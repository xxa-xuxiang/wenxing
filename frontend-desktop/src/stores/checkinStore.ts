// 问星 v1.2 — 打卡 / 周复盘 Store
// 登录：读写服务端（userId 隔离）；未登录或后端不可用：静默降级为本地 localStorage
// 合并策略（简单）：拉取服务端时只补本地缺失的日期（冲突以本地为准），不自动批量上传，避免静默请求
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { storage } from '@/utils/storage'
import { getToken } from '@/services/authService'
import {
  fetchCheckins,
  fetchReviews,
  saveCheckin,
  saveReview,
  type CheckinRecord,
  type WeeklyReviewRecord
} from '@/services/checkinService'

const DAY = 24 * 60 * 60 * 1000

/** 本地日期键 YYYY-MM-DD（本地时区） */
export function dateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 某日所在周的周一日期键（周一为起点） */
export function weekStartKey(d: Date): string {
  const base = new Date(d)
  base.setHours(0, 0, 0, 0)
  const dow = base.getDay() // 0=周日
  base.setDate(base.getDate() - (dow === 0 ? 6 : dow - 1))
  return dateKey(base)
}

// ===== 学习时间 / 学习项目自动记录（本地按日分桶，仅供「今日打卡」一键读取） =====
// 学习时间由 LearnView 心跳累计（页面可见时每分钟 +1）；学习项目在打开任务文档时记录
const studyMinKey = (d: string) => `study:min:${d}`
const studyTaskKey = (d: string) => `study:tasks:${d}`

/** 追踪数据版本号：写入时 +1，供 computed 建立响应式依赖 */
export const studyTrackVersion = ref(0)

/** 累计今日学习时长（分钟） */
export function addStudyMinutes(n = 1, d = dateKey(new Date())): void {
  storage.set(studyMinKey(d), storage.get<number>(studyMinKey(d), 0) + n)
  studyTrackVersion.value += 1
}
/** 读取某日自动累计的学习时长（分钟） */
export function getStudyMinutes(d = dateKey(new Date())): number {
  void studyTrackVersion.value
  return storage.get<number>(studyMinKey(d), 0)
}
/** 记录今日学过（打开过文档）的任务 */
export function markTaskStudied(taskId: string, d = dateKey(new Date())): void {
  const list = storage.get<string[]>(studyTaskKey(d), [])
  if (!list.includes(taskId)) {
    list.push(taskId)
    storage.set(studyTaskKey(d), list)
    studyTrackVersion.value += 1
  }
}
/** 读取某日自动记录的学习任务 ID 列表 */
export function getStudiedTaskIds(d = dateKey(new Date())): string[] {
  void studyTrackVersion.value
  return storage.get<string[]>(studyTaskKey(d), [])
}

export const useCheckinStore = defineStore('checkin', () => {
  const checkins = ref<Record<string, CheckinRecord>>(storage.get('checkins', {}))
  const reviews = ref<Record<string, WeeklyReviewRecord>>(storage.get('reviews', {}))
  const loading = ref(false)
  const error = ref('')
  /** 本地是否有未同步到服务端的记录（离线期间产生） */
  const pendingLocal = ref<boolean>(storage.get('checkinPending', false))

  const todayKey = dateKey(new Date())
  const weekKey = weekStartKey(new Date())

  function persistLocal() {
    storage.set('checkins', checkins.value)
    storage.set('reviews', reviews.value)
    storage.set('checkinPending', pendingLocal.value)
  }

  /** 今日打卡记录（null = 未打卡） */
  const todayRecord = computed<CheckinRecord | null>(() => checkins.value[todayKey] ?? null)
  /** 本周复盘记录 */
  const weekReview = computed<WeeklyReviewRecord | null>(() => reviews.value[weekKey] ?? null)

  /** 连续打卡天数（从今天/昨天起向前连续） */
  const streak = computed(() => {
    const has = (k: string) => Boolean(checkins.value[k])
    const cursor = new Date()
    cursor.setHours(0, 0, 0, 0)
    // 今天没打卡不打断连续（从昨天开始数）
    if (!has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1)
    let n = 0
    while (has(dateKey(cursor)) && n < 3650) {
      n += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return n
  })

  /** 本周（周一至今）打卡统计 */
  const weekStats = computed(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const dow = start.getDay()
    start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let days = 0
    let minutes = 0
    const taskIds = new Set<string>()
    for (let t = start.getTime(); t <= today.getTime(); t += DAY) {
      const r = checkins.value[dateKey(new Date(t))]
      if (!r) continue
      days += 1
      minutes += r.minutes
      for (const id of r.taskIds) taskIds.add(id)
    }
    return { days, minutes, taskCount: taskIds.size }
  })

  /** 拉取服务端区间打卡并合并（未登录 / 后端不可用：静默保留本地） */
  async function loadRecent(days = 120): Promise<void> {
    if (!getToken()) return
    loading.value = true
    error.value = ''
    try {
      const to = dateKey(new Date())
      const from = dateKey(new Date(Date.now() - days * DAY))
      const resp = await fetchCheckins(from, to)
      for (const item of resp.items) {
        // 冲突以本地为准：本地已有该日则保留本地
        if (!checkins.value[item.date]) checkins.value[item.date] = item
      }
      persistLocal()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '打卡记录加载失败'
    } finally {
      loading.value = false
    }
  }

  /** 保存某日打卡（登录走服务端，失败降级本地） */
  async function saveDaily(
    date: string,
    payload: { minutes: number; taskIds: string[]; note: string }
  ): Promise<void> {
    const record: CheckinRecord = {
      date,
      minutes: payload.minutes,
      taskIds: payload.taskIds,
      note: payload.note,
      updatedAt: Date.now()
    }
    let synced = false
    if (getToken()) {
      try {
        const resp = await saveCheckin(date, payload)
        checkins.value[date] = resp.checkin
        synced = true
      } catch {
        /* 后端不可用：降级本地，标记待同步 */
      }
    }
    if (!synced) {
      checkins.value[date] = record
      pendingLocal.value = true
    }
    persistLocal()
  }

  /** 保存本周复盘（登录走服务端，失败降级本地） */
  async function saveWeekly(
    weekStart: string,
    payload: { good: string; bad: string; improve: string }
  ): Promise<void> {
    let synced = false
    if (getToken()) {
      try {
        const resp = await saveReview(weekStart, payload)
        reviews.value[weekStart] = resp.review
        synced = true
      } catch {
        /* 降级本地 */
      }
    }
    if (!synced) {
      reviews.value[weekStart] = { weekStart, ...payload, updatedAt: Date.now() }
      pendingLocal.value = true
    }
    persistLocal()
  }

  /** 拉取历史复盘（最近 8 周，登录态） */
  async function loadReviews(limit = 8): Promise<void> {
    if (!getToken()) return
    try {
      const resp = await fetchReviews(limit)
      for (const item of resp.items) {
        if (!reviews.value[item.weekStart]) reviews.value[item.weekStart] = item
      }
      persistLocal()
    } catch {
      /* 静默保留本地 */
    }
  }

  /** 登录/退出切换用户命名空间后重读本地缓存 */
  function reload() {
    checkins.value = storage.get('checkins', {})
    reviews.value = storage.get('reviews', {})
    pendingLocal.value = storage.get('checkinPending', false)
  }

  function resetLocal() {
    checkins.value = {}
    reviews.value = {}
    pendingLocal.value = false
    persistLocal()
  }

  return {
    checkins,
    reviews,
    loading,
    error,
    pendingLocal,
    todayKey,
    weekKey,
    todayRecord,
    weekReview,
    streak,
    weekStats,
    loadRecent,
    saveDaily,
    saveWeekly,
    loadReviews,
    reload,
    resetLocal
  }
})
