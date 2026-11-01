// 问星 v1.6 — AI 计费配置：按 action 单价（元/次），JSON 文件持久化 + 版本号
// 台账/用量中出现的未知 action 自动补入默认价，保证计费口径不漏
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { DATA_ROOT } from './data-root.js'

const PRICING_FILE = path.join(DATA_ROOT, 'ai-pricing.json')

/** 内置默认计费（pricePerCall 单位：元/次，演示数值） */
const DEFAULT_ITEMS = {
  recommend: { pricePerCall: 0.001, label: '技能推荐' },
  doc: { pricePerCall: 0.001, label: '新文档生成' },
  revise: { pricePerCall: 0.001, label: '文档修订' },
  chat: { pricePerCall: 0.001, label: '对话聊天' },
  questions: { pricePerCall: 0.001, label: '批量出题' },
  explainCheck: { pricePerCall: 0.001, label: '费曼讲解检测' },
  plan: { pricePerCall: 0.001, label: '学习计划' }
}

/**
 * 计量计费参数（v1.7 起生效）：
 * - freeTokenQuota：每账号长期免费 token 总量（累计，不刷新）
 * - tokenPricePerMillionYuan：超出免费量后每 100 万 token 价格（元）
 * - callPricePerThousandYuan：API 调用每 1000 次价格（元）
 */
const DEFAULT_METERING = {
  freeTokenQuota: 1_000_000,
  tokenPricePerMillionYuan: 1.3,
  callPricePerThousandYuan: 1
}

let cache = load()

function load() {
  try {
    if (fs.existsSync(PRICING_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf-8'))
      if (data && typeof data === 'object' && data.items && typeof data.items === 'object') {
        return {
          version: Number(data.version) || 1,
          updatedAt: String(data.updatedAt || ''),
          items: data.items,
          metering: { ...DEFAULT_METERING, ...(data.metering && typeof data.metering === 'object' ? data.metering : {}) }
        }
      }
    }
  } catch {
    /* 损坏则回退默认 */
  }
  return { version: 1, updatedAt: new Date().toISOString(), items: { ...DEFAULT_ITEMS }, metering: { ...DEFAULT_METERING } }
}

function persist() {
  try {
    fs.mkdirSync(DATA_ROOT, { recursive: true })
    fs.writeFileSync(PRICING_FILE, JSON.stringify(cache), 'utf-8')
  } catch {
    /* 写盘失败静默降级（内存缓存仍可用） */
  }
}

/** 未知 action 自动补入（label=action、默认价 0.01），同步写盘 */
function ensureAction(action) {
  const key = String(action || '').trim()
  if (!key || cache.items[key]) return
  cache.items[key] = { pricePerCall: 0.01, label: key }
  persist()
}

/** 读取当前计费配置（进程内缓存），可传入 action 列表用于补全未知项 */
export function getPricing(actions) {
  if (Array.isArray(actions)) for (const a of actions) ensureAction(a)
  return cache
}

/** 读取计量计费参数（免费 token 总量 / token 单价 / 次数单价） */
export function getMetering() {
  return cache.metering
}

/** 保存计量计费参数：校验非负数字与正整数配额；写盘 version+1 */
export function saveMetering(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('metering 必须为对象')
  const next = { ...cache.metering }
  if ('freeTokenQuota' in patch) {
    const n = Math.round(Number(patch.freeTokenQuota))
    if (!Number.isInteger(n) || n < 0) throw new Error('freeTokenQuota 必须为非负整数')
    next.freeTokenQuota = n
  }
  if ('tokenPricePerMillionYuan' in patch) {
    const n = Number(patch.tokenPricePerMillionYuan)
    if (!Number.isFinite(n) || n < 0) throw new Error('tokenPricePerMillionYuan 必须为非负数字')
    next.tokenPricePerMillionYuan = n
  }
  if ('callPricePerThousandYuan' in patch) {
    const n = Number(patch.callPricePerThousandYuan)
    if (!Number.isFinite(n) || n < 0) throw new Error('callPricePerThousandYuan 必须为非负数字')
    next.callPricePerThousandYuan = n
  }
  cache = { version: cache.version + 1, updatedAt: new Date().toISOString(), items: cache.items, metering: next }
  persist()
  return cache
}

/** 保存计费配置：items 为 {action: pricePerCall}，校验非负数字；写盘 version+1 并更新缓存 */
export function savePricing(items) {
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    throw new Error('items 必须为对象')
  }
  const next = {}
  for (const [action, price] of Object.entries(items)) {
    const n = Number(price)
    if (!Number.isFinite(n) || n < 0) throw new Error(`「${action}」单价必须为非负数字`)
    next[action] = { pricePerCall: n, label: cache.items[action]?.label || action }
  }
  cache = { version: cache.version + 1, updatedAt: new Date().toISOString(), items: next, metering: cache.metering }
  persist()
  return cache
}

// 默认导出：挂载于 /api/billing（公开只读，桌面端/网页端展示计费标准与变更提醒）
const router = express.Router()

router.get('/pricing', (req, res) => {
  res.json({ version: cache.version, updatedAt: cache.updatedAt, items: cache.items })
})

export default router
