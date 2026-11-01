// 问星 v1.1 — 试卷与答题会话服务（后端化：试卷 ID 引用、交卷服务端判分、交卷深度分析）
import { http } from './http'
import type { Paper, Question } from '@/types'

export interface PaperBrief {
  id: string
  title: string
  createdAt: number
  scope: string[]
  scorePer: number
  questionCount: number
  totalScore: number
}

/** 创建试卷（题目以 ID 引用，仅接受 verified 题） */
export function createPaper(payload: {
  title: string
  scope: string[]
  scorePer: number
  questionIds: string[]
}): Promise<{ paper: Paper; dropped: number }> {
  return http('/api/papers', { method: 'POST', body: JSON.stringify(payload) })
}

export function listPapers(limit = 100): Promise<{ items: PaperBrief[] }> {
  return http(`/api/papers?limit=${limit}`)
}

export function getPaper(id: string): Promise<{ paper: Paper }> {
  return http(`/api/papers/${encodeURIComponent(id)}`)
}

export function deletePaper(id: string): Promise<{ ok: true }> {
  return http(`/api/papers/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ===== 答题会话 =====

export interface SessionDetail {
  id: string
  title: string
  total: number
  correctCount: number
  score: number
  earnedScore: number
  totalScore: number
  kpReview: { name: string; total: number; correct: number; rate: number }[]
  createdAt: number
}

export interface JudgedItem {
  questionId: string
  correct: boolean
  userAnswer: string
  question: Question
}

/** 交卷：服务端判分并归档（匿名也可用，登录后归档到账号） */
export function submitSession(payload: {
  title: string
  paperId?: string | null
  leafKey?: string | null
  scorePer?: number
  answers: { questionId: string; userAnswer: string }[]
}): Promise<{ session: SessionDetail; results: JudgedItem[] }> {
  return http('/api/quiz/sessions', { method: 'POST', body: JSON.stringify(payload) })
}

export interface QuizAnalysis {
  wrongItems: { index: number; question: string; diagnosis: string; correctThinking: string; knowledgePoint: string }[]
  keyItems: { index: number; question: string; deepDive: string }[]
  weakPoints: { name: string; advice: string }[]
  overall: string
  nextSteps: string[]
}

/** 交卷后深度分析（服务端缓存：同一会话只生成一次） */
export function analyzeSession(sessionId: string): Promise<{ analysis: QuizAnalysis; cached: boolean }> {
  return http(`/api/quiz/sessions/${encodeURIComponent(sessionId)}/analyze`, {
    method: 'POST',
    timeout: 180000
  })
}

export function listSessions(limit = 30): Promise<{
  items: { id: string; title: string; total: number; correctCount: number; score: number; createdAt: number; hasAnalysis: boolean }[]
}> {
  return http(`/api/quiz/sessions?limit=${limit}`)
}
