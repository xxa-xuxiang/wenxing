// 问星 v1.2 — 学习流程路由（每日打卡 / 每周复盘）
// 打卡：userId+date 唯一，PUT upsert；区间查询供「连续天数 / 本周统计」用
// 复盘：userId+weekStart 唯一（weekStart = 本周一 YYYY-MM-DD），PUT upsert
import { db } from './db.js'
import { wrap } from './ai.js'
import { auth } from './auth.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** taskIds 以 JSON string[] 存储，读时安全解析 */
function safeList(s) {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function checkinDTO(row) {
  return {
    date: row.date,
    minutes: row.minutes,
    taskIds: safeList(row.taskIds),
    note: row.note,
    updatedAt: row.updatedAt.getTime()
  }
}

export default function registerCheckinRoutes(app) {
  // ===== 打卡：写入/覆盖当日（upsert，幂等） =====
  app.put(
    '/api/checkins/:date',
    auth,
    wrap(async (req, res) => {
      const date = String(req.params.date)
      if (!DATE_RE.test(date)) throw new Error('日期格式应为 YYYY-MM-DD')
      const body = req.body ?? {}
      const minutes = Math.max(0, Math.min(1440, Math.round(Number(body.minutes) || 0)))
      const taskIds = Array.isArray(body.taskIds) ? body.taskIds.map(String).slice(0, 200) : []
      const note = String(body.note ?? '').slice(0, 2000)
      const row = await db.checkin.upsert({
        where: { userId_date: { userId: req.user.id, date } },
        update: { minutes, taskIds: JSON.stringify(taskIds), note },
        create: { userId: req.user.id, date, minutes, taskIds: JSON.stringify(taskIds), note }
      })
      res.json({ checkin: checkinDTO(row) })
    })
  )

  // ===== 打卡：区间查询（默认最近 30 天） =====
  app.get(
    '/api/checkins',
    auth,
    wrap(async (req, res) => {
      const where = { userId: req.user.id }
      const from = typeof req.query.from === 'string' && DATE_RE.test(req.query.from) ? req.query.from : null
      const to = typeof req.query.to === 'string' && DATE_RE.test(req.query.to) ? req.query.to : null
      if (from || to) {
        where.date = {}
        if (from) where.date.gte = from
        if (to) where.date.lte = to
      }
      const rows = await db.checkin.findMany({
        where,
        orderBy: { date: 'desc' },
        take: Math.min(400, Math.max(1, Number(req.query.limit) || 90))
      })
      res.json({ items: rows.map(checkinDTO) })
    })
  )

  // ===== 周复盘：写入/覆盖当周（upsert，幂等） =====
  app.put(
    '/api/reviews/:weekStart',
    auth,
    wrap(async (req, res) => {
      const weekStart = String(req.params.weekStart)
      if (!DATE_RE.test(weekStart)) throw new Error('日期格式应为 YYYY-MM-DD')
      const body = req.body ?? {}
      const good = String(body.good ?? '').slice(0, 2000)
      const bad = String(body.bad ?? '').slice(0, 2000)
      const improve = String(body.improve ?? '').slice(0, 2000)
      const row = await db.weeklyReview.upsert({
        where: { userId_weekStart: { userId: req.user.id, weekStart } },
        update: { good, bad, improve },
        create: { userId: req.user.id, weekStart, good, bad, improve }
      })
      res.json({
        review: {
          weekStart: row.weekStart,
          good: row.good,
          bad: row.bad,
          improve: row.improve,
          updatedAt: row.updatedAt.getTime()
        }
      })
    })
  )

  // ===== 周复盘：历史列表（默认最近 8 周） =====
  app.get(
    '/api/reviews',
    auth,
    wrap(async (req, res) => {
      const limit = Math.min(52, Math.max(1, Number(req.query.limit) || 8))
      const rows = await db.weeklyReview.findMany({
        where: { userId: req.user.id },
        orderBy: { weekStart: 'desc' },
        take: limit
      })
      res.json({
        items: rows.map((r) => ({
          weekStart: r.weekStart,
          good: r.good,
          bad: r.bad,
          improve: r.improve,
          updatedAt: r.updatedAt.getTime()
        }))
      })
    })
  )
}
