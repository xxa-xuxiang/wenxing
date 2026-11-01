<script setup lang="ts">
// 问星 — 桌宠窗口根组件（独立 Tauri 子窗口，透明置顶，脱离主窗口）
// 渲染：悬浮球本体 + 胶囊状态栏（hover 展开） + 翻译面板
// 聊天对话框是独立原生窗口（pet-chat，可移动缩放），由点击悬浮球唤起，不再内嵌
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { PhysicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { currentMonitor, primaryMonitor, cursorPosition } from '@tauri-apps/api/window'
import { isTauri, openPetChatWindow } from '@/composables/useTauriWindow'
import { readClipboard } from '@/services/selectionGrab'
import { useTranslateStore } from '@/stores/translateStore'
import PetOrb from '@/components/pet/PetOrb.vue'
import PetCapsule from '@/components/pet/PetCapsule.vue'
import PetTranslatePanel from '@/components/pet/PetTranslatePanel.vue'

// 窗口随 UI 状态扩缩：WebView2 视口硬裁剪窗口外内容，
// 球那么小的窗口里胶囊/菜单会被切掉。idle 时窗口只留球大小，
// 避免一个大的透明置顶窗口挡住桌面右下角的点击。
const ORB = 48
const SIZE = {
  idle: { w: ORB, h: ORB },
  capsule: { w: 372, h: 56 },
  menu: { w: 248, h: 320 },
  translate: { w: 400, h: 480 },
} as const
type SizeKey = keyof typeof SIZE

type PetMode = 'idle' | 'translate'

const mode = ref<PetMode>('idle')
const hovered = ref(false)
const menuShown = ref(false)
const translateStore = useTranslateStore()

const sizeKey = computed<SizeKey>(() => {
  if (mode.value !== 'idle') return mode.value
  if (menuShown.value) return 'menu'
  if (hovered.value) return 'capsule'
  return 'idle'
})

/** 点击悬浮球：唤起独立聊天窗口（原生标题栏，可任意移动缩放） */
function toggleChat() {
  void openPetChatWindow()
}

function closeTranslate() {
  translateStore.close()
  mode.value = 'idle'
}

/**
 * 打开翻译面板并翻译：selected 为空时退回剪贴板内容
 * （全局热键的选区由 Rust 侧先取好，聚焦桌宠后再模拟 Ctrl+C 会打错对象）
 */
async function openTranslate(selected: string) {
  mode.value = 'translate'
  const text = (selected || (await readClipboard())).trim()
  await translateStore.openWith(text)
}

function translateFromMenu() {
  void openTranslate('')
}

// 同步 UI 状态 → 窗口尺寸。右下锚定：球用 right/bottom 钉在窗口右下角，
// 换尺寸时只让左边和顶边变化，右下缘保持不动 → 球的屏幕位置零位移，
// 不会出现「扩窗→球跑→mouseleave→回缩」的抖动循环。
let resizeQueue: Promise<void> = Promise.resolve()
const mounted = ref(false)

function resizePetWindow(key: SizeKey) {
  if (!isTauri()) return
  const win = getCurrentWebviewWindow()
  const size = SIZE[key]
  resizeQueue = resizeQueue.then(async () => {
    try {
      const pos = await win.outerPosition()
      const before = await win.outerSize()
      // Windows 对 resizable:false 的窗口会拒绝 setSize，必须临时打开
      await win.setResizable(true)
      await win.setSize(new LogicalSize(size.w, size.h))
      const after = await win.outerSize()
      const x = pos.x + before.width - after.width
      const y = pos.y + before.height - after.height
      if (x !== pos.x || y !== pos.y) {
        await win.setPosition(new PhysicalPosition(x, y))
      }
      await win.setResizable(false)
    } catch (e) {
      console.warn('[pet] resize error:', e)
    }
  })
}

watch(sizeKey, (key) => {
  if (!mounted.value) return
  resizePetWindow(key)
})

/**
 * hover 用「轮询光标位置」而不是 mouseenter/mouseleave：
 * 窗口自己 setSize 时 Windows 会给 WebView 发一次 WM_MOUSELEAVE，
 * 而光标本没动 → 浏览器认为指针离开且不会补发 enter，胶囊一展开就塌回去。
 * 直接比对光标与窗口矩形，扩缩窗口都不会产生误判。
 */
const HOVER_POLL_MS = 120
let hoverTimer: number | null = null

async function pollHover() {
  if (!isTauri() || mode.value !== 'idle' || menuShown.value) return
  const win = getCurrentWebviewWindow()
  try {
    const [cursor, pos, size] = await Promise.all([
      cursorPosition(),
      win.outerPosition(),
      win.outerSize(),
    ])
    if (!cursor) return
    const inside =
      cursor.x >= pos.x &&
      cursor.x <= pos.x + size.width &&
      cursor.y >= pos.y &&
      cursor.y <= pos.y + size.height
    if (hovered.value !== inside) hovered.value = inside
  } catch (e) {
    console.warn('[pet] pollHover error:', e)
  }
}

// 全局快捷键 Ctrl+Shift+T（Rust 侧取词并唤起窗口后，把选区文本广播到桌宠窗口）
let unlisten: (() => void) | null = null
onMounted(async () => {
  if (!isTauri()) return
  mounted.value = true
  hoverTimer = window.setInterval(() => { void pollHover() }, HOVER_POLL_MS)
  unlisten = await getCurrentWebviewWindow().listen<string>('pet-translate-hotkey', (e) => {
    void openTranslate(typeof e.payload === 'string' ? e.payload : '')
  })
})
onBeforeUnmount(() => {
  if (hoverTimer) window.clearInterval(hoverTimer)
  unlisten?.()
})
</script>

<template>
  <div class="wx-pet-root" data-test="pet-root">
    <PetOrb
      @toggle-chat="toggleChat"
      @translate="translateFromMenu"
      @menu="(v: boolean) => menuShown = v"
    />
    <PetCapsule v-show="hovered && mode === 'idle'" />
    <PetTranslatePanel v-if="mode === 'translate'" @close="closeTranslate" />
  </div>
</template>

<style scoped>
.wx-pet-root {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.wx-pet-root > * {
  pointer-events: auto;
}
</style>
