<script setup lang="ts">
// 费曼讲解输入弹窗：textarea + 2min 计时 + 草稿持久化（@/utils/storage）
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storage } from '@/utils/storage'
import { useOverlay } from '@/composables/useOverlay'
import type { KpPath } from '@/types'

const props = defineProps<{ kp: KpPath }>()
const emit = defineEmits<{
  (e: 'submit', transcript: string): void
  (e: 'close'): void
}>()

// 统一浮层行为：Esc / 点击遮罩空白 → 复用原有 emit('close') 出口
const { overlayRef, onOverlayMousedown } = useOverlay({
  onClose: () => emit('close'),
  modal: true
})

// 草稿键名（storage 会自动加命名空间与用户隔离前缀）
const DRAFT_KEY = (kpName: string) => `explain:draft:${kpName}`
const TIME_LIMIT = 120 // 秒

const transcript = ref('')
const secondsLeft = ref(TIME_LIMIT)
const started = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

// 载入草稿（storage 已内置 try/catch 降级）
onMounted(() => {
  transcript.value = storage.get<string>(DRAFT_KEY(props.kp.name), '')
})

// 草稿持久化（防抖式：watch 每次变化即写，量小可接受）
watch(transcript, (v) => {
  if (v.trim()) storage.set(DRAFT_KEY(props.kp.name), v)
  else storage.remove(DRAFT_KEY(props.kp.name))
})

function startTimer() {
  if (started.value) return
  started.value = true
  timer = setInterval(() => {
    secondsLeft.value -= 1
    if (secondsLeft.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function clearDraft() {
  storage.remove(DRAFT_KEY(props.kp.name))
}

function submit() {
  if (!transcript.value.trim()) return
  clearDraft()
  emit('submit', transcript.value.trim())
}
</script>

<template>
  <div ref="overlayRef" class="wx-explain-input-mask" @mousedown="onOverlayMousedown">
    <div class="wx-explain-input-modal wx-glass">
      <header class="wx-explain-input-head">
        <div class="wx-explain-input-head-title">
          <span class="wx-explain-input-mark">✦</span>
          <span>费曼讲解 · {{ kp.name }}</span>
        </div>
        <button class="wx-explain-input-close wx-pressable" @click="emit('close')" title="关闭">×</button>
      </header>

      <div class="wx-explain-input-body">
        <p class="wx-explain-input-tip">
          想象你在给一个完全不懂的朋友讲这个知识点，用你自己的话讲清楚它是什么、为什么、怎么用。
        </p>

        <textarea
          v-model="transcript"
          class="wx-explain-input-area"
          rows="10"
          placeholder="开始输入你的讲解…&#10;&#10;提示：可以讲讲这个概念是什么、为什么需要它、举个例子说明。"
          @input="startTimer"
        ></textarea>

        <div class="wx-explain-input-meta">
          <span class="wx-explain-input-count">{{ transcript.length }} 字</span>
          <span class="wx-explain-input-timer" :class="{ warn: secondsLeft <= 30 }">
            ⏱ {{ fmt(secondsLeft) }}
          </span>
        </div>

        <div class="wx-explain-input-foot">
          <button class="wx-pressable wx-explain-input-cancel" @click="emit('close')">取消</button>
          <button
            class="wx-btn-gradient wx-pressable wx-explain-input-submit"
            :disabled="!transcript.trim()"
            @click="submit"
          >✦ 提交评估</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wx-explain-input-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: color-mix(in srgb, var(--wx-bg-deep) 78%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.wx-explain-input-modal {
  width: min(640px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--wx-bg-deep) 92%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-glass-radius);
  box-shadow: var(--wx-shadow-glow), var(--wx-shadow-lg);
  overflow: hidden;
}
.wx-explain-input-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.wx-explain-input-head-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--wx-font-serif);
  font-size: 16px;
  color: var(--wx-text-primary);
  letter-spacing: 0.04em;
}
.wx-explain-input-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 8px var(--wx-color-primary));
}
.wx-explain-input-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  font-size: 18px;
  color: var(--wx-text-secondary);
  line-height: 1;
}
.wx-explain-input-close:hover { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }

.wx-explain-input-body {
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wx-explain-input-tip {
  font-size: 13px;
  color: var(--wx-text-tertiary);
  line-height: 1.6;
  margin: 0;
}
.wx-explain-input-area {
  width: 100%;
  resize: vertical;
  min-height: 200px;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-primary);
  font-size: 14px;
  line-height: 1.7;
  padding: 14px;
  outline: none;
  font-family: var(--wx-font-sans);
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-explain-input-area:focus { border-color: var(--wx-border-glow); }

.wx-explain-input-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.wx-explain-input-count { color: var(--wx-text-muted); }
.wx-explain-input-timer { color: var(--wx-text-tertiary); font-variant-numeric: tabular-nums; }
.wx-explain-input-timer.warn { color: var(--wx-color-vermilion); }

.wx-explain-input-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.wx-explain-input-cancel {
  padding: 8px 20px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  font-size: 13px;
}
.wx-explain-input-submit { padding: 8px 24px; font-size: 13px; font-weight: 600; }
.wx-explain-input-submit:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
