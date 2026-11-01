// 问星 v1.6 — 行为埋点上报：POST /api/track/events（optionalAuth，未登录按匿名会话统计）
// 失败静默（500 不带细节），绝不阻塞桌面端 UI；非法 body 必须 400
import express from 'express'
import { db, serializeWrite } from './db.js'
import { optionalAuth } from './auth.js'
import { createLogger } from './logger.js'
import { createRateLimit } from './rate-limit.js'

const router = express.Router()
const log = createLogger('track')

const KINDS = new Set(['view_enter', 'view_leave', 'click', 'post_view'])

// 埋点匿名可写，按 IP/用户限流，防止无成本刷库
const trackLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '上报过于频繁'
})

/** 校验单条事件：非法返回错误文案，合法返回入库行 */
function normalizeEvent(e, sessionId, userId) {
  if (!e || typeof e !== 'object') return 'event 非法'
  if (!KINDS.has(e.kind)) return 'kind 非法'
  if (typeof e.screen !== 'string' || !e.screen || e.screen.length > 32) return 'screen 非法'
  let target = e.target ?? null
  if (target !== null && (typeof target !== 'string' || target.length > 128)) return 'target 非法'
  let durationMs = e.durationMs ?? null
  if (durationMs !== null && (!Number.isInteger(durationMs) || durationMs <= 0)) return 'durationMs 非法'
  let meta = e.meta ?? null
  if (meta !== null && (typeof meta !== 'string' || meta.length > 512)) return 'meta 非法'
  return { userId, sessionId, kind: e.kind, screen: e.screen, target, durationMs, meta }
}

router.post('/events', optionalAuth, trackLimit, async (req, res) => {
  const body = req.body ?? {}
  const sessionId = body.sessionId
  const events = body.events
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 64) {
    return res.status(400).json({ error: 'sessionId 非法' })
  }
  if (!Array.isArray(events) || events.length === 0 || events.length > 50) {
    return res.status(400).json({ error: 'events 非法' })
  }
  const userId = req.user?.id ?? null
  const rows = []
  for (const e of events) {
    const row = normalizeEvent(e, sessionId, userId)
    if (typeof row === 'string') return res.status(400).json({ error: row })
    rows.push(row)
  }
  try {
    const r = await serializeWrite(() => db.usageEvent.createMany({ data: rows }))
    res.json({ ok: true, accepted: r.count })
  } catch (e) {
    log.warn('埋点入库失败:', e?.message || e)
    res.status(500).json({ ok: false })
  }
})

export default router
