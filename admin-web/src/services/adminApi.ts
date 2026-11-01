// 问星管理后台 — 全部管理接口封装（路径统一以 /api/admin 开头）
import { request } from './http'
import type {
  ActivityHeatmapResult,
  AdminBookItem,
  AdminLoginResult,
  AdminMe,
  AdminOverview,
  AdminPricing,
  AdminPostDetail,
  AdminPostListItem,
  AdminQuestionDetail,
  AdminQuestionItem,
  AdminStatus,
  AdminUserDetail,
  AdminUserListItem,
  AdminCommentListItem,
  AiKeyStatus,
  AnalyticsScale,
  AuditLogItem,
  BehaviorAnalyticsResult,
  CheckinCalendarResult,
  CommentListQuery,
  CommunityAnalyticsScale,
  CommunityAnalyticsResult,
  CompositionScale,
  CompositionResult,
  ContentDocContent,
  ContentDocItem,
  ContentListQuery,
  CorpusDocItem,
  CorpusDocListQuery,
  CorpusDocStatus,
  DeleteFeedbackPayload,
  DeleteFeedbackResult,
  FeedbackListResult,
  FillCfdResult,
  FillJobItem,
  FillJobListQuery,
  FlowSankeyResult,
  FunnelResult,
  FunnelSegment,
  InvitationAnalyticsResult,
  LeafItem,
  LeafListQuery,
  OkResult,
  PageResult,
  PlatformSplitResult,
  PostListQuery,
  QuestionListQuery,
  QuestionUpdatePayload,
  ResetFillJobsPayload,
  ResetFillJobsResult,
  RevenueRange,
  RevenueResult,
  RunFillJobResult,
  SaveContentPayload,
  SaveContentResult,
  ScoreHistogramResult,
  UpdateAdminPricingResult,
  UpdateFeedbackStatusPayload,
  UpdateUserPayload,
  UserAnalyticsResult,
  UserListQuery,
  WalletCodeItem,
  WalletCodeQuery,
  WalletOrderItem,
  WalletOrderQuery,
  WalletOverview,
  WalletTxnItem,
  WalletTxnQuery,
  ManualRechargePayload,
  ManualRechargeResult,
  GenerateCodesPayload,
  GenerateCodesResult
} from './types'

type QueryValue = string | number | boolean | null | undefined

function withQuery(path: string, params: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}

function jsonBody(payload: unknown): string {
  return JSON.stringify(payload)
}

/* ===== 鉴权 ===== */
export function getAdminStatus(): Promise<AdminStatus> {
  return request<AdminStatus>('/api/admin/status')
}

export function loginAdmin(username: string, password: string): Promise<AdminLoginResult> {
  return request<AdminLoginResult>('/api/admin/login', {
    method: 'POST',
    body: jsonBody({ username, password })
  })
}

export function getAdminMe(): Promise<AdminMe> {
  return request<AdminMe>('/api/admin/me')
}

// 退出登录：吊销服务端 jti，token 立即失效
export function logoutAdmin(): Promise<OkResult> {
  return request<OkResult>('/api/admin/logout', { method: 'POST' })
}

/* ===== 审计日志（v1.8） ===== */
export function getAuditLogs(
  query: { page?: number; pageSize?: number } = {}
): Promise<PageResult<AuditLogItem>> {
  return request<PageResult<AuditLogItem>>(withQuery('/api/admin/audit-logs', { ...query }))
}

/* ===== 看板 ===== */
export function getOverview(): Promise<AdminOverview> {
  return request<AdminOverview>('/api/admin/overview')
}

/* ===== 用户 ===== */
export function getUsers(query: UserListQuery = {}): Promise<PageResult<AdminUserListItem>> {
  return request<PageResult<AdminUserListItem>>(
    withQuery('/api/admin/users', { ...query })
  )
}

export function getUser(id: string): Promise<AdminUserDetail> {
  return request<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`)
}

export function resetUserPassword(id: string, password: string): Promise<OkResult> {
  return request<OkResult>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    body: jsonBody({ password })
  })
}

export function updateUser(id: string, payload: UpdateUserPayload): Promise<OkResult> {
  return request<OkResult>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: jsonBody(payload)
  })
}

export function deleteUser(id: string): Promise<OkResult> {
  return request<OkResult>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

/* ===== 社区 ===== */
export function getPosts(query: PostListQuery = {}): Promise<PageResult<AdminPostListItem>> {
  return request<PageResult<AdminPostListItem>>(
    withQuery('/api/admin/posts', { ...query })
  )
}

export function getPost(id: string): Promise<{ post: AdminPostDetail }> {
  return request<{ post: AdminPostDetail }>(`/api/admin/posts/${encodeURIComponent(id)}`)
}

export function deletePost(id: string): Promise<OkResult> {
  return request<OkResult>(`/api/admin/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

/** 帖子审核（下架/恢复）：status 为 approved | rejected，reason 选填 */
export function auditPost(
  id: string,
  status: 'approved' | 'rejected',
  reason?: string
): Promise<OkResult> {
  return request<OkResult>(`/api/admin/posts/${encodeURIComponent(id)}/audit`, {
    method: 'PATCH',
    body: jsonBody(reason === undefined ? { status } : { status, reason })
  })
}

export function getComments(
  query: CommentListQuery = {}
): Promise<PageResult<AdminCommentListItem>> {
  return request<PageResult<AdminCommentListItem>>(
    withQuery('/api/admin/comments', { ...query })
  )
}

export function deleteComment(id: string): Promise<OkResult> {
  return request<OkResult>(`/api/admin/comments/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

/* ===== 书架 ===== */
export function getBooks(): Promise<{ items: AdminBookItem[] }> {
  return request<{ items: AdminBookItem[] }>('/api/books')
}

/** 删除书籍（后端要求管理员 token，文件一并删除） */
export function deleteBook(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/books/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

/* ===== 题库 ===== */
export function getQuestions(
  query: QuestionListQuery = {}
): Promise<PageResult<AdminQuestionItem>> {
  return request<PageResult<AdminQuestionItem>>(
    withQuery('/api/admin/questions', { ...query })
  )
}

export function getQuestion(id: string): Promise<{ question: AdminQuestionDetail }> {
  return request<{ question: AdminQuestionDetail }>(
    `/api/admin/questions/${encodeURIComponent(id)}`
  )
}

export function updateQuestion(
  id: string,
  payload: QuestionUpdatePayload
): Promise<{ ok: true; question: AdminQuestionItem }> {
  return request<{ ok: true; question: AdminQuestionItem }>(
    `/api/admin/questions/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: jsonBody(payload)
    }
  )
}

export function deleteQuestion(id: string): Promise<OkResult> {
  return request<OkResult>(`/api/admin/questions/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

/* ===== 铺题 ===== */
export function getFillJobs(query: FillJobListQuery = {}): Promise<PageResult<FillJobItem>> {
  return request<PageResult<FillJobItem>>(
    withQuery('/api/admin/fill-jobs', { ...query })
  )
}

export function getLeaves(query: LeafListQuery = {}): Promise<PageResult<LeafItem>> {
  return request<PageResult<LeafItem>>(
    withQuery('/api/admin/leaves', { ...query })
  )
}

export function resetFillJobs(
  payload: ResetFillJobsPayload = {}
): Promise<ResetFillJobsResult> {
  return request<ResetFillJobsResult>('/api/admin/fill-jobs/reset', {
    method: 'POST',
    body: jsonBody(payload)
  })
}

export function runFillJob(leafKey: string): Promise<RunFillJobResult> {
  return request<RunFillJobResult>('/api/admin/fill-jobs/run', {
    method: 'POST',
    body: jsonBody({ leafKey })
  })
}

/* ===== 语料 ===== */
export function getCorpusDocs(
  query: CorpusDocListQuery = {}
): Promise<PageResult<CorpusDocItem>> {
  return request<PageResult<CorpusDocItem>>(
    withQuery('/api/admin/corpus/docs', { ...query })
  )
}

export function updateCorpusDoc(id: string, status: CorpusDocStatus): Promise<OkResult> {
  return request<OkResult>(`/api/admin/corpus/docs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: jsonBody({ status })
  })
}

export function deleteCorpusDoc(id: string): Promise<OkResult> {
  return request<OkResult>(`/api/admin/corpus/docs/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

/* ===== 内容：文档 ===== */
export function getDocs(query: ContentListQuery = {}): Promise<PageResult<ContentDocItem>> {
  return request<PageResult<ContentDocItem>>(
    withQuery('/api/admin/docs', { ...query })
  )
}

export function getDocContent(file: string): Promise<ContentDocContent> {
  return request<ContentDocContent>(
    withQuery('/api/admin/docs/content', { file })
  )
}

export function saveDocContent(payload: SaveContentPayload): Promise<SaveContentResult> {
  return request<SaveContentResult>('/api/admin/docs/content', {
    method: 'PUT',
    body: jsonBody(payload)
  })
}

export function deleteDocContent(file: string): Promise<OkResult> {
  return request<OkResult>(
    withQuery('/api/admin/docs/content', { file }),
    { method: 'DELETE' }
  )
}

/* ===== 数据分析 ===== */
export function getUserAnalytics(scale: AnalyticsScale = 'day'): Promise<UserAnalyticsResult> {
  return request<UserAnalyticsResult>(withQuery('/api/admin/analytics/users', { scale }))
}

export function getBehaviorAnalytics(from?: string, to?: string): Promise<BehaviorAnalyticsResult> {
  return request<BehaviorAnalyticsResult>(
    withQuery('/api/admin/analytics/behavior', { from, to })
  )
}

export function getInvitationAnalytics(): Promise<InvitationAnalyticsResult> {
  return request<InvitationAnalyticsResult>('/api/admin/analytics/invitations')
}

export function getCommunityAnalytics(
  scale: CommunityAnalyticsScale = 'day'
): Promise<CommunityAnalyticsResult> {
  return request<CommunityAnalyticsResult>(
    withQuery('/api/admin/analytics/community', { scale })
  )
}

/* ===== 图表洞察（v1.7） ===== */
export function getActivityHeatmap(days = 30): Promise<ActivityHeatmapResult> {
  return request<ActivityHeatmapResult>(
    withQuery('/api/admin/analytics/activity-heatmap', { days })
  )
}

export function getFunnel(days = 90, segment?: FunnelSegment): Promise<FunnelResult> {
  return request<FunnelResult>(withQuery('/api/admin/analytics/funnel', { days, segment }))
}

export function getFillCfd(weeks = 12): Promise<FillCfdResult> {
  return request<FillCfdResult>(withQuery('/api/admin/analytics/fill-cfd', { weeks }))
}

export function getFlowSankey(days = 7): Promise<FlowSankeyResult> {
  return request<FlowSankeyResult>(
    withQuery('/api/admin/analytics/flow-sankey', { days })
  )
}

export function getScoreHistogram(): Promise<ScoreHistogramResult> {
  return request<ScoreHistogramResult>('/api/admin/analytics/score-histogram')
}

export function getComposition(scale: CompositionScale = 'week'): Promise<CompositionResult> {
  return request<CompositionResult>(withQuery('/api/admin/analytics/composition', { scale }))
}

export function getCheckinCalendar(year?: number): Promise<CheckinCalendarResult> {
  return request<CheckinCalendarResult>(
    withQuery('/api/admin/analytics/checkin-calendar', { year })
  )
}

export function getPlatformSplit(days = 30): Promise<PlatformSplitResult> {
  return request<PlatformSplitResult>(
    withQuery('/api/admin/analytics/platform-split', { days })
  )
}

/* ===== 计费与收入 ===== */
export function getAdminPricing(): Promise<AdminPricing> {
  return request<AdminPricing>('/api/admin/pricing')
}

/** 保存计费标准：items 为 {action: 单价（元/次）}，写盘后版本号 +1 */
export function updateAdminPricing(items: Record<string, number>): Promise<UpdateAdminPricingResult> {
  return request<UpdateAdminPricingResult>('/api/admin/pricing', {
    method: 'PUT',
    body: jsonBody({ items })
  })
}

export function getRevenue(range: RevenueRange = 'today'): Promise<RevenueResult> {
  return request<RevenueResult>(withQuery('/api/admin/revenue', { range }))
}

/* ===== 充值与余额（v1.1） ===== */
export function getWalletOverview(): Promise<WalletOverview> {
  return request<WalletOverview>('/api/admin/wallet/overview')
}

export function getWalletOrders(
  query: WalletOrderQuery = {}
): Promise<PageResult<WalletOrderItem>> {
  return request<PageResult<WalletOrderItem>>(
    withQuery('/api/admin/wallet/orders', { ...query })
  )
}

/** 手动充值（按 userId 或用户名指定用户，金额单位：分） */
export function manualRecharge(payload: ManualRechargePayload): Promise<ManualRechargeResult> {
  return request<ManualRechargeResult>('/api/admin/wallet/recharge', {
    method: 'POST',
    body: jsonBody(payload)
  })
}

export function getWalletCodes(
  query: WalletCodeQuery = {}
): Promise<PageResult<WalletCodeItem>> {
  return request<PageResult<WalletCodeItem>>(
    withQuery('/api/admin/wallet/codes', { ...query })
  )
}

/** 批量生成兑换码 */
export function generateWalletCodes(
  payload: GenerateCodesPayload
): Promise<GenerateCodesResult> {
  return request<GenerateCodesResult>('/api/admin/wallet/codes', {
    method: 'POST',
    body: jsonBody(payload)
  })
}

/** 作废未使用的兑换码 */
export function deleteWalletCode(id: string): Promise<OkResult> {
  return request<OkResult>(`/api/admin/wallet/codes/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

export function getWalletTxns(
  query: WalletTxnQuery = {}
): Promise<PageResult<WalletTxnItem>> {
  return request<PageResult<WalletTxnItem>>(
    withQuery('/api/admin/wallet/txns', { ...query })
  )
}

/* ===== 平台 AI 密钥 ===== */
export function getAiKeyStatus(): Promise<AiKeyStatus> {
  return request<AiKeyStatus>('/api/admin/ai-key')
}

/** 保存运行时 Key（服务端加密落盘并立即生效，不回传明文） */
export function setAiKey(key: string): Promise<AiKeyStatus> {
  return request<AiKeyStatus>('/api/admin/ai-key', {
    method: 'PUT',
    body: jsonBody({ key })
  })
}

export function clearAiKey(): Promise<{ ok: true; status: AiKeyStatus }> {
  return request<{ ok: true; status: AiKeyStatus }>('/api/admin/ai-key', {
    method: 'DELETE'
  })
}

/* ===== 反馈 ===== */
export function getFeedback(industry?: string): Promise<FeedbackListResult> {
  return request<FeedbackListResult>(
    withQuery('/api/admin/feedback', { industry })
  )
}

export function deleteFeedback(
  payload: DeleteFeedbackPayload
): Promise<DeleteFeedbackResult> {
  return request<DeleteFeedbackResult>('/api/admin/feedback', {
    method: 'DELETE',
    body: jsonBody(payload)
  })
}

// 流转反馈处理状态
export function updateFeedbackStatus(payload: UpdateFeedbackStatusPayload): Promise<OkResult> {
  return request<OkResult>('/api/admin/feedback', {
    method: 'PATCH',
    body: jsonBody(payload)
  })
}
