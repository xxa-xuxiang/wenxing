// 问星 v1.7 — 管理后台「API 盈利」：计费标准维护 + 收入看板
// 收入口径（毛收入估算）：调用次数 × 次数单价 + tokens × token 单价（未扣除每账号 100 万免费量）
// 自带 Key 的调用不入台账（不计收入）；tokens 尽力采集，拿不到记 0
import express from 'express'
import { wrap } from '../ai.js'
import { getPricing, getMetering, savePricing, saveMetering } from '../pricing.js'
import { ledgerSeries } from '../aiLedger.js'

const router = express.Router()

/** 本地时区日期键（YYYY-MM-DD） */
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 日期键偏移 n 天 */
function dateKeyOffset(n) {
  return dateKey(new Date(Date.now() + n * 24 * 3600 * 1000))
}

/** 计量口径收入：次数费（元/次）+ token 费（元/token） */
function meteredRevenue(calls, tokens) {
  const m = getMetering()
  return (calls * m.callPricePerThousandYuan) / 1000 + (tokens * m.tokenPricePerMillionYuan) / 1_000_000
}

/** 按计量口径把一个 byAction 分桶换算为 {calls,tokens,revenue} */
function withRevenue(byAction) {
  let calls = 0
  let tokens = 0
  for (const v of Object.values(byAction || {})) {
    calls += v.calls
    tokens += v.tokens
  }
  return { calls, tokens, revenue: Math.round(meteredRevenue(calls, tokens) * 10000) / 10000 }
}

// 计费标准（与公开 GET /api/billing/pricing 同源，此处管理员可见）
router.get(
  '/pricing',
  wrap(async (req, res) => {
    const pricing = getPricing()
    res.json(pricing)
  })
)

// 修改计量计费参数：body {metering:{freeTokenQuota?, tokenPricePerMillionYuan?, callPricePerThousandYuan?}}
router.put(
  '/metering',
  wrap(async (req, res) => {
    try {
      const pricing = saveMetering(req.body?.metering ?? req.body ?? {})
      res.json({ ok: true, pricing })
    } catch (e) {
      res.status(400).json({ error: e?.message || '计量参数保存失败' })
    }
  })
)

// 修改计费标准：body {items:{[action]:pricePerCall 数字}}，写盘后 version+1
router.put(
  '/pricing',
  wrap(async (req, res) => {
    const items = req.body?.items
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      res.status(400).json({ error: 'items 必须为对象' })
      return
    }
    for (const [action, price] of Object.entries(items)) {
      const n = Number(price)
      if (!Number.isFinite(n) || n < 0) {
        res.status(400).json({ error: `「${action}」单价必须为非负数字` })
        return
      }
    }
    try {
      const pricing = savePricing(items)
      res.json({ ok: true, pricing })
    } catch (e) {
      res.status(400).json({ error: e?.message || '计费标准保存失败' })
    }
  })
)

// 收入看板：?range=today|7d|30d（默认 today）
// today 按小时出序列；7d 按日聚合；30d 按月聚合
router.get(
  '/revenue',
  wrap(async (req, res) => {
    const range = String(req.query.range || 'today')
    if (!['today', '7d', '30d'].includes(range)) {
      res.status(400).json({ error: 'range 仅支持 today|7d|30d' })
      return
    }

    const today = dateKey()
    const monthKey = today.slice(0, 7)
    // 时间范围：序列聚合窗口（today 按小时，7d 按日，30d 按月）
    const fromKey = range === 'today' ? today : range === '7d' ? dateKeyOffset(-6) : dateKeyOffset(-29)
    const granularity = range === 'today' ? 'hour' : range === '7d' ? 'day' : 'month'

    // 先按范围取序列，顺带收集出现过的 action（未知 action 自动补入展示标签）
    const { buckets: rawBuckets } = ledgerSeries({ fromKey, toKey: today, granularity })
    const knownActions = new Set()
    for (const b of rawBuckets) for (const action of Object.keys(b.byAction)) knownActions.add(action)
    const pricing = getPricing([...knownActions])
    const items = pricing.items

    // 序列桶换算金额（次数费 + token 费）
    const buckets = rawBuckets.map((b) => {
      const { calls, tokens, revenue } = withRevenue(b.byAction)
      return { key: b.key, revenue, calls, tokens }
    })

    // 按 action 汇总（含各自序列），金额实时按当前计量参数计算
    const byActionMap = new Map()
    for (const b of rawBuckets) {
      for (const [action, v] of Object.entries(b.byAction)) {
        let stat = byActionMap.get(action)
        if (!stat) {
          stat = { calls: 0, tokens: 0, buckets: [] }
          byActionMap.set(action, stat)
        }
        stat.calls += v.calls
        stat.tokens += v.tokens
        stat.buckets.push({ key: b.key, calls: v.calls, tokens: v.tokens })
      }
    }
    const byAction = [...byActionMap.entries()]
      .map(([action, stat]) => ({
        action,
        label: items[action]?.label ?? action,
        calls: stat.calls,
        tokens: stat.tokens,
        revenue: Math.round(meteredRevenue(stat.calls, stat.tokens) * 10000) / 10000,
        buckets: stat.buckets
      }))
      .sort((a, b) => b.revenue - a.revenue || b.calls - a.calls)

    // 汇总卡：今日收入 / 本月收入 / 总调用次数 / 今日调用次数（全量台账口径，与 range 无关）
    let todayRevenue = 0
    let monthRevenue = 0
    let totalCalls = 0
    let todayCalls = 0
    // 直接遍历台账日期聚合（ledgerSeries 粒度不含「今日/本月」汇总，这里就地算）
    const all = ledgerSeries({ fromKey: dateKeyOffset(-89), toKey: today, granularity: 'day' })
    for (const b of all.buckets) {
      const dateCalls = Object.values(b.byAction).reduce((s, v) => s + v.calls, 0)
      const dateTokens = Object.values(b.byAction).reduce((s, v) => s + v.tokens, 0)
      totalCalls += dateCalls
      if (b.key === today) {
        todayCalls += dateCalls
        todayRevenue += meteredRevenue(dateCalls, dateTokens)
      }
      if (b.key.slice(0, 7) === monthKey) {
        monthRevenue += meteredRevenue(dateCalls, dateTokens)
      }
    }
    const round4 = (n) => Math.round(n * 10000) / 10000

    res.json({
      summary: {
        todayRevenue: round4(todayRevenue),
        monthRevenue: round4(monthRevenue),
        totalCalls,
        todayCalls
      },
      priceVersion: pricing.version,
      metering: pricing.metering,
      items,
      series: { buckets, byAction }
    })
  })
)

export default router
