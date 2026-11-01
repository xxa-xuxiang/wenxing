// 问星 — 功能模块独立窗口服务
// 番茄钟 / 学习笔记 / Anki 记忆卡片 / 学习日历 → 各自独立 Tauri 窗口（单实例：已打开则聚焦，关闭后可重开）
// 主题继承：各窗口与主窗口共享 localStorage，themeStore 经 'storage' 事件实时同步
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri } from '@/composables/useTauriWindow'

export type ToolWindowKind = 'pomodoro' | 'notes' | 'anki' | 'calendar'

interface ToolWindowConf {
  label: ToolWindowKind
  title: string
  width: number
  height: number
  minWidth: number
  minHeight: number
}

/** 尺寸按功能分级：番茄钟偏小、卡片中等、笔记偏大；各自设最小尺寸 */
const CONF: Record<ToolWindowKind, ToolWindowConf> = {
  pomodoro: { label: 'pomodoro', title: '番茄钟',        width: 400, height: 560, minWidth: 340, minHeight: 460 },
  anki:     { label: 'anki',     title: 'Anki 记忆卡片', width: 760, height: 640, minWidth: 560, minHeight: 480 },
  notes:    { label: 'notes',    title: '学习笔记',      width: 960, height: 680, minWidth: 720, minHeight: 520 },
  calendar: { label: 'calendar', title: '学习日历',      width: 1100, height: 720, minWidth: 820, minHeight: 560 },
}

function toolUrl(kind: ToolWindowKind, params?: Record<string, string>): string {
  const q = new URLSearchParams({ window: kind, ...params })
  return `index.html?${q.toString()}`
}

/**
 * 打开（或聚焦）功能窗口。
 * - 已存在实例：show + setFocus（被最小化则先还原），不重复创建
 * - 不存在：按功能尺寸新建；窗口关闭后 Tauri 销毁实例，再次点击自然重建
 */
export async function openToolWindow(kind: ToolWindowKind, params?: Record<string, string>): Promise<void> {
  const url = toolUrl(kind, params)

  if (!isTauri()) {
    // 浏览器 dev 环境兜底：弹新标签页模拟独立窗口
    window.open(url, kind)
    return
  }

  const conf = CONF[kind]
  const existing = await WebviewWindow.getByLabel(conf.label)
  if (existing) {
    if (await existing.isMinimized()) await existing.unminimize()
    await existing.show()
    await existing.setFocus()
    return
  }

  const win = new WebviewWindow(conf.label, {
    url,
    title: `问星 · ${conf.title}`,
    width: conf.width,
    height: conf.height,
    minWidth: conf.minWidth,
    minHeight: conf.minHeight,
    decorations: false,
    center: true,
    dragDropEnabled: false,
  })
  win.once('tauri://error', (e) => {
    console.error(`[问星] 创建 ${conf.title} 窗口失败`, e)
  })
}
