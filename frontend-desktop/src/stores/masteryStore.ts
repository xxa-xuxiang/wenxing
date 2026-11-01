// 问星 v0.5 — 知识点掌握度 Store（学习闭环核心）
// 状态机（PRD 3.1 唯一定义）：
//   未学（无任何答题记录）→ 产生任意答题记录 → 在学
//   在学 → 近 10 条记录正确率 ≥80% 且累计题数 ≥5 → 已掌握
//   已掌握 → 近 10 条记录正确率跌破 60% → 退回在学（滞回：60%~80% 区间保持已掌握）
// 持久化：localStorage 单对象 mastery，键 = 知识点原名（星图 md 叶子能力项名）
// v0.6 云同步：答题记录先入本地队列，防抖推送到服务端（未登录/失败保留重试）；
//   登录引导用 replayRecords 按时间序重放服务端记录重建状态机
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { storage } from '@/utils/storage'

export type MasteryState = 'unlearned' | 'learning' | 'mastered'

interface MasteryRecord {
  ok: boolean
  t: number
}

interface MasteryEntry {
  state: MasteryState
  records: MasteryRecord[]
}

type MasteryMap = Record<string, MasteryEntry>

/** 待推送的答题记录（队列项 = 记录 + 知识点名） */
type PendingRecord = MasteryRecord & { kp: string }

/** 每个知识点最多保留的答题记录数（状态机只看近 10 条，多余截断防膨胀） */
const MAX_RECORDS = 50

function recentAccuracy(records: MasteryRecord[]): number {
  const last = records.slice(-10)
  if (last.length === 0) return 0
  return last.filter((r) => r.ok).length / last.length
}

/** 状态机转移（recordAnswer 与 replayRecords 共用，勿在此处改动阈值） */
function applyTransition(entry: MasteryEntry): void {
  const total = entry.records.length
  const acc = recentAccuracy(entry.records)
  if (entry.state === 'unlearned') {
    entry.state = 'learning'
  }
  if (entry.state === 'learning' && total >= 5 && acc >= 0.8) {
    entry.state = 'mastered'
  } else if (entry.state === 'mastered' && acc < 0.6) {
    entry.state = 'learning'
  }
}

export const useMasteryStore = defineStore('mastery', () => {
  const map = ref<MasteryMap>(storage.get<MasteryMap>('mastery', {}))
  // 变更版本号：星图/首页等监听它触发重渲染
  const version = ref(0)

  // ===== v0.6 云同步队列：待推送的答题记录（localStorage 持久化防丢失） =====
  const pending = ref<PendingRecord[]>(storage.get<PendingRecord[]>('masteryPending', []))
  let flushTimer: number | null = null
  let flushing = false

  function persist() {
    storage.set('mastery', map.value)
  }

  function persistPending() {
    storage.set('masteryPending', pending.value)
  }

  /** 答题记录入队并防抖推送（1.5s 内的连续答题合并为一批） */
  function enqueue(kp: string, ok: boolean, t: number) {
    const item: PendingRecord = { kp, ok, t }
    pending.value = [...pending.value, item]
    persistPending()
    if (flushTimer !== null) return
    flushTimer = window.setTimeout(() => {
      flushTimer = null
      void flush()
    }, 1500)
  }

  /** 推送队列到服务端；成功移除已发送批次，失败保留等待下次重试 */
  async function flush(): Promise<void> {
    if (flushing || pending.value.length === 0) return
    flushing = true
    const batch = pending.value
    try {
      const { pushMastery } = await import('@/services/progressService')
      await pushMastery(batch)
      // 竞态保护：flush 期间新入队的记录不会被误删
      pending.value = pending.value.slice(batch.length)
      persistPending()
    } catch {
      /* 未登录或后端不可用：保留队列静默降级 */
    } finally {
      flushing = false
    }
  }

  /** 查询某知识点掌握状态（无记录 = 未学，不报错） */
  function getState(kp: string): MasteryState {
    return map.value[kp]?.state ?? 'unlearned'
  }

  /** 记录一次答题，返回状态迁移（供结果页统计「新点亮 / 新掌握」） */
  function recordAnswer(kp: string, ok: boolean): { prev: MasteryState; next: MasteryState } {
    const name = kp.trim()
    if (!name) return { prev: 'unlearned', next: 'unlearned' }
    const entry: MasteryEntry = map.value[name] ?? { state: 'unlearned', records: [] }
    const prev = entry.state
    const t = Date.now()
    entry.records = [...entry.records, { ok, t }].slice(-MAX_RECORDS)
    applyTransition(entry)
    map.value = { ...map.value, [name]: entry }
    version.value += 1
    persist()
    enqueue(name, ok, t)
    return { prev, next: entry.state }
  }

  /** 按时间序重放服务端答题记录，重建本地状态机（登录引导：云端覆盖本地）。
   *  按 (kp, t) 去重：同一设备重复登录时云端记录已在本地，避免重复追加导致膨胀 */
  function replayRecords(records: { kp: string; ok: boolean; t: number }[]) {
    const sorted = [...records].sort((a, b) => a.t - b.t)
    for (const r of sorted) {
      const name = r.kp.trim()
      if (!name) continue
      const entry: MasteryEntry = map.value[name] ?? { state: 'unlearned', records: [] }
      if (entry.records.some((x) => x.t === r.t)) continue
      entry.records = [...entry.records, { ok: r.ok, t: r.t }].slice(-MAX_RECORDS)
      applyTransition(entry)
      map.value = { ...map.value, [name]: entry }
    }
    version.value += 1
    persist()
  }

  /** 清空待推送队列（登录继承推送成功后调用，防止队列重推造成云端重复） */
  function clearPending() {
    pending.value = []
    persistPending()
  }

  /** 从 localStorage 重读（登录/退出切换用户命名空间后调用，界面随之更新） */
  function reload() {
    map.value = storage.get<MasteryMap>('mastery', {})
    pending.value = storage.get<PendingRecord[]>('masteryPending', [])
    version.value += 1
  }

  /** 全局统计：已掌握知识点数 / 累计答题数 / 已点亮（在学+已掌握）知识点数 */
  const stats = computed(() => {
    let masteredCount = 0
    let litCount = 0
    let totalAnswers = 0
    for (const key of Object.keys(map.value)) {
      const e = map.value[key]
      if (e.state === 'mastered') masteredCount += 1
      if (e.state !== 'unlearned') litCount += 1
      totalAnswers += e.records.length
    }
    return { masteredCount, litCount, totalAnswers }
  })

  /** 清空全部掌握度记录（重置进度时调用），同步队列一并清空 */
  function reset() {
    map.value = {}
    pending.value = []
    persistPending()
    version.value += 1
    persist()
  }

  return { map, version, stats, getState, recordAnswer, replayRecords, clearPending, reload, reset }
})
