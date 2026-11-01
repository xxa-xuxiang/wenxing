// 问星 v1.1 — 题目生产管线（「不能瞎编」的执行核心）
// 七步：语料检索 → RAG 出题 → 结构校验 → verifier 二审 → 向量去重 → 入库 → 更新填充账本
// 全部 LLM 调用只发生在服务端；任何题必须带非空解析与至少 1 条真实出处才可能 verified
import { deepseek } from './ai.js'
import { embed, embeddingModel, cosine } from './embedding.js'
import { vecToBlob, blobToVec } from './vec.js'
import { retrieveChunks } from './corpus.js'
import { materializeForLeaf } from './web-fetch.js'
import { db, serializeWrite } from './db.js'
import { createLogger } from './logger.js'

const log = createLogger('question-pipeline')

const TARGET = Number(process.env.QUESTION_TARGET_PER_LEAF || 20)
const BATCH = 5
const DEDUP_COSINE = Number(process.env.DEDUP_COSINE || 0.92)
/** 单次 LLM 调用前的礼貌间隔（实测接口可承受高并发，间隔只用于轻微削峰） */
const SLEEP_MS = Number(process.env.PIPELINE_SLEEP_MS || 120)
/** 同一叶子内部并行的批次数（题型之间互不依赖，可并行以缩短单叶子耗时） */
const BATCH_CONCURRENCY = Math.max(1, Number(process.env.PIPELINE_BATCH_CONCURRENCY || 3))

// 仅这些行业出编程题；其余行业编程配额自动转为情景简答
const CODING_INDUSTRIES = new Set(['信息技术与软件', '通信电子与半导体'])

const DIFF_LABEL = { easy: '简单', medium: '中等', hard: '困难' }
const TYPE_LABEL = { single: '单选题', multiple: '多选题', short: '简答题', coding: '编程题' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = () => SLEEP_MS + Math.floor(Math.random() * SLEEP_MS)

/** 每叶子题型配额：单选 10 / 多选 4 / 简答 4 / 编程 2（非数字行业编程 2 题并入简答→简答 6） */
export function typeQuotas(industry) {
  const coding = CODING_INDUSTRIES.has(industry) ? 2 : 0
  return { single: 10, multiple: 4, short: 6 - coding, coding }
}

/** 各题型是否都已达标（filled 的判定必须按题型，不能只看总题数） */
export function quotasMet(existingByType, industry) {
  const q = typeQuotas(industry)
  return (
    (existingByType.single || 0) >= q.single &&
    (existingByType.multiple || 0) >= q.multiple &&
    (existingByType.short || 0) >= q.short &&
    (existingByType.coding || 0) >= q.coding
  )
}

/** 把 n 道题按 易8/中8/难4 的比例分配（最大余数法） */
function splitDifficulty(n) {
  const ratio = { easy: 8, medium: 8, hard: 4 }
  const raw = Object.entries(ratio).map(([k, v]) => [k, (n * v) / TARGET])
  const floor = raw.map(([k, v]) => [k, Math.floor(v)])
  let left = n - floor.reduce((s, [, v]) => s + v, 0)
  const order = raw
    .map(([k, v], i) => [k, v - Math.floor(v), i])
    .sort((a, b) => b[1] - a[1])
  const alloc = Object.fromEntries(floor)
  for (const [k] of order) {
    if (left <= 0) break
    alloc[k] += 1
    left -= 1
  }
  return alloc
}

/** 生成「批次规格」：每批 ≤5 题，指定每题类型与难度；只列尚缺的名额（续跑时按类型补差） */
export function planBatches(existingByType, industry) {
  const quota = typeQuotas(industry)
  const flat = []
  for (const type of ['single', 'multiple', 'short', 'coding']) {
    const need = Math.max(0, (quota[type] || 0) - (existingByType[type] || 0))
    const add = splitDifficulty(need)
    for (const d of ['easy', 'medium', 'hard']) {
      for (let i = 0; i < add[d]; i++) flat.push({ type, difficulty: d })
    }
  }
  const batches = []
  // 同类型聚批，保证每批题型一致（prompt 更稳）
  for (const type of ['single', 'multiple', 'short', 'coding']) {
    const items = flat.filter((s) => s.type === type)
    for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH))
  }
  return batches
}

function extractJson(raw) {
  const t = String(raw).trim()
  const direct = JSON.parse(t)
  return direct
}

function safeParse(raw) {
  try {
    return extractJson(raw)
  } catch {
    const m = /\{[\s\S]*\}/.exec(String(raw))
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* fallthrough */
      }
    }
    return null
  }
}

/** RAG 出题：严格限定只能用参考资料 */
async function generateBatch(leaf, chunks, spec, retryRound = 0) {
  const specText = spec
    .map((s, i) => `${i + 1}. ${TYPE_LABEL[s.type]}，难度${DIFF_LABEL[s.difficulty]}`)
    .join('\n')
  const corpusText = chunks
    .map((c, i) => `【资料${i + 1}】（出处：${c.title} ${c.url}）\n${c.text}`)
    .join('\n\n')
  const sys = `你是「问星」的严格出题器。规则：
1. 只能依据下面的「参考资料」出题，资料不支持的事实一律不许写，宁可不写也不能编造。
2. 每题必须包含：title（10-30字题目名）、body（完整题干）、answer、explanation（80-200字解析，讲清正确答案为什么对、易混点是什么）、sources（支撑该题答案的资料编号数组，如[1,3]，至少1个）。
3. 单选题 single：options 必须4个且互不等同，answer 为单个字母如"A"；多选题 multiple：options 4个，answer 为2-3个字母如"AC"；简答 short 与编程 coding 无 options，answer 是参考答案要点（关键词明确，便于判分），编程题要求给出可运行思路或关键代码。
4. 题目要有真实场景感，难度分布：简单=概念直接辨析；中等=需要一步推理/应用；困难=多概念综合或排错。
5. 只输出 JSON：{"questions":[...]}，不要任何解释。${retryRound > 0 ? '\n注意：上一批有题目未通过校验或找不到资料依据，本次务必确保每题 sources 真实可查、答案与资料一致。' : ''}`
  const user = `技能叶子路径：${leaf.pathText}
本批需要 ${spec.length} 题，规格：
${specText}

参考资料：
${corpusText}`
  const raw = await deepseek(
    [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ],
    true
  )
  const parsed = safeParse(raw)
  const list = Array.isArray(parsed) ? parsed : parsed?.questions
  return Array.isArray(list) ? list : []
}

/** verifier：整批二审，输出每题是否被资料支持 */
async function verifyBatch(leaf, chunks, questions) {
  const corpusText = chunks
    .map((c, i) => `【资料${i + 1}】${c.text}`)
    .join('\n\n')
  const qText = questions
    .map(
      (q, i) =>
        `${i + 1}. [${TYPE_LABEL[q.type]}] ${q.title}\n题干：${q.body}\n答案：${q.answer}\n解析：${q.explanation}\n引用：${(q.sources || []).join(',')}`
    )
    .join('\n\n')
  const sys = `你是「问星」的题目审校。逐题核对：题目与正确答案是否被给定参考资料直接支持、答案本身是否正确、解析是否与答案一致。
资料完全没提到、需要常识以外推断、或答案错误的题判 supported=false，并在 reason 中用 30 字内说明。
只输出 JSON：{"verdicts":[{"index":1,"supported":true,"reason":""}]}`
  const raw = await deepseek(
    [
      { role: 'system', content: sys },
      { role: 'user', content: `技能叶子：${leaf.pathText}\n参考资料：\n${corpusText}\n\n题目：\n${qText}` }
    ],
    true
  )
  const parsed = safeParse(raw)
  const arr = Array.isArray(parsed?.verdicts) ? parsed.verdicts : []
  const map = new Map()
  for (const v of arr) map.set(Number(v.index) - 1, Boolean(v.supported))
  return questions.map((q, i) => {
    const supported = map.get(i) === true
    const reason = arr.find((v) => Number(v.index) - 1 === i)?.reason
    return { supported, reason: typeof reason === 'string' ? reason.slice(0, 200) : '' }
  })
}

/** 结构校验；返回错误原因，null = 通过
 *  选择题选项做「去重 + 答案字母重映射」容错：模型常给重复选项或少于 4 项，
 *  直接判废会白白浪费一次生成（实测占驳回量的 1/4），去重后仍 ≥3 项即保留 */
function validate(q, chunksLen, spec) {
  if (!q || typeof q.title !== 'string' || q.title.trim().length < 5) return '标题不合规'
  if (typeof q.body !== 'string' || q.body.trim().length < 8) return '题干过短'
  if (typeof q.answer !== 'string' || q.answer.trim().length < 1) return '答案为空'
  if (typeof q.explanation !== 'string' || q.explanation.trim().length < 30) return '解析缺失或过短'
  const src = Array.isArray(q.sources) ? q.sources : []
  const validSrc = src.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= chunksLen)
  if (validSrc.length === 0) return '缺少有效出处'
  q.sources = Array.from(new Set(validSrc))

  if (spec?.type === 'single' || spec?.type === 'multiple') {
    const raw = Array.isArray(q.options) ? q.options.map((o) => String(o ?? '').trim()) : []
    if (raw.length < 3) return '选项不足3个'
    // 去重并建立「原索引 → 去重后索引」映射
    const dict = new Map()
    const uniq = []
    const remap = new Array(raw.length).fill(-1)
    raw.forEach((t, i) => {
      if (!t) return
      if (dict.has(t)) {
        remap[i] = dict.get(t)
        return
      }
      remap[i] = uniq.length
      dict.set(t, uniq.length)
      uniq.push(t)
    })
    if (uniq.length < 3) return '选项不足3个（去重后）'
    const rawLetters = String(q.answer).toUpperCase().replace(/[^A-Z]/g, '').split('').filter(Boolean)
    const mapped = new Set()
    for (const l of rawLetters) {
      const idx = l.charCodeAt(0) - 65
      if (idx < 0 || idx >= raw.length) return '答案字母越界'
      const ni = remap[idx]
      if (ni >= 0) mapped.add(ni)
    }
    if (mapped.size === 0) return '答案与选项不匹配'
    if (spec.type === 'single' && mapped.size !== 1) return '单选答案必须1个字母'
    if (spec.type === 'multiple' && (mapped.size < 2 || mapped.size > 3)) return '多选答案必须2-3个字母'
    q.options = uniq.slice(0, 5)
    q.answer = [...mapped]
      .filter((i) => i < q.options.length)
      .sort((a, b) => a - b)
      .map((i) => String.fromCharCode(65 + i))
      .join('')
    if (!q.answer) return '答案与选项不匹配（去重后越界）'
  } else {
    q.options = undefined
    if (String(q.answer).trim().length < 2) return '参考答案过短'
  }
  q.type = spec?.type
  q.difficulty = spec?.difficulty
  return null
}

/**
 * 填充单个叶子到目标题量（可重复调用，断点续跑）
 * @param {object} opts.leaf SkillLeaf 行
 * @param {boolean} opts.fetchWeb 是否允许联网补语料（JIT 可关）
 * @returns {Promise<{status,verifiedCount,added,rejected,blockedReason?}>}
 */
export async function fillLeaf(leaf, { fetchWeb = true } = {}) {
  const job = await serializeWrite(() =>
    db.fillJobItem.upsert({
      where: { leafKey: leaf.leafKey },
      update: { status: 'materializing' },
      create: { leafKey: leaf.leafKey, status: 'materializing' }
    })
  )
  try {
    // ① 语料：先检索；数量不足或来源域名过于单一（<2 个域）时联网补齐
    const retrieveQuery = `${leaf.name} ${leaf.stack}`.trim()
    let chunks = await retrieveChunks(retrieveQuery, { industry: leaf.industry, topK: 12 })
    const domainCount = () => new Set(chunks.map((c) => c.siteDomain)).size
    if (fetchWeb && (chunks.length < 2 || domainCount() < 2)) {
      const mat = await materializeForLeaf(leaf)
      if (mat.chunks > 0 || mat.fetched > 0) {
        chunks = await retrieveChunks(retrieveQuery, { industry: leaf.industry, topK: 12 })
      }
    }
    if (chunks.length < 2) {
      await serializeWrite(() =>
        db.fillJobItem.update({
          where: { leafKey: leaf.leafKey },
          data: { status: 'blocked', lastError: '合规语料不足（白名单抓取失败），等待人工语料', attempts: { increment: 1 }, updatedAt: new Date() }
        })
      )
      return { status: 'blocked', verifiedCount: job.verifiedCount, added: 0, rejected: 0, blockedReason: 'corpus' }
    }

    // 已有 verified 题（按类型计数，用于续跑）
    const existing = await db.question.findMany({
      where: { leafId: leaf.id, status: 'verified' },
      select: { type: true, embedding: true, dim: true }
    })
    const existByType = { single: 0, multiple: 0, short: 0, coding: 0 }
    const existVecs = []
    for (const q of existing) {
      existByType[q.type] = (existByType[q.type] || 0) + 1
      if (q.embedding) existVecs.push(blobToVec(q.embedding))
    }

    const batches = planBatches(existByType, leaf.industry)
    let added = 0
    let rejected = 0
    const model = embeddingModel()
    // 去重集合跨批共享（同叶子内不同批次的题也不允许互相重复）
    const dedupVecs = existVecs
    /** 单批处理：生成 → 结构校验 → 二审 → 去重 → 入库，返回本批通过数 */
    const runBatch = async (spec) => {
      let acceptedInBatch = 0
      // 只要本批还没凑齐就继续重试（最多 3 轮），尽量减少「只差几题」的半成品叶子
      for (let round = 0; round < 3 && acceptedInBatch < spec.length; round++) {
        const need = spec.slice(acceptedInBatch)
        await sleep(jitter())
        let generated
        try {
          generated = await generateBatch(leaf, chunks, need, round)
        } catch (e) {
          if (round === 2) throw e
          continue
        }
        const candidates = []
        for (let i = 0; i < need.length; i++) {
          const q = generated[i]
          if (!q) continue
          const err = validate(q, chunks.length, need[i])
          candidates.push({ q, err })
        }
        const toVerify = candidates.filter((c) => !c.err)
        let verdicts = []
        if (toVerify.length) {
          await sleep(jitter())
          try {
            verdicts = await verifyBatch(
              leaf,
              chunks,
              toVerify.map((c) => c.q)
            )
          } catch {
            verdicts = toVerify.map(() => ({ supported: false, reason: '审校调用失败' }))
          }
        }
        // ⑥ 向量去重（含跨批与已有题目互斥）
        const texts = toVerify.map((c) => `${c.q.title}\n${c.q.body}\n${c.q.explanation}`)
        const vecs = texts.length ? await embed(texts) : []
        for (let i = 0; i < toVerify.length; i++) {
          const { q } = toVerify[i]
          const verdict = verdicts[i] || { supported: false, reason: '无审校结果' }
          let rejectReason = verdict.supported ? '' : `verifier:${verdict.reason || '不支持'}`
          if (!rejectReason && dedupVecs.some((v) => cosine(v, vecs[i]) > DEDUP_COSINE)) rejectReason = 'duplicate'
          if (rejectReason) {
            rejected += 1
            await persistQuestion(leaf, q, chunks, { status: 'rejected', reason: rejectReason, model, vec: null })
            continue
          }
          dedupVecs.push(vecs[i])
          await persistQuestion(leaf, q, chunks, { status: 'verified', reason: '', model, vec: vecs[i] })
          added += 1
          acceptedInBatch += 1
        }
        // 结构不合格的也留痕
        for (const { q, err } of candidates.filter((c) => c.err)) {
          rejected += 1
          await persistQuestion(leaf, q, chunks, { status: 'rejected', reason: `schema:${err}`, model, vec: null }).catch(() => {})
        }
      }
      return acceptedInBatch
    }

    // 批次并行（题型之间互不依赖），用「分批并发」控制同时在飞的 LLM 请求数
    for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
      const group = batches.slice(i, i + BATCH_CONCURRENCY)
      await Promise.all(
        group.map((spec) =>
          runBatch(spec).catch((e) => {
            log.warn(`批次失败（${leaf.name}）：${String(e?.message || e).slice(0, 120)}`)
            return 0
          })
        )
      )
      // 每完成一组即刷新账本计数，便于中断后观察进度
      const c = await db.question.count({ where: { leafId: leaf.id, status: 'verified' } })
      await serializeWrite(() =>
        db.fillJobItem.update({
          where: { leafKey: leaf.leafKey },
          data: { verifiedCount: c, lastError: '', updatedAt: new Date() }
        })
      )
    }

    const verifiedCount = await db.question.count({ where: { leafId: leaf.id, status: 'verified' } })
    const finalByType = { single: 0, multiple: 0, short: 0, coding: 0 }
    const grp = await db.question.groupBy({ by: ['type'], where: { leafId: leaf.id, status: 'verified' }, _count: { _all: true } })
    for (const g of grp) finalByType[g.type] = g._count._all
    const status = quotasMet(finalByType, leaf.industry) ? 'filled' : 'materializing'
    await serializeWrite(() =>
      db.fillJobItem.update({
        where: { leafKey: leaf.leafKey },
        data: { status, verifiedCount, attempts: { increment: 1 }, lastError: '', updatedAt: new Date() }
      })
    )
    return { status, verifiedCount, added, rejected }
  } catch (e) {
    await serializeWrite(() =>
      db.fillJobItem.update({
        where: { leafKey: leaf.leafKey },
        data: { status: 'failed', lastError: String(e?.message || e).slice(0, 300), attempts: { increment: 1 }, updatedAt: new Date() }
      })
    )
    throw e
  }
}

async function persistQuestion(leaf, q, chunks, { status, reason, model, vec }) {
  const sources = (q.sources || [])
    .map((i) => {
      const c = chunks[i - 1]
      return c ? { url: c.url, title: c.title, snippet: c.text.slice(0, 160) } : null
    })
    .filter(Boolean)
  // 写入串行化：LLM 调用高并发时，SQLite 只允许一个写事务，必须排队
  return serializeWrite(async () => {
    const row = await db.question.create({
      data: {
        leafId: leaf.id,
        type: q.type || 'short',
        difficulty: q.difficulty || 'medium',
        title: String(q.title).slice(0, 60),
        body: String(q.body || q.title).slice(0, 2000),
        options: JSON.stringify(Array.isArray(q.options) ? q.options : []),
        answer: String(q.answer || '').slice(0, 1000),
        explanation: String(q.explanation || '').slice(0, 2000),
        sources: JSON.stringify(sources),
        embedding: vec ? vecToBlob(vec) : null,
        dim: vec?.length || 0,
        model,
        status,
        source: 'rag'
      }
    })
    if (reason) {
      await db.questionAudit.create({
        data: { questionId: row.id, verdict: status === 'verified' ? 'supported' : 'rejected', reason, attempt: 1 }
      })
    }
    return row
  })
}
