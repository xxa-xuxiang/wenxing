<script setup lang="ts">
// 问星 — 桌宠聊天面板（绝对定位于悬浮球右上，可溢出窗口边界）
// 内容复用 AIOrb 的 chatStore + useSpeech 能力
import { ref, onMounted, onBeforeUnmount, h, defineComponent } from 'vue'
import { useChatStore } from '@/stores/chatStore'
import { useSpeechRecognition, useSpeechSynthesis } from '@/composables/useSpeech'
import ChatOptions from '@/components/chat/ChatOptions.vue'

const emit = defineEmits<{ (e: 'close'): void }>()
const chatStore = useChatStore()

// 打断用 AbortController
let streamAbort: AbortController | null = null

// 通话状态机（最小化版）
const callState = ref<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')

const stt = useSpeechRecognition({
  silenceTimeout: 1500,
  onFinal: (text) => { void handleVoiceInput(text) },
  onSpeechStart: () => {
    if (callState.value === 'speaking') interruptAI()
  }
})
const tts = useSpeechSynthesis()

async function handleVoiceInput(text: string) {
  if (callState.value !== 'listening') return
  if (!text.trim()) { startListening(); return }
  callState.value = 'thinking'
  tts.cancel()
  streamAbort = new AbortController()
  const reply = await chatStore.sendStream(text, streamAbort.signal)
  streamAbort = null
  if (reply && chatStore.voiceMode) {
    callState.value = 'speaking'
    tts.speak(reply)
  } else if (chatStore.voiceMode) {
    startListening()
  }
}

function interruptAI() {
  tts.cancel()
  streamAbort?.abort()
  streamAbort = null
  callState.value = 'listening'
  stt.flush()
}

function startListening() {
  callState.value = 'listening'
  stt.start()
}

function startVoice() {
  if (!stt.supported.value) return
  chatStore.voiceMode = true
  startListening()
}

function endVoice() {
  chatStore.voiceMode = false
  callState.value = 'idle'
  streamAbort?.abort()
  streamAbort = null
  stt.stop()
  tts.cancel()
}

const ChatInput = defineComponent({
  name: 'PetChatInput',
  emits: ['send'],
  setup(_, { emit }) {
    const text = ref('')
    function onSend() {
      if (!text.value.trim()) return
      emit('send', text.value)
      text.value = ''
    }
    return () =>
      h('div', { class: 'wx-pet-input-wrap' }, [
        h('input', {
          class: 'wx-pet-input',
          type: 'text',
          placeholder: '输入问题…（Enter 发送）',
          value: text.value,
          onInput: (e: Event) => (text.value = (e.target as HTMLInputElement).value),
          onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') onSend() }
        }),
        h('button', { class: 'wx-pet-send', onClick: onSend }, '发送')
      ])
  }
})

onMounted(() => {
  // 聊天面板打开时的初始化（复用 chatStore.toggle 的首次欢迎语逻辑）
  if (chatStore.messages.length === 0) {
    chatStore.toggle(true)
  }
})
onBeforeUnmount(() => {
  if (chatStore.voiceMode) endVoice()
})
</script>

<template>
  <div class="wx-pet-chat wx-glass-strong" data-test="pet-chat-panel">
    <header class="wx-pet-chat-head">
      <div class="wx-pet-chat-head-info">
        <span class="wx-pet-avatar" :class="{ 'wx-pet-avatar-voice': chatStore.voiceMode }">✦</span>
        <div>
          <div class="wx-pet-chat-name">问星 AI</div>
          <div class="wx-pet-chat-status">
            <span class="wx-pet-dot" :class="{ 'wx-pet-dot-pulse': chatStore.voiceMode }"></span>
            {{ chatStore.voiceMode ? '语音通话中' : '在线' }}
          </div>
        </div>
      </div>
      <button class="wx-pet-chat-close" @click="emit('close')" title="收起">✕</button>
    </header>

    <div class="wx-pet-chat-body">
      <TransitionGroup name="wx-fade" tag="div" class="wx-pet-chat-list">
        <div
          v-for="m in chatStore.messages"
          :key="m.id"
          class="wx-pet-chat-msg"
          :class="m.role"
        >
          <div class="wx-pet-bubble">{{ m.content }}</div>
          <ChatOptions
            v-if="m.role === 'assistant' && m.options?.length"
            class="wx-pet-msg-options"
            :options="m.options"
            :chosen="m.chosen"
            @choose="chatStore.choose(m.id, $event)"
          />
        </div>
      </TransitionGroup>

      <div v-if="chatStore.loading && chatStore.streamingContent" class="wx-pet-chat-msg assistant">
        <div class="wx-pet-bubble wx-pet-bubble-streaming">{{ chatStore.streamingContent }}</div>
      </div>

      <div v-if="chatStore.voiceMode && stt.transcript" class="wx-pet-chat-msg user">
        <div class="wx-pet-bubble wx-pet-bubble-interim">{{ stt.transcript }}</div>
      </div>

      <div v-if="chatStore.loading && !chatStore.streamingContent" class="wx-pet-typing">
        <span class="wx-pet-typing-dot"></span>
        <span class="wx-pet-typing-dot"></span>
        <span class="wx-pet-typing-dot"></span>
      </div>
    </div>

    <!-- 语音通话底栏 -->
    <div v-if="chatStore.voiceMode" class="wx-pet-voice-bar">
      <div class="wx-pet-voice-state">
        <span v-if="callState !== 'idle'" class="wx-pet-voice-wave" :class="callState">
          <i></i><i></i><i></i><i></i>
        </span>
        <span class="wx-pet-voice-state-text">
          {{ callState === 'listening' ? '聆听' : callState === 'thinking' ? '思考' : callState === 'speaking' ? '回复中' : '就绪' }}
        </span>
      </div>
      <button class="wx-pet-hangup" @click="endVoice" title="挂断">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
        </svg>
      </button>
    </div>

    <!-- 文字模式底栏 -->
    <footer v-else class="wx-pet-chat-foot">
      <button class="wx-pet-chat-voice" :disabled="!stt.supported" @click="startVoice" title="语音通话">📞</button>
      <ChatInput @send="chatStore.send" />
    </footer>
  </div>
</template>

<style scoped>
.wx-pet-chat {
  position: absolute;
  top: 0;
  left: 68px;
  width: var(--wx-pet-panel-width);
  max-width: 340px;
  height: var(--wx-pet-panel-height);
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  overflow: hidden;
  animation: wx-pet-chat-in 240ms var(--wx-ease-out-soft);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), 0 0 40px color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
}

@keyframes wx-pet-chat-in {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.wx-pet-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--wx-ink) 8%, transparent);
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
}
.wx-pet-chat-head-info { display: flex; align-items: center; gap: 8px; }
.wx-pet-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--wx-gradient-primary); color: var(--wx-text-on-accent); font-size: 14px;
}
.wx-pet-avatar-voice { background: linear-gradient(135deg, var(--wx-color-vermilion), #b91c1c); }
.wx-pet-chat-name { font-weight: 600; font-size: 13px; }
.wx-pet-chat-status { font-size: 10px; color: var(--wx-text-tertiary); display: flex; align-items: center; gap: 3px; }
.wx-pet-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--wx-state-deep); box-shadow: 0 0 4px var(--wx-state-deep); }
.wx-pet-dot-pulse { background: var(--wx-color-vermilion); animation: wx-pet-blink 1s ease-in-out infinite; }
@keyframes wx-pet-blink { 50% { opacity: 0.3; } }
.wx-pet-chat-close {
  width: 26px; height: 26px; border-radius: 6px;
  color: var(--wx-text-tertiary); font-size: 13px;
  transition: all var(--wx-duration-fast);
}
.wx-pet-chat-close:hover { background: color-mix(in srgb, var(--wx-ink) 8%, transparent); color: var(--wx-text-on-accent); }

.wx-pet-chat-body { flex: 1; overflow-y: auto; padding: 12px; }
.wx-pet-chat-list { display: flex; flex-direction: column; gap: 8px; }
.wx-pet-chat-msg { display: flex; flex-wrap: wrap; }
.wx-pet-chat-msg.user { justify-content: flex-end; }
.wx-pet-msg-options { flex-basis: 100%; max-width: 82%; }
.wx-pet-bubble {
  max-width: 78%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.wx-pet-chat-msg.assistant .wx-pet-bubble {
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 25%, transparent);
  border-bottom-left-radius: 4px;
}
.wx-pet-chat-msg.user .wx-pet-bubble {
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  border-bottom-right-radius: 4px;
}
.wx-pet-bubble-streaming { opacity: 0.85; }
.wx-pet-bubble-interim { opacity: 0.55; }

.wx-pet-typing { display: flex; gap: 3px; padding: 4px 8px; align-items: center; }
.wx-pet-typing-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--wx-color-primary-soft);
  animation: wx-pet-typing 1.2s ease-in-out infinite;
}
.wx-pet-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.wx-pet-typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes wx-pet-typing { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-3px); opacity: 1; } }

.wx-pet-voice-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  border-top: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 30%, transparent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent);
}
.wx-pet-voice-state { display: flex; align-items: center; gap: 8px; }
.wx-pet-voice-wave { display: flex; align-items: flex-end; gap: 2px; height: 16px; }
.wx-pet-voice-wave i { display: block; width: 2px; border-radius: 2px; background: var(--wx-color-vermilion); }
.wx-pet-voice-wave.listening i { animation: wx-pet-wave 0.8s ease-in-out infinite; }
.wx-pet-voice-wave i:nth-child(1) { height: 6px; }
.wx-pet-voice-wave i:nth-child(2) { height: 12px; animation-delay: 0.1s; }
.wx-pet-voice-wave i:nth-child(3) { height: 10px; animation-delay: 0.2s; }
.wx-pet-voice-wave i:nth-child(4) { height: 14px; animation-delay: 0.3s; }
@keyframes wx-pet-wave { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
.wx-pet-voice-wave.thinking i { background: var(--wx-color-amber); animation: wx-pet-wave 0.6s ease-in-out infinite; }
.wx-pet-voice-wave.speaking i { background: var(--wx-state-deep); animation: wx-pet-wave 0.5s ease-in-out infinite; }
.wx-pet-voice-state-text { font-size: 11px; color: var(--wx-text-primary); }
.wx-pet-hangup {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--wx-color-vermilion); color: var(--wx-text-on-accent); border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: transform 120ms;
}
.wx-pet-hangup:hover { transform: scale(1.1); }

.wx-pet-chat-foot {
  padding: 10px;
  border-top: 1px solid color-mix(in srgb, var(--wx-ink) 8%, transparent);
  display: flex; gap: 8px; align-items: center;
}
.wx-pet-chat-voice {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-ink) 8%, transparent);
  font-size: 13px; cursor: pointer;
  transition: all var(--wx-duration-fast);
}
.wx-pet-chat-voice:hover:not(:disabled) { border-color: var(--wx-color-primary-soft); background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent); }
.wx-pet-chat-voice:disabled { opacity: 0.35; cursor: not-allowed; }

.wx-pet-input-wrap { flex: 1; display: flex; gap: 6px; }
.wx-pet-input {
  flex: 1; padding: 8px 12px;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-ink) 8%, transparent);
  border-radius: 999px;
  color: var(--wx-text-primary); font-size: 12px; outline: none;
  transition: border-color var(--wx-duration-fast);
}
.wx-pet-input:focus { border-color: var(--wx-color-primary-soft); }
.wx-pet-send {
  padding: 7px 14px; background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent); border-radius: 999px;
  font-size: 12px; font-weight: 600;
}
</style>
