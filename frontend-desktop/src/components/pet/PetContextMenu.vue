<script setup lang="ts">
// 桌宠自定义右键菜单（悬浮球上右键弹出）
// 定位语义：x = 距窗口右缘距离，y = 距窗口底缘距离（右下锚定布局，球在窗口右下角）
// 菜单项：打开主窗口 / 显示/隐藏胶囊 / 置顶开关 / 固定位置 / 隐藏桌宠 / 退出
import { ref, watch } from 'vue'
import { isTauri, getMainWindow, getPetWindow } from '@/composables/useTauriWindow'

const props = defineProps<{ x: number; y: number }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'translate'): void }>()

// 菜单项列表（用 ref 以便响应式切换状态）
const topmost = ref(true)
const docked = ref(false)

async function toggleTopmost() {
  if (!isTauri()) return
  topmost.value = !topmost.value
  const pet = await getPetWindow()
  await pet?.setAlwaysOnTop(topmost.value)
}

async function toggleDock() {
  docked.value = !docked.value
  emit('close')
}

async function openMain() {
  if (!isTauri()) { emit('close'); return }
  const w = await getMainWindow()
  if (!w) return
  await w.show()
  await w.setFocus()
  emit('close')
}

async function hidePet() {
  if (isTauri()) {
    const pet = await getPetWindow()
    await pet?.hide()
  }
  emit('close')
}

/** 划词翻译：热键注册失败时作为备用入口 */
function startTranslate() {
  emit('translate')
  emit('close')
}

async function quitAll() {
  if (isTauri()) {
    const pet = await getPetWindow()
    await pet?.close()
    const w = await getMainWindow()
    await w?.close()
  }
  emit('close')
}

const items: { icon: string; label: string; action: () => void; divider?: boolean }[] = [
  { icon: '◈', label: '打开主窗口', action: openMain },
  { icon: '译', label: '划词翻译', action: startTranslate, divider: true },
  { icon: '◎', label: topmost.value ? '取消置顶' : '始终置顶', action: toggleTopmost },
  { icon: '▣', label: docked.value ? '取消固定' : '固定位置', action: toggleDock, divider: true },
  { icon: '⚑', label: '隐藏桌宠', action: hidePet },
  { icon: '✕', label: '退出问星', action: quitAll },
]

// 点击空白处关闭（需在宿主 div 监听，这里只处理 Esc）
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(() => props.x, () => {}, { flush: 'post' })
</script>

<template>
  <Teleport to="body">
    <div
      class="wx-pet-menu-mask"
      @contextmenu.prevent="emit('close')"
      @click="emit('close')"
    >
      <ul
        class="wx-pet-menu wx-glass-strong"
        :style="{ right: `${x}px`, bottom: `${y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown="onKeydown"
        tabindex="-1"
        ref="root"
      >
        <li
          v-for="(it, i) in items"
          :key="i"
          class="wx-pet-menu-item"
          :class="{ 'wx-pet-menu-divider': it.divider }"
          @click="it.action()"
        >
          <span class="wx-pet-menu-icon">{{ it.icon }}</span>
          <span class="wx-pet-menu-label">{{ it.label }}</span>
        </li>
      </ul>
    </div>
  </Teleport>
</template>

<script lang="ts">
import { nextTick } from 'vue'
export default {
  mounted() {
    nextTick(() => {
      const el = document.querySelector('.wx-pet-menu') as HTMLElement | null
      el?.focus()
    })
  }
}
</script>

<style scoped>
.wx-pet-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.wx-pet-menu {
  position: fixed;
  min-width: 180px;
  padding: 6px;
  border-radius: 12px;
  list-style: none;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.55),
    0 0 0 1px color-mix(in srgb, var(--wx-color-primary) 18%, transparent),
    0 0 40px color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  animation: wx-pet-menu-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  outline: none;
}

@keyframes wx-pet-menu-in {
  from { opacity: 0; transform: scale(0.94) translateY(-4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.wx-pet-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--wx-text-secondary);
  cursor: pointer;
  transition: background 120ms, color 120ms;
}

.wx-pet-menu-item:hover {
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  color: var(--wx-text-primary);
}

.wx-pet-menu-divider {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--wx-ink) 6%, transparent);
}

.wx-pet-menu-icon {
  width: 18px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  text-align: center;
  flex-shrink: 0;
}

.wx-pet-menu-item:last-child {
  color: var(--wx-color-vermilion);
}
.wx-pet-menu-item:last-child:hover {
  background: color-mix(in srgb, var(--wx-color-vermilion) 18%, transparent);
  color: #ff8a8a;
}
</style>
