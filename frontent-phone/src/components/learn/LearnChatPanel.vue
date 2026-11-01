<script setup lang="ts">
// AI 学习伙伴对话（移动端全屏弹层）：
// chatStore + aiService.chatStream（SSE 流式，authHeaders + fetch reader），边收边渲染
import { nextTick, ref, watch, onBeforeUnmount } from 'vue'
import { showConfirmDialog } from 'vant'
import { useChatStore } from '@/stores/chatStore'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const chat = useChatStore()
const input = ref('')
const listRef = ref<HTMLElement | null>(null)

// 流式中断：关闭弹层时 abort 当前请求
let controller: AbortController | null = null

function close() {
  controller?.abort()
  controller = null
  chat.toggle(false)
  emit('update:show', false)
}

function scrollToBottom() {
  void nextTick(() => {
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// 新消息 / 流式增量 → 自动滚到底
watch(
  () => [chat.messages.length, chat.streamingContent] as const,
  () => scrollToBottom()
)
watch(
  () => props.show,
  (v) => {
    if (v) {
      chat.toggle(true)
      scrollToBottom()
    } else {
      close()
    }
  }
)
onBeforeUnmount(() => {
  controller?.abort()
})

/** 流式发送（chat-stream SSE） */
async function onSend() {
  const content = input.value.trim()
  if (!content || chat.loading) return
  input.value = ''
  controller = new AbortController()
  await chat.sendStream(content, controller.signal)
  controller = null
}

/** 清空对话（本地写操作，无需确认 API，但防误触先确认） */
async function onClear() {
  try {
    await showConfirmDialog({ title: '清空对话', message: '将删除全部聊天记录，是否继续？' })
  } catch {
    return
  }
  chat.clear()
}

function onKeydown(e: KeyboardEvent) {
  // 移动端回车即发送（软键盘「换行」键多为 enter）
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void onSend()
  }
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '86%' }"
    round
    closeable
    close-icon="cross"
    @update:show="emit('update:show', $event)"
  >
    <div class="lchat">
      <header class="lchat-head">
        <span class="lchat-title">问星 AI 学习伙伴</span>
        <button class="lchat-clear" @click="onClear">清空</button>
      </header>

      <div ref="listRef" class="lchat-list">
        <div
          v-for="m in chat.messages"
          :key="m.id"
          class="lchat-msg lchat-msg-block"
          :class="m.role === 'user' ? 'is-user' : 'is-ai'"
        >
          <div class="lchat-bubble">{{ m.content }}</div>
          <div v-if="m.options?.length" class="lchat-opts">
            <button
              v-for="opt in m.options"
              :key="opt"
              class="lchat-opt"
              :class="{ chosen: m.chosen === opt }"
              :disabled="!!m.chosen"
              @click="chat.choose(m.id, opt)"
            >{{ opt }}</button>
          </div>
        </div>
        <!-- 流式回复（实时渲染，未落库） -->
        <div v-if="chat.streamingContent" class="lchat-msg is-ai">
          <div class="lchat-bubble streaming">{{ chat.streamingContent }}</div>
        </div>
        <div v-if="chat.loading && !chat.streamingContent" class="lchat-msg is-ai">
          <div class="lchat-bubble streaming">思考中…</div>
        </div>
      </div>

      <footer class="lchat-foot">
        <input
          v-model="input"
          class="lchat-input"
          type="text"
          placeholder="问点什么…"
          enterkeyhint="send"
          @keydown="onKeydown"
        />
        <button
          class="lchat-send"
          :disabled="!input.trim() || chat.loading"
          @click="onSend"
        >发送</button>
      </footer>
    </div>
  </van-popup>
</template>

<style scoped>
.lchat {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.lchat-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 46px 10px 16px;
  border-bottom: 1px solid #ebedf0;
}
.lchat-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
}
.lchat-clear {
  font-size: 12.5px;
  color: #969799;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
}
.lchat-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lchat-msg {
  display: flex;
}
.lchat-msg-block {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.lchat-msg-block.is-user {
  align-items: flex-end;
}
.lchat-msg.is-user {
  justify-content: flex-end;
}
.lchat-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lchat-opt {
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  color: #4f6ef2;
  border: 1px solid rgba(79, 110, 242, 0.4);
  background: rgba(79, 110, 242, 0.07);
}
.lchat-opt.chosen {
  color: #fff;
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
  border-color: transparent;
}
.lchat-opt:disabled {
  opacity: 0.55;
}
.lchat-bubble {
  max-width: 82%;
  padding: 9px 13px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.is-ai .lchat-bubble {
  background: #f2f3f5;
  color: #323233;
  border-bottom-left-radius: 4px;
}
.is-user .lchat-bubble {
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.lchat-bubble.streaming::after {
  content: '▍';
  animation: lchat-blink 1s steps(1) infinite;
  color: #4f6ef2;
}
@keyframes lchat-blink {
  50% {
    opacity: 0;
  }
}
.lchat-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid #ebedf0;
  background: #fff;
}
.lchat-input {
  flex: 1;
  min-width: 0;
  padding: 9px 14px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  border-radius: 999px;
  font-size: 14px;
  color: #323233;
  outline: none;
}
.lchat-input:focus {
  border-color: #4f6ef2;
}
.lchat-send {
  flex-shrink: 0;
  padding: 8px 18px;
  border: none;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
}
.lchat-send:disabled {
  opacity: 0.45;
}
</style>
