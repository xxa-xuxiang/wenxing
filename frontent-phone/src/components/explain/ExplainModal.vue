<script setup lang="ts">
// 费曼讲解输入弹窗（移动端）：textarea + 2min 计时 + 草稿持久化（@/utils/storage）
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storage } from '@/utils/storage'
import type { KpPath } from '@/types'

const props = defineProps<{ kp: KpPath }>()
const emit = defineEmits<{
  (e: 'submit', transcript: string): void
  (e: 'close'): void
}>()

// 草稿键名（storage 会自动加命名空间与用户隔离前缀）
const DRAFT_KEY = (kpName: string) => `explain:draft:${kpName}`
const TIME_LIMIT = 120 // 秒

const transcript = ref('')
const secondsLeft = ref(TIME_LIMIT)
const started = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  transcript.value = storage.get<string>(DRAFT_KEY(props.kp.name), '')
})

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

function submit() {
  if (!transcript.value.trim()) return
  storage.remove(DRAFT_KEY(props.kp.name))
  emit('submit', transcript.value.trim())
}
</script>

<template>
  <div class="wx-explain-input-mask" @click.self="emit('close')">
    <div class="wx-explain-input-modal">
      <header class="wx-explain-input-head">
        <div class="wx-explain-input-head-title">
          <span class="wx-explain-input-mark">✦</span>
          <span>费曼讲解 · {{ kp.name }}</span>
        </div>
        <button class="wx-explain-input-close" title="关闭" @click="emit('close')">×</button>
      </header>

      <div class="wx-explain-input-body">
        <p class="wx-explain-input-tip">
          想象你在给一个完全不懂的朋友讲这个知识点，用你自己的话讲清楚它是什么、为什么、怎么用。
        </p>

        <textarea
          v-model="transcript"
          class="wx-explain-input-area"
          rows="8"
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
          <button class="wx-explain-input-cancel" @click="emit('close')">取消</button>
          <button
            class="wx-explain-input-submit"
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
  z-index: 220;
  background: color-mix(in srgb, var(--wx-bg-deep) 72%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.wx-explain-input-modal {
  width: 100%;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--wx-bg-deep) 94%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-glass-radius);
  box-shadow: var(--wx-shadow-glow), var(--wx-shadow-lg);
  overflow: hidden;
}
.wx-explain-input-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.wx-explain-input-head-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--wx-font-serif);
  font-size: 15px;
  color: var(--wx-text-primary);
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
.wx-explain-input-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.wx-explain-input-tip {
  font-size: 12.5px;
  color: var(--wx-text-tertiary);
  line-height: 1.6;
  margin: 0;
}
.wx-explain-input-area {
  width: 100%;
  resize: vertical;
  min-height: 160px;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-primary);
  font-size: 14px;
  line-height: 1.7;
  padding: 12px;
  outline: none;
  font-family: var(--wx-font-sans);
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
  gap: 10px;
  padding-bottom: env(safe-area-inset-bottom);
}
.wx-explain-input-cancel,
.wx-explain-input-submit {
  flex: 1;
  padding: 11px 0;
  border-radius: var(--wx-radius-pill);
  font-size: 13.5px;
}
.wx-explain-input-cancel {
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
}
.wx-explain-input-submit {
  border: none;
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-weight: 600;
}
.wx-explain-input-submit:disabled { opacity: 0.4; }
</style>
