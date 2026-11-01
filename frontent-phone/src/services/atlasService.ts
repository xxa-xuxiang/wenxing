// 知识星图运行时增量：读取/追加 AI 精细大纲补充的新学科与能力〔自桌面端移植〕
import { http } from './http'

export interface AtlasNewNode {
  leixing: string
  zu: string
  xiang: string
  kp: string[]
  reason?: string
  industry?: string
}

/** 拉取后端增量节点（失败返回空数组，不阻塞星图） */
export async function fetchAtlasExtra(): Promise<AtlasNewNode[]> {
  try {
    const data = await http<{ nodes: AtlasNewNode[] }>('/api/atlas/extra', { timeout: 8000 })
    return Array.isArray(data.nodes) ? data.nodes : []
  } catch {
    return []
  }
}

/** 追加增量节点（同时由后端同步 SkillLeaf） */
export async function addAtlasExtra(
  industry: string,
  nodes: AtlasNewNode[]
): Promise<{ added: number; total: number }> {
  return http<{ added: number; total: number }>('/api/atlas/extra', {
    method: 'POST',
    body: JSON.stringify({ industry, nodes }),
    timeout: 15000
  })
}
