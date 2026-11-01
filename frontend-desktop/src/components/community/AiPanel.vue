<script setup lang="ts">
// 发布编辑器右侧 AI 助手：对话 + 快捷动作（续写/润色/总结/翻译/大纲）
// 编辑器选中文本经父组件转发（setSelection）后，可针对选区单独调用；结果可「插入为块」或复制
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
  <aside class="wx-aip">
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
        <p class="wx-aip-empty-line">· 上方快捷按钮可对整篇文档续写、润色、总结、翻译、生成大纲</p>
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
        placeholder="向问星 AI 提问，Enter 发送"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button class="wx-aip-send" :disabled="busy || !input.trim()" @click="send">发送</button>
    </div>
  </aside>
</template>

<style scoped>
.wx-aip {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--wx-border-soft);
  padding-left: 14px;
  min-height: 0;
}
.wx-aip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-aip-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}
.wx-aip-spark { color: var(--wx-color-primary-soft); }
.wx-aip-clear {
  font-size: 11px;
  color: var(--wx-text-muted);
  padding: 3px 9px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
}
.wx-aip-clear:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }

/* 选区横幅 */
.wx-aip-sel {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 35%, transparent);
  flex-shrink: 0;
}
.wx-aip-sel-row { display: flex; align-items: center; justify-content: space-between; }
.wx-aip-sel-tag { font-size: 11px; color: var(--wx-color-primary-soft); }
.wx-aip-sel-close { font-size: 10px; color: var(--wx-text-muted); width: 18px; height: 18px; border-radius: 50%; }
.wx-aip-sel-close:hover { color: var(--wx-text-primary); background: color-mix(in srgb, var(--wx-ink) 10%, transparent); }
.wx-aip-sel-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.wx-aip-sel-actions button {
  padding: 3px 10px;
  font-size: 11px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-aip-sel-actions button:hover:not(:disabled) { color: var(--wx-text-on-accent); border-color: var(--wx-border-glow); background: color-mix(in srgb, var(--wx-color-primary) 20%, transparent); }
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
  scrollbar-width: thin;
}
.wx-aip-empty { padding: 18px 6px; }
.wx-aip-empty-title { font-size: 12.5px; color: var(--wx-text-secondary); font-weight: 600; margin-bottom: 8px; }
.wx-aip-empty-line { font-size: 11.5px; color: var(--wx-text-muted); line-height: 1.9; }
.wx-aip-msg { display: flex; flex-direction: column; gap: 5px; }
.wx-aip-msg.user { align-items: flex-end; }
.wx-aip-msg.assistant { align-items: flex-start; }
.wx-aip-bubble {
  max-width: 100%;
  padding: 8px 11px;
  border-radius: var(--wx-radius-md);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.wx-aip-msg.user .wx-aip-bubble {
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
  color: var(--wx-text-primary);
}
.wx-aip-msg.assistant .wx-aip-bubble {
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-secondary);
}
.wx-aip-bubble.md { white-space: normal; }
.wx-aip-bubble.md :deep(p) { margin: 6px 0; }
.wx-aip-bubble.md :deep(h1), .wx-aip-bubble.md :deep(h2), .wx-aip-bubble.md :deep(h3) {
  font-size: 12.5px; font-weight: 600; color: var(--wx-text-primary); margin: 8px 0 4px;
}
.wx-aip-bubble.md :deep(ul), .wx-aip-bubble.md :deep(ol) { margin: 6px 0; padding-left: 18px; }
.wx-aip-bubble.md :deep(code) {
  font-family: var(--wx-font-mono); font-size: 11px;
  padding: 1px 4px; border-radius: 4px; background: color-mix(in srgb, var(--wx-bg-deep) 70%, transparent); color: var(--wx-text-secondary);
}
.wx-aip-bubble.md :deep(.wx-code-block) {
  margin: 8px 0; padding: 8px 10px; border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-bg-deep) 80%, transparent); overflow-x: auto; font-size: 11px;
}
.wx-aip-bubble.md :deep(.wx-mark) { background: color-mix(in srgb, var(--wx-color-amber) 30%, transparent); border-radius: 3px; padding: 0 2px; }
.wx-aip-bubble.typing { color: var(--wx-text-muted); font-size: 11.5px; }
.wx-aip-acts { display: flex; gap: 6px; }
.wx-aip-acts button {
  font-size: 10.5px;
  padding: 2px 9px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-aip-acts button:hover { color: var(--wx-color-primary-soft); border-color: var(--wx-border-glow); }

.wx-aip-err {
  flex-shrink: 0;
  margin-top: 6px;
  padding: 7px 10px;
  border-radius: var(--wx-radius-md);
  font-size: 11.5px;
  color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
}

/* 快捷动作 */
.wx-aip-quick {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 10px 0 8px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-aip-quick button {
  padding: 4px 12px;
  font-size: 11.5px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-aip-quick button:hover:not(:disabled) { color: var(--wx-text-on-accent); background: color-mix(in srgb, var(--wx-color-primary) 20%, transparent); border-color: var(--wx-border-glow); }
.wx-aip-quick button:disabled { opacity: 0.5; }

/* 输入区 */
.wx-aip-input { flex-shrink: 0; display: flex; align-items: flex-end; gap: 8px; }
.wx-aip-input textarea {
  flex: 1;
  min-width: 0;
  resize: none;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  padding: 8px 10px;
  color: var(--wx-text-primary);
  font-size: 12.5px;
  line-height: 1.6;
  outline: none;
}
.wx-aip-input textarea:focus { border-color: var(--wx-border-glow); }
.wx-aip-send {
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: var(--wx-radius-md);
  font-size: 12px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
}
.wx-aip-send:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
