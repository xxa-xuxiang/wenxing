<script setup lang="ts">
// 学习工具 — 番茄钟（内置白噪音）：右侧全高抽屉
// 硬约束：挂载时不得自动播放音频、不得自动开始计时，一切由用户点击触发。
// 完成计数持久化到 storage 'pomodoro:sessions'（仅统计）。
import { computed, onBeforeUnmount, ref } from 'vue'
import { storage } from '@/utils/storage'
import { useOverlay } from '@/composables/useOverlay'
import { useWhiteNoise, type NoiseKind } from '@/composables/useWhiteNoise'

const emit = defineEmits<{ (e: 'close'): void }>()

// Esc / 点外部关闭（非模态）
const { overlayRef } = useOverlay({ onClose: () => emit('close') })

// ===== 番茄钟 =====
const DURATIONS = [25, 5, 15, 45] as const
const minutes = ref<number>(25)
const remainSec = ref<number>(25 * 60)
const running = ref(false)
const notice = ref('')
const sessions = ref<number>(storage.get<number>('pomodoro:sessions', 0))

let tickTimer: number | null = null
let endAt = 0

const totalSec = computed(() => minutes.value * 60)
const progress = computed(() => (totalSec.value ? 1 - remainSec.value / totalSec.value : 0))

const timeText = computed(() => {
  const s = Math.max(0, remainSec.value)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
})

const stateText = computed(() => {
  if (running.value) return '专注中'
  if (remainSec.value <= 0) return '本轮完成'
  if (remainSec.value < totalSec.value) return '已暂停'
  return '待开始'
})

const mainLabel = computed(() => {
  if (running.value) return '暂停'
  return remainSec.value <= 0 ? '再来一轮' : '开始'
})

const ringStyle = computed(() => {
  const deg = Math.min(1, Math.max(0, progress.value)) * 360
  return {
    background: `conic-gradient(var(--wx-color-primary) 0deg ${deg}deg, var(--wx-border-soft) ${deg}deg 360deg)`
  }
})

function clearTick() {
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

function tick() {
  const left = Math.max(0, Math.round((endAt - Date.now()) / 1000))
  remainSec.value = left
  if (left <= 0) finish()
}

function start() {
  if (running.value) return
  if (remainSec.value <= 0) remainSec.value = totalSec.value
  endAt = Date.now() + remainSec.value * 1000
  running.value = true
  notice.value = ''
  tickTimer = window.setInterval(tick, 250)
  tick()
}

function pause() {
  if (!running.value) return
  running.value = false
  clearTick()
  remainSec.value = Math.max(0, Math.round((endAt - Date.now()) / 1000))
}

function toggleRun() {
  if (running.value) pause()
  else start()
}

function finish() {
  clearTick()
  running.value = false
  remainSec.value = 0
  sessions.value += 1
  storage.set('pomodoro:sessions', sessions.value)
  notice.value = `完成第 ${sessions.value} 个番茄，去休息一下～`
}

function reset() {
  running.value = false
  clearTick()
  remainSec.value = totalSec.value
  notice.value = ''
}

function chooseDuration(min: number) {
  if (running.value) return
  minutes.value = min
  remainSec.value = min * 60
  notice.value = ''
}

// ===== 白噪音 =====
const {
  playing: noisePlaying,
  kind: noiseKind,
  volume: noiseVolume,
  start: startNoise,
  stop: stopNoise,
  setVolume: setNoiseVolume,
  setKind: setNoiseKind
} = useWhiteNoise()

const NOISES: { kind: NoiseKind; label: string }[] = [
  { kind: 'white', label: '白噪声' },
  { kind: 'rain', label: '雨声' },
  { kind: 'wave', label: '海浪' },
  { kind: 'cafe', label: '咖啡馆' }
]

function toggleNoise() {
  if (noisePlaying.value) stopNoise()
  else startNoise(noiseKind.value)
}

function pickNoise(k: NoiseKind) {
  setNoiseKind(k)
}

function onVolumeInput(e: Event) {
  setNoiseVolume(Number((e.target as HTMLInputElement).value))
}

onBeforeUnmount(() => {
  clearTick()
})
</script>

<template>
  <aside ref="overlayRef" class="wx-pomo" aria-label="番茄钟" data-test="panel-pomodoro">
    <header class="wx-pomo-head">
      <div class="wx-pomo-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4.5l3 2" />
          <path d="M12 5V3.5" />
          <path d="M9.5 4.2L12 2.5l2.5 1.7" />
        </svg>
        <span>番茄钟</span>
      </div>
      <button class="wx-pomo-close" title="关闭" @click="emit('close')">✕</button>
    </header>

    <div class="wx-pomo-body">
      <!-- 计时区 -->
      <section class="wx-pomo-section">
        <div class="wx-pomo-presets">
          <button
            v-for="p in DURATIONS"
            :key="p"
            class="wx-pomo-preset wx-pressable"
            :class="{ active: minutes === p }"
            :disabled="running"
            @click="chooseDuration(p)"
          >{{ p }} 分钟</button>
        </div>

        <div class="wx-pomo-ring-wrap">
          <div class="wx-pomo-ring" :style="ringStyle">
            <div class="wx-pomo-ring-inner">
              <div class="wx-pomo-time">{{ timeText }}</div>
              <div class="wx-pomo-state">{{ stateText }}</div>
            </div>
          </div>
        </div>

        <div class="wx-pomo-controls">
          <button class="wx-btn-gradient wx-pressable wx-pomo-main" @click="toggleRun">{{ mainLabel }}</button>
          <button class="wx-pomo-ghost" @click="reset">重置</button>
        </div>

        <div class="wx-pomo-meta">
          <span>已完成番茄</span>
          <b>{{ sessions }}</b>
          <span>个</span>
        </div>

        <div v-if="notice" class="wx-pomo-notice">{{ notice }}</div>
      </section>

      <!-- 白噪音 -->
      <section class="wx-pomo-section">
        <div class="wx-pomo-noise-head">
          <span class="wx-pomo-noise-title">内置白噪音</span>
          <button
            class="wx-pomo-switch"
            :class="{ on: noisePlaying }"
            role="switch"
            :aria-checked="noisePlaying"
            :title="noisePlaying ? '关闭白噪音' : '开启白噪音'"
            @click="toggleNoise"
          >
            <span class="wx-pomo-switch-dot"></span>
          </button>
        </div>

        <div class="wx-pomo-kinds">
          <button
            v-for="n in NOISES"
            :key="n.kind"
            class="wx-pomo-kind wx-pressable"
            :class="{ active: noiseKind === n.kind }"
            @click="pickNoise(n.kind)"
          >{{ n.label }}</button>
        </div>

        <label class="wx-pomo-vol">
          <span class="wx-pomo-vol-label">音量</span>
          <input
            class="wx-pomo-range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="noiseVolume"
            :disabled="!noisePlaying"
            @input="onVolumeInput"
          />
          <span class="wx-pomo-vol-val">{{ Math.round(noiseVolume * 100) }}%</span>
        </label>
        <p class="wx-pomo-hint">点击开关才会出声；切换音色不影响正在进行的计时。</p>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.wx-pomo {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  max-width: 92vw;
  z-index: 45;
  display: flex;
  flex-direction: column;
  background: var(--wx-glass-bg-strong);
  backdrop-filter: blur(calc(var(--wx-glass-blur) + 4px)) saturate(180%);
  -webkit-backdrop-filter: blur(calc(var(--wx-glass-blur) + 4px)) saturate(180%);
  border-left: 1px solid var(--wx-glass-border);
  box-shadow: var(--wx-shadow-lg);
  animation: wx-pomo-in var(--wx-duration-mid) var(--wx-ease-out-soft);
}
@keyframes wx-pomo-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

.wx-pomo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-pomo-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-pomo-title svg { width: 17px; height: 17px; color: var(--wx-color-primary-soft); }
.wx-pomo-close {
  width: 26px;
  height: 26px;
  border-radius: var(--wx-radius-sm);
  color: var(--wx-text-tertiary);
  font-size: 13px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pomo-close:hover { color: var(--wx-text-primary); background: color-mix(in srgb, var(--wx-ink) 6%, transparent); }

.wx-pomo-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.wx-pomo-section {
  padding: 16px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
  border: 1px solid var(--wx-border-soft);
}

/* 时长预设 */
.wx-pomo-presets {
  display: flex;
  gap: 8px;
}
.wx-pomo-preset {
  flex: 1;
  padding: 6px 4px;
  font-size: 12px;
  border-radius: var(--wx-radius-sm);
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pomo-preset:hover:not(:disabled) { border-color: var(--wx-border-glow); color: var(--wx-text-primary); }
.wx-pomo-preset.active {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
  font-weight: 600;
}
.wx-pomo-preset:disabled { opacity: 0.5; cursor: not-allowed; }

/* 环形进度 */
.wx-pomo-ring-wrap {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}
.wx-pomo-ring {
  width: 172px;
  height: 172px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--wx-duration-mid) var(--wx-ease-out-soft);
}
.wx-pomo-ring-inner {
  width: 142px;
  height: 142px;
  border-radius: 50%;
  background: var(--wx-bg-deep);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.wx-pomo-time {
  font-family: var(--wx-font-mono);
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--wx-text-primary);
}
.wx-pomo-state {
  font-size: 11px;
  color: var(--wx-text-tertiary);
}

/* 控制按钮 */
.wx-pomo-controls {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.wx-pomo-main {
  flex: 1;
  padding: 10px 0;
  font-size: 13.5px;
  text-align: center;
}
.wx-pomo-ghost {
  padding: 10px 18px;
  font-size: 13px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: transparent;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pomo-ghost:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }

.wx-pomo-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  justify-content: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--wx-border-soft);
  font-size: 12px;
  color: var(--wx-text-tertiary);
}
.wx-pomo-meta b {
  font-family: var(--wx-font-mono);
  font-size: 18px;
  color: var(--wx-color-yanqing);
}
.wx-pomo-notice {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: var(--wx-radius-sm);
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
  text-align: center;
}

/* 白噪音 */
.wx-pomo-noise-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.wx-pomo-noise-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-secondary);
}
.wx-pomo-switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
  border: 1px solid var(--wx-border-soft);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pomo-switch.on {
  background: color-mix(in srgb, var(--wx-color-primary) 50%, transparent);
  border-color: var(--wx-border-glow);
}
.wx-pomo-switch-dot {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--wx-text-primary);
  transition: transform var(--wx-duration-fast) var(--wx-ease-spring);
}
.wx-pomo-switch.on .wx-pomo-switch-dot { transform: translateX(18px); }

.wx-pomo-kinds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}
.wx-pomo-kind {
  padding: 8px 0;
  font-size: 12.5px;
  border-radius: var(--wx-radius-sm);
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pomo-kind:hover { border-color: var(--wx-border-glow); color: var(--wx-text-primary); }
.wx-pomo-kind.active {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
  font-weight: 600;
}

.wx-pomo-vol {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.wx-pomo-vol-label {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}
.wx-pomo-range {
  flex: 1;
  min-width: 0;
  height: 4px;
  accent-color: var(--wx-color-primary);
  cursor: pointer;
}
.wx-pomo-range:disabled { opacity: 0.4; cursor: not-allowed; }
.wx-pomo-vol-val {
  flex-shrink: 0;
  width: 38px;
  text-align: right;
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-pomo-hint {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--wx-text-muted);
}
</style>
