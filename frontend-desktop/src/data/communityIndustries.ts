// 问星社区 — 行业标签配置（由运营方维护：增删 / 排序 / 图标 / 可见范围）
// 系统不预设行业名称：页面只展示此处 enabled=true 的行业，示例项仅用于演示布局，实际名称由运营方确定。
// 行业是内容分区边界：不同行业的帖子、评论、点赞、收藏、搜索、推荐相互隔离。
export interface CommunityIndustry {
  /** 稳定标识：入库存 industryId，改名不影响历史数据 */
  id: string
  /** 展示名称 */
  name: string
  /** 导航图标（矢量字符） */
  icon: string
  /** 可见范围：false = 未开放（不进入导航，也不参与搜索） */
  enabled: boolean
}

export const COMMUNITY_INDUSTRIES: CommunityIndustry[] = [
  { id: 'frontend', name: '前端', icon: '❖', enabled: true },
  { id: 'backend', name: '后端', icon: '⬡', enabled: true },
  { id: 'aigc', name: 'AIGC', icon: '✧', enabled: true },
  { id: 'designer', name: '设计师', icon: '◈', enabled: true }
]

/** 全站推荐流（伪行业）：左侧导航置顶，内容跨行业聚合，不作为发布归属 */
export const RECOMMEND_ID = 'recommend'

/** 默认落地行业（发布 / 草稿等需要真实行业归属时回退到第一个可用行业） */
export const DEFAULT_INDUSTRY_ID = 'frontend'

/** 可见行业列表（导航与发布行业选择共用） */
export function visibleIndustries(): CommunityIndustry[] {
  return COMMUNITY_INDUSTRIES.filter((i) => i.enabled)
}

export function industryById(id: string): CommunityIndustry | undefined {
  return COMMUNITY_INDUSTRIES.find((i) => i.id === id)
}

/** 行业名；未配置的 id 原样返回（兼容运营方改名/删项后的历史数据） */
export function industryName(id: string): string {
  return industryById(id)?.name ?? id ?? ''
}
