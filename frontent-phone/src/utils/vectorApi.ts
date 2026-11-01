// 问星 — 向量文档检索工具（星图关联文档）：/api/vector/search〔读取类接口，按需调用〕
// 后端：GET /api/vector/search?q=<查询词>&limit=<条数>
//   响应 { docs: RelatedDoc[], degraded: boolean }
//   未配置 Embedding 时 degraded=true，服务端降级为标题/标签关键词匹配（score 为 null）
// file 为相对文档根目录路径（如 cs/programming/java.md），与后端 /api/vector/* 约定一致
import { http } from '@/services/http'

/** 关联文档检索结果项（score 为 null = 降级关键词匹配） */
export interface RelatedDoc {
  industry: string
  file: string
  title: string
  tags: string[]
  score: number | null
  snippet: string
}

export interface SearchRelatedResult {
  docs: RelatedDoc[]
  /** true = 未配置 Embedding，降级为标题/标签匹配 */
  degraded: boolean
}

/** 语义检索与知识点相关的文档 TopK（未配置 Embedding 时服务端降级为关键词匹配） */
export function searchRelated(q: string, limit = 5): Promise<SearchRelatedResult> {
  return http(`/api/vector/search?q=${encodeURIComponent(q)}&limit=${limit}`)
}
