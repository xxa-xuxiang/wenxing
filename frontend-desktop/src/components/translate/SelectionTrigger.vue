<script setup lang="ts">
// 问星 v1.5 — 应用内划词触发
// 主窗口内选中文字 → 选区右下出现「译」按钮 → 点击就地弹出翻译卡（不跳窗口）
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useTranslateStore } from '@/stores/translateStore'
import TranslationCard from './TranslationCard.vue'

const store = useTranslateStore()

/** 「译」按钮位置（null 表示不显示） */
const btnPos = ref<{ x: number; y: number } | null>(null)
const selected = ref('')
/** 浮层位置（null 表示不显示） */
const cardPos = ref<{ x: number; y: number } | null>(null)

const CARD_W = 360
const CARD_H = 360

/** 选区是否落在输入框/可编辑区（避免干扰正常输入） */
function inEditable(node: Node | null): boolean {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  while (el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true
    el = el.parentElement
  }
  return false
}

function hideBtn() {
  btnPos.value = null
  selected.value = ''
}

/** 读取当前选区并定位按钮 */
function pickSelection() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.rangeCount === 0 || !text || text.length > 2000) return hideBtn()
  if (inEditable(sel.anchorNode)) return hideBtn()
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height)) return hideBtn()
  selected.value = text
  btnPos.value = {
    x: Math.min(rect.right + 6, window.innerWidth - 36),
    y: Math.min(rect.bottom + 6, window.innerHeight - 36)
  }
}

function onMouseUp(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (t?.closest?.('.wx-sel-btn, .wx-sel-pop')) return
  window.setTimeout(pickSelection, 0)
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Shift' || e.shiftKey) window.setTimeout(pickSelection, 0)
  if (e.key === 'Escape') {
    cardPos.value = null
    hideBtn()
  }
}

function onMouseDown(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (t?.closest?.('.wx-sel-btn')) return
  hideBtn()
  if (cardPos.value && !t?.closest?.('.wx-sel-pop')) cardPos.value = null
}

function onScroll() {
  hideBtn()
}

/** 点「译」：先算浮层位置（越界自动翻转），再发起翻译 */
async function openCard() {
  const text = selected.value
  const pos = btnPos.value
  if (!text || !pos) return
  hideBtn()
  cardPos.value = {
    x: Math.max(8, Math.min(pos.x, window.innerWidth - CARD_W - 8)),
    y: pos.y + CARD_H > window.innerHeight - 8
      ? Math.max(8, pos.y - CARD_H - 28)
      : pos.y
  }
  await store.openWith(text)
}

onMounted(() => {
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('scroll', onScroll, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mouseup', onMouseUp)
  document.removeEventListener('keyup', onKeyUp)
  document.removeEventListener('mousedown', onMouseDown, true)
  document.removeEventListener('scroll', onScroll, true)
})
</script>

<template>
  <Teleport to="body">
    <button
      v-if="btnPos"
      class="wx-sel-btn"
      :style="{ left: `${btnPos.x}px`, top: `${btnPos.y}px` }"
      title="翻译选中内容"
      @click.stop="openCard"
    >
      译
    </button>

    <div
      v-if="cardPos"
      class="wx-sel-pop wx-glass-strong"
      :style="{ left: `${cardPos.x}px`, top: `${cardPos.y}px`, width: `${CARD_W}px` }"
      @click.stop
    >
      <div class="wx-sel-pop-head">
        <span class="wx-sel-pop-title">划词翻译</span>
        <button class="wx-sel-pop-close" @click="cardPos = null">✕</button>
      </div>
      <TranslationCard
        :result="store.result"
        :loading="store.loading"
        :error="store.error"
        @retry="store.translate()"
        @swap="store.swap"
        @copy="store.copy"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.wx-sel-btn {
  position: fixed;
  z-index: 9000;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border: 1px solid color-mix(in srgb, var(--wx-ink) 35%, transparent);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--wx-color-primary) 45%, transparent);
  cursor: pointer;
  animation: wx-sel-in 140ms var(--wx-ease-out-soft);
  transition: transform var(--wx-duration-fast);
}
.wx-sel-btn:hover { transform: scale(1.1); }

@keyframes wx-sel-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

.wx-sel-pop {
  position: fixed;
  z-index: 9001;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  animation: wx-sel-pop-in 180ms var(--wx-ease-out-soft);
}

@keyframes wx-sel-pop-in {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.wx-sel-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wx-sel-pop-title { font-size: 12px; font-weight: 600; color: var(--wx-text-primary); }
.wx-sel-pop-close {
  width: 22px; height: 22px; border-radius: 6px;
  color: var(--wx-text-tertiary); font-size: 12px;
}
.wx-sel-pop-close:hover { background: color-mix(in srgb, var(--wx-ink) 8%, transparent); color: var(--wx-text-on-accent); }
</style>
