// 问星 — 轻量内存限流：固定窗口计数（不引入 redis/express-rate-limit）
// 用于登录防爆破与 AI 接口的分钟级突发限流；进程重启后计数清零
const DEFAULT_WINDOW_MS = 60_000

/**
 * 创建限流中间件
 * @param {{ windowMs?: number, max: number, message?: string, keyGenerator?: (req: import('express').Request) => string }} opts
 */
export function createRateLimit({ windowMs = DEFAULT_WINDOW_MS, max, message, keyGenerator } = {}) {
  const buckets = new Map()
  const keyOf = keyGenerator || ((req) => req.ip || 'unknown')

  // 过期清理：每 5 分钟一次，定时器不阻塞进程退出
  const cleaner = setInterval(() => {
    const now = Date.now()
    for (const [key, item] of buckets) {
      if (item.resetAt <= now) buckets.delete(key)
    }
  }, 5 * 60_000)
  cleaner.unref?.()

  return function rateLimit(req, res, next) {
    const key = keyOf(req)
    const now = Date.now()
    let item = buckets.get(key)
    if (!item || item.resetAt <= now) {
      item = { count: 0, resetAt: now + windowMs }
      buckets.set(key, item)
    }
    item.count += 1
    if (item.count > max) {
      const retryAfter = Math.max(1, Math.ceil((item.resetAt - now) / 1000))
      res.set('Retry-After', String(retryAfter))
      res.status(429).json({ error: message || '操作过于频繁，请稍后再试' })
      return
    }
    next()
  }
}
