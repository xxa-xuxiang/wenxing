// 问星 v1.7 — 行为埋点服务：内存攒批 → POST /api/track/events（后端 optionalAuth，未登录按匿名上报）
// 原则：绝不抛错、绝不阻塞 UI——所有异常静默吞掉，发送失败直接丢弃队列不重试
import { http } from './http'
import { isTauri } from '@/composables/useTauriWindow'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

/** 单条埋点事件（字段口径与后端 /api/track/events 校验一致） */
export interface TrackEvent {
  kind: 'view_enter' | 'view_leave' | 'click' | 'post_view'
  screen: string
  target?: string
  durationMs?: number
  meta?: string
}

/** 平台标识（预序列化避免逐事件 stringify；后端按 meta.platform 拆分平台构成） */
const PLATFORM_META = '{"platform":"desktop"}'

const SESSION_KEY = 'wenxing:track:session'
/** 队列满 20 条立即 flush */
const QUEUE_LIMIT = 20
/** 否则 15 秒定时 flush */
const FLUSH_INTERVAL = 15_000

let queue: TrackEvent[] = []
let flushTimer: number | undefined
/** 当前路由 screen（router afterEach 更新，click 埋点取用） */
let currentScreen = 'other'
/** 上一 screen 与进入时间（view_leave 停留时长计算） */
let lastScreen: string | null = null
let lastEnterAt = 0

/** 路径首段 → screen 命名映射；未知归 other */
export function resolveScreen(path: string): string {
  const seg = path.split('?')[0].split('/').filter(Boolean)[0] ?? ''
  const map: Record<string, string> = {
    atlas: 'atlas',
    learn: 'learn',
    questions: 'questions',
    papers: 'papers',
    quiz: 'quiz',
    community: 'community',
    me: 'me',
    feedback: 'feedback',
    auth: 'auth'
  }
  return map[seg] ?? 'other'
}

/** 会话 id：sessionStorage 持久（标签页生命周期内稳定），存储不可用时退化为一次性 UUID */
function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

/** 攒批上报：先整体出队再发送，失败静默丢弃 */
function flush(): void {
  if (queue.length === 0) return
  const events = queue
  queue = []
  try {
    void http('/api/track/events', {
      method: 'POST',
      body: JSON.stringify({ sessionId: getSessionId(), events })
    }).catch(() => {
      /* 静默丢弃 */
    })
  } catch {
    /* 静默丢弃 */
  }
}

/** 记录事件：满 20 条立即 flush，否则挂 15 秒定时器 */
export function trackEvent(
  kind: TrackEvent['kind'],
  screen: string,
  extra?: { target?: string; durationMs?: number }
): void {
  try {
    queue.push({ kind, screen, meta: PLATFORM_META, ...extra })
    if (queue.length >= QUEUE_LIMIT) {
      flush()
      return
    }
    if (flushTimer == null) {
      flushTimer = window.setTimeout(() => {
        flushTimer = undefined
        flush()
      }, FLUSH_INTERVAL)
    }
  } catch {
    /* 绝不阻塞 UI */
  }
}

/** router afterEach 调用：补发上一 screen 的 view_leave{durationMs}，再发新 screen 的 view_enter */
export function trackRouteChange(path: string): void {
  const screen = resolveScreen(path)
  const now = Date.now()
  if (lastScreen && lastEnterAt > 0) {
    trackEvent('view_leave', lastScreen, { durationMs: Math.max(1, now - lastEnterAt) })
  }
  trackEvent('view_enter', screen)
  lastScreen = screen
  lastEnterAt = now
  currentScreen = screen
}

/** document 捕获阶段点击委托：target 取最近 [data-track] 属性值，无则 'body'；screen=当前路由 */
export function installClickListener(): void {
  document.addEventListener(
    'click',
    (e) => {
      try {
        const el = (e.target instanceof Element ? e.target : null)?.closest('[data-track]')
        trackEvent('click', currentScreen, { target: el?.getAttribute('data-track') || 'body' })
      } catch {
        /* 静默 */
      }
    },
    true
  )
}

/** 关闭兜底 flush：beforeunload + Tauri 窗口关闭（isTauri 兼容 __TAURI__ 与 __TAURI_INTERNALS__；非 Tauri 仅留 beforeunload） */
export function installFlushHooks(): void {
  window.addEventListener('beforeunload', flush)
  if (!isTauri()) return
  try {
    void getCurrentWebviewWindow()
      .onCloseRequested(() => {
        flush()
      })
      .catch(() => {
        /* 事件不可用：仅保留 beforeunload 兜底 */
      })
  } catch {
    /* 静默 */
  }
}
