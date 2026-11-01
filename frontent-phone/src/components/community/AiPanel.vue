<script setup lang="ts">
// 发布编辑器 AI 助手（移动端：作为底部弹层内容，宽度 100% / 高度自适应）
// 对话 + 快捷动作（续写/润色/总结/翻译/大纲）；编辑器选中文本经父组件转发后，可针对选区单独调用
import { nextTick, ref } from 'vue'
import { chat } from '@/services/aiService'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  docTitle: string
  docText: string
}>()

const emit = defineEmits<{
  (e: 'insert', md: string): void
}>()

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<Msg[]>([])
const input = ref('')
const busy = ref(false)
const err = ref('')
const listEl = ref<HTMLElement | null>(null)

/** 编辑器选中的文本（由父组件注入，出现后展示选区快捷动作） */
const selText = ref('')

const QUICKS = [
  { key: 'continue', label: '续写', instr: '请基于文档现有内容自然续写 2~3 段，保持原有语气与风格，只输出续写内容，不要重复原文。' },
  { key: 'polish', label: '润色', instr: '请润色这份文档：表达更流畅专业、修正错别字，保持 Markdown 结构，只输出润色后的全文。' },
  { key: 'summary', label: '总结', instr: '请用不超过 150 字总结这份文档的核心要点，直接输出总结正文。' },
  { key: 'translate', label: '翻译', instr: '请把这份文档翻译成英文，保持 Markdown 结构，只输出译文。' },
  { key: 'outline', label: '大纲', instr: '请通读文档，输出一份 Markdown 大纲（用二级/三级标题与列表组织），只输出大纲。' }
] as const

const SEL_QUICKS = [
  { key: 's-polish', label: '润色', instr: '请润色以下内容，保持原有含义与格式，只输出结果。' },
  { key: 's-summary', label: '总结', instr: '请用一两句话总结以下内容，只输出总结。' },
  { key: 's-translate', label: '翻译', instr: '请把以下内容翻译成英文，只输出译文。' },
  { key: 's-outline', label: '大纲', instr: '请把以下内容整理成 Markdown 大纲（标题+列表），只输出大纲。' },
  { key: 's-continue', label: '续写', instr: '请续写以下内容（2~3 段），保持原文风格，只输出续写部分。' }
] as const

/** 全文档作为上下文注入（过长截断） */
function contextOf(): string {
  const body = props.docText.trim()
  const clipped = body.length > 6000 ? `${body.slice(0, 6000)}\n…（正文过长已截断）` : body
  return `用户正在编辑社区文档《${props.docTitle || '无标题'}》，正文如下：\n${clipped || '（正文还是空的）'}`
}

function scrollBottom() {
  void nextTick(() => {
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
  })
}

async function run(userText: string) {
  const content = userText.trim()
  if (!content || busy.value) return
  busy.value = true
  err.value = ''
  messages.value.push({ role: 'user', content })
  scrollBottom()
  try {
    const reply = await chat(
      messages.value.map((m) => ({ role: m.role, content: m.content })),
      contextOf()
    )
    messages.value.push({ role: 'assistant', content: reply.content })
  } catch (e) {
    err.value = (e as Error).message || 'AI 请求失败，请稍后重试'
  } finally {
    busy.value = false
    scrollBottom()
  }
}

function quick(q: (typeof QUICKS)[number]) {
  void run(q.instr)
}

function runSel(q: (typeof SEL_QUICKS)[number]) {
  const t = selText.value
  clearSel()
  void run(`${q.instr}\n\n---\n\n${t}`)
}

function send() {
  const t = input.value
  input.value = ''
  void run(t)
}

/** 编辑器选中文本进入面板（父组件调用） */
function setSelection(text: string) {
  selText.value = text.trim()
  scrollBottom()
}

function clearSel() {
  selText.value = ''
}

function clearChat() {
  messages.value = []
  err.value = ''
}

async function copyMsg(m: Msg) {
  try {
    await navigator.clipboard.writeText(m.content)
  } catch {
    /* 剪贴板不可用时静默 */
  }
}

defineExpose({ setSelection })
</script>

<template>
  <div class="wx-aip">
    <div class="wx-aip-head">
      <span class="wx-aip-title"><span class="wx-aip-spark">✦</span> 问星 AI</span>
      <button class="wx-aip-clear" title="清空对话" @click="clearChat">清空</button>
    </div>

    <!-- 编辑器选中文本：选区快捷动作 -->
    <div v-if="selText" class="wx-aip-sel">
      <div class="wx-aip-sel-row">
        <span class="wx-aip-sel-tag">已选中 {{ selText.length }} 字</span>
        <button class="wx-aip-sel-close" title="取消选区" @click="clearSel">✕</button>
      </div>
      <div class="wx-aip-sel-actions">
        <button v-for="q in SEL_QUICKS" :key="q.key" :disabled="busy" @click="runSel(q)">{{ q.label }}</button>
      </div>
    </div>

    <div ref="listEl" class="wx-aip-list">
      <div v-if="!messages.length && !busy" class="wx-aip-empty">
        <p class="wx-aip-empty-title">让 AI 参与你的写作</p>
        <p class="wx-aip-empty-line">· 点击上方快捷按钮可对整篇文档续写、润色、总结、翻译、生成大纲</p>
        <p class="wx-aip-empty-line">· 在正文选中一段文字 → 浮动栏点「✦ AI」，可针对选区处理</p>
        <p class="wx-aip-empty-line">· AI 回复可一键「插入为块」，直接写进文档</p>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="wx-aip-msg" :class="m.role">
        <div v-if="m.role === 'assistant'" class="wx-aip-bubble md" v-html="renderMarkdown(m.content)"></div>
        <div v-else class="wx-aip-bubble">{{ m.content }}</div>
        <div v-if="m.role === 'assistant' && !busy" class="wx-aip-acts">
          <button @click="emit('insert', m.content)">⤓ 插入为块</button>
          <button @click="copyMsg(m)">⧉ 复制</button>
        </div>
      </div>

      <div v-if="busy" class="wx-aip-msg assistant">
        <div class="wx-aip-bubble typing">问星 AI 思考中…</div>
      </div>
    </div>

    <div v-if="err" class="wx-aip-err">⚠ {{ err }}</div>

    <div class="wx-aip-quick">
      <button v-for="q in QUICKS" :key="q.key" :disabled="busy" @click="quick(q)">{{ q.label }}</button>
    </div>

    <div class="wx-aip-input">
      <textarea
        v-model="input"
        rows="2"
        placeholder="向问星 AI 提问"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button class="wx-aip-send" :disabled="busy || !input.trim()" @click="send">发送</button>
    </div>
  </div>
</template>

<style scoped>
.wx-aip {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 16px calc(12px + env(safe-area-inset-bottom));
  background: #ffffff;
}
.wx-aip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0 10px;
  border-bottom: 1px solid #ebedf0;
  flex-shrink: 0;
}
.wx-aip-title {
  font-size: 15px;
  font-weight: 600;
  color: #323233;
  display: flex;
  align-items: center;
  gap: 6px;
}
.wx-aip-spark { color: #1989fa; }
.wx-aip-clear {
  font-size: 12px;
  color: #969799;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #ebedf0;
}
.wx-aip-clear:active { color: #323233; }

/* 选区横幅 */
.wx-aip-sel {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #e8f3ff;
  border: 1px solid #b8dcff;
  flex-shrink: 0;
}
.wx-aip-sel-row { display: flex; align-items: center; justify-content: space-between; }
.wx-aip-sel-tag { font-size: 12px; color: #1989fa; }
.wx-aip-sel-close { font-size: 11px; color: #969799; width: 22px; height: 22px; border-radius: 50%; }
.wx-aip-sel-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.wx-aip-sel-actions button {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 999px;
  color: #646566;
  background: #ffffff;
  border: 1px solid #b8dcff;
}
.wx-aip-sel-actions button:disabled { opacity: 0.5; }

/* 消息列表 */
.wx-aip-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 2px;
  -webkit-overflow-scrolling: touch;
}
.wx-aip-empty { padding: 18px 6px; }
.wx-aip-empty-title { font-size: 14px; color: #323233; font-weight: 600; margin-bottom: 8px; }
.wx-aip-empty-line { font-size: 12.5px; color: #969799; line-height: 1.9; }
.wx-aip-msg { display: flex; flex-direction: column; gap: 5px; }
.wx-aip-msg.user { align-items: flex-end; }
.wx-aip-msg.assistant { align-items: flex-start; }
.wx-aip-bubble {
  max-width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.wx-aip-msg.user .wx-aip-bubble {
  background: #1989fa;
  color: #ffffff;
}
.wx-aip-msg.assistant .wx-aip-bubble {
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  color: #323233;
}
.wx-aip-bubble.md { white-space: normal; }
.wx-aip-bubble.md :deep(p) { margin: 6px 0; }
.wx-aip-bubble.md :deep(h1), .wx-aip-bubble.md :deep(h2), .wx-aip-bubble.md :deep(h3) {
  font-size: 14px; font-weight: 600; color: #323233; margin: 8px 0 4px;
}
.wx-aip-bubble.md :deep(ul), .wx-aip-bubble.md :deep(ol) { margin: 6px 0; padding-left: 18px; }
.wx-aip-bubble.md :deep(code) {
  font-family: 'JetBrains Mono', 'Cascadia Code', monospace; font-size: 12px;
  padding: 1px 4px; border-radius: 4px; background: #ebedf0; color: #323233;
}
.wx-aip-bubble.md :deep(.wx-code-block) {
  margin: 8px 0; padding: 8px 10px; border-radius: 8px;
  background: #f2f3f5; overflow-x: auto; font-size: 12px;
}
.wx-aip-bubble.md :deep(.wx-mark) { background: #ffe7a3; border-radius: 3px; padding: 0 2px; }
.wx-aip-bubble.typing { color: #969799; font-size: 12.5px; }
.wx-aip-acts { display: flex; gap: 6px; }
.wx-aip-acts button {
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 999px;
  color: #646566;
  border: 1px solid #ebedf0;
  background: #ffffff;
}

.wx-aip-err {
  flex-shrink: 0;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12.5px;
  color: #ee0a24;
  background: #ffe9e9;
  border: 1px solid #ffb3b3;
}

/* 快捷动作 */
.wx-aip-quick {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 0 8px;
  border-top: 1px solid #ebedf0;
}
.wx-aip-quick button {
  padding: 6px 13px;
  font-size: 12.5px;
  border-radius: 999px;
  color: #646566;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
}
.wx-aip-quick button:disabled { opacity: 0.5; }

/* 输入区 */
.wx-aip-input { flex-shrink: 0; display: flex; align-items: flex-end; gap: 8px; }
.wx-aip-input textarea {
  flex: 1;
  min-width: 0;
  resize: none;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  border-radius: 10px;
  padding: 9px 11px;
  color: #323233;
  font-size: 14px;
  line-height: 1.6;
  outline: none;
}
.wx-aip-input textarea:focus { border-color: #1989fa; }
.wx-aip-send {
  flex-shrink: 0;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  background: #1989fa;
}
.wx-aip-send:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
