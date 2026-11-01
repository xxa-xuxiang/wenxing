// 问星 — 错题本接口封装（桌面端与手机端共用）
// 服务端按题目聚合「最近一次作答为错」的题（重练答对后自然移出），需要登录
import { getToken } from '@/services/authService'
import { http } from '@shared/services/http'
import type { WrongItem } from '@/types'

/** 拉取错题本（按最近答错时间倒序，默认最多 100 题） */
export function fetchWrongQuestions(limit = 100): Promise<{ items: WrongItem[]; total: number }> {
  if (!getToken()) return Promise.reject(new Error('未登录'))
  return http<{ items: WrongItem[]; total: number }>(`/api/quiz/wrong-questions?limit=${limit}`)
}
