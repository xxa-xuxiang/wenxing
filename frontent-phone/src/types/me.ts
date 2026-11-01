// 个人中心 / 反馈中心共享类型〔移动端专用〕

/** AI 用量单桶：某类 AI 调用今日已用 / 上限 / 剩余 */
export interface UsageBucket {
  used: number
  limit: number
  remaining: number
}

/** GET /api/ai/usage 返回结构（usage 按 action 分桶；mode 区分平台 AI / 自带 Key） */
export interface AiUsageResult {
  usage: Record<string, UsageBucket>
  /** byo = 自带 Key（完全免费）；platform = 平台 AI（token + 次数计量） */
  mode: 'byo' | 'platform'
  hasKey: boolean
  billing?: { managementFee: number; currency: string; note: string } | null
  /** 长期计量：token 累计 / 免费配额 / 剩余 / 调用总次数 / 未清欠费（分） */
  metering?: {
    tokens: number
    calls: number
    tokenQuota: number
    tokenRemaining: number
    debtFen: number
  } | null
}

/** GET /api/feedback 列表项（后端按 data/feedback/*.md 解析） */
export interface FeedbackItem {
  industry: string
  time: string
  source: string
  content: string
}
