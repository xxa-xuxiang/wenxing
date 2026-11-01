// 问星 v0.7 — 学习社区服务：帖子列表/详情/发布、点赞、收藏、评论、图片上传
// 统一前缀 /api/community；浏览类接口匿名可用，写操作需登录（带 token 自动附 Authorization）
import { apiUrl } from './apiBase'
import { ApiError, authHeaders, http } from './http'

export interface CommunityAuthor {
  nickname: string
}

/** 帖子列表项（cover 为首图相对地址，可能为 null） */
export interface CommunityPostListItem {
  id: string
  industryId: string
  title: string
  excerpt: string
  content: string
  tags: string[]
  images: string[]
  cover: string | null
  author: CommunityAuthor
  likeCount: number
  commentCount: number
  createdAt: string
  liked: boolean
  favorited: boolean
}

/** 帖子详情（评论按时间正序） */
export interface CommunityPostDetail {
  id: string
  industryId: string
  title: string
  content: string
  tags: string[]
  images: string[]
  author: CommunityAuthor
  likeCount: number
  commentCount: number
  favoriteCount: number
  createdAt: string
  liked: boolean
  favorited: boolean
  comments: CommunityComment[]
}

/** 发布帖子返回对象（完整帖子，无评论） */
export interface CommunityPostCreated {
  id: string
  industryId: string
  title: string
  content: string
  tags: string[]
  images: string[]
  cover: string | null
  author: CommunityAuthor
  likeCount: number
  commentCount: number
  favoriteCount: number
  createdAt: string
  liked: boolean
  favorited: boolean
}

export interface CommunityComment {
  id: string
  content: string
  author: CommunityAuthor
  createdAt: string
}

export interface ListPostsParams {
  page?: number
  pageSize?: number
  /** 行业标识（内容分区边界，默认 general 综合交流） */
  industry?: string
  /** 排序：latest 最新 / hot 热榜 / comment 多答（缺省=推荐倒序） */
  sort?: string
  tag?: string
  q?: string
}

export interface ListPostsResult {
  items: CommunityPostListItem[]
  total: number
  page: number
  pageSize: number
}

export interface CreatePostPayload {
  industryId: string
  title: string
  content: string
  tags: string[]
  images: string[]
}

/** 社区固定标签集（列表筛选与发帖多选共用） */
export const COMMUNITY_TAGS = [
  '学习心得',
  '打卡日常',
  '求助问答',
  '资源分享',
  '前端',
  '后端',
  'AI 工具',
  '职业发展'
] as const

/** 帖子列表：按行业隔离，createdAt 倒序分页，tag 精确匹配 / q 标题正文模糊搜索 */
export function listPosts(params: ListPostsParams = {}): Promise<ListPostsResult> {
  const qs = new URLSearchParams()
  if (params.page != null) qs.set('page', String(params.page))
  if (params.pageSize != null) qs.set('pageSize', String(params.pageSize))
  if (params.industry) qs.set('industry', params.industry)
  if (params.sort) qs.set('sort', params.sort)
  if (params.tag) qs.set('tag', params.tag)
  if (params.q) qs.set('q', params.q)
  const suffix = qs.toString()
  return http<ListPostsResult>(`/api/community/posts${suffix ? `?${suffix}` : ''}`)
}

/** 各行业内容计数（左侧行业导航展示内容数 / 空行业引导用） */
export function getIndustryStats(): Promise<{ counts: Record<string, number> }> {
  return http<{ counts: Record<string, number> }>('/api/community/posts/stats')
}

/** 我发表的帖子（个人文章管理界面卡片项） */
export interface MyPostItem {
  id: string
  industryId: string
  title: string
  /** 正文纯文本摘要（看板卡片内容预览） */
  excerpt?: string
  tags: string[]
  cover: string | null
  likeCount: number
  commentCount: number
  createdAt: string
  updatedAt: string
}

/** 我的文章列表（需登录，按 updatedAt 倒序） */
export function listMyPosts(): Promise<{ items: MyPostItem[] }> {
  return http<{ items: MyPostItem[] }>('/api/community/posts/mine')
}

/** 通知项：我发表的帖子收到的新点赞 / 新评论 */
export interface NotificationItem {
  id: string
  kind: 'like' | 'comment'
  postId: string
  postTitle: string
  from: string
  excerpt?: string
  createdAt: string
}

/** 通知列表（需登录，按时间倒序，不含本人操作） */
export function getNotifications(): Promise<{ items: NotificationItem[] }> {
  return http<{ items: NotificationItem[] }>('/api/community/notifications')
}

/** 帖子详情（不存在抛 status=404 错误） */
export function getPost(id: string): Promise<CommunityPostDetail> {
  return http<CommunityPostDetail>(`/api/community/posts/${encodeURIComponent(id)}`)
}

/**
 * 发布帖子（需登录）：title 1-60 字、tags ≤6 个、images ≤9 张且为 /uploads/community/ 地址
 * 敏感词拦截（400）时后端错误体额外携带 reason（命中词），拼进错误 message 供编辑页 toast 展示
 */
export async function createPost(payload: CreatePostPayload): Promise<CommunityPostCreated> {
  const res = await fetch(apiUrl('/api/community/posts'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    let msg = `后端错误 ${res.status}`
    let reason = ''
    try {
      const data = (await res.json()) as { error?: string; reason?: string }
      msg = data.error ?? msg
      reason = typeof data.reason === 'string' ? data.reason : ''
    } catch {
      /* 保留默认信息 */
    }
    throw new ApiError(reason ? `${msg}（命中：${reason}）` : msg, res.status)
  }
  return (await res.json()) as CommunityPostCreated
}

/** 点赞（幂等），返回最新状态 */
export function likePost(id: string): Promise<{ liked: boolean; likeCount: number }> {
  return http<{ liked: boolean; likeCount: number }>(`/api/community/posts/${encodeURIComponent(id)}/like`, {
    method: 'POST'
  })
}

/** 取消点赞（幂等），返回最新状态 */
export function unlikePost(id: string): Promise<{ liked: boolean; likeCount: number }> {
  return http<{ liked: boolean; likeCount: number }>(`/api/community/posts/${encodeURIComponent(id)}/like`, {
    method: 'DELETE'
  })
}

/** 收藏（幂等），返回最新状态 */
export function favoritePost(id: string): Promise<{ favorited: boolean; favoriteCount: number }> {
  return http<{ favorited: boolean; favoriteCount: number }>(
    `/api/community/posts/${encodeURIComponent(id)}/favorite`,
    { method: 'POST' }
  )
}

/** 取消收藏（幂等），返回最新状态 */
export function unfavoritePost(id: string): Promise<{ favorited: boolean; favoriteCount: number }> {
  return http<{ favorited: boolean; favoriteCount: number }>(
    `/api/community/posts/${encodeURIComponent(id)}/favorite`,
    { method: 'DELETE' }
  )
}

/** 发评论（需登录）：1-500 字，返回新评论 */
export function addComment(id: string, content: string): Promise<CommunityComment> {
  return http<CommunityComment>(`/api/community/posts/${encodeURIComponent(id)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  })
}

/** 社区图片上传（需登录）：dataURL（jpeg/png/webp，≤3MB）→ /uploads/community/ 相对地址 */
export function uploadImage(dataUrl: string): Promise<{ url: string }> {
  return http<{ url: string }>('/api/community/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl })
  })
}
