// 问星 v1.7 — AI 计费配置监听：启动拉取 /api/billing/pricing 缓存 version 到 localStorage；
// 按「累计在线时长」计时（模块级秒数累加），每满 24 小时重新拉取一次；
// version 与缓存不同 → 更新缓存并调 billingNotice store 的 show() 弹左上角提醒。
// 走查钩子：localStorage `wenxing:billing:check-override-minutes` 数字可覆盖在线时长阈值（单位：分钟）
import { http } from './http'
import { useBillingNoticeStore } from '@/stores/billingNotice'

const VERSION_KEY = 'wenxing:billing:version'
const OVERRIDE_KEY = 'wenxing:billing:check-override-minutes'
/** 累计在线时长阈值：24 小时（秒） */
const CHECK_INTERVAL_SECONDS = 86_400

/** 累计在线秒数 */
let onlineSeconds = 0
let started = false

/** 拉取当前计费 version：与缓存不同 → 更新缓存并弹提醒；首次无缓存仅缓存不弹 */
async function checkPricingVersion(): Promise<void> {
  try {
    const data = await http<{ version: number }>('/api/billing/pricing')
    const raw = localStorage.getItem(VERSION_KEY)
    const cached = raw == null ? null : Number(raw)
    if (cached != null && Number.isFinite(cached) && data.version !== cached) {
      useBillingNoticeStore().show()
    }
    localStorage.setItem(VERSION_KEY, String(data.version))
  } catch {
    /* 后端不可达静默跳过，下个周期再试 */
  }
}

/** 在线时长阈值（秒）：走查覆盖分钟数 → 秒；非法/缺省回退 24h */
function thresholdSeconds(): number {
  const minutes = Number(localStorage.getItem(OVERRIDE_KEY))
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60
  return CHECK_INTERVAL_SECONDS
}

/** 每秒累计在线时长，满阈值清零并重新拉取 */
function tick(): void {
  onlineSeconds++
  if (onlineSeconds >= thresholdSeconds()) {
    onlineSeconds = 0
    void checkPricingVersion()
  }
}

/** 应用启动时调用（幂等）：立即拉取一次，并开启在线时长计时 */
export function initBillingWatch(): void {
  if (started) return
  started = true
  void checkPricingVersion()
  window.setInterval(tick, 1000)
}
