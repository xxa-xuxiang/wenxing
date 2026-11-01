// 问星 v1.1 — 后端题库服务（浏览/分面、按技能叶子凑题、覆盖度、旧题迁移）
import { http } from './http'
import type { Question } from '@/types'

export interface FacetItem {
  val: string
  count: number
}
export interface QuestionListResp {
  items: Question[]
  total: number
  page: number
  pageSize: number
  facets: {
    difficulty: FacetItem[]
    type: FacetItem[]
    industry: FacetItem[]
  }
}

export interface ListParams {
  q?: string
  type?: string[]
  difficulty?: string[]
  industry?: string
  leafKey?: string
  page?: number
  pageSize?: number
}

/** 后端 DTO 归一化：题库题统一按 AI/RAG 来源标记，保证旧 UI 的 source 徽章可用 */
function norm(q: Question): Question {
  return { ...q, source: q.source ?? 'ai' }
}

export function listQuestions(params: ListParams = {}): Promise<QuestionListResp> {
  const usp = new URLSearchParams()
  if (params.q?.trim()) usp.set('q', params.q.trim())
  if (params.type?.length) usp.set('type', params.type.join(','))
  if (params.difficulty?.length) usp.set('difficulty', params.difficulty.join(','))
  if (params.industry) usp.set('industry', params.industry)
  if (params.leafKey) usp.set('leafKey', params.leafKey)
  usp.set('page', String(params.page ?? 1))
  usp.set('pageSize', String(params.pageSize ?? 60))
  return http<QuestionListResp>(`/api/questions?${usp.toString()}`).then((r) => ({
    ...r,
    items: r.items.map(norm)
  }))
}

export interface LeafSearchItem {
  leafKey: string
  name: string
  industry: string
  pathText: string
  verifiedCount: number
  status: string
}

export function searchLeaves(q: string, industry = ''): Promise<{ items: LeafSearchItem[] }> {
  const usp = new URLSearchParams({ q })
  if (industry) usp.set('industry', industry)
  return http<{ items: LeafSearchItem[] }>(`/api/leaves/search?${usp.toString()}`)
}

export interface SkillPath {
  industry: string
  category?: string
  domain?: string
  stack?: string
  name: string
}

export interface BySkillResp {
  items: Question[]
  leaf: { leafKey: string; name: string; pathText: string; industry: string }
  pipeline: { status: string; verifiedCount: number; added: number; rejected: number; blockedReason?: string } | null
}

/** 学习页能力点入口：路径精确匹配叶子（generate=false 时只取已入库题，不触发出题） */
export function questionsBySkillPath(path: SkillPath, count = 20, generate = true): Promise<BySkillResp> {
  return http<BySkillResp>('/api/questions/by-skill', {
    method: 'POST',
    body: JSON.stringify({ path, count, generate }),
    timeout: 180000 // JIT 出题可能耗时 1 分钟以上
  }).then((r) => ({ ...r, items: r.items.map(norm) }))
}

/** 题库面板入口：已知 leafKey（generate=false 时只取已入库题） */
export function questionsByLeaf(leafKey: string, count = 20, generate = true): Promise<BySkillResp> {
  const usp = new URLSearchParams({ leafKey, count: String(count), generate: generate ? '1' : '0' })
  return http<BySkillResp>(`/api/questions/by-skill?${usp.toString()}`, { timeout: 180000 }).then((r) => ({
    ...r,
    items: r.items.map(norm)
  }))
}

export interface CoverageItem {
  industry: string
  leaves: number
  filled: number
  blocked: number
  materializing: number
  failed: number
  questions: number
}

export function getCoverage(): Promise<{ items: CoverageItem[]; targetPerLeaf: number }> {
  return http('/api/questions/coverage')
}

/** 旧版本地自定义题一次性迁移（需登录；按知识点名匹配叶子，匹配不上跳过） */
export function migrateQuestions(questions: Question[]): Promise<{ imported: number; skipped: number; total: number }> {
  return http('/api/questions/migrate', { method: 'POST', body: JSON.stringify({ questions }) })
}

/** 题目纠错反馈：累计 3 次自动下架并重新出题 */
export function reportQuestion(
  id: string,
  reason = ''
): Promise<{ ok: true; feedbackCount: number; retired: boolean }> {
  return http(`/api/questions/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  })
}
