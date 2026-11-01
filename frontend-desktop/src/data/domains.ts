// 问星 v0.1 — 行业领域词条（由 20 行业元数据派生，全部可选）
// 注：tagline/tags 由分类 md 解析而来，但全项目从未读取，故这里不再解析 md，
// 改从 industriesMeta 取 id/name，避免行业分类 md 正文进入首屏 chunk。
import type { Domain } from '@/types'
import { industryMetas } from '@/data/industriesMeta'

export const domains: Domain[] = industryMetas.map((ind) => ({
  id: ind.id,
  name: ind.name,
  tagline: '',
  tags: [],
  available: true
}))
