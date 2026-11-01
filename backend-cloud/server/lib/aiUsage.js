// 问星 v1.7 — AI 额度计数与计量计费（轻量版，不建新表，JSON 文件持久化）
// 计费模型（两维度计量）：
//   - token：每账号长期累计 100 万 token 免费，超出后按 1.3 元/百万 token 从余额扣费
//   - API 调用：0.001 元/次（1000 次 1 元），分以下费用进累加器凑整扣费
//   - 自带 API Key（不调用平台 AI）：完全免费，不计量
//   - 匿名请求无余额可扣：仍按 ANON_DAILY_LIMITS 每日次数硬上限（429）
//   - 后付费模式：调用完成后结算；余额不足记欠费，下一次调用前先补扣，扣不动则 402 拒绝
import fs from 'node:fs'
import path from 'node:path'
import { recordLedger } from './aiLedger.js'
import { optUserId } from './auth.js'
import { DATA_ROOT } from './data-root.js'
import { getMetering } from './pricing.js'
import { debitBalance } from './wallet.js'

const USAGE_FILE = path.join(DATA_ROOT, 'ai-usage.json')

/** 每日平台 AI 免费/赠送额度（演示数值，按 AI 调用类型分桶；仅统计走平台 Key 的调用） */
export const DAILY_LIMITS = {
  recommend: 3,   // 技能推荐
  doc: 20,        // 新文档生成
  revise: 20,     // 文档修订
  chat: 50,       // 对话聊天
  questions: 5,   // 批量出题
  explainCheck: 5, // 费曼讲解检测
  plan: 10,       // 学习计划（理解/分类/生成/修订/周报统一计此桶）
  translate: 100, // 划词翻译（高频）
  books: 10       // 开放教材检索
}

/** 未登录（匿名 IP）的每日额度：明显低于登录用户，仅保留本地体验 */
export const ANON_DAILY_LIMITS = {
  recommend: 1,
  doc: 3,
  revise: 3,
  chat: 10,
  questions: 2,
  explainCheck: 2,
  plan: 2,
  translate: 20,
  books: 2
}

/** 额度主体：已登录返回 userId，匿名返回 anon:<ip> */
export function actorOf(req) {
  return optUserId(req) || `anon:${req?.ip || 'unknown'}`
}

/** 计费说明（前端「个人中心 · 计费」展示口径） */
export const BILLING = {
  model: 'metered-tokens+calls',
  managementFee: 0,
  currency: 'CNY',
  note: '每账号长期免费 100 万 token；超出后按 1.3 元/百万 token 计费，API 调用 0.001 元/次（1000 次 1 元）；自带 API Key 完全免费'
}

/** 该请求是否使用了用户自带的 API Key（X-User-Api-Key 非空） */
export function hasUserKey(req) {
  const k = req?.headers?.['x-user-api-key']
  return typeof k === 'string' && k.trim().length > 0
}

let cache = load()

function load() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'))
    }
  } catch {
    /* 损坏则重建 */
  }
  return {}
}

function save() {
  try {
    fs.mkdirSync(DATA_ROOT, { recursive: true })
    fs.writeFileSync(USAGE_FILE, JSON.stringify(cache), 'utf-8')
  } catch {
    /* 写盘失败静默降级（内存计数仍可用，进程重启丢失） */
  }
}

/** 今日日期键（本地时区 YYYY-MM-DD） */
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 记录一次 AI 调用并返回用量状态。
 * 自带 Key（opts.byoKey）→ 完全免费，不计量（返回 used:0, limited:false）。
 * actor 为 'anon:<ip>' 时使用匿名额度表，且不计入收入台账。
 * opts.meter 为 true（路由末尾结算调用）时同步累计长期 tokens/calls。
 * 正常计数时同步记入收入台账（opts.tokens 为本次调用 tokens，可缺省记 0）。
 * @param {string|null} actor 用户 ID 或 anon:<ip>
 * @param {{ byoKey?: boolean, tokens?: number, meter?: boolean }} [opts]
 * @returns {{ used:number, limit:number|null, remaining:number, limited:boolean, byoKey:boolean }}
 */
export function countUsage(actor, action, opts = {}) {
  const isAnon = typeof actor === 'string' && actor.startsWith('anon:')
  const limits = isAnon ? ANON_DAILY_LIMITS : DAILY_LIMITS
  const limit = limits[action] ?? null
  // 自带 Key：完全免费，不占平台计量
  if (opts.byoKey) {
    return { used: 0, limit, remaining: limit ?? 0, limited: false, byoKey: true }
  }
  if (!actor || limit === null) {
    return { used: 0, limit, remaining: limit ?? 0, limited: false, byoKey: false }
  }
  const date = today()
  const user = cache[actor] ?? (cache[actor] = {})
  const day = user[date] ?? (user[date] = {})
  day[action] = (day[action] ?? 0) + 1
  // 长期计量：仅路由末尾带 meter 的结算调用才累计，避免闸门预计数双计
  if (opts.meter && !isAnon) {
    const lt = lifetimeOf(actor)
    lt.calls += 1
    lt.tokens += Number(opts.tokens) || 0
  }
  // 记入收入台账（次数 + tokens，仅真实用户；匿名调用无法归属到账号）
  if (!isAnon) recordLedger([action], { [action]: Number(opts.tokens) || 0 })
  // 清理 30 天前的旧数据，防膨胀（__ 前缀为计量字段，不是日期桶，跳过）
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  for (const k of Object.keys(user)) {
    if (k.startsWith('__')) continue
    if (k < cutoff.toISOString().slice(0, 10)) delete user[k]
  }
  save()
  const used = day[action]
  const byoKey = false
  return { used, limit, remaining: Math.max(0, limit - used), limited: true, byoKey }
}

/** 长期计量桶（__ 前缀避免被日期清理/聚合误读） */
function lifetimeOf(actor) {
  const user = cache[actor] ?? (cache[actor] = {})
  return user.__lifetime ?? (user.__lifetime = { tokens: 0, calls: 0 })
}

/** 费用累加器与欠费（fen；carry 为分以下小数，debtFen 为未扣成的整数欠费） */
function billingOf(actor) {
  const user = cache[actor] ?? (cache[actor] = {})
  return user.__billing ?? (user.__billing = { carry: 0, debtFen: 0 })
}

/** 查询用户当前欠费（整数分） */
export function getDebtFen(userId) {
  return Math.round(Number(cache[userId]?.__billing?.debtFen) || 0)
}

/** 清除欠费（补扣成功后调用） */
export function clearDebt(userId) {
  const b = cache[userId]?.__billing
  if (b) b.debtFen = 0
  save()
}

/** 查询用户长期 token/调用计量（未产生过调用返回 0） */
export function getTokenStats(userId) {
  const lt = cache[userId]?.__lifetime ?? { tokens: 0, calls: 0 }
  const quota = getMetering().freeTokenQuota
  return {
    tokens: lt.tokens,
    calls: lt.calls,
    tokenQuota: quota,
    tokenRemaining: Math.max(0, quota - lt.tokens)
  }
}

/**
 * 调用后结算（后付费）：次数费 + 超额 token 费，经分以下累加器凑整后从余额扣费。
 * 余额不足记欠费（debtFen），由下一次 authorizeAiCall 先补扣再放行。
 * 必须在 countUsage(..., { meter:true }) 之后调用（lifetime 已含本次 tokens）。
 * @param {string} userId
 * @param {number} tokens 本次调用消耗的 tokens
 */
export async function settleAiFee(userId, tokens) {
  if (!userId) return
  const m = getMetering()
  const lt = lifetimeOf(userId)
  const b = billingOf(userId)
  // 本次 tokens 中超出免费池的部分 = 累计超额增量
  const used = lt.tokens
  const prev = used - (Number(tokens) || 0)
  const billable = Math.max(0, used - m.freeTokenQuota) - Math.max(0, prev - m.freeTokenQuota)
  const tokenFeeFen = (billable * m.tokenPricePerMillionYuan * 100) / 1_000_000
  const callFeeFen = (m.callPricePerThousandYuan * 100) / 1000
  b.carry += tokenFeeFen + callFeeFen
  const charge = Math.floor(b.carry)
  if (charge <= 0) {
    save()
    return
  }
  b.carry -= charge
  try {
    const r = await debitBalance(userId, charge, { refId: 'metered', note: 'AI 计量扣费（token+次数）' })
    if (!r.ok) b.debtFen += charge
  } catch {
    b.debtFen += charge
  }
  save()
}

/**
 * 只读查询额度（不递增、不写盘），供 aiGate 拦截前检查。
 * 自带 Key 直接放行。
 * @returns {{ used:number, limit:number|null, remaining:number, allowed:boolean }}
 */
export function peekUsage(actor, action, byoKey = false) {
  if (byoKey) return { used: 0, limit: null, remaining: Infinity, allowed: true }
  const isAnon = typeof actor === 'string' && actor.startsWith('anon:')
  const limit = (isAnon ? ANON_DAILY_LIMITS : DAILY_LIMITS)[action] ?? null
  if (!actor || limit === null) return { used: 0, limit, remaining: Infinity, allowed: true }
  const used = cache[actor]?.[today()]?.[action] ?? 0
  const remaining = Math.max(0, limit - used)
  return { used, limit, remaining, allowed: remaining > 0 }
}

/**
 * 汇总全平台 AI 用量（管理后台看板用）：今日与近 7 日（含今日）按 action 聚合
 * @returns {{ today: {total:number,byAction:Object<string,number>}, last7d: {total:number,byAction:Object<string,number>} }}
 */
export function getUsageTotals() {
  const todayKey = today()
  const from = new Date()
  from.setDate(from.getDate() - 6)
  const fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
  const out = { today: { total: 0, byAction: {} }, last7d: { total: 0, byAction: {} } }
  const add = (bucket, action, n) => {
    bucket.total += n
    bucket.byAction[action] = (bucket.byAction[action] || 0) + n
  }
  for (const user of Object.values(cache)) {
    if (!user || typeof user !== 'object') continue
    for (const [date, day] of Object.entries(user)) {
      if (date.startsWith('__')) continue
      if (!day || typeof day !== 'object') continue
      for (const [action, count] of Object.entries(day)) {
        const n = Number(count) || 0
        if (n <= 0) continue
        if (date === todayKey) add(out.today, action, n)
        if (date >= fromKey && date <= todayKey) add(out.last7d, action, n)
      }
    }
  }
  return out
}

/** 查询今日某用户全部 AI 用量（未登录返回各 action limit 但 used=0） */
export function getUsage(userId) {
  const result = {}
  for (const action of Object.keys(DAILY_LIMITS)) {
    const limit = DAILY_LIMITS[action]
    let used = 0
    if (userId) {
      const day = cache[userId]?.[today()]
      if (day) used = day[action] ?? 0
    }
    result[action] = { used, limit, remaining: Math.max(0, limit - used) }
  }
  return result
}
