// 问星 v1.6 — AI 收入台账：按日期记录平台 AI 调用次数与 tokens（JSON 文件持久化，保留 90 天）
// 结构：{[date 'YYYY-MM-DD']:{byHour:{[h]:{[action]:{calls,tokens}}},byAction:{[action]:{calls,tokens}}}}
// 仅统计走平台 Key 的调用（自带 Key 不计收入），由 aiUsage 在正常计数时调用本模块记账
import fs from 'node:fs'
import path from 'node:path'
import { DATA_ROOT } from './data-root.js'

const LEDGER_FILE = path.join(DATA_ROOT, 'ai-ledger.json')
const RETAIN_DAYS = 90

let cache = load()
// 防抖写盘：500ms 定时器合并写，高频调用不频繁刷盘
let saveTimer = null

function load() {
  try {
    if (fs.existsSync(LEDGER_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8'))
      if (data && typeof data === 'object' && !Array.isArray(data)) return data
    }
  } catch {
    /* 损坏则重建 */
  }
  return {}
}

function flush() {
  saveTimer = null
  try {
    fs.mkdirSync(DATA_ROOT, { recursive: true })
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(cache), 'utf-8')
  } catch {
    /* 写盘失败静默降级（内存累计仍可用） */
  }
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(flush, 500)
  saveTimer.unref?.()
}

/** 本地时区日期键（YYYY-MM-DD） */
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 清理超过 90 天的旧数据，防膨胀 */
function prune() {
  const cutoff = new Date(Date.now() - RETAIN_DAYS * 24 * 3600 * 1000)
  const cutoffKey = cutoff.toISOString().slice(0, 10)
  for (const date of Object.keys(cache)) {
    if (date < cutoffKey) delete cache[date]
  }
}

/**
 * 记录一次（或一批）AI 调用到台账。
 * @param {string|string[]} actions 本次调用涉及的 action（单个或数组）
 * @param {Object<string,number>} [tokensByAction] 各 action 的 tokens（可缺省，缺省记 0）
 */
export function recordLedger(actions, tokensByAction = {}) {
  const list = Array.isArray(actions) ? actions : [actions]
  if (list.length === 0) return
  const date = dateKey()
  const hour = String(new Date().getHours())
  const day = cache[date] ?? (cache[date] = { byHour: {}, byAction: {} })
  for (const action of list) {
    const key = String(action || '').trim()
    if (!key) continue
    const tokens = Math.max(0, Math.round(Number(tokensByAction?.[key]) || 0))
    const add = (bucket) => {
      const item = bucket[key] ?? (bucket[key] = { calls: 0, tokens: 0 })
      item.calls += 1
      item.tokens += tokens
    }
    add(day.byAction)
    add(day.byHour[hour] ?? (day.byHour[hour] = {}))
  }
  prune()
  scheduleSave()
}

/**
 * 聚合查询台账序列。
 * @param {{ fromKey:string, toKey:string, granularity:'hour'|'day'|'month' }} opts
 *   hour：仅取 fromKey 当天数据，按小时拆 24 桶（key 'HH'）；day：按日期（'YYYY-MM-DD'）；month：按月（'YYYY-MM'）
 * @returns {{ buckets: Array<{key:string, byAction:Object<string,{calls:number,tokens:number}>}> }}
 */
export function ledgerSeries({ fromKey, toKey, granularity = 'day' } = {}) {
  const from = String(fromKey || '')
  const to = String(toKey || from || '')
  const buckets = []
  const bucketBy = new Map()

  const add = (key, action, calls, tokens) => {
    let bucket = bucketBy.get(key)
    if (!bucket) {
      bucket = { key, byAction: {} }
      bucketBy.set(key, bucket)
      buckets.push(bucket)
    }
    const item = bucket.byAction[action] ?? (bucket.byAction[action] = { calls: 0, tokens: 0 })
    item.calls += calls
    item.tokens += tokens
  }

  if (granularity === 'hour') {
    // 小时粒度：仅当天数据按 byHour 展开 0-23 时（空桶也返回，便于前端画满 24 小时柱）
    const day = cache[from]
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, '0')
      const bucket = { key, byAction: {} }
      bucketBy.set(key, bucket)
      buckets.push(bucket)
    }
    if (day?.byHour && typeof day.byHour === 'object') {
      for (const [h, actions] of Object.entries(day.byHour)) {
        if (!actions || typeof actions !== 'object') continue
        const key = String(Number(h)).padStart(2, '0')
        for (const [action, v] of Object.entries(actions)) {
          if (!v || typeof v !== 'object') continue
          add(key, action, Number(v.calls) || 0, Number(v.tokens) || 0)
        }
      }
    }
    return { buckets }
  }

  // 日/月粒度：先补全范围内的连续桶（空桶也返回，便于前端画连续序列）
  if (granularity === 'day' || granularity === 'month') {
    const sliceLen = granularity === 'month' ? 7 : 10
    let cursor = granularity === 'month' ? `${from.slice(0, 7)}-01` : from
    const end = granularity === 'month' ? `${to.slice(0, 7)}-01` : to
    let guard = 0
    while (cursor <= end && guard < 400) {
      const key = cursor.slice(0, sliceLen)
      const bucket = { key, byAction: {} }
      bucketBy.set(key, bucket)
      buckets.push(bucket)
      // 下一桶：month 进位到下月 1 日，day 进位到次日（用 UTC 计算避免时区漂移）
      if (granularity === 'month') {
        const t = new Date(Date.parse(`${cursor}T00:00:00Z`) + 32 * 24 * 3600 * 1000)
        cursor = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`
      } else {
        cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10)
      }
      guard++
    }
  }

  // 填充台账数据（范围外的日期忽略）
  for (const [date, day] of Object.entries(cache)) {
    if (!day?.byAction || typeof day.byAction !== 'object') continue
    if ((from && date < from) || (to && date > to)) continue
    const key = granularity === 'month' ? date.slice(0, 7) : date
    for (const [action, v] of Object.entries(day.byAction)) {
      if (!v || typeof v !== 'object') continue
      add(key, action, Number(v.calls) || 0, Number(v.tokens) || 0)
    }
  }
  buckets.sort((a, b) => a.key.localeCompare(b.key))
  return { buckets }
}
