// 问星 v1.1 — 题库填充 worker（P7 全量铺开）
// 按行业/限定数量取 pending 任务 → 逐叶子跑出题管线（语料→RAG→校验→二审→去重→入库）
// 特性：断点续跑（账本在 FillJobItem）、可随时 Ctrl+C 停止、失败叶子记录可重试、进度实时打印
// 用法（在 server/）：
//   node --env-file=.env scripts/fill-worker.mjs --industry 信息技术与软件
//   node --env-file=.env scripts/fill-worker.mjs --limit 20            # 全行业任意 20 个叶子（试跑）
//   node --env-file=.env scripts/fill-worker.mjs --concurrency 3 --max-attempts 2
import { PrismaClient } from '@prisma/client'
import { fillLeaf } from '../lib/question-pipeline.js'

const db = new PrismaClient()

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1]
  if (process.argv.includes(`--${name}`)) return true
  return def
}

const INDUSTRY = typeof arg('industry', '') === 'string' ? arg('industry', '') : ''
const LIMIT = Number(arg('limit', 0)) || 0
const CONCURRENCY = Math.max(1, Math.min(48, Number(arg('concurrency', process.env.FILL_CONCURRENCY || 3))))
const MAX_ATTEMPTS = Number(arg('max-attempts', 5))
const RETRY_BLOCKED = process.argv.includes('--retry-blocked')
/** 目标题量（与管线一致） */
const TARGET = Number(process.env.QUESTION_TARGET_PER_LEAF || 20)

let stopping = false
process.on('SIGINT', () => {
  console.log('\n[worker] 收到停止信号：当前批次跑完后退出（进度已落账本，可随时续跑）')
  stopping = true
})

const stats = { done: 0, filled: 0, partial: 0, blocked: 0, failed: 0, questions: 0, rejected: 0 }
const t0 = Date.now()

function progressLine() {
  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  return `[${mins}min] 完成 ${stats.done} 叶子 ｜ 满配 ${stats.filled} · 部分 ${stats.partial} · 语料不足 ${stats.blocked} · 失败 ${stats.failed} ｜ 新题 ${stats.questions}（驳回 ${stats.rejected}）`
}

/** 取下一批待处理任务
 *  不指定行业时按「行业轮转」各取 1 个：保证 20 个行业同时推进，
 *  避免题库里长时间只出现第一个行业的题目（按 updatedAt 排会先把首个行业刷完） */
async function takeBatch(size) {
  const statuses = RETRY_BLOCKED ? ['pending', 'failed', 'materializing', 'blocked'] : ['pending', 'failed', 'materializing']
  const base = {
    status: { in: statuses },
    ...(RETRY_BLOCKED ? {} : { attempts: { lt: MAX_ATTEMPTS } })
  }
  if (INDUSTRY) {
    return db.fillJobItem.findMany({
      where: { ...base, leaf: { industry: INDUSTRY } },
      include: { leaf: true },
      orderBy: [{ attempts: 'asc' }, { updatedAt: 'asc' }],
      take: size
    })
  }
  // 行业轮转：本轮起点用时间戳错开，避免每轮都从同一行业开头
  const industries = (
    await db.skillLeaf.findMany({ distinct: ['industry'], select: { industry: true }, orderBy: { industry: 'asc' } })
  ).map((r) => r.industry)
  if (industries.length === 0) return []
  const offset = Math.floor(Date.now() / 1000) % industries.length
  const rotated = [...industries.slice(offset), ...industries.slice(0, offset)]
  const picked = []
  const seen = new Set()
  for (const industry of rotated) {
    if (picked.length >= size) break
    const job = await db.fillJobItem.findFirst({
      where: { ...base, leaf: { industry } },
      include: { leaf: true },
      orderBy: [{ attempts: 'asc' }, { updatedAt: 'asc' }]
    })
    if (job && !seen.has(job.leafKey)) {
      picked.push(job)
      seen.add(job.leafKey)
    }
  }
  // 行业都取过了还有余量（并发 > 行业数）时，用全局队列补齐
  if (picked.length < size) {
    const rest = await db.fillJobItem.findMany({
      where: { ...base, leafKey: { notIn: [...seen] } },
      include: { leaf: true },
      orderBy: [{ attempts: 'asc' }, { updatedAt: 'asc' }],
      take: size - picked.length
    })
    picked.push(...rest)
  }
  return picked
}

async function runOne(job, maxAttempts) {
  const leaf = job.leaf
  try {
    const r = await fillLeaf(leaf, { fetchWeb: true })
    stats.done += 1
    stats.questions += r.added || 0
    stats.rejected += r.rejected || 0
    if (r.status === 'filled') stats.filled += 1
    else if (r.status === 'blocked') stats.blocked += 1
    else stats.partial += 1
    // 重试已用尽但仍未满配 → 如实置 blocked（含缺口题量），避免叶子被静默留在半成品状态
    if (r.status !== 'filled' && r.status !== 'blocked') {
      const fresh = await db.fillJobItem.findUnique({ where: { leafKey: leaf.leafKey } })
      if (fresh && fresh.attempts >= maxAttempts) {
        await db.fillJobItem.update({
          where: { leafKey: leaf.leafKey },
          data: {
            status: 'blocked',
            lastError: `重试 ${fresh.attempts} 轮仅 ${fresh.verifiedCount}/${TARGET} 题：合规公开语料不足，待人工补语料`
          }
        })
        stats.partial -= 1
        stats.blocked += 1
        console.log(`⊘ [blocked] ${leaf.pathText} → ${fresh.verifiedCount}/${TARGET} 题（语料不足，已标注待补）`)
        return
      }
    }
    console.log(`✓ [${r.status}] ${leaf.pathText} → ${r.verifiedCount} 题（+${r.added} / 驳回 ${r.rejected}）`)
  } catch (e) {
    stats.done += 1
    stats.failed += 1
    console.error(`✗ [failed] ${leaf.pathText}: ${String(e?.message || e).slice(0, 120)}`)
  }
}

async function main() {
  console.log(`[worker] 启动 ｜ 行业=${INDUSTRY || '全部'} ｜ 并发=${CONCURRENCY} ｜ 最大尝试=${MAX_ATTEMPTS} ｜ 上限=${LIMIT || '不限'}`)
  const totalTodo = await db.fillJobItem.count({
    where: {
      status: RETRY_BLOCKED ? { in: ['pending', 'failed', 'materializing', 'blocked'] } : { in: ['pending', 'failed', 'materializing'] },
      ...(INDUSTRY ? { leaf: { industry: INDUSTRY } } : {})
    }
  })
  console.log(`[worker] 待处理叶子 ${totalTodo} 个（目标 每叶子 ${process.env.QUESTION_TARGET_PER_LEAF || 20} 题）`)

  while (!stopping) {
    if (LIMIT && stats.done >= LIMIT) break
    const batch = await takeBatch(Math.min(CONCURRENCY, LIMIT ? LIMIT - stats.done : CONCURRENCY))
    if (batch.length === 0) {
      console.log('[worker] 无更多待处理任务' + (RETRY_BLOCKED ? '' : '（如需重试失败叶子请加 --retry-blocked）'))
      break
    }
    await Promise.all(batch.map((job) => runOne(job, MAX_ATTEMPTS)))
    console.log(progressLine())
  }

  const left = await db.fillJobItem.count({
    where: { status: { in: ['pending', 'failed', 'materializing'] }, ...(INDUSTRY ? { leaf: { industry: INDUSTRY } } : {}) }
  })
  // 未满配但在本轮已无待办的叶子（重试额度用尽的另计）——如实报出缺口
  const short = await db.fillJobItem.count({
    where: {
      status: { not: 'filled' },
      verifiedCount: { lt: TARGET },
      ...(INDUSTRY ? { leaf: { industry: INDUSTRY } } : {})
    }
  })
  console.log(`[worker] 结束 ｜ ${progressLine()} ｜ 剩余待处理 ${left} ｜ 未满配 ${short}（含 blocked）`)
}

main()
  .catch((e) => {
    console.error('[worker] 异常退出', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
