<script setup lang="ts">
// 问星 AI 悬浮球 + 聊天面板（v0.10 语音通话：连续识别 + 静音切轮 + 打断）
// 悬浮球可拖动：位置经统一存储封装（键 'aiOrbPos'）持久化，区分点击与拖动（阈值 5px）；支持贴边收纳
import { ref, computed, watch, h, defineComponent, onMounted, onBeforeUnmount } from 'vue'
import { storage } from '@/utils/storage'
import { useChatStore } from '@/stores/chatStore'
import { useSpeechRecognition, useSpeechSynthesis } from '@/composables/useSpeech'
import ChatOptions from '@/components/chat/ChatOptions.vue'

const chatStore = useChatStore()

// ===== 悬浮球拖拽（右/下偏移坐标系，单位 px） =====
const ORB_SIZE = 60
const SNAP_THRESHOLD = 24 // 球边缘距视口边缘 ≤ 该值即贴边收纳
const DEFAULT_POS = { x: 24, y: 96 } // 默认位置（内缩/上移，降低遮挡右下角主按钮概率）
const orbPos = ref({ ...DEFAULT_POS })
const dragging = ref(false)
const hovered = ref(false) // 收纳态下鼠标悬停临时展开
let dragMoved = false
let dragStart: { px: number; py: number; x: number; y: number } | null = null

function clampPos(x: number, y: number) {
  const maxX = Math.max(0, window.innerWidth - ORB_SIZE)
  const maxY = Math.max(0, window.innerHeight - ORB_SIZE)
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) }
}

// 收纳方向：x<=0 贴右边缘，x>=maxX 贴左边缘，其余为自由浮动
const dockSide = computed<'left' | 'right' | null>(() => {
  const maxX = Math.max(0, window.innerWidth - ORB_SIZE)
  if (orbPos.value.x <= 0) return 'right'
  if (orbPos.value.x >= maxX) return 'left'
  return null
})

// 是否处于收纳态：贴边且未悬停、未拖动、未打开面板
const collapsed = computed(
  () => dockSide.value !== null && !hovered.value && !dragging.value && !chatStore.open
)

// 拖拽结束/载入时按球边缘到视口边缘的距离决定收纳（贴边则吸附到边缘）
function applyDock() {
  const maxX = Math.max(0, window.innerWidth - ORB_SIZE)
  const rightGap = orbPos.value.x // 球右缘 → 视口右缘
  const leftGap = window.innerWidth - (orbPos.value.x + ORB_SIZE) // 球左缘 → 视口左缘
  if (rightGap <= SNAP_THRESHOLD) orbPos.value = { x: 0, y: orbPos.value.y }
  else if (leftGap <= SNAP_THRESHOLD) orbPos.value = { x: maxX, y: orbPos.value.y }
}

function onOrbPointerDown(e: PointerEvent) {
  dragging.value = true
  dragMoved = false
  dragStart = { px: e.clientX, py: e.clientY, x: orbPos.value.x, y: orbPos.value.y }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onOrbPointerMove(e: PointerEvent) {
  if (!dragging.value || !dragStart) return
  const dx = e.clientX - dragStart.px
  const dy = e.clientY - dragStart.py
  if (!dragMoved && Math.hypot(dx, dy) < 5) return
  dragMoved = true
  // 右/下偏移：向右拖 x 减小，向上拖 y 增大
  orbPos.value = clampPos(dragStart.x - dx, dragStart.y - dy)
}

function onOrbPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  if (dragMoved) {
    applyDock() // 贴边则吸附收纳
    storage.set('aiOrbPos', orbPos.value) // 沿用统一存储封装（命名空间 + 降级）
  }
  dragStart = null
}

// 收纳态下悬停临时展开为完整圆球
function onOrbHoverIn() { hovered.value = true }
function onOrbHoverOut() { hovered.value = false }

function onOrbClick() {
  // 拖拽结束后的一次 click 不触发开合
  if (dragMoved) {
    dragMoved = false
    return
  }
  chatStore.toggle()
}

// 聊天面板方向：球在左半屏时面板向右展开，避免出屏
const panelLeft = computed(() => window.innerWidth - orbPos.value.x - ORB_SIZE < window.innerWidth / 2)

// 定位：左贴边时以 left 锚定（收窄/展开始终贴左缘）；其余情况沿用 right 偏移
// 拖动中始终用 right 偏移，保证贴边球也能被拖走
const wrapStyle = computed(() => {
  const anchoredLeft = dockSide.value === 'left' && !dragging.value
  return anchoredLeft
    ? { left: '0px', right: 'auto', bottom: `${orbPos.value.y}px` }
    : { right: `${orbPos.value.x}px`, left: 'auto', bottom: `${orbPos.value.y}px` }
})

// 打断用的 AbortController
let streamAbort: AbortController | null = null

// 刷新页面后恢复语音模式（sessionStorage，关闭标签页即清）；恢复悬浮球位置
onMounted(() => {
  if (sessionStorage.getItem('wx_voice_mode') === '1') {
    chatStore.voiceMode = true
    chatStore.open = true
    // callState 保持 idle，用户点击"继续聆听"再启动 STT
  }
  // 恢复悬浮球位置（统一存储封装；键值形状仍为 { x, y }）
  const saved = storage.get<{ x: number; y: number } | null>('aiOrbPos', null)
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    orbPos.value = clampPos(saved.x, saved.y)
    applyDock() // 载入即按贴边规则归一化
  }
  window.addEventListener('wx:orb-reset', onOrbReset)
})

// 位置重置：任意页面 window.dispatchEvent(new CustomEvent('wx:orb-reset')) 即可复位并清存储
function onOrbReset() {
  orbPos.value = { ...DEFAULT_POS }
  storage.remove('aiOrbPos')
}

onBeforeUnmount(() => {
  window.removeEventListener('wx:orb-reset', onOrbReset)
})

const stt = useSpeechRecognition({
  silenceTimeout: 1500,
  // 静音超时 → 自动发送
  onFinal: (text) => {
    void handleVoiceInput(text)
  },
  // 检测到说话 → 打断 AI（全双工）
  onSpeechStart: () => {
    // 只在 AI 朗读时打断；思考中不响应（避免并发请求）
    if (callState.value === 'speaking') {
      interruptAI()
    }
  }
})
const tts = useSpeechSynthesis()

// 通话状态机：idle | listening | thinking | speaking
const callState = ref<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')
const voiceError = ref<string | null>(null)

const ChatInput = defineComponent({
  name: 'ChatInput',
  emits: ['send'],
  setup(_, { emit }) {
    const text = ref('')
    function onSend() {
      if (!text.value.trim()) return
      emit('send', text.value)
      text.value = ''
    }
    return () =>
      h('div', { class: 'wx-chat-input-wrap' }, [
        h('input', {
          class: 'wx-chat-input',
          type: 'text',
          placeholder: '输入问题…（Enter 发送）',
          value: text.value,
          onInput: (e: Event) => (text.value = (e.target as HTMLInputElement).value),
          onKeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') onSend()
          }
        }),
        h('button', { class: 'wx-chat-send wx-pressable', onClick: onSend }, '发送')
      ])
  }
})

function startVoiceCall() {
  if (!stt.supported.value) {
    voiceError.value = '当前浏览器不支持语音识别，请用 Chrome 或 Edge'
    return
  }
  voiceError.value = null
  chatStore.voiceMode = true
  sessionStorage.setItem('wx_voice_mode', '1')
  chatStore.open = true
  startListening()
}

function startListening() {
  callState.value = 'listening'
  stt.start()
}

/** 用户说话 → 发送给 AI */
async function handleVoiceInput(text: string) {
  // 只在聆听状态接受输入；思考中/朗读中的静音回调忽略
  if (callState.value !== 'listening') return
  if (!text.trim()) {
    startListening()
    return
  }
  callState.value = 'thinking'
  tts.cancel()
  streamAbort = new AbortController()
  const reply = await chatStore.sendStream(text, streamAbort.signal)
  streamAbort = null
  if (reply && chatStore.voiceMode) {
    callState.value = 'speaking'
    tts.speak(reply)
    // speaking 状态下 STT 继续监听（用户可打断）
  } else if (chatStore.voiceMode) {
    // 被打断或出错：回到聆听
    startListening()
  }
}

/** 打断 AI：停止朗读 + 终止流式请求 + 立即发送已识别文本 */
function interruptAI() {
  tts.cancel()
  streamAbort?.abort()
  streamAbort = null
  callState.value = 'listening'  // 切回聆听，让 flush 触发的 handleVoiceInput 能执行
  stt.flush()
}

// TTS 朗读完成 → 自动开始下一轮聆听
watch(() => tts.speaking.value, (speaking, wasSpeaking) => {
  if (wasSpeaking && !speaking && chatStore.voiceMode && callState.value === 'speaking') {
    startListening()
  }
})

function endVoiceCall() {
  chatStore.voiceMode = false
  sessionStorage.removeItem('wx_voice_mode')
  callState.value = 'idle'
  streamAbort?.abort()
  streamAbort = null
  stt.stop()
  tts.cancel()
}

watch(() => chatStore.voiceMode, (v) => {
  if (!v) {
    streamAbort?.abort()
    streamAbort = null
    stt.stop()
    tts.cancel()
    callState.value = 'idle'
  }
})
</script>

<template>
  <div class="wx-orb-wrap" :style="wrapStyle">
    <Transition name="wx-pop">
      <div
        v-if="chatStore.open"
        class="wx-chat-panel wx-glass-strong"
        :style="panelLeft ? { left: '0', right: 'auto' } : { right: '0', left: 'auto' }"
      >
        <header class="wx-chat-head">
          <div class="wx-chat-head-info">
            <span class="wx-chat-head-avatar" :class="{ 'wx-avatar-voice': chatStore.voiceMode }">✦</span>
            <div>
              <div class="wx-chat-head-name">问星 AI</div>
              <div class="wx-chat-head-status">
                <span class="wx-online-dot" :class="{ 'wx-dot-pulse': chatStore.voiceMode }"></span>
                {{ chatStore.voiceMode ? '语音通话中' : '在线 · 文字' }}
              </div>
            </div>
          </div>
          <button class="wx-chat-close" @click="chatStore.toggle(false)" aria-label="收起">✕</button>
        </header>

        <div class="wx-chat-body">
          <TransitionGroup name="wx-fade" tag="div" class="wx-chat-list">
            <div
              v-for="m in chatStore.messages"
              :key="m.id"
              class="wx-chat-msg"
              :class="m.role"
            >
              <div class="wx-chat-bubble">{{ m.content }}</div>
              <ChatOptions
                v-if="m.role === 'assistant' && m.options?.length"
                class="wx-orb-msg-options"
                :options="m.options"
                :chosen="m.chosen"
                @choose="chatStore.choose(m.id, $event)"
              />
            </div>
          </TransitionGroup>

          <!-- 流式接收中的实时文字 -->
          <div v-if="chatStore.loading && chatStore.streamingContent" class="wx-chat-msg assistant">
            <div class="wx-chat-bubble wx-chat-bubble-streaming">{{ chatStore.streamingContent }}</div>
          </div>

          <!-- 聆听中的实时识别文字 -->
          <div v-if="chatStore.voiceMode && stt.transcript" class="wx-chat-msg user">
            <div class="wx-chat-bubble wx-chat-bubble-interim">{{ stt.transcript }}</div>
          </div>

          <div v-if="chatStore.loading && !chatStore.streamingContent" class="wx-chat-typing">
            <span class="wx-typing-dot"></span>
            <span class="wx-typing-dot"></span>
            <span class="wx-typing-dot"></span>
          </div>
        </div>

        <!-- 语音通话中：状态提示 + 挂断 -->
        <div v-if="chatStore.voiceMode" class="wx-voice-bar">
          <div class="wx-voice-state">
            <span v-if="callState !== 'idle'" class="wx-voice-wave" :class="callState">
              <i></i><i></i><i></i><i></i>
            </span>
            <span class="wx-voice-state-text">
              {{ callState === 'listening' ? '正在聆听…' : callState === 'thinking' ? '思考中…' : callState === 'speaking' ? '回复中…' : '已就绪' }}
            </span>
            <!-- 刷新恢复后：点击继续聆听 -->
            <button v-if="callState === 'idle'" class="wx-voice-resume" @click="startListening">继续聆听</button>
          </div>
          <button class="wx-voice-hangup" @click="endVoiceCall" title="挂断">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
              <path d="M23 18.5c0-.41-.34-.75-.75-.75h-5.5c-.41 0-.75.34-.75.75v4c0 .41.34.75.75.75h5.5c.41 0 .75-.34.75-.75v-4z" transform="rotate(135 19.5 20.5)"/>
            </svg>
          </button>
        </div>

        <!-- 文字模式输入框 -->
        <footer v-else class="wx-chat-foot">
          <button
            class="wx-chat-voice"
            :class="{ 'wx-chat-voice-disabled': !stt.supported }"
            :title="stt.supported ? '语音通话' : '当前浏览器不支持语音识别'"
            @click="startVoiceCall"
          >📞</button>
          <ChatInput @send="chatStore.send" />
        </footer>

        <div v-if="voiceError" class="wx-voice-error">{{ voiceError }}</div>
      </div>
    </Transition>

    <button
      class="wx-orb wx-breathe"
      :class="{
        'wx-orb-active': chatStore.open,
        'wx-orb-voice': chatStore.voiceMode,
        'wx-orb-dragging': dragging,
        'wx-orb-collapsed': collapsed,
        'wx-orb-dock-right': dockSide === 'right',
        'wx-orb-dock-left': dockSide === 'left'
      }"
      @pointerdown="onOrbPointerDown"
      @pointermove="onOrbPointerMove"
      @pointerup="onOrbPointerUp"
      @pointercancel="dragging = false"
      @mouseenter="onOrbHoverIn"
      @mouseleave="onOrbHoverOut"
      @click="onOrbClick"
      aria-label="问星 AI"
      title="问星 AI（可拖动）"
    >
      <span class="wx-orb-core">✦</span>
      <span class="wx-orb-ring"></span>
    </button>
  </div>
</template>

<style scoped>
.wx-orb-wrap {
  position: fixed;
  /* right/bottom 由内联样式驱动（可拖动） */
  z-index: 50;
}

.wx-orb {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--wx-color-primary-soft) 0%, var(--wx-color-primary-strong) 50%, #312e81 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--wx-ink) 35%, transparent);
  cursor: grab;
  touch-action: none;
  transition:
    transform var(--wx-duration-fast) var(--wx-ease-spring),
    width var(--wx-duration-fast) var(--wx-ease-out-soft),
    height var(--wx-duration-fast) var(--wx-ease-out-soft),
    border-radius var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-orb-dragging { cursor: grabbing; }
.wx-orb:hover { transform: scale(1.08); }
.wx-orb:active { transform: scale(0.94); }
.wx-orb-core {
  font-size: 22px;
  color: var(--wx-text-on-accent);
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--wx-ink) 60%, transparent));
  z-index: 2;
}
.wx-orb-ring {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 40%, transparent);
  animation: wx-orb-ring 3s linear infinite;
}
@keyframes wx-orb-ring {
  to { transform: rotate(360deg); }
}
/* 贴边收纳态：收窄为贴边窄条（hover/点击/面板打开时恢复完整圆球） */
.wx-orb-collapsed {
  width: 20px;
  height: 48px;
  overflow: hidden;
}
.wx-orb-collapsed.wx-orb-dock-right { border-radius: 10px 0 0 10px; }
.wx-orb-collapsed.wx-orb-dock-left { border-radius: 0 10px 10px 0; }
.wx-orb-collapsed .wx-orb-ring { display: none; }
.wx-orb-collapsed .wx-orb-core { font-size: 12px; }
.wx-orb-active { transform: scale(0.92); opacity: 0.85; }
.wx-orb-voice {
  background: radial-gradient(circle at 30% 30%, #fca5a5 0%, var(--wx-color-vermilion) 50%, #7f1d1d 100%);
  animation: wx-orb-voice-pulse 1.5s ease-in-out infinite;
}
@keyframes wx-orb-voice-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--wx-color-vermilion) 50%, transparent); }
  50% { box-shadow: 0 0 0 12px color-mix(in srgb, var(--wx-color-vermilion) 0%, transparent); }
}

.wx-chat-panel {
  position: absolute;
  right: 0;
  bottom: 78px;
  width: 380px;
  max-width: calc(100vw - 56px);
  height: 520px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 20px;
}

.wx-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
}
.wx-chat-head-info { display: flex; align-items: center; gap: 10px; }
.wx-chat-head-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--wx-gradient-primary); color: var(--wx-text-on-accent); font-size: 16px;
}
.wx-avatar-voice { background: linear-gradient(135deg, var(--wx-color-vermilion), #b91c1c); }
.wx-chat-head-name { font-weight: 600; font-size: 14px; }
.wx-chat-head-status { font-size: 11px; color: var(--wx-text-tertiary); display: flex; align-items: center; gap: 4px; }
.wx-online-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--wx-state-deep); box-shadow: 0 0 6px var(--wx-state-deep); }
.wx-dot-pulse { background: var(--wx-color-vermilion); box-shadow: 0 0 6px var(--wx-color-vermilion); animation: wx-dot-blink 1s ease-in-out infinite; }
@keyframes wx-dot-blink { 50% { opacity: 0.3; } }
.wx-chat-close {
  width: 28px; height: 28px; border-radius: 8px;
  color: var(--wx-text-tertiary); font-size: 14px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-chat-close:hover { background: color-mix(in srgb, var(--wx-ink) 8%, transparent); color: var(--wx-text-on-accent); }

.wx-chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.wx-chat-list { display: flex; flex-direction: column; gap: 12px; }
.wx-chat-msg { display: flex; flex-wrap: wrap; }
.wx-chat-msg.user { justify-content: flex-end; }
.wx-orb-msg-options { flex-basis: 100%; max-width: 82%; }
.wx-chat-bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.wx-chat-msg.assistant .wx-chat-bubble {
  background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 25%, transparent);
  border-bottom-left-radius: 4px;
}
.wx-chat-msg.user .wx-chat-bubble {
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  border-bottom-right-radius: 4px;
}
.wx-chat-bubble-streaming { opacity: 0.85; }
.wx-chat-bubble-interim { opacity: 0.6; }
.wx-chat-typing { display: flex; gap: 4px; padding: 6px 10px; align-items: center; }
.wx-typing-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--wx-color-primary-soft);
  animation: wx-typing 1.2s ease-in-out infinite;
}
.wx-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.wx-typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes wx-typing { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }

/* 语音通话底栏 */
.wx-voice-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-top: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 30%, transparent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent);
}
.wx-voice-state { display: flex; align-items: center; gap: 12px; }
.wx-voice-wave { display: flex; align-items: flex-end; gap: 2px; height: 20px; }
.wx-voice-wave i {
  display: block; width: 3px; border-radius: 2px; background: var(--wx-color-vermilion);
}
.wx-voice-wave.listening i { animation: wx-wave 0.8s ease-in-out infinite; }
.wx-voice-wave i:nth-child(1) { height: 8px; }
.wx-voice-wave i:nth-child(2) { height: 16px; animation-delay: 0.1s; }
.wx-voice-wave i:nth-child(3) { height: 12px; animation-delay: 0.2s; }
.wx-voice-wave i:nth-child(4) { height: 18px; animation-delay: 0.3s; }
@keyframes wx-wave { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
.wx-voice-wave.thinking i { background: var(--wx-color-amber); animation: wx-wave 0.6s ease-in-out infinite; }
.wx-voice-wave.speaking i { background: var(--wx-state-deep); animation: wx-wave 0.5s ease-in-out infinite; }
.wx-voice-state-text { font-size: 13px; color: var(--wx-text-primary); }
.wx-voice-resume {
  margin-left: 8px;
  padding: 4px 12px;
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  border: none;
  border-radius: var(--wx-radius-pill);
  font-size: 12px;
  cursor: pointer;
}
.wx-voice-resume:hover { opacity: 0.9; }
.wx-voice-hangup {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--wx-color-vermilion); color: var(--wx-text-on-accent); border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: transform var(--wx-duration-fast);
}
.wx-voice-hangup:hover { transform: scale(1.1); }

.wx-chat-foot {
  padding: 12px;
  border-top: 1px solid var(--wx-border-soft);
  display: flex; gap: 10px; align-items: center;
}
.wx-chat-voice {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  font-size: 14px; cursor: pointer;
  transition: all var(--wx-duration-fast);
}
.wx-chat-voice:hover { border-color: var(--wx-border-glow); background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent); }
.wx-chat-voice-disabled { opacity: 0.35; cursor: not-allowed; }
.wx-voice-error {
  padding: 8px 16px; font-size: 12px; color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent); text-align: center;
}
:deep(.wx-chat-input-wrap) { flex: 1; display: flex; gap: 8px; }
:deep(.wx-chat-input) {
  flex: 1; padding: 9px 14px;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-primary); font-size: 13px; outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
:deep(.wx-chat-input:focus) { border-color: var(--wx-border-glow); }
:deep(.wx-chat-send) {
  padding: 8px 16px; background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent); border-radius: var(--wx-radius-pill);
  font-size: 13px; font-weight: 600;
}
</style>
