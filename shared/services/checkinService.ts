// 问星 — 学习流程接口封装（每日打卡 / 每周复盘，桌面端与手机端共用）
// 全部接口需要登录；未登录时直接抛错不发请求，调用方（checkinStore）静默降级为本地 localStorage
import { getToken } from '@/services/authService'
import { http } from '@shared/services/http'

/** 打卡记录（服务端返回结构） */
export interface CheckinRecord {
  /** YYYY-MM-DD */
  date: string
  minutes: number
  taskIds: string[]
  note: string
  updatedAt: number
}

/** 周复盘记录（服务端返回结构） */
export interface WeeklyReviewRecord {
  /** 本周一 YYYY-MM-DD */
  weekStart: string
  good: string
  bad: string
  improve: string
  updatedAt: number
}

async function authed<T>(path: string, method: string, body?: unknown): Promise<T> {
  if (!getToken()) throw new Error('未登录')
  return http<T>(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

/** 打卡区间查询（默认最近 90 天） */
export function fetchCheckins(from?: string, to?: string): Promise<{ items: CheckinRecord[] }> {
  const qs = [from ? `from=${from}` : '', to ? `to=${to}` : ''].filter(Boolean).join('&')
  return authed<{ items: CheckinRecord[] }>(`/checkins${qs ? `?${qs}` : ''}`, 'GET')
}

/** 写入/覆盖某日打卡（upsert，幂等） */
export function saveCheckin(
  date: string,
  payload: { minutes: number; taskIds: string[]; note: string }
): Promise<{ checkin: CheckinRecord }> {
  return authed<{ checkin: CheckinRecord }>(`/checkins/${date}`, 'PUT', payload)
}

/** 复盘历史（默认最近 8 周） */
export function fetchReviews(limit = 8): Promise<{ items: WeeklyReviewRecord[] }> {
  return authed<{ items: WeeklyReviewRecord[] }>(`/reviews?limit=${limit}`, 'GET')
}

/** 写入/覆盖某周复盘（upsert，幂等） */
export function saveReview(
  weekStart: string,
  payload: { good: string; bad: string; improve: string }
): Promise<{ review: WeeklyReviewRecord }> {
  return authed<{ review: WeeklyReviewRecord }>(`/reviews/${weekStart}`, 'PUT', payload)
}
