<script setup lang="ts">
// 问星 — 桌宠悬浮球（独立 Tauri 窗口版）
// 核心交互：Tauri startDragging() 拖动 + 点击展开聊天面板 + hover 触发胶囊展开 + 右键菜单
import { ref } from 'vue'
import { startPetDrag } from '@/composables/useTauriWindow'
import PetContextMenu from './PetContextMenu.vue'

const emit = defineEmits<{
  (e: 'toggle-chat'): void
  (e: 'translate'): void
  (e: 'menu', v: boolean): void
}>()

// 拖动状态（用于视觉反馈）
const dragging = ref(false)
let dragMoved = false
let downPos = { x: 0, y: 0 }

// 右键菜单
const menuShown = ref(false)
const menuPos = ref({ x: 0, y: 0 })

function openContext(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 右下锚定布局：菜单固定放在球上方（距右 4px 与球右缘对齐，距底 44px 露出球）
  // 菜单展开前父组件已把窗口扩到 menu 尺寸
  menuPos.value = { x: 4, y: 44 }
  menuShown.value = true
  emit('menu', true)
}

function closeContext() {
  menuShown.value = false
  emit('menu', false)
}

function onPointerDown(e: PointerEvent) {
  // 只有左键能触发（button 0 = 左键；右键/中键跳过）
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (target.closest('input, textarea, button, [data-no-drag]')) return
  dragging.value = true
  dragMoved = false
  downPos = { x: e.clientX, y: e.clientY }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - downPos.x
  const dy = e.clientY - downPos.y
  if (!dragMoved && Math.hypot(dx, dy) > 3) {
    dragMoved = true
    // 检测到移动后才让 Tauri 接管窗口拖动
    startPetDrag()
  }
}

function onPointerUp(e: PointerEvent) {
  dragging.value = false
  // 左键 + 未移动 → 判定为点击（触发展开面板）
  if (e.button === 0 && !dragMoved) {
    emit('toggle-chat')
  }
  dragMoved = false
}
</script>

<template>
  <div
    class="wx-pet-orb"
    data-test="pet-orb"
    role="button"
    tabindex="0"
    :class="{
      'wx-pet-orb-dragging': dragging,
      'wx-pet-orb-active': false,
      'wx-pet-orb-hover': false,
    }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="dragging = false"
    @contextmenu="openContext"
    @keydown.enter="emit('toggle-chat')"
    aria-label="问星 AI"
    title="问星 AI（点击对话，拖动移动，右键菜单）"
  >
    <span class="wx-pet-orb-core">✦</span>
    <span class="wx-pet-orb-ring"></span>
    <span class="wx-pet-orb-breathe"></span>
  </div>

  <PetContextMenu
    v-if="menuShown"
    :x="menuPos.x"
    :y="menuPos.y"
    @translate="emit('translate')"
    @close="closeContext"
  />
</template>

<style scoped>
/* 悬浮球：与胶囊状态栏同高（36px） */
.wx-pet-orb {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--wx-color-primary-soft) 0%, var(--wx-color-primary-strong) 50%, #312e81 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--wx-ink) 40%, transparent);
  cursor: grab;
  touch-action: none;
  user-select: none;
  outline: none;
  box-shadow:
    0 4px 16px color-mix(in srgb, var(--wx-color-primary) 45%, transparent),
    0 0 24px color-mix(in srgb, var(--wx-color-primary) 35%, transparent),
    inset 0 1px 1px color-mix(in srgb, var(--wx-ink) 20%, transparent);
  transition: transform var(--wx-duration-fast) var(--wx-ease-spring),
              box-shadow var(--wx-duration-fast) var(--wx-ease-out-soft);
}

.wx-pet-orb-dragging {
  cursor: grabbing;
  transform: scale(1.06);
  box-shadow:
    0 8px 32px color-mix(in srgb, var(--wx-color-primary) 60%, transparent),
    0 0 40px color-mix(in srgb, var(--wx-color-primary) 50%, transparent);
}

.wx-pet-orb:hover {
  transform: scale(1.08);
}

.wx-pet-orb:active {
  transform: scale(0.94);
}

.wx-pet-orb-core {
  font-size: 14px;
  color: var(--wx-text-on-accent);
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--wx-ink) 60%, transparent));
  z-index: 2;
}

.wx-pet-orb-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 50%, transparent);
  animation: wx-pet-ring 4s linear infinite;
}

@keyframes wx-pet-ring {
  to { transform: rotate(360deg); }
}

/* 持续呼吸辉光 */
.wx-pet-orb-breathe {
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--wx-color-primary) 35%, transparent) 0%, transparent 70%);
  animation: wx-pet-breathe 3s ease-in-out infinite;
}

@keyframes wx-pet-breathe {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.08); }
}
</style>
