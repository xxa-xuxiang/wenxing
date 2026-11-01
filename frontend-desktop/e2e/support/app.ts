/**
 * 问星桌面端 E2E — CDP 连接与窗口操作封装
 *
 * 只做两件事：
 * 1. 通过 WebView2 的 CDP 端口连上「已经在运行」的 Tauri 应用；
 * 2. 封装按窗口种类等待、Tauri 窗口状态查询、统一 data-test 点击。
 * 不启动/停止应用，不注入业务逻辑。
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const CDP_URL = process.env.WX_CDP_URL ?? 'http://127.0.0.1:9222'

export const TOOL_KINDS = ['pomodoro', 'notes', 'anki'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]
export type WindowKind = 'main' | 'pet' | ToolKind

export interface AppConnection {
  browser: Browser
  context: BrowserContext
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 连接已运行应用；失败时给出可执行的排查提示 */
export async function connectApp(): Promise<AppConnection> {
  let browser: Browser
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 15_000 })
  } catch (err) {
    throw new Error(
      [
        `无法通过 CDP 连接 ${CDP_URL}。`,
        '1) 应用是否用调试配置启动？  npm run dev:debug',
        '2) 启动日志里是否出现 DevTools listening on ws://127.0.0.1:9222？',
        '3) 主 tauri.conf.json 不应包含调试端口（端口只在 tauri.debug.conf.json）。',
        `原始错误：${(err as Error).message}`
      ].join('\n')
    )
  }
  const context = browser.contexts()[0]
  if (!context) throw new Error('CDP 连接成功，但没有拿到浏览器上下文')
  return { browser, context }
}

export function pagesOf(app: AppConnection): Page[] {
  return app.browser.contexts().flatMap((ctx) => ctx.pages())
}

/**
 * 窗口种类由 URL 判定：
 * - 无 ?window= → 主窗口
 * - ?window=pet / pomodoro / notes / anki → 对应子窗口
 */
export function windowKind(page: Page): WindowKind | null {
  const url = page.url()
  if (!/^https?:/i.test(url)) return null
  const kind = new URL(url).searchParams.get('window')
  if (!kind) return 'main'
  if (kind === 'pet' || (TOOL_KINDS as readonly string[]).includes(kind)) return kind as WindowKind
  return null
}

export function findWindow(app: AppConnection, kind: WindowKind): Page | undefined {
  return pagesOf(app).find((page) => windowKind(page) === kind)
}

/** 主窗口页面（应用已运行，正常应立即可见） */
export async function getMainPage(app: AppConnection, timeout = 10_000): Promise<Page> {
  return waitForWindow(app, 'main', timeout)
}

/** 等待新窗口出现（按种类），超时错误会列出当前所有页面便于定位 */
export async function waitForWindow(
  app: AppConnection,
  kind: WindowKind,
  timeout = 20_000
): Promise<Page> {
  const deadline = Date.now() + timeout
  let snapshot: string[] = []
  while (Date.now() < deadline) {
    const pages = pagesOf(app)
    snapshot = pages.map((p) => `${windowKind(p) ?? 'other'} | ${p.url()}`)
    const hit = pages.find((p) => windowKind(p) === kind)
    if (hit) {
      // 新窗口可能仍在加载，等 DOM 就绪再交给用例
      await hit.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {})
      return hit
    }
    await delay(150)
  }
  throw new Error(
    `等待 ${kind} 窗口超时（${timeout}ms）。当前页面：\n${snapshot.join('\n') || '(无)'}`
  )
}

/** 等待页面关闭（Tauri 窗口销毁后 CDP target 消失） */
export async function waitForWindowClosed(page: Page, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (page.isClosed()) return
    await delay(100)
  }
  throw new Error(`窗口在 ${timeout}ms 内未关闭：${page.url()}`)
}

/** 读取页面内 Tauri 窗口 label（main / pet / pomodoro / notes / anki） */
export async function windowLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__
    return internals?.metadata?.currentWindow?.label ?? ''
  })
}

/** 调用页面内的 Tauri 命令（测试侧只读查询与恢复窗口状态） */
export async function tauriInvoke<T = unknown>(
  page: Page,
  cmd: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return page.evaluate(
    ([command, payload]) => (window as any).__TAURI_INTERNALS__.invoke(command, payload),
    [cmd, args] as [string, Record<string, unknown>]
  )
}

export interface WindowFlags {
  label: string
  minimized: boolean
  maximized: boolean
  focused: boolean
  visible: boolean
  alwaysOnTop: boolean
}

/** 原生窗口状态（走 Tauri 命令，不依赖页面文案） */
export async function windowFlags(page: Page): Promise<WindowFlags> {
  const label = await windowLabel(page)
  const call = (cmd: string) => tauriInvoke<boolean>(page, cmd, { label })
  const [minimized, maximized, focused, visible, alwaysOnTop] = await Promise.all([
    call('plugin:window|is_minimized'),
    call('plugin:window|is_maximized'),
    call('plugin:window|is_focused'),
    call('plugin:window|is_visible'),
    call('plugin:window|is_always_on_top')
  ])
  return { label, minimized, maximized, focused, visible, alwaysOnTop }
}

/** 物理像素几何（含 DPI 缩放） */
export async function windowGeometry(page: Page): Promise<{ width: number; height: number; dpr: number }> {
  const label = await windowLabel(page)
  const [size, dpr] = await Promise.all([
    tauriInvoke<{ width: number; height: number }>(page, 'plugin:window|inner_size', { label }),
    page.evaluate(() => window.devicePixelRatio || 1)
  ])
  return { width: size.width, height: size.height, dpr }
}

/** 点击标题栏 / 学习页的 data-test 元素 */
export async function clickTest(page: Page, testId: string): Promise<void> {
  await page.locator(`[data-test="${testId}"]`).click()
}

/** 通过底部导航切换主窗口页面 */
export async function gotoNav(main: Page, name: 'learn' | 'atlas' | 'questions' | 'community' | 'me') {
  await clickTest(main, `nav-${name}`)
  await main
    .waitForFunction((n) => location.hash.startsWith(`#/${n}`), name, { timeout: 5_000 })
    .catch(() => {})
}

/**
 * 打开功能独立窗口：
 * - 番茄钟 / 学习笔记：主窗口标题栏图标
 * - Anki：学习页顶栏图标（标题栏未提供该入口）
 */
export async function openTool(app: AppConnection, main: Page, kind: ToolKind): Promise<Page> {
  if (kind === 'anki') {
    await gotoNav(main, 'learn')
    await clickTest(main, 'learn-anki')
  } else {
    await clickTest(main, `titlebar-${kind}`)
  }
  return waitForWindow(app, kind)
}

/** 点击工具窗自绘标题栏关闭按钮；关闭失败时兜底走 Tauri 命令 */
export async function closeTool(page: Page): Promise<void> {
  if (page.isClosed()) return
  const closeBtn = page.locator('[data-test="tool-close"]')
  if (await closeBtn.count()) await closeBtn.click({ timeout: 5_000 }).catch(() => {})
  try {
    await waitForWindowClosed(page, 3_000)
  } catch {
    if (!page.isClosed()) {
      const label = await windowLabel(page).catch(() => '')
      if (label) await tauriInvoke(page, 'plugin:window|close', { label }).catch(() => {})
    }
  }
}

/** 关闭所有工具窗（用例前置/后置清理） */
export async function closeAllTools(app: AppConnection): Promise<void> {
  for (const kind of TOOL_KINDS) {
    const page = findWindow(app, kind)
    if (!page) continue
    await closeTool(page)
    await waitForWindowClosed(page, 5_000).catch(() => {})
  }
}

/** 用例前置：清除窗口状态并确保停留在主窗口 */
export async function resetMainWindow(main: Page): Promise<void> {
  const label = await windowLabel(main)
  const flags = await windowFlags(main)
  if (flags.minimized) await tauriInvoke(main, 'plugin:window|unminimize', { label }).catch(() => {})
  if (flags.maximized) await tauriInvoke(main, 'plugin:window|toggle_maximize', { label }).catch(() => {})
}

/**
 * 余额框三态：该占位组件没有真实数据源，测试通过 Vue 根实例定位 TitleBar 的
 * balanceState ref 并改值，验证三态的渲染映射（不改业务代码）。
 * 返回 false 表示未能定位（例如构建产物未暴露 Vue 实例）。
 */
export async function setBalanceState(page: Page, state: 'loading' | 'ok' | 'error'): Promise<boolean> {
  return page.evaluate((next) => {
    const app = (document.querySelector('#app') as any)?.__vue_app__
    const find = (instance: any): any => {
      if (!instance) return null
      const setupState = instance.setupState
      if (setupState && Object.prototype.hasOwnProperty.call(setupState, 'balanceState')) return instance
      const stack: any[] = [instance.subTree]
      while (stack.length) {
        const vnode = stack.pop()
        if (!vnode) continue
        if (vnode.component) {
          const hit = find(vnode.component)
          if (hit) return hit
        }
        if (Array.isArray(vnode.children)) stack.push(...vnode.children)
        if (vnode.suspense?.activeBranch) stack.push(vnode.suspense.activeBranch)
      }
      return null
    }
    const target = find(app?._instance)
    if (!target) return false
    target.setupState.balanceState = next
    return true
  }, state)
}
