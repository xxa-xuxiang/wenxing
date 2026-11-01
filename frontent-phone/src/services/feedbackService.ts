// 微反馈与学习埋点上报〔自桌面端移植〕：失败静默，不阻塞 UI；失败进入 localStorage 队列待下次启动补传
// 铁律：任何异常都不能抛给调用方，也不能弹错误框打断用户
// 注意：反馈中心页面（/feedback）走 /api/feedback 归档，不使用本服务的 /api/micro 通道
import { http } from './http'

export type FeedbackKind = 'smooth' | 'stuck' | 'abandon'

/** 前端上报口径（snake_case，与后端入参一致） */
export interface FeedbackPayload {
  task_id: string
  user_given: FeedbackKind
  reason_tag?: string | null
  detail?: string
  context?: Record<string, unknown>
  ts?: number
}

export interface FeedbackResult {
  ok: boolean
  id?: string
  plan_changed?: boolean
  action?: string
  reply?: string
}

export type LearnerEventType = 'task_start' | 'task_complete' | 'task_stuck' | 'artifact_submit'

const QUEUE_KEY = 'wx:feedback-queue'
const QUEUE_LIMIT = 50
const FALLBACK_REPLY = '已记录，感谢反馈。'
/** 后端挂载在 /api/micro，避开星图反馈 /api/feedback */
const FEEDBACK_URL = '/api/micro/feedback'
const EVENTS_URL = '/api/micro/events'

interface QueueItem {
  url: string
  body: string
  at: number
}

function readQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? (list as QueueItem[]) : []
  } catch {
    return []
  }
}

function writeQueue(list: QueueItem[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-QUEUE_LIMIT)))
  } catch {
    /* 存储不可用 — 直接丢弃 */
  }
}

function enqueue(url: string, body: string): void {
  const list = readQueue()
  list.push({ url, body, at: Date.now() })
  writeQueue(list)
}

/** 微反馈上报：成功返回后端即时回报文案；失败静默入队并返回兜底文案 */
export async function submitFeedback(p: FeedbackPayload): Promise<FeedbackResult> {
  try {
    return await http<FeedbackResult>(FEEDBACK_URL, {
      method: 'POST',
      body: JSON.stringify(p),
      timeout: 8000
    })
  } catch {
    enqueue(FEEDBACK_URL, JSON.stringify(p))
    return { ok: false, plan_changed: false, reply: FALLBACK_REPLY }
  }
}

/** 学习埋点：fire-and-forget，绝不阻塞；失败入队 */
export function reportLearnerEvent(
  type: LearnerEventType,
  payload: Record<string, unknown> & { task_id?: string }
): void {
  const body = JSON.stringify({ task_id: payload.task_id, type, payload })
  try {
    void http(EVENTS_URL, { method: 'POST', body, timeout: 8000 }).catch(() => {
      enqueue(EVENTS_URL, body)
    })
  } catch {
    enqueue(EVENTS_URL, body)
  }
}

/** 启动时补传上次失败的上报（静默；仍失败的重新入队） */
export async function flushFeedbackQueue(): Promise<void> {
  const list = readQueue()
  if (list.length === 0) return
  writeQueue([])
  for (const item of list) {
    try {
      await http(item.url, { method: 'POST', body: item.body, timeout: 8000 })
    } catch {
      enqueue(item.url, item.body)
    }
  }
}
