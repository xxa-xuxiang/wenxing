// 问星管理后台 — 接口类型集中定义（字段名与后端契约严格一致）

/* ===== 通用 ===== */
export interface OkResult {
  ok: true
}

export interface PageQuery {
  page?: number
  pageSize?: number
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/* ===== 鉴权 ===== */
export interface AdminStatus {
  enabled: boolean
}

export interface AdminLoginResult {
  token: string
  username: string
}

export interface AdminMe {
  username: string
}

/* ===== 书架 ===== */
export interface AdminBookItem {
  id: string
  title: string
  author: string | null
  format: string
  fileSize: number | null
  coverUrl: string | null
  sourceUrl: string | null
  license: string | null
  industry: string | null
  tags: string | null
  hasFile: boolean
  previewable: boolean
  createdAt: number
}

/* ===== 看板 ===== */
export interface AiUsageBucket {
  total: number
  byAction: Record<string, number>
}

export interface CoverageItem {
  industry: string
  leaves: number
  pending: number
  materializing: number
  filled: number
  blocked: number
  failed: number
  questions: number
}

export interface AdminOverview {
  users: {
    total: number
    newToday: number
    new7d: number
    disabled: number
  }
  community: {
    posts: number
    comments: number
    posts7d: number
  }
  questions: {
    total: number
    byStatus: {
      draft: number
      verified: number
      rejected: number
    }
  }
  leaves: {
    total: number
    byStatus: {
      pending: number
      materializing: number
      filled: number
      blocked: number
      failed: number
    }
  }
  plans: {
    total: number
    active: number
  }
  checkins: {
    total: number
    last7d: number
  }
  quizSessions: {
    total: number
    today: number
  }
  docs: {
    total: number
  }
  feedback: {
    total: number
  }
  aiUsage: {
    today: AiUsageBucket
    last7d: AiUsageBucket
  }
  coverage: CoverageItem[]
  targetPerLeaf: number
}

/* ===== 用户 ===== */
export interface AdminUserListItem {
  id: string
  username: string
  nickname: string
  disabled: boolean
  createdAt: string
  lastLoginAt: string | null
  postCount: number
}

export interface AdminUserInfo {
  id: string
  username: string
  nickname: string
  disabled: boolean
  createdAt: string
  lastLoginAt: string | null
}

export interface AdminUserStats {
  mastery: number
  posts: number
  comments: number
  checkins: number
  plans: number
  lastActiveAt: string | null
}

export interface AdminUserDetail {
  user: AdminUserInfo
  profile: Record<string, unknown> | null
  stats: AdminUserStats
}

export interface UserListQuery extends PageQuery {
  q?: string
}

export interface UpdateUserPayload {
  disabled?: boolean
  nickname?: string
}

/* ===== 社区 ===== */
export interface CommunityAuthor {
  nickname: string
  username: string
}

export interface AdminPostListItem {
  id: string
  industryId: string
  title: string
  excerpt: string
  author: CommunityAuthor
  status: string
  auditReason: string | null
  likeCount: number
  commentCount: number
  createdAt: string
  updatedAt: string
}

export interface AdminPostComment {
  id: string
  content: string
  author: CommunityAuthor
  createdAt: string
}

export interface AdminPostDetail {
  id: string
  industryId: string
  title: string
  content: string
  tags: string[]
  images: string[]
  author: CommunityAuthor
  status: string
  auditReason: string | null
  likeCount: number
  commentCount: number
  favoriteCount: number
  createdAt: string
  comments: AdminPostComment[]
}

export interface AdminCommentListItem {
  id: string
  content: string
  author: CommunityAuthor
  postId: string
  postTitle: string
  createdAt: string
}

export interface PostListQuery extends PageQuery {
  industry?: string
  q?: string
  author?: string
  status?: string
}

export interface CommentListQuery extends PageQuery {
  q?: string
}

/* ===== 题库 ===== */
export interface QuestionLeaf {
  leafKey: string
  pathText: string
  industry: string
  category: string
  domain: string
  stack: string
  name: string
}

export interface QuestionSource {
  url: string
  title: string
  snippet?: string
}

export interface AdminQuestionItem {
  id: string
  status: string
  type: string
  difficulty: string
  title: string
  body: string
  answer: string
  explanation: string
  options: string[]
  sources: QuestionSource[]
  feedbackCount: number
  version: number
  source: string
  createdAt: string
  updatedAt: string
  leaf: QuestionLeaf
}

export interface QuestionAudit {
  id: string
  verdict: string
  reason: string
  attempt: number
  createdAt: string
}

export interface AdminQuestionDetail extends AdminQuestionItem {
  audits: QuestionAudit[]
}

export interface QuestionListQuery extends PageQuery {
  status?: string
  type?: string
  difficulty?: string
  industry?: string
  leafKey?: string
  q?: string
}

export interface QuestionUpdatePayload {
  status?: string
  type?: string
  difficulty?: string
  title?: string
  body?: string
  answer?: string
  explanation?: string
  options?: string[]
}

/* ===== 铺题 ===== */
export interface FillJobItem {
  leafKey: string
  pathText: string
  industry: string
  status: string
  verifiedCount: number
  attempts: number
  lastError: string | null
  updatedAt: string
}

export interface LeafItem {
  leafKey: string
  pathText: string
  name: string
  industry: string
  status: string
  verifiedCount: number
  attempts: number
}

export interface FillJobListQuery extends PageQuery {
  status?: string
  industry?: string
}

export interface LeafListQuery extends PageQuery {
  q?: string
  industry?: string
}

export interface ResetFillJobsPayload {
  leafKeys?: string[]
  status?: string
  industry?: string
}

export interface ResetFillJobsResult {
  ok: true
  count: number
}

export interface RunFillJobResult {
  started: boolean
}

/* ===== 语料 ===== */
export type CorpusDocStatus = 'active' | 'disabled'

export interface CorpusDocItem {
  id: string
  url: string
  title: string
  siteDomain: string
  industry: string
  license: string
  status: string
  chunkCount: number
  fetchedAt: string
}

export interface CorpusDocListQuery extends PageQuery {
  industry?: string
  q?: string
}

/* ===== 内容（文档） ===== */
export interface ContentDocItem {
  industry: string
  file: string
  title: string
  tags: string[]
  generatedAt: string
  updatedAt: string
  size: number
}

export interface ContentListQuery extends PageQuery {
  industry?: string
  q?: string
}

export interface ContentDocContent {
  file: string
  content: string
}

export interface SaveContentPayload {
  file: string
  content: string
}

export interface SaveContentResult {
  ok: true
  file: string
}

/* ===== 反馈 ===== */
export type FeedbackStatus = 'pending' | 'processing' | 'done'

export interface FeedbackItem {
  industry: string
  time: string
  source: string
  content: string
  status: FeedbackStatus
  statusUpdatedAt: string | null
}

export interface FeedbackListResult {
  items: FeedbackItem[]
  total: number
}

export interface DeleteFeedbackPayload {
  industry: string
  time?: string
}

export interface DeleteFeedbackResult {
  ok: true
  removed: number
}

export interface UpdateFeedbackStatusPayload {
  industry: string
  time: string
  status: FeedbackStatus
}

/* ===== 审计日志（v1.8） ===== */
export interface AuditLogItem {
  at: string
  method: string
  path: string
  status: number
  ms: number
  ip: string
  admin: string | null
}

/* ===== 数据分析（v1.6） ===== */
export type AnalyticsScale = 'day' | 'week' | 'month' | 'year'

export interface AnalyticsSeriesPoint {
  bucket: string
  count: number
}

export interface UserAnalyticsResult {
  summary: {
    total: number
    today: number
    week: number
    month: number
  }
  series: AnalyticsSeriesPoint[]
  dau: {
    today: number
    series: AnalyticsSeriesPoint[]
  }
}

export interface BehaviorAnalyticsRow {
  screen: string
  pv: number
  uv: number
  clicks: number
  ctr: number
  avgStayMs: number
}

export type BehaviorAnalyticsResult = BehaviorAnalyticsRow[]

export interface InvitationRankingItem {
  userId: string
  username: string
  nickname: string
  invitedCount: number
}

export interface InvitationAnalyticsResult {
  totalInvited: number
  ranking: InvitationRankingItem[]
  series: AnalyticsSeriesPoint[]
}

export type CommunityAnalyticsScale = 'day' | 'month' | 'year'

export interface CommunityAnalyticsPoint {
  bucket: string
  posts: number
  views: number
  likes: number
  favorites: number
}

export interface CommunityAnalyticsResult {
  today: {
    posts: number
    views: number
    likes: number
    favorites: number
  }
  series: CommunityAnalyticsPoint[]
  monthly: CommunityAnalyticsPoint[]
}

/* ===== 图表洞察（v1.7） ===== */
export interface ActivityHeatmapResult {
  days: number
  /** [hour(0-23), weekday(0=周一), count] */
  cells: [number, number, number][]
  max: number
}

export interface FunnelStep {
  key: string
  label: string
  count: number
  /** 相对上一层转化率（0-1），第一层恒为 1 */
  rate: number
}

export interface FunnelResult {
  days: number
  cohort: number
  steps: FunnelStep[]
}

export interface FillCfdBucket {
  bucket: string
  created: number
  filled: number
  blockedFailed: number
}

export interface FillCfdResult {
  weeks: number
  buckets: FillCfdBucket[]
}

export interface FlowSankeyLink {
  source: string
  target: string
  value: number
}

export interface FlowSankeyResult {
  days: number
  nodes: { name: string }[]
  links: FlowSankeyLink[]
  /** 未进入 Top 30 而被省略的边数 */
  truncated: number
}

export interface HistogramBucket {
  bucket: string
  count: number
}

export interface ScoreHistogramResult {
  /** 答题得分分布（10 分桶，百分制） */
  score: HistogramBucket[]
  /** 界面停留时长分布（30s 桶，>30min 截断进末桶） */
  stay: HistogramBucket[]
}

export type CompositionScale = 'week' | 'month'

export interface QuestionCompositionPoint {
  bucket: string
  created: number
  verified: number
  rejected: number
}

export interface CommunityCompositionPoint {
  bucket: string
  posts: number
  comments: number
  books: number
}

export interface CompositionResult {
  scale: CompositionScale
  questions: QuestionCompositionPoint[]
  community: CommunityCompositionPoint[]
}

export interface CheckinCalendarDay {
  /** YYYY-MM-DD */
  date: string
  users: number
  minutes: number
}

export interface CheckinCalendarResult {
  year: number
  days: CheckinCalendarDay[]
  maxUsers: number
}

export type FunnelSegment = 'all' | 'invited' | 'organic'

export interface PlatformSplitPoint {
  bucket: string
  desktop: number
  phone: number
  other: number
}

export interface PlatformSplitResult {
  days: number
  series: PlatformSplitPoint[]
}

/* ===== 计费与收入（v1.6） ===== */
export interface PricingItem {
  pricePerCall: number
  label: string
}

export interface AdminPricing {
  version: number
  updatedAt: string
  items: Record<string, PricingItem>
}

export interface UpdateAdminPricingResult {
  ok: true
  pricing: AdminPricing
}

/* ===== 平台 AI 密钥（P0-1） ===== */
export type AiKeySource = 'runtime' | 'env' | 'none'

export interface AiKeyStatus {
  configured: boolean
  source: AiKeySource
  /** 掩码后的 Key（仅末 4 位） */
  masked: string
  updatedAt: string
  updatedBy: string
}

export interface ClearAiKeyResult {
  ok: true
  status: AiKeyStatus
}

export type RevenueRange = 'today' | '7d' | '30d'

export interface RevenueBucket {
  key: string
  revenue: number
  calls: number
  tokens: number
}

export interface RevenueActionBucket {
  key: string
  calls: number
  tokens: number
}

export interface RevenueActionItem {
  action: string
  label: string
  pricePerCall: number
  calls: number
  tokens: number
  revenue: number
  buckets: RevenueActionBucket[]
}

export interface RevenueResult {
  summary: {
    todayRevenue: number
    monthRevenue: number
    totalCalls: number
    todayCalls: number
  }
  priceVersion: number
  items: Record<string, PricingItem>
  series: {
    buckets: RevenueBucket[]
    byAction: RevenueActionItem[]
  }
}

/* ===== 充值与余额（v1.1） ===== */
export interface WalletOverview {
  totalBalanceFen: number
  totalBalanceYuan: number
  balanceUsers: number
  todayRechargeFen: number
  todayRechargeYuan: number
  totalRechargeFen: number
  totalRechargeYuan: number
  totalConsumeFen: number
  totalConsumeYuan: number
  todayConsumeFen: number
  todayConsumeYuan: number
  unusedCodeCount: number
  unusedCodeValueFen: number
  unusedCodeValueYuan: number
}

export type RechargeChannel = 'redeem' | 'manual'

export interface WalletOrderItem {
  id: string
  amountFen: number
  amountYuan: number
  channel: RechargeChannel
  status: string
  refCode: string | null
  note: string
  operator: string | null
  createdAt: string
  user: { id: string; username: string; nickname: string }
}

export interface WalletOrderQuery {
  page?: number
  pageSize?: number
  q?: string
  channel?: RechargeChannel | ''
}

export type RedeemCodeStatus = 'all' | 'unused' | 'used'

export interface WalletCodeItem {
  id: string
  code: string
  codeText: string
  amountFen: number
  amountYuan: number
  note: string
  createdBy: string | null
  usedBy: string | null
  usedAt: string | null
  createdAt: string
}

export interface WalletCodeQuery {
  page?: number
  pageSize?: number
  status?: RedeemCodeStatus
}

export interface WalletTxnItem {
  id: string
  deltaFen: number
  deltaYuan: number
  type: string
  refId: string | null
  balanceAfter: number
  balanceAfterYuan: number
  note: string
  createdAt: string
  user: { id: string; username: string; nickname: string }
}

export interface WalletTxnQuery {
  page?: number
  pageSize?: number
  q?: string
  type?: string
}

export interface ManualRechargePayload {
  userId?: string
  username?: string
  amountFen: number
  note?: string
}

export interface ManualRechargeResult {
  ok: true
  orderId: string
  amountFen: number
  amountYuan: number
  balanceFen: number
  balanceYuan: number
  user: { id: string; username: string; nickname: string }
}

export interface GenerateCodesPayload {
  count: number
  amountFen: number
  note?: string
}

export interface GenerateCodesResult {
  ok: true
  count: number
  amountFen: number
  amountYuan: number
  items: { code: string; codeText: string }[]
}
