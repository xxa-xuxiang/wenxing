<script setup lang="ts">
// 右侧文档区：未选/选中无文档/已有文档三态 + 反馈完善（调 AI 修订并存档）+ 知识点导航
// 验收标准 = 看完：读完文档即深度掌握，不再有答题步骤
import { ref, computed } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import NextTaskPicker from '@/components/learn/NextTaskPicker.vue'

const learnStore = useLearnStore()
const feedbackText = ref('')
const showNextPicker = ref(false)

const revising = computed(
  () => !!learnStore.activeTaskId && learnStore.revisingDocId === learnStore.activeTaskId
)

// 当前任务在 outline 中的位置 → 推导上/下一知识点
const currentIndex = computed(() =>
  learnStore.outline.findIndex((t) => t.id === learnStore.activeTaskId)
)
const prevTask = computed(() =>
  currentIndex.value > 0 ? learnStore.outline[currentIndex.value - 1] : null
)
const nextTask = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < learnStore.outline.length - 1
    ? learnStore.outline[currentIndex.value + 1]
    : null
)

// 「定制下一个任务」入口：当前任务已深度掌握，或大纲已学到末尾
const showCustomizeNext = computed(() => {
  const t = learnStore.activeTask
  if (!t) return false
  return t.status === 'deep' || !nextTask.value
})

function goPrev() {
  if (prevTask.value) learnStore.setActiveTask(prevTask.value.id)
}
function goNext() {
  if (nextTask.value) learnStore.setActiveTask(nextTask.value.id)
}

// 验收 = 看完：显式标记当前任务为已读完（生成文档不再自动置为已掌握）
function markDone() {
  if (learnStore.activeTaskId) learnStore.markTaskDone(learnStore.activeTaskId)
}

async function onRevise() {
  if (!learnStore.activeTaskId || !feedbackText.value.trim()) return
  await learnStore.requestRevise(learnStore.activeTaskId, feedbackText.value)
  feedbackText.value = ''
}

// 极简 Markdown 渲染（v0.1 文档用到的语法 + 教材所需：图片/表格/有序列表/深层标题/外链）
function renderMarkdown(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = esc(src).split('\n')
  let html = ''
  let inCode = false
  // 列表容器：null | 'ul' | 'ol'
  let listTag: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (listTag) { html += `</${listTag}>`; listTag = null }
  }
  const openList = (tag: 'ul' | 'ol') => {
    if (listTag === tag) return
    closeList()
    html += `<${tag}>`
    listTag = tag
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {
      if (inCode) { html += '</code></pre>'; inCode = false }
      else { closeList(); html += '<pre><code>'; inCode = true }
      continue
    }
    if (inCode) { html += line + '\n'; continue }
    // 表格：当前行以 | 开头且下一行为分隔行
    if (line.trim().startsWith('|') && isTableDivider(lines[i + 1])) {
      closeList()
      const head = splitRow(line)
      html += '<table><thead><tr>' + head.map((c) => `<th>${inlineMd(c)}</th>`).join('') + '</tr></thead><tbody>'
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        html += '<tr>' + splitRow(lines[i]).map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>'
        i++
      }
      html += '</tbody></table>'
      i--
      continue
    }
    if (line.startsWith('###### ')) { closeList(); html += `<h6>${line.slice(7)}</h6>`; continue }
    if (line.startsWith('##### ')) { closeList(); html += `<h5>${line.slice(6)}</h5>`; continue }
    if (line.startsWith('#### ')) { closeList(); html += `<h4>${line.slice(5)}</h4>`; continue }
    if (line.startsWith('### ')) { closeList(); html += `<h3>${line.slice(4)}</h3>`; continue }
    if (line.startsWith('## ')) { closeList(); html += `<h2>${line.slice(3)}</h2>`; continue }
    if (line.startsWith('# ')) { closeList(); html += `<h1>${line.slice(2)}</h1>`; continue }
    if (line.startsWith('> ')) { closeList(); html += `<blockquote>${line.slice(2)}</blockquote>`; continue }
    if (/^\s*[-*] /.test(line)) { openList('ul'); html += `<li>${inlineMd(line.replace(/^\s*[-*] /, ''))}</li>`; continue }
    if (/^\s*\d+\. /.test(line)) { openList('ol'); html += `<li>${inlineMd(line.replace(/^\s*\d+\. /, ''))}</li>`; continue }
    if (line.trim() === '') { closeList(); html += ''; continue }
    closeList()
    html += `<p>${inlineMd(line)}</p>`
  }
  closeList()
  if (inCode) html += '</code></pre>'
  return html

  /** 是否为表格分隔行（| --- | :--: |） */
  function isTableDivider(line: string | undefined): boolean {
    return Boolean(line) && /^\s*\|[\s:|-]+\|\s*$/.test(line as string) && (line as string).includes('-')
  }

  /** 拆分表格行为单元格 */
  function splitRow(line: string): string[] {
    return line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
  }

  /** 还原被 esc 转义的 URL 尖括号与 & */
  const unescUrl = (u: string) =>
    u.replace(/^&lt;/, '').replace(/&gt;$/, '').replace(/&amp;/g, '&').trim()

  function inlineMd(s: string): string {
    return s
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, raw: string) =>
        `<img src="${unescUrl(raw)}" alt="${alt}" loading="lazy">`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_m, text: string, raw: string) =>
        `<a href="${unescUrl(raw)}" target="_blank" rel="noreferrer">${text}</a>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  }
}
</script>

<template>
  <section class="wx-doc">
    <!-- 文档生成/完善失败提示（可关闭） -->
    <div v-if="learnStore.docError" class="wx-doc-error">
      <span class="wx-doc-error-mark">⚠</span>
      <span class="wx-doc-error-text">{{ learnStore.docError }}</span>
      <button class="wx-doc-error-close" @click="learnStore.clearDocError()">×</button>
    </div>

    <!-- 未选任务 -->
    <div v-if="!learnStore.activeTask" class="wx-doc-empty">
      <div class="wx-doc-empty-mark">✧</div>
      <div class="wx-doc-empty-title">暂无文档</div>
      <div class="wx-doc-empty-sub">从左侧目录树打开一个学习任务</div>
    </div>

    <!-- 选中但无文档 -->
    <div v-else-if="!learnStore.activeDoc" class="wx-doc-generate">
      <div class="wx-doc-generate-head">
        <span class="wx-dot" :class="`wx-dot-${learnStore.activeTask.status}`"></span>
        <span class="wx-doc-generate-title">{{ learnStore.activeTask.title }}</span>
      </div>
      <div class="wx-doc-generate-body">
        <div class="wx-doc-generate-icon">✦</div>
        <div class="wx-doc-generate-text">尚未生成学习文档</div>
        <div class="wx-doc-generate-sub">点击下方按钮，问星 AI（DeepSeek）将基于你的方向定制学习文档</div>
        <button
          class="wx-btn-gradient wx-pressable"
          :disabled="learnStore.generatingDocId === learnStore.activeTaskId"
          @click="learnStore.requestDoc()"
        >
          <span v-if="learnStore.generatingDocId !== learnStore.activeTaskId">✦ 生成学习文档</span>
          <span v-else class="wx-loading-text">生成中…</span>
        </button>
      </div>
    </div>

    <!-- 已有文档 -->
    <article v-else class="wx-doc-content">
      <header class="wx-doc-head">
        <span class="wx-dot" :class="`wx-dot-${learnStore.activeTask.status}`"></span>
        <h1 class="wx-doc-title">{{ learnStore.activeTask.title }}</h1>
        <span v-if="learnStore.activeDoc?.updatedAt" class="wx-doc-updated" title="最近完善时间">
          已完善
        </span>
        <button
          v-if="learnStore.activeTask.status !== 'deep'"
          class="wx-doc-done-btn wx-pressable"
          title="读完即完成验收，标记为深度掌握"
          @click="markDone"
        >✓ 标记已读完</button>
        <span v-else class="wx-doc-done-flag">已读完 · 深度掌握</span>
      </header>
      <div class="wx-doc-md" v-html="renderMarkdown(learnStore.activeDoc.content)"></div>

      <!-- 知识点导航（验收 = 看完，无答题步骤） -->
      <div class="wx-doc-nav">
        <button class="wx-nav-btn wx-pressable" :disabled="!prevTask" @click="goPrev">
          <span class="wx-nav-arrow">←</span>
          <span class="wx-nav-label">上一知识点</span>
          <span class="wx-nav-target" v-if="prevTask">{{ prevTask.title }}</span>
        </button>
        <button class="wx-nav-btn wx-pressable" :disabled="!nextTask" @click="goNext">
          <span class="wx-nav-arrow">→</span>
          <span class="wx-nav-label">下一知识点</span>
          <span class="wx-nav-target" v-if="nextTask">{{ nextTask.title }}</span>
        </button>
      </div>

      <!-- 定制下一个任务：深度掌握后 / 大纲学完后，从知识点树中追加 -->
      <div v-if="showCustomizeNext" class="wx-doc-next">
        <button class="wx-next-btn wx-pressable" @click="showNextPicker = true">
          ✦ 定制下一个任务
        </button>
        <span class="wx-next-hint">从知识星图中挑选下一个知识点，加入学习大纲</span>
      </div>
      <NextTaskPicker v-if="showNextPicker" @close="showNextPicker = false" />

      <!-- 反馈完善：调 AI 修订文档（有困惑或建议都可写） -->
      <div class="wx-doc-feedback">
        <div class="wx-doc-feedback-title">读完后有困惑或建议？告诉问星 AI</div>
        <div class="wx-doc-feedback-sub">无论是发现错误、看不懂某段、还是希望补充场景示例，都可写下来，问星 AI 会即时完善这篇文档。</div>
        <textarea
          v-model="feedbackText"
          rows="2"
          placeholder="例如：第二节的代码示例没看懂，能不能多解释一下 / 想补充一个实际应用场景 / 这里似乎有误…"
        ></textarea>
        <div class="wx-doc-feedback-foot">
          <button
            class="wx-btn-gradient wx-pressable"
            :disabled="revising || !feedbackText.trim()"
            @click="onRevise"
          >
            <span v-if="!revising">✦ 完善 docs/{{ learnStore.selectedDomain?.name }} 文档</span>
            <span v-else class="wx-loading-text">完善中…</span>
          </button>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.wx-doc {
  height: 100%;
  overflow-y: auto;
  padding: 32px 40px 96px;
}
.wx-doc-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 10px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
  font-size: 12.5px;
  color: var(--wx-text-primary);
}
.wx-doc-error-mark { color: var(--wx-color-vermilion); }
.wx-doc-error-text { flex: 1; min-width: 0; }
.wx-doc-error-close {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: var(--wx-text-tertiary);
  font-size: 14px;
}
.wx-doc-error-close:hover { color: var(--wx-color-vermilion); background: color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent); }
.wx-doc-empty,
.wx-doc-generate-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  gap: 12px;
}
.wx-doc-empty-mark,
.wx-doc-generate-icon {
  font-size: 48px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 14px var(--wx-color-primary));
  animation: wx-breathe 4s var(--wx-ease-in-out-soft) infinite alternate;
}
.wx-doc-empty-title,
.wx-doc-generate-text {
  font-size: 20px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
}
.wx-doc-empty-sub,
.wx-doc-generate-sub {
  font-size: 13px;
  color: var(--wx-text-tertiary);
}

.wx-doc-generate-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  justify-content: center;
}
.wx-doc-generate-title {
  font-size: 14px;
  color: var(--wx-text-secondary);
}

.wx-doc-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-doc-title {
  flex: 1;
  font-size: 24px;
  font-family: var(--wx-font-serif);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.wx-doc-updated {
  font-size: 11px;
  color: var(--wx-color-yanqing);
  padding: 2px 10px;
  border: 1px solid color-mix(in srgb, var(--wx-color-yanqing) 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-color-yanqing) 8%, transparent);
}
.wx-doc-done-btn {
  flex-shrink: 0;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  white-space: nowrap;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-doc-done-btn:hover {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 24%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
}
.wx-doc-done-flag {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--wx-state-deep);
  padding: 2px 10px;
  border: 1px solid color-mix(in srgb, var(--wx-state-deep) 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-state-deep) 8%, transparent);
  white-space: nowrap;
}

.wx-doc-md {
  font-size: 14.5px;
  line-height: 1.75;
  color: var(--wx-text-secondary);
}
.wx-doc-md :deep(h1),
.wx-doc-md :deep(h2),
.wx-doc-md :deep(h3) {
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
  margin: 22px 0 12px;
  letter-spacing: 0.03em;
}
.wx-doc-md :deep(h1) { font-size: 22px; }
.wx-doc-md :deep(h2) { font-size: 18px; }
.wx-doc-md :deep(h3) { font-size: 15px; color: var(--wx-color-primary-soft); }
.wx-doc-md :deep(h4),
.wx-doc-md :deep(h5),
.wx-doc-md :deep(h6) {
  color: var(--wx-text-primary);
  margin: 16px 0 8px;
  font-size: 14px;
  letter-spacing: 0.02em;
}
.wx-doc-md :deep(h5) { font-size: 13.5px; color: var(--wx-color-primary-soft); }
.wx-doc-md :deep(h6) { font-size: 13px; color: var(--wx-text-tertiary); }
.wx-doc-md :deep(p) { margin: 10px 0; }
.wx-doc-md :deep(ul),
.wx-doc-md :deep(ol) { padding-left: 22px; margin: 10px 0; }
.wx-doc-md :deep(ol) { list-style: decimal; }
.wx-doc-md :deep(li) { margin: 4px 0; }
.wx-doc-md :deep(strong) { color: var(--wx-text-primary); }
.wx-doc-md :deep(code) {
  font-family: var(--wx-font-mono);
  font-size: 13px;
  padding: 2px 6px;
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border-radius: 4px;
  color: var(--wx-color-primary-soft);
}
.wx-doc-md :deep(pre) {
  margin: 14px 0;
  padding: 14px 18px;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  overflow-x: auto;
}
.wx-doc-md :deep(pre code) {
  background: transparent;
  padding: 0;
  color: var(--wx-text-primary);
}
.wx-doc-md :deep(blockquote) {
  margin: 14px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  border-radius: 0 8px 8px 0;
  color: var(--wx-text-tertiary);
  font-style: italic;
}
.wx-doc-md :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 14px auto;
  border-radius: var(--wx-radius-sm);
  border: 1px solid var(--wx-border-soft);
}
.wx-doc-md :deep(table) {
  width: 100%;
  margin: 14px 0;
  border-collapse: collapse;
  font-size: 13px;
}
.wx-doc-md :deep(th),
.wx-doc-md :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--wx-border-soft);
  text-align: left;
  vertical-align: top;
}
.wx-doc-md :deep(th) {
  color: var(--wx-text-primary);
  font-weight: 600;
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-doc-md :deep(tbody tr:nth-child(even)) {
  background: color-mix(in srgb, var(--wx-ink) 2%, transparent);
}
.wx-doc-md :deep(a) {
  color: var(--wx-color-primary-soft);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.wx-doc-md :deep(a:hover) { color: var(--wx-color-primary); }

/* 反馈完善 */
.wx-doc-feedback {
  margin-top: 28px;
  padding: 16px;
  border-radius: var(--wx-glass-radius);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-doc-feedback-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-secondary);
  margin-bottom: 10px;
}
.wx-doc-feedback textarea {
  width: 100%;
  resize: vertical;
  min-height: 52px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-primary);
  font-size: 13px;
  font-family: var(--wx-font-sans);
  outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-doc-feedback textarea:focus { border-color: var(--wx-border-glow); }
.wx-doc-feedback-foot {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

/* 知识点导航 */
.wx-doc-nav {
  margin-top: 28px;
  padding: 16px;
  display: flex;
  align-items: stretch;
  gap: 12px;
  border-radius: var(--wx-glass-radius);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-nav-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-secondary);
  font-size: 12px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-nav-btn:hover:not(:disabled) {
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wx-nav-arrow {
  font-size: 16px;
  color: var(--wx-color-primary-soft);
}
.wx-nav-label {
  font-size: 12px;
  color: var(--wx-text-tertiary);
}
.wx-nav-target {
  font-size: 13px;
  color: var(--wx-text-primary);
  font-weight: 600;
}

/* 定制下一个任务 */
.wx-doc-next {
  margin-top: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: var(--wx-glass-radius);
  background: color-mix(in srgb, var(--wx-state-deep) 5%, transparent);
  border: 1px dashed color-mix(in srgb, var(--wx-color-primary) 35%, transparent);
}
.wx-next-btn {
  padding: 8px 18px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
  white-space: nowrap;
}
.wx-next-btn:hover {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
}
.wx-next-hint {
  font-size: 11px;
  color: var(--wx-text-muted);
}

/* 反馈副标题 */
.wx-doc-feedback-sub {
  font-size: 12px;
  color: var(--wx-text-tertiary);
  line-height: 1.55;
  margin-bottom: 12px;
}
</style>
