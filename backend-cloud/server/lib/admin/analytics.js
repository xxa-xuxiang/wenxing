// 问星 v1.6 — 管理后台数据分析：用户增长/日活/行为/邀请/社区统计
// 量级小（用户/帖子/埋点），统一 findMany createdAt 后 JS 分桶，简单正确优先
import express from 'express'
import { db } from '../db.js'
import { wrap } from '../ai.js'

const router = express.Router()

/** 本地时区今日 0 点 */
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 本周周一 0 点 */
function mondayOf(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  return t
}

/** ISO 周号桶：2026-W43（周一为起点，周年份取该周周四所在年份） */
function isoWeekKey(d) {
  const thu = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  thu.setDate(thu.getDate() - ((thu.getDay() + 6) % 7) + 3) // 移到本周周四
  const jan4 = new Date(thu.getFullYear(), 0, 4)
  const week1Thu = new Date(thu.getFullYear(), 0, 4 - ((jan4.getDay() + 6) % 7) + 3)
  const week = Math.round((thu - week1Thu) / (7 * 24 * 3600 * 1000)) + 1
  return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`
}

/** 近 n 天按日的桶（含今日，升序） */
function dayBuckets(n) {
  const keys = []
  for (let i = n - 1; i >= 0; i--) {
    const d = startOfToday()
    d.setDate(d.getDate() - i)
    keys.push(dayKey(d))
  }
  return keys
}

/** 近 n 周的桶（含本周，升序） */
function weekBuckets(n) {
  const base = mondayOf(new Date())
  const keys = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i * 7)
    keys.push(isoWeekKey(d))
  }
  return keys
}

/** 近 n 月的桶（含当月，升序） */
function monthBuckets(n) {
  const now = new Date()
  const keys = []
  for (let i = n - 1; i >= 0; i--) keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)))
  return keys
}

/** 年桶：从最早数据年到今年（无数据则仅今年） */
function yearBuckets(minYear) {
  const now = new Date().getFullYear()
  const keys = []
  for (let y = Math.min(minYear ?? now, now); y <= now; y++) keys.push(String(y))
  return keys
}

/** 把 createdAt 列表计入预设桶（桶外忽略），返回 Map<bucket, count>（桶序即升序） */
function tally(dates, keyOf, buckets) {
  const map = new Map(buckets.map((k) => [k, 0]))
  for (const d of dates) {
    const k = keyOf(d)
    if (map.has(k)) map.set(k, map.get(k) + 1)
  }
  return map
}

const toSeries = (map) => [...map].map(([bucket, count]) => ({ bucket, count }))

/** 解析 YYYY-MM-DD（本地时区 0 点），非法返回 null */
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 埋点访主键：coalesce(userId, sessionId) */
const eventKey = (e) => e.userId || e.sessionId

// 注册增长 + 日活：summary{total,today,week,month} + series + dau{today,series}
// 注意：usersRouter 已占用 /api/admin/users（用户列表），故此处相对路径带 /analytics 前缀
router.get(
  '/analytics/users',
  wrap(async (req, res) => {
    const scale = ['day', 'week', 'month', 'year'].includes(req.query.scale) ? req.query.scale : 'day'
    const today = startOfToday()
    const weekStart = mondayOf(new Date())
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const dauStart = new Date(today)
    dauStart.setDate(dauStart.getDate() - 29)

    const [total, todayCount, weekCount, monthCount, users, events] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: today } } }),
      db.user.count({ where: { createdAt: { gte: weekStart } } }),
      db.user.count({ where: { createdAt: { gte: monthStart } } }),
      db.user.findMany({ select: { createdAt: true } }),
      db.usageEvent.findMany({
        where: { createdAt: { gte: dauStart } },
        select: { userId: true, sessionId: true, createdAt: true }
      })
    ])

    const createdAts = users.map((u) => u.createdAt)
    let series
    if (scale === 'day') series = tally(createdAts, dayKey, dayBuckets(30))
    else if (scale === 'week') series = tally(createdAts, isoWeekKey, weekBuckets(12))
    else if (scale === 'month') series = tally(createdAts, monthKey, monthBuckets(12))
    else {
      const minYear = createdAts.length ? Math.min(...createdAts.map((d) => d.getFullYear())) : null
      series = tally(createdAts, (d) => String(d.getFullYear()), yearBuckets(minYear))
    }

    // DAU：按 distinct coalesce(userId, sessionId) 计数
    const dauToday = new Set()
    const dauByDay = new Map(dayBuckets(30).map((k) => [k, new Set()]))
    for (const e of events) {
      const who = eventKey(e)
      if (!who) continue
      if (e.createdAt >= today) dauToday.add(who)
      const k = dayKey(e.createdAt)
      if (dauByDay.has(k)) dauByDay.get(k).add(who)
    }

    res.json({
      summary: { total, today: todayCount, week: weekCount, month: monthCount },
      series: toSeries(series),
      dau: {
        today: dauToday.size,
        series: [...dauByDay].map(([bucket, set]) => ({ bucket, count: set.size }))
      }
    })
  })
)

// 界面行为分析：pv/uv/点击率/平均停留（缺省近 7 天，from/to 传 YYYY-MM-DD，to 含当天）
router.get(
  '/analytics/behavior',
  wrap(async (req, res) => {
    const today = startOfToday()
    let from = new Date(today)
    from.setDate(from.getDate() - 6)
    let to = today
    if (req.query.from || req.query.to) {
      const f = parseDay(req.query.from)
      const t = parseDay(req.query.to)
      if ((req.query.from && !f) || (req.query.to && !t)) {
        return res.status(400).json({ error: 'from/to 需为 YYYY-MM-DD' })
      }
      if (f) from = f
      if (t) to = t
    }
    const toEx = new Date(to)
    toEx.setDate(toEx.getDate() + 1)

    const events = await db.usageEvent.findMany({
      where: { createdAt: { gte: from, lt: toEx } },
      select: { kind: true, screen: true, userId: true, sessionId: true, durationMs: true }
    })

    const byScreen = new Map()
    for (const e of events) {
      let s = byScreen.get(e.screen)
      if (!s) {
        s = { pv: 0, uv: new Set(), clicks: 0, staySum: 0, stayCount: 0 }
        byScreen.set(e.screen, s)
      }
      const who = eventKey(e)
      if (who) s.uv.add(who)
      if (e.kind === 'view_enter') s.pv += 1
      else if (e.kind === 'click') s.clicks += 1
      else if (e.kind === 'view_leave' && e.durationMs != null) {
        s.staySum += e.durationMs
        s.stayCount += 1
      }
    }

    const rows = [...byScreen]
      .map(([screen, s]) => ({
        screen,
        pv: s.pv,
        uv: s.uv.size,
        clicks: s.clicks,
        ctr: s.pv ? Number((s.clicks / s.pv).toFixed(4)) : 0,
        avgStayMs: s.stayCount ? Math.round(s.staySum / s.stayCount) : 0
      }))
      .sort((a, b) => b.pv - a.pv || a.screen.localeCompare(b.screen))
    res.json(rows)
  })
)

// 邀请推广：总数 + Top20 排行 + 近 30 天趋势（按被邀请人 createdAt）
router.get(
  '/analytics/invitations',
  wrap(async (req, res) => {
    const [totalInvited, groups, invited] = await Promise.all([
      db.user.count({ where: { invitedById: { not: null } } }),
      db.user.groupBy({
        by: ['invitedById'],
        where: { invitedById: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { invitedById: 'desc' } },
        take: 20
      }),
      db.user.findMany({ where: { invitedById: { not: null } }, select: { createdAt: true } })
    ])

    const topIds = groups.map((g) => g.invitedById)
    const infos = await db.user.findMany({
      where: { id: { in: topIds } },
      select: { id: true, username: true, nickname: true }
    })
    const infoById = new Map(infos.map((u) => [u.id, u]))
    const ranking = groups.map((g) => ({
      userId: g.invitedById,
      username: infoById.get(g.invitedById)?.username ?? '',
      nickname: infoById.get(g.invitedById)?.nickname ?? '',
      invitedCount: g._count._all
    }))

    const series = tally(invited.map((u) => u.createdAt), dayKey, dayBuckets(30))
    res.json({ totalInvited, ranking, series: toSeries(series) })
  })
)

// 社区统计：今日四指标 + 趋势（posts/views/likes/favorites）+ 近 12 月分组柱状
router.get(
  '/analytics/community',
  wrap(async (req, res) => {
    const scale = ['day', 'month', 'year'].includes(req.query.scale) ? req.query.scale : 'day'
    const today = startOfToday()

    const [posts, views, likes, favorites] = await Promise.all([
      db.communityPost.findMany({ select: { createdAt: true } }),
      db.usageEvent.findMany({ where: { kind: 'post_view' }, select: { createdAt: true } }),
      db.communityLike.findMany({ select: { createdAt: true } }),
      db.communityFavorite.findMany({ select: { createdAt: true } })
    ])
    const postDates = posts.map((p) => p.createdAt)
    const viewDates = views.map((v) => v.createdAt)
    const likeDates = likes.map((l) => l.createdAt)
    const favDates = favorites.map((f) => f.createdAt)
    const since = (dates) => dates.filter((d) => d >= today).length

    let keys, keyOf
    if (scale === 'day') {
      keys = dayBuckets(30)
      keyOf = dayKey
    } else if (scale === 'month') {
      keys = monthBuckets(12)
      keyOf = monthKey
    } else {
      const years = [...postDates, ...viewDates, ...likeDates, ...favDates].map((d) => d.getFullYear())
      keys = yearBuckets(years.length ? Math.min(...years) : null)
      keyOf = (d) => String(d.getFullYear())
    }
    const mPosts = tally(postDates, keyOf, keys)
    const mViews = tally(viewDates, keyOf, keys)
    const mLikes = tally(likeDates, keyOf, keys)
    const mFavs = tally(favDates, keyOf, keys)
    const series = keys.map((bucket) => ({
      bucket,
      posts: mPosts.get(bucket),
      views: mViews.get(bucket),
      likes: mLikes.get(bucket),
      favorites: mFavs.get(bucket)
    }))

    // 近 12 月分组柱状图数据（无论 scale 是什么都返回）
    const mk = monthBuckets(12)
    const p = tally(postDates, monthKey, mk)
    const v = tally(viewDates, monthKey, mk)
    const l = tally(likeDates, monthKey, mk)
    const f = tally(favDates, monthKey, mk)
    const monthly = mk.map((bucket) => ({
      bucket,
      posts: p.get(bucket),
      views: v.get(bucket),
      likes: l.get(bucket),
      favorites: f.get(bucket)
    }))

    res.json({
      today: {
        posts: since(postDates),
        views: since(viewDates),
        likes: since(likeDates),
        favorites: since(favDates)
      },
      series,
      monthly
    })
  })
)

// ===== 图表接口（v1.7 新增）：活跃热力 / 转化漏斗 / 铺题 CFD =====
// 统一窗口限定 + groupBy 聚合，避免全量 findMany

/** 聚合结果 → Map<userId, Date>（_min/_max 取其一） */
function toTimeMap(rows, field) {
  const map = new Map()
  for (const r of rows) {
    if (!r.userId) continue
    const t = r[field]?.createdAt
    if (t) map.set(r.userId, t)
  }
  return map
}

// 活跃热力图：星期（0=周一）× 小时（0-23）分桶
router.get(
  '/analytics/activity-heatmap',
  wrap(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30))
    const from = startOfToday()
    from.setDate(from.getDate() - (days - 1))

    const events = await db.usageEvent.findMany({
      where: { createdAt: { gte: from } },
      select: { createdAt: true }
    })

    // cells: [hour, weekday, count]，weekday 0=周一（与前端坐标轴顺序对齐）
    const counts = new Map()
    let max = 0
    for (const e of events) {
      const d = e.createdAt
      const weekday = (d.getDay() + 6) % 7
      const hour = d.getHours()
      const key = `${hour}|${weekday}`
      const next = (counts.get(key) || 0) + 1
      counts.set(key, next)
      if (next > max) max = next
    }
    const cells = [...counts].map(([key, count]) => {
      const [hour, weekday] = key.split('|').map(Number)
      return [hour, weekday, count]
    })
    res.json({ days, cells, max })
  })
)

// 新用户转化漏斗：注册 → 生成计划 → 首次答题 → 首次打卡 → 7 日留存
// 顺序漏斗：每层要求该行为最早发生时间不早于上一层（保证单调不增）
router.get(
  '/analytics/funnel',
  wrap(async (req, res) => {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90))
    const from = startOfToday()
    from.setDate(from.getDate() - (days - 1))

    // 邀请归因细分：invited=经邀请注册 / organic=自然注册 / 缺省=全部
    const segment = req.query.segment
    if (segment !== undefined && segment !== 'invited' && segment !== 'organic') {
      return res.status(400).json({ error: 'segment 非法' })
    }

    // 队列：窗口内注册的用户
    const users = await db.user.findMany({
      where: {
        createdAt: { gte: from },
        ...(segment === 'invited' ? { invitedById: { not: null } } : {}),
        ...(segment === 'organic' ? { invitedById: null } : {})
      },
      select: { id: true, createdAt: true }
    })
    const cohort = new Map(users.map((u) => [u.id, u.createdAt]))

    // 全表 groupBy 聚合（聚合非全量扫描），在 JS 侧按队列过滤
    const [plans, sessions, checkins, lastEvents] = await Promise.all([
      db.learningPlan.groupBy({ by: ['userId'], _min: { createdAt: true } }),
      db.quizSession.groupBy({ by: ['userId'], _min: { createdAt: true } }),
      db.checkin.groupBy({ by: ['userId'], _min: { createdAt: true } }),
      db.usageEvent.groupBy({ by: ['userId'], _max: { createdAt: true } })
    ])
    const planMap = toTimeMap(plans, '_min')
    const sessionMap = toTimeMap(sessions, '_min')
    const checkinMap = toTimeMap(checkins, '_min')
    const lastMap = toTimeMap(lastEvents, '_max')

    // 逐层推进：current 元素为 { id, t }（t 为到达该层的时间）
    let current = users.map((u) => ({ id: u.id, t: u.createdAt }))
    const layers = [{ key: 'register', label: '注册用户', count: current.length }]

    const advance = (key, label, timeMap) => {
      current = current.filter((u) => {
        const t = timeMap.get(u.id)
        if (!t || t < u.t) return false
        u.t = t
        return true
      })
      layers.push({ key, label, count: current.length })
    }
    advance('plan', '生成学习计划', planMap)
    advance('quiz', '首次答题', sessionMap)
    advance('checkin', '首次打卡', checkinMap)

    // 7 日留存：已到达上一层，且注册满 7 天后仍有活跃事件
    const retained = current.filter((u) => {
      const last = lastMap.get(u.id)
      const registered = cohort.get(u.id)
      return last && registered && last.getTime() >= registered.getTime() + 7 * 24 * 3600 * 1000
    })
    layers.push({ key: 'retention7', label: '7 日留存', count: retained.length })

    const steps = layers.map((layer, i) => ({
      key: layer.key,
      label: layer.label,
      count: layer.count,
      rate: i === 0 ? 1 : layers[i - 1].count > 0
        ? Math.round((layer.count / layers[i - 1].count) * 10000) / 10000
        : 0
    }))
    res.json({ days, segment: segment ?? 'all', cohort: users.length, steps })
  })
)

// 铺题 CFD 累计流：按周分桶的累计创建 / 累计铺满 / 累计阻塞失败
// 完成与阻塞时间用 updatedAt 近似（无状态历史表，口径为近似值）
router.get(
  '/analytics/fill-cfd',
  wrap(async (req, res) => {
    const weeks = Math.min(26, Math.max(4, Number(req.query.weeks) || 12))
    const base = mondayOf(new Date())
    const starts = []
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(base)
      d.setDate(d.getDate() - i * 7)
      starts.push(d)
    }

    const items = await db.fillJobItem.findMany({
      select: { status: true, createdAt: true, updatedAt: true }
    })
    const now = new Date()

    const buckets = starts.map((start, idx) => {
      const cutoff = idx === starts.length - 1 ? now : starts[idx + 1]
      let created = 0
      let filled = 0
      let blockedFailed = 0
      for (const it of items) {
        if (it.createdAt < cutoff) created += 1
        if (it.status === 'filled' && it.updatedAt < cutoff) filled += 1
        if ((it.status === 'blocked' || it.status === 'failed') && it.updatedAt < cutoff) {
          blockedFailed += 1
        }
      }
      return { bucket: isoWeekKey(start), created, filled, blockedFailed }
    })
    res.json({ weeks, buckets })
  })
)

// ===== 图表接口第二批（v1.7）：路径桑基 / 直方图 / 构成演变 =====

// 页面路径桑基：view_enter 按会话内相邻 screen 转移对聚合，Top 30 边
router.get(
  '/analytics/flow-sankey',
  wrap(async (req, res) => {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7))
    const from = startOfToday()
    from.setDate(from.getDate() - (days - 1))

    // 全局按时间升序拉取，逐事件维护「该会话上一屏」即可得到会话内转移
    const events = await db.usageEvent.findMany({
      where: { kind: 'view_enter', createdAt: { gte: from } },
      select: { sessionId: true, screen: true },
      orderBy: { createdAt: 'asc' }
    })

    const lastBySession = new Map()
    const edges = new Map() // 'a->b' -> count
    for (const e of events) {
      const prev = lastBySession.get(e.sessionId)
      if (prev && prev !== e.screen) {
        const key = `${prev}->${e.screen}`
        edges.set(key, (edges.get(key) || 0) + 1)
      }
      lastBySession.set(e.sessionId, e.screen)
    }

    const sorted = [...edges].sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 30)
    const nodeSet = new Set()
    const links = top.map(([key, value]) => {
      const [source, target] = key.split('->')
      nodeSet.add(source)
      nodeSet.add(target)
      return { source, target, value }
    })
    res.json({
      days,
      nodes: [...nodeSet].map((name) => ({ name })),
      links,
      truncated: sorted.length - top.length
    })
  })
)

// 分布直方图：答题得分（10 分桶，百分制）+ 界面停留时长（30s 桶，>30min 截断进末桶）
router.get(
  '/analytics/score-histogram',
  wrap(async (req, res) => {
    const [sessions, leaves] = await Promise.all([
      db.quizSession.findMany({ select: { score: true } }),
      db.usageEvent.findMany({
        where: { kind: 'view_leave', durationMs: { not: null } },
        select: { durationMs: true }
      })
    ])

    const score = Array.from({ length: 10 }, (_, i) => ({
      bucket: `${i * 10}-${i * 10 + 9}`,
      count: 0
    }))
    for (const s of sessions) {
      const idx = Math.min(9, Math.max(0, Math.floor(s.score / 10)))
      score[idx].count += 1
    }

    const STAY_BUCKETS = 60 // 30s × 60 = 30min
    const stay = Array.from({ length: STAY_BUCKETS }, (_, i) => {
      const endSec = (i + 1) * 30
      const label = `${Math.floor(endSec / 60)}:${String(endSec % 60).padStart(2, '0')}`
      return { bucket: label, count: 0 }
    })
    for (const e of leaves) {
      const idx = Math.min(STAY_BUCKETS - 1, Math.max(0, Math.floor(e.durationMs / 30000)))
      stay[idx].count += 1
    }

    res.json({ score, stay })
  })
)

// 构成演变：题目状态构成（累计创建/通过/驳回）+ 社区内容构成（帖子/评论/书籍累计）
// 题目通过/驳回时间取该题首条对应 verdict 的审核记录，窗口前数据计入基数
router.get(
  '/analytics/composition',
  wrap(async (req, res) => {
    const scale = req.query.scale === 'month' ? 'month' : 'week'

    const [questions, audits, posts, comments, books] = await Promise.all([
      db.question.findMany({ select: { createdAt: true } }),
      db.questionAudit.findMany({
        select: { questionId: true, verdict: true, createdAt: true },
        orderBy: { createdAt: 'asc' }
      }),
      db.communityPost.findMany({ select: { createdAt: true } }),
      db.communityComment.findMany({ select: { createdAt: true } }),
      db.book.findMany({ select: { createdAt: true } })
    ])

    // 每题首次通过 / 首次驳回时间
    const firstVerdict = new Map()
    for (const a of audits) {
      let v = firstVerdict.get(a.questionId)
      if (!v) {
        v = {}
        firstVerdict.set(a.questionId, v)
      }
      if (a.verdict === 'supported' && !v.supported) v.supported = a.createdAt
      if (a.verdict === 'rejected' && !v.rejected) v.rejected = a.createdAt
    }
    const verifiedDates = []
    const rejectedDates = []
    for (const v of firstVerdict.values()) {
      if (v.supported) verifiedDates.push(v.supported)
      if (v.rejected) rejectedDates.push(v.rejected)
    }

    // 桶定义 + 窗口起点（累计值需计入窗口前基数）
    const now = new Date()
    let keys
    let keyOf
    let baseStart
    if (scale === 'month') {
      keys = monthBuckets(12)
      keyOf = monthKey
      baseStart = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    } else {
      keys = weekBuckets(12)
      keyOf = isoWeekKey
      baseStart = mondayOf(now)
      baseStart.setDate(baseStart.getDate() - 11 * 7)
    }

    // 累计序列：窗口前基数 + 窗口内逐桶增量前缀和
    const cumulate = (dates) => {
      const inc = tally(dates, keyOf, keys)
      let acc = 0
      for (const d of dates) if (d < baseStart) acc += 1
      return keys.map((k) => {
        acc += inc.get(k)
        return acc
      })
    }

    const qCreated = cumulate(questions.map((q) => q.createdAt))
    const qVerified = cumulate(verifiedDates)
    const qRejected = cumulate(rejectedDates)
    const cPosts = cumulate(posts.map((p) => p.createdAt))
    const cComments = cumulate(comments.map((c) => c.createdAt))
    const cBooks = cumulate(books.map((b) => b.createdAt))

    res.json({
      scale,
      questions: keys.map((bucket, i) => ({
        bucket,
        created: qCreated[i],
        verified: qVerified[i],
        rejected: qRejected[i]
      })),
      community: keys.map((bucket, i) => ({
        bucket,
        posts: cPosts[i],
        comments: cComments[i],
        books: cBooks[i]
      }))
    })
  })
)

// ===== 图表接口第三批（v1.7）：打卡年历 / 平台构成 =====

// 打卡日历热力：按 Checkin.date（YYYY-MM-DD）聚合打卡人数与学习分钟数
router.get(
  '/analytics/checkin-calendar',
  wrap(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear()
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ error: 'year 非法' })
    }

    const rows = await db.checkin.findMany({
      where: { date: { startsWith: `${year}-` } },
      select: { date: true, minutes: true, userId: true }
    })

    const byDate = new Map()
    for (const r of rows) {
      let d = byDate.get(r.date)
      if (!d) {
        d = { users: new Set(), minutes: 0 }
        byDate.set(r.date, d)
      }
      d.users.add(r.userId)
      d.minutes += r.minutes
    }
    const days = [...byDate].map(([date, d]) => ({
      date,
      users: d.users.size,
      minutes: d.minutes
    }))
    const maxUsers = days.reduce((m, d) => Math.max(m, d.users), 0)
    res.json({ year, days, maxUsers })
  })
)

// 平台构成：按日拆分活跃设备平台（desktop / phone / other）
// 平台来源：两端埋点在 meta JSON 中注入 platform 常量；历史无 meta 数据归 other
router.get(
  '/analytics/platform-split',
  wrap(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30))
    const from = startOfToday()
    from.setDate(from.getDate() - (days - 1))

    const events = await db.usageEvent.findMany({
      where: { createdAt: { gte: from } },
      select: { createdAt: true, userId: true, sessionId: true, meta: true }
    })

    const keys = dayBuckets(days)
    const sets = {
      desktop: new Map(keys.map((k) => [k, new Set()])),
      phone: new Map(keys.map((k) => [k, new Set()])),
      other: new Map(keys.map((k) => [k, new Set()]))
    }
    const platformOf = (meta) => {
      if (!meta) return 'other'
      try {
        const p = JSON.parse(meta)?.platform
        return p === 'desktop' || p === 'phone' ? p : 'other'
      } catch {
        return 'other'
      }
    }
    for (const e of events) {
      const bucket = sets[platformOf(e.meta)].get(dayKey(e.createdAt))
      bucket?.add(eventKey(e))
    }

    const series = keys.map((bucket) => ({
      bucket,
      desktop: sets.desktop.get(bucket).size,
      phone: sets.phone.get(bucket).size,
      other: sets.other.get(bucket).size
    }))
    res.json({ days, series })
  })
)

export default router
