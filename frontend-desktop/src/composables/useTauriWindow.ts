// 问星 — Tauri 窗口管理封装（主窗口 + 桌宠子窗口）
// 非 Tauri 环境（浏览器开发）自动降级：isTauri() 返回 false，所有窗口操作空跑
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { currentMonitor, primaryMonitor } from '@tauri-apps/api/window'
import { onMounted } from 'vue'

/** 检测当前是否在 Tauri 环境（Tauri 2 兼容：__TAURI__ 或 __TAURI_INTERNALS__） */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as any
  return w.__TAURI__ !== undefined || w.__TAURI_INTERNALS__ !== undefined
}

/** 获取主窗口实例（getByLabel：获取已存在窗口的唯一合法方式；new WebviewWindow 会触发创建） */
export async function getMainWindow(): Promise<WebviewWindow | null> {
  if (!isTauri()) return null
  return await WebviewWindow.getByLabel('main')
}

/** 获取桌宠窗口实例 */
export async function getPetWindow(): Promise<WebviewWindow | null> {
  if (!isTauri()) return null
  return await WebviewWindow.getByLabel('pet')
}

/** 桌宠窗口：懒创建（启动时不预建透明窗口，避免 WebView2 初始化失败拖垮主进程） */
async function ensurePetWindow(): Promise<WebviewWindow | null> {
  let pet = await getPetWindow()
  if (pet) return pet

  pet = new WebviewWindow('pet', {
    url: 'index.html?window=pet',
    title: '问星',
    width: 48,
    height: 48,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    center: false,
    visible: false,
  })
  // 等窗口创建完成（成功或失败都继续，失败由后续 show 抛错暴露）
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    void pet!.once('tauri://created', done)
    void pet!.once('tauri://error', done)
    setTimeout(done, 3000)
  })
  return await getPetWindow()
}

/** 桌宠窗口：初始化位置（右下）并 show */
export async function openPetWindow() {
  if (!isTauri()) return
  const pet = await ensurePetWindow()
  if (!pet) return
  try {
    await pet.show()
    await pet.setAlwaysOnTop(true)
    // 定位到屏幕右下角（任务栏上方）。全程用物理像素 + 显示器几何：
    // screen.width 是 CSS 像素，与 outerPosition 的物理像素混算在缩放屏上会严重偏移。
    // currentMonitor 启动瞬间可能返回 null（DPI 尚未初始化），回退主显示器
    const monitor = (await currentMonitor()) ?? (await primaryMonitor())
    if (monitor) {
      const k = monitor.scaleFactor
      // 用「工作区」而非整屏定位：任务栏占着屏幕底部（本机 1140~1200），
      // 按整屏贴底会让悬浮球的下半部分压在任务栏下面，点击全被任务栏吃掉。
      // screen.availHeight/availWidth 就是去掉任务栏后的可用区域（CSS 像素）
      const availW = Math.round((window.screen.availWidth || monitor.size.width / k) * k)
      const availH = Math.round((window.screen.availHeight || monitor.size.height / k) * k)
      // 球锚定在窗口右下角，用实际 outerSize 定位窗口右下缘
      // （Windows 对无边框窗口有最小尺寸限制，实际尺寸可能大于声明的值）
      const outer = await pet.outerSize()
      const margin = Math.round(12 * k)
      const x = monitor.position.x + availW - outer.width - margin
      const y = monitor.position.y + availH - outer.height - margin
      await pet.setPosition(new PhysicalPosition(x, y))
    }
    await pet.setFocus()
  } catch (e) {
    console.warn('[pet] openPetWindow error:', e)
  }
}

/** 隐藏桌宠窗口（主窗口关闭时调用） */
export async function hidePetWindow() {
  if (!isTauri()) return
  try {
    const pet = await getPetWindow()
    await pet?.hide()
  } catch (e) {
    console.warn('[pet] hidePetWindow error:', e)
  }
}

/**
 * 打开/聚焦桌宠聊天独立窗口（label: pet-chat，原生标题栏，可移动缩放）
 * 优先复用 tauri.conf.json 里静态声明（visible:false）的窗口；
 * getByLabel 拿不到（webview 未初始化等）时按需创建，避免点击无反应。
 * show / unminimize / setFocus 各自容错：任一步失败不阻断后续步骤。
 */
export async function openPetChatWindow() {
  if (!isTauri()) return
  try {
    let win = await WebviewWindow.getByLabel('pet-chat')
    if (!win) {
      win = new WebviewWindow('pet-chat', {
        url: 'index.html?window=pet-chat',
        title: '问星 AI 对话',
        width: 400,
        height: 560,
        minWidth: 340,
        minHeight: 420,
        center: true,
        resizable: true
      })
      // 等窗口创建完成（成功或失败都继续，失败由后续 show 抛错暴露）
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        void win!.once('tauri://created', done)
        void win!.once('tauri://error', done)
        setTimeout(done, 3000)
      })
    }
    try {
      await win.show()
    } catch (e) {
      console.warn('[pet-chat] show error:', e)
    }
    try {
      await win.unminimize()
    } catch {
      /* 非最小化状态会抛错，忽略 */
    }
    try {
      await win.setFocus()
    } catch (e) {
      console.warn('[pet-chat] setFocus error:', e)
    }
  } catch (e) {
    console.warn('[pet-chat] openPetChatWindow error:', e)
  }
}

/** 桌宠窗口拖动（调用 Tauri startDragging） */
export async function startPetDrag() {
  if (!isTauri()) return
  try {
    await getCurrentWebviewWindow().startDragging()
  } catch (e) {
    console.warn('[pet] startDragging error:', e)
  }
}

/** 当前窗口是否是桌宠 */
export function isPetWindow(): boolean {
  return new URLSearchParams(location.search).get('window') === 'pet'
}

/** 主窗口生命周期：mounted 时打开桌宠，beforeunload 时隐藏桌宠 */
export function useMainWindowLifecycle() {
  onMounted(async () => {
    setTimeout(async () => {
      await openPetWindow()
    }, 600)
    window.addEventListener('beforeunload', () => {
      hidePetWindow()
    })
  })
}
