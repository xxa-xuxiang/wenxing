// 问星 — 向量文档服务：星图关联文档检索 / 单篇预览 / 收藏 / 入库〔自桌面端移植〕
// file 统一为相对文档根目录的路径（如 cs/programming/java.md），与后端 /api/vector/* 约定一致
import { http } from './http'

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

/** 单篇文档预览（meta 为文档 frontmatter，字段不固定） */
export interface VectorDoc {
  meta: { title?: string; tags?: string[]; [key: string]: unknown }
  content: string
}

/** 收藏记录 */
export interface FavoriteItem {
  industry: string
  file: string
  title: string
  createdAt: string
}

/** 已存档文档清单项（file 为行业目录内的文件名，不含行业前缀） */
export interface DocListItem {
  industry: string
  file: string
  title: string
  tags: string[]
  generatedAt?: string
  updatedAt?: string
}

/** 文档清单（用于星图节点按标题 / 标签本地匹配） */
export function listDocs(): Promise<{ docs: DocListItem[] }> {
  return http('/api/docs/list')
}

/** 按星图节点路径生成技能文档（已存在则直接返回，不重复消耗 AI） */
export function generateSkillDoc(payload: {
  title: string
  path: string[]
}): Promise<{ industry: string; file: string; title: string; content: string }> {
  return http('/api/skill-doc/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

/** 语义检索与知识点相关的文档 TopK（未配置 Embedding 时服务端降级为关键词匹配） */
export function searchRelated(q: string, limit = 5): Promise<SearchRelatedResult> {
  return http(`/api/vector/search?q=${encodeURIComponent(q)}&limit=${limit}`)
}

/** 读取单篇文档全文（供关联文档面板内嵌预览 / 导出） */
export function fetchVectorDoc(file: string): Promise<VectorDoc> {
  return http(`/api/vector/doc?file=${encodeURIComponent(file)}`)
}

/** 单篇文档入库/重建向量索引（未配置 Embedding 时后端返回 503） */
export function indexDoc(industry: string, file: string): Promise<{ ok: boolean; chunks: number }> {
  return http('/api/vector/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ industry, file })
  })
}

/** 收藏文档（需登录） */
export function favoriteDoc(
  industry: string,
  file: string,
  title: string
): Promise<{ ok: boolean; favorited: boolean }> {
  return http('/api/docs/favorite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ industry, file, title })
  })
}

/** 取消收藏（需登录） */
export function unfavoriteDoc(
  industry: string,
  file: string
): Promise<{ ok: boolean; favorited: boolean }> {
  return http(
    `/api/docs/favorite?industry=${encodeURIComponent(industry)}&file=${encodeURIComponent(file)}`,
    { method: 'DELETE' }
  )
}

/** 收藏列表（需登录） */
export function listFavorites(): Promise<{ favorites: FavoriteItem[] }> {
  return http('/api/docs/favorites')
}
