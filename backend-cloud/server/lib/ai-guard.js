// 问星 — AI 调用统一闸门
// 目的：所有走平台 Key 的 AI 调用必须经过同一入口（欠费校验 + 分钟级突发限流），
//       防止匿名/普通用户绕过网关无限消耗平台额度。
// v1.7：计量计费（后付费）——登录用户不再受每日次数限制，调用完成后按
//       token（超 100 万免费量部分）+ 调用次数从余额扣费；余额不足记欠费，
//       下次调用前先补扣，扣不动则 402。匿名请求无余额，仍按每日次数 429 拦截。
import { actorOf, countUsage, hasUserKey, peekUsage, getDebtFen, clearDebt } from './aiUsage.js'
import { optUserId } from './auth.js'
import { debitBalance } from './wallet.js'
import { createRateLimit } from './rate-limit.js'

// 每个 action 一个独立限流器（按主体计数：登录用户 userId / 匿名 IP）
const limiters = new Map()

function limiterOf(action, max) {
  const key = `${action}:${max}`
  if (!limiters.has(key)) {
    limiters.set(
      key,
      createRateLimit({
        windowMs: 60_000,
        max,
        message: 'AI 请求过于频繁，请稍后再试',
        keyGenerator: (req) => actorOf(req)
      })
    )
  }
  return limiters.get(key)
}

/**
 * 判定一次 AI 调用是否放行：
 * - byo：自带 Key，完全免费
 * - free：匿名请求，当日次数额度仍有剩余
 * - metered：登录用户，后付费计量（调用完成后按 token+次数结算）
 * - denied：无法放行（匿名超限 / 欠费未清且余额不足）
 */
export async function authorizeAiCall(req, action, { honorUserKey = true } = {}) {
  if (honorUserKey && hasUserKey(req)) return { mode: 'byo', amountFen: 0 }
  const actor = actorOf(req)
  const uid = optUserId(req)
  if (!uid) {
    // 匿名无余额可扣：维持每日次数硬上限
    if (peekUsage(actor, action).allowed) return { mode: 'free', amountFen: 0 }
    return { mode: 'denied', reason: 'AI_QUOTA', balanceFen: 0 }
  }
  // 登录用户：有欠费先补扣，补扣失败拒绝本次调用
  const debt = getDebtFen(String(uid))
  if (debt > 0) {
    const paid = await debitBalance(String(uid), debt, { refId: 'debt', note: 'AI 欠费补扣' })
    if (!paid.ok) {
      return {
        mode: 'denied',
        reason: paid.reason || 'INSUFFICIENT_BALANCE',
        balanceFen: paid.balanceFen ?? 0,
        amountFen: debt
      }
    }
    clearDebt(String(uid))
  }
  return { mode: 'metered', amountFen: 0 }
}

/** 统一输出放行失败的响应：余额不足 402，匿名/额度 429，其余 500 */
export function respondAiDenied(res, result) {
  if (result.reason === 'INSUFFICIENT_BALANCE') {
    res.status(402).json({
      error: '账户余额不足且有未清费用，请先充值或兑换',
      code: 'INSUFFICIENT_BALANCE',
      balanceFen: result.balanceFen ?? 0
    })
    return
  }
  if (result.reason === 'AI_QUOTA') {
    res.status(429).json({
      error: '今日体验额度已用完，登录后可获得 100 万 token 免费量，或填写自己的 API Key',
      code: 'AI_QUOTA'
    })
    return
  }
  res.status(500).json({ error: 'AI 计费校验失败，请稍后重试', code: result.reason || 'AI_BILLING_ERROR' })
}

/**
 * 是否还有额度（只读，不计数、不扣费）
 * honorUserKey：仅当该路由确实把用户自带 Key 透传给 deepseek 时才跳过平台额度；
 *   若路由实际用平台 Key 调用（如出题管线、社区 AI 复审），必须传 false，否则可用伪造 header 逃逸。
 * 登录用户为后付费计量：仅检查有无未清欠费（余额是否足够在 authorizeAiCall 异步补扣时判定）。
 */
export function aiQuotaAllowed(req, action, { honorUserKey = true } = {}) {
  if (honorUserKey && hasUserKey(req)) return true
  const uid = optUserId(req)
  if (uid) return getDebtFen(String(uid)) <= 0
  return peekUsage(actorOf(req), action).allowed
}

/** 占用一次平台 AI 额度（自带 Key 且路由透传时跳过） */
export function consumeAiQuota(req, action, { honorUserKey = true } = {}) {
  if (honorUserKey && hasUserKey(req)) return
  countUsage(actorOf(req), action)
}

/**
 * 校验并占用一次额度；免费额度用尽时可从余额扣费。
 * 放行失败时直接写出响应并返回 false。
 * 采用「先校验/扣费再调用」，避免并发请求同时通过额度检查。
 */
export async function takeAiQuota(req, res, action, { honorUserKey = true } = {}) {
  const result = await authorizeAiCall(req, action, { honorUserKey })
  if (result.mode === 'denied') {
    respondAiDenied(res, result)
    return false
  }
  if (result.mode !== 'byo') countUsage(actorOf(req), action)
  return true
}

/**
 * 中间件：分钟级突发限流 + 额度校验/扣费
 * 仅用于「每次请求必然调用平台 AI」的路由。
 * @param {string} action 额度桶名（见 aiUsage.DAILY_LIMITS）
 * @param {{ burst?: number, honorUserKey?: boolean }} [opts]
 */
export function aiGuard(action, { burst = 10, honorUserKey = true } = {}) {
  const burstLimit = limiterOf(action, burst)
  return (req, res, next) => {
    if (honorUserKey && hasUserKey(req)) return next()
    burstLimit(req, res, async () => {
      try {
        if (!(await takeAiQuota(req, res, action, { honorUserKey }))) return
        next()
      } catch (e) {
        next(e)
      }
    })
  }
}

/**
 * 仅分钟级突发限流（不占额度），用于零成本或缓存命中的检索类接口
 * @param {string} action 限流桶名
 * @param {{ burst?: number }} [opts]
 */
export function aiBurstOnly(action, { burst = 30 } = {}) {
  return limiterOf(action, burst)
}
