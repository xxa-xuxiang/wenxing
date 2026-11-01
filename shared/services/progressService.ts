// 问星 — 学习进度同步服务（桌面端与手机端共用）
// 掌握度答题记录：增量追加（按客户端时间戳落库）；学习状态：全量 JSON 快照整存整取
// 全部接口需要登录（Bearer token）；未登录时直接抛错，不发请求（调用方静默降级为纯本地）
import { getToken } from '@/services/authService'
import { http } from '@shared/services/http'

/** 服务端答题记录条目 */
export interface RemoteMasteryRecord {
  kp: string
  ok: boolean
  t: number
}

/** 服务端全量进度 */
export interface RemoteProgress {
  mastery: RemoteMasteryRecord[]
  learning: string | null
}

async function authed<T>(path: string, method: string, body?: unknown): Promise<T> {
  // 未登录直接抛错不发请求（调用方静默降级为纯本地）；token 注入交由 http 统一处理
  if (!getToken()) throw new Error('未登录')
  return http<T>(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

/** 拉取当前用户全量进度 */
export function fetchProgress(): Promise<RemoteProgress> {
  return authed<RemoteProgress>('/progress', 'GET')
}

/** 批量推送答题记录（增量追加），返回入库条数 */
export function pushMastery(records: RemoteMasteryRecord[]): Promise<{ ok: boolean; inserted: number }> {
  return authed('/progress/mastery', 'POST', { records })
}

/** 保存学习状态 JSON 快照（整存整取） */
export function putLearning(data: string): Promise<{ ok: boolean }> {
  return authed('/progress/learning', 'PUT', { data })
}

/** 清空当前用户云端学习数据（保留账号） */
export function deleteProgress(): Promise<{ ok: boolean }> {
  return authed('/progress', 'DELETE')
}
