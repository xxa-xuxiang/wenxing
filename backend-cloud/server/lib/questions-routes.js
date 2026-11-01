// 问星 v1.1 — 题库路由：浏览+分面 / 按技能叶子凑题(JIT 触发出题) / 覆盖度 / 叶子检索 / 旧题迁移
import { db, serializeWrite } from './db.js'
import { wrap } from './ai.js'
import { auth } from './auth.js'
import { fillLeaf } from './question-pipeline.js'
import { aiQuotaAllowed, consumeAiQuota } from './ai-guard.js'
import { leafKeyOf } from './skill-leaves.js'
import { toQuestionDTO } from './question-dto.js'
import { createRateLimit } from './rate-limit.js'

// 纠错反馈/旧题迁移的写操作限流（按登录用户），防止批量下架题目或灌库
const feedbackLimit = createRateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '操作过于频繁，请稍后再试'
})
const migrateLimit = createRateLimit({
  windowMs: 60_000,
  max: 3,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '迁移过于频繁，请稍后再试'
})

// 同一叶子的补题任务合并：并发请求/多端同时触发时只跑一次 AI，其余共享同一结果
const fillLocks = new Map()
function fillLeafOnce(leaf) {
  const key = String(leaf.id)
  const running = fillLocks.get(key)
  if (running) return running
  const task = fillLeaf(leaf, { fetchWeb: true }).finally(() => fillLocks.delete(key))
  fillLocks.set(key, task)
  return task
}

const TYPE_VALS = ['single', 'multiple', 'short', 'coding']
const DIFF_VALS = ['easy', 'medium', 'hard']

function listParam(v, allowed) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => allowed.includes(s))
}

/** 题目 → 前端 DTO（共享实现见 question-dto.js） */
const toDTO = toQuestionDTO

/** 解析浏览过滤条件（facet 计数时排除某一组用 except） */
function buildFilter(query, except = null) {
  const where = { status: 'verified' }
  const types = listParam(query.type, TYPE_VALS)
  const diffs = listParam(query.difficulty, DIFF_VALS)
  if (except !== 'type' && types.length) where.type = { in: types }
  if (except !== 'difficulty' && diffs.length) where.difficulty = { in: diffs }
  if (except !== 'industry' && query.industry) where.leaf = { is: { industry: String(query.industry) } }
  if (except !== 'leaf' && query.leafKey) where.leaf = { is: { leafKey: String(query.leafKey) } }
  if (query.q) {
    const kw = String(query.q).trim().slice(0, 60)
    if (kw) {
      where.OR = [
        { title: { contains: kw } },
        { body: { contains: kw } },
        { leaf: { is: { name: { contains: kw } } } }
      ]
    }
  }
  return where
}

export default function registerQuestionRoutes(app) {
  // ===== 题库浏览：分页 + 服务端分面计数 =====
  app.get(
    '/api/questions',
    wrap(async (req, res) => {
      const page = Math.max(1, Number(req.query.page) || 1)
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 60))
      const where = buildFilter(req.query)
      const [total, rows, diffFacets, typeFacets, industryFacets] = await Promise.all([
        db.question.count({ where }),
        db.question.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { leaf: true }
        }),
        (async () => {
          const out = []
          for (const val of DIFF_VALS) {
            const w = buildFilter(req.query, 'difficulty')
            w.difficulty = val
            out.push({ val, count: await db.question.count({ where: w }) })
          }
          return out
        })(),
        (async () => {
          const out = []
          for (const val of TYPE_VALS) {
            const w = buildFilter(req.query, 'type')
            w.type = val
            out.push({ val, count: await db.question.count({ where: w }) })
          }
          return out
        })(),
        (async () => {
          // 行业分面：按行业聚合计数（20 个固定行业）
          const groups = await db.question.groupBy({
            by: ['leafId'],
            where: buildFilter(req.query, 'industry'),
            _count: { _all: true }
          })
          const leaves = await db.skillLeaf.findMany({
            where: { id: { in: groups.map((g) => g.leafId) } },
            select: { id: true, industry: true }
          })
          const map = new Map()
          for (const g of groups) {
            const ind = leaves.find((l) => l.id === g.leafId)?.industry
            if (!ind) continue
            map.set(ind, (map.get(ind) || 0) + g._count._all)
          }
          return [...map.entries()].map(([val, count]) => ({ val, count })).sort((a, b) => b.count - a.count)
        })()
      ])
      res.json({
        items: rows.map(toDTO),
        total,
        page,
        pageSize,
        facets: { difficulty: diffFacets, type: typeFacets, industry: industryFacets }
      })
    })
  )

  // ===== 叶子检索（组卷/凑题选择技能点用） =====
  app.get(
    '/api/leaves/search',
    wrap(async (req, res) => {
      const q = String(req.query.q || '').trim().slice(0, 40)
      const industry = String(req.query.industry || '')
      if (!q) return res.json({ items: [] })
      const leaves = await db.skillLeaf.findMany({
        where: {
          ...(industry ? { industry } : {}),
          name: { contains: q }
        },
        take: 10,
        orderBy: { industry: 'asc' }
      })
      const jobs = await db.fillJobItem.findMany({
        where: { leafKey: { in: leaves.map((l) => l.leafKey) } }
      })
      const jobMap = new Map(jobs.map((j) => [j.leafKey, j]))
      res.json({
        items: leaves.map((l) => ({
          leafKey: l.leafKey,
          name: l.name,
          industry: l.industry,
          pathText: l.pathText,
          verifiedCount: jobMap.get(l.leafKey)?.verifiedCount || 0,
          status: jobMap.get(l.leafKey)?.status || 'pending'
        }))
      })
    })
  )

  // ===== 按技能叶子凑题：verified 不足时同步触发管线（JIT） =====
  async function serveBySkill(leaf, { count = 20, generate = true, req } = {}) {
    const take = Math.min(50, Math.max(1, Number(count) || 20))
    const pickRandom = async () =>
      db.$queryRawUnsafe(
        `SELECT q.* FROM "Question" q WHERE q."leafId" = ? AND q."status" = 'verified' ORDER BY RANDOM() LIMIT ?`,
        leaf.id,
        take
      )
    let rows = await pickRandom()
    let pipeline = null
    let quotaExhausted = false
    if (rows.length < take && generate) {
      // 出题管线固定走平台 Key（不透传用户自带 Key），因此不能按自带 Key 放行额度
      if (aiQuotaAllowed(req, 'questions', { honorUserKey: false })) {
        consumeAiQuota(req, 'questions', { honorUserKey: false })
        pipeline = await fillLeafOnce(leaf)
        rows = await pickRandom()
      } else {
        quotaExhausted = true
      }
    }
    const fullRows = await db.question.findMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'verified' },
      include: { leaf: true }
    })
    return {
      items: rows
        .map((r) => fullRows.find((f) => f.id === r.id))
        .filter(Boolean)
        .map(toDTO),
      leaf: { leafKey: leaf.leafKey, name: leaf.name, pathText: leaf.pathText, industry: leaf.industry },
      pipeline,
      quotaExhausted
    }
  }

  app.get(
    '/api/questions/by-skill',
    wrap(async (req, res) => {
      const leafKey = String(req.query.leafKey || '')
      const leaf = leafKey ? await db.skillLeaf.findUnique({ where: { leafKey } }) : null
      if (!leaf) throw new Error('技能点不存在或缺少 leafKey')
      const data = await serveBySkill(leaf, {
        count: Number(req.query.count) || 20,
        generate: req.query.generate !== '0',
        req
      })
      res.json(data)
    })
  )

  app.post(
    '/api/questions/by-skill',
    wrap(async (req, res) => {
      const body = req.body ?? {}
      let leaf = null
      if (body.leafKey) leaf = await db.skillLeaf.findUnique({ where: { leafKey: String(body.leafKey) } })
      if (!leaf && body.path) {
        leaf = await db.skillLeaf.findUnique({ where: { leafKey: leafKeyOf(body.path) } })
      }
      if (!leaf) throw new Error('技能点不存在（无法匹配叶子注册表）')
      const data = await serveBySkill(leaf, {
        count: Number(body.count) || 20,
        generate: body.generate !== false,
        req
      })
      res.json(data)
    })
  )

  // ===== 覆盖度看板（按行业） =====
  app.get(
    '/api/questions/coverage',
    wrap(async (req, res) => {
      const leaves = await db.skillLeaf.groupBy({ by: ['industry'], _count: { _all: true } })
      const jobs = await db.fillJobItem.groupBy({
        by: ['status', 'leafKey'],
        _count: { _all: true }
      })
      const qGroups = await db.question.groupBy({
        by: ['leafId'],
        where: { status: 'verified' },
        _count: { _all: true }
      })
      const leafRows = await db.skillLeaf.findMany({ select: { id: true, industry: true, leafKey: true } })
      const industryByLeafId = new Map(leafRows.map((l) => [l.id, l.industry]))
      const industryByLeafKey = new Map(leafRows.map((l) => [l.leafKey, l.industry]))
      const jobByLeafKey = new Map()
      for (const j of jobs) {
        const industry = industryByLeafKey.get(j.leafKey)
        if (!industry) continue
        const key = `${industry}|${j.status}`
        jobByLeafKey.set(key, (jobByLeafKey.get(key) || 0) + j._count._all)
      }
      const qByIndustry = new Map()
      for (const g of qGroups) {
        const industry = industryByLeafId.get(g.leafId)
        if (industry) qByIndustry.set(industry, (qByIndustry.get(industry) || 0) + g._count._all)
      }
      const items = leaves
        .map((l) => ({
          industry: l.industry,
          leaves: l._count._all,
          filled: jobByLeafKey.get(`${l.industry}|filled`) || 0,
          blocked: jobByLeafKey.get(`${l.industry}|blocked`) || 0,
          materializing: jobByLeafKey.get(`${l.industry}|materializing`) || 0,
          failed: jobByLeafKey.get(`${l.industry}|failed`) || 0,
          questions: qByIndustry.get(l.industry) || 0
        }))
        .sort((a, b) => b.questions - a.questions || a.industry.localeCompare(b.industry))
      res.json({ items, targetPerLeaf: Number(process.env.QUESTION_TARGET_PER_LEAF || 20) })
    })
  )

  // ===== 题目纠错反馈（质量闭环）：累计到阈值自动下架该题，并把所属叶子重新排入填充队列 =====
  app.post(
    '/api/questions/:id/feedback',
    auth,
    feedbackLimit,
    wrap(async (req, res) => {
      const id = String(req.params.id)
      const reason = String(req.body?.reason || '').slice(0, 300)
      const q = await db.question.findUnique({ where: { id }, include: { leaf: true } })
      if (!q) throw new Error('题目不存在')

      const uid = req.user.id
      // 仅允许对本人做过的题提交纠错，避免任意用户对没接触过的题刷反馈下架
      const answered = await db.quizAnswer.findFirst({
        where: { questionId: id, session: { userId: uid } },
        select: { id: true }
      })
      if (!answered) {
        res.status(403).json({ error: '只能对做过的题目提交纠错' })
        return
      }
      // 同一用户对同一题只计一次：用审计 reason 前缀标记用户（避免额外表结构变更）
      const marker = `[uid:${uid}]`
      const dup = await db.questionAudit.findFirst({
        where: { questionId: id, verdict: 'feedback', reason: { startsWith: marker } }
      })
      if (dup) {
        res.json({ ok: true, feedbackCount: q.feedbackCount, retired: false, duplicated: true })
        return
      }

      // 写入串行化（与铺题 worker 共用同一写队列，避免 SQLite 写锁争用）
      const updated = await serializeWrite(() =>
        db.question.update({ where: { id }, data: { feedbackCount: { increment: 1 } } })
      )
      await serializeWrite(() =>
        db.questionAudit.create({
          data: {
            questionId: id,
            verdict: 'feedback',
            reason: `${marker} ${reason || '用户标记题目有误'}`.slice(0, 320),
            attempt: updated.feedbackCount
          }
        })
      )
      // 阈值下架：同一题累计 3 名不同用户反馈即不再对用户可见，并让所属叶子重新补题
      const THRESHOLD = 3
      let retired = false
      if (updated.feedbackCount >= THRESHOLD && updated.status === 'verified') {
        await serializeWrite(async () => {
          await db.question.update({ where: { id }, data: { status: 'rejected' } })
          // updateMany：叶子可能没有填充任务行，避免抛出 P2025 导致 500
          await db.fillJobItem.updateMany({
            where: { leafKey: q.leaf.leafKey },
            data: { status: 'pending', lastError: '用户反馈下架，待重新出题', updatedAt: new Date() }
          })
        })
        retired = true
      }
      res.json({ ok: true, feedbackCount: updated.feedbackCount, retired })
    })
  )

  // ===== 旧版 localStorage 自定义题迁移（登录后一次性；按知识点名匹配叶子，匹配不上则跳过） =====
  app.post(
    '/api/questions/migrate',
    auth,
    migrateLimit,
    wrap(async (req, res) => {
      const list = Array.isArray(req.body?.questions) ? req.body.questions : []
      let imported = 0
      let skipped = 0
      for (const raw of list.slice(0, 500)) {
        const kps = Array.isArray(raw?.knowledgePoints) ? raw.knowledgePoints.filter((x) => typeof x === 'string') : []
        const title = String(raw?.title || '').trim()
        if (!title || kps.length === 0) {
          skipped += 1
          continue
        }
        const leaf = await db.skillLeaf.findFirst({ where: { name: kps[0] } })
        if (!leaf) {
          skipped += 1
          continue
        }
        const dup = await db.question.findFirst({ where: { leafId: leaf.id, title } })
        if (dup) {
          skipped += 1
          continue
        }
        await db.question.create({
          data: {
            leafId: leaf.id,
            type: TYPE_VALS.includes(raw.type) ? raw.type : 'short',
            difficulty: DIFF_VALS.includes(raw.difficulty) ? raw.difficulty : 'medium',
            title: title.slice(0, 60),
            body: String(raw.body || title).slice(0, 2000),
            options: JSON.stringify(Array.isArray(raw.options) ? raw.options : []),
            answer: String(raw.answer || '').slice(0, 1000),
            explanation: '旧版本地题目迁移（暂无解析）',
            sources: JSON.stringify([{ url: 'local://migrated', title: '本地迁移题', snippet: '' }]),
            // 客户端上传内容未经审核，禁止直接进入公共题库：落 draft，待管理员复核后再上线
            status: 'draft',
            source: 'migrated'
          }
        })
        imported += 1
      }
      res.json({ imported, skipped, total: list.length })
    })
  )
}
