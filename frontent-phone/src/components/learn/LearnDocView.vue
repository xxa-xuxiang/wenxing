<script setup lang="ts">
// 文档阅读区（移动端单栏）：未选/选中无文档/已有文档三态 + 反馈完善 + 知识点导航 + 定制下一任务
// 〔自桌面端 components/learn/DocView.vue 移植，Markdown 走共享渲染器 @/utils/markdown〕
// 验收标准 = 看完：读完文档即深度掌握；文档生成/完善为 AI 写操作，先 showDialog 确认
import { ref, computed } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useLearnStore } from '@/stores/learnStore'
import NextTaskPicker from '@/components/learn/NextTaskPicker.vue'
import { renderMarkdown } from '@/utils/markdown'

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

// 验收 = 看完：显式标记当前任务为已读完
function markDone() {
  if (learnStore.activeTaskId) learnStore.markTaskDone(learnStore.activeTaskId)
  showToast('已标记为深度掌握')
}

/** 生成学习文档（AI 写操作：先确认再请求） */
async function onGenerate() {
  if (!learnStore.activeTaskId) return
  try {
    await showConfirmDialog({
      title: '生成学习文档',
      message: `将调用 AI 为「${learnStore.activeTask?.title ?? ''}」定制学习文档，是否继续？`
    })
  } catch {
    return
  }
  await learnStore.requestDoc()
}

/** 反馈完善（AI 写操作：先确认再请求） */
async function onRevise() {
  if (!learnStore.activeTaskId || !feedbackText.value.trim()) return
  const feedback = feedbackText.value.trim()
  try {
    await showConfirmDialog({
      title: '完善文档',
      message: '将把你的反馈交给 AI 修订当前文档，是否继续？'
    })
  } catch {
    return
  }
  await learnStore.requestRevise(learnStore.activeTaskId, feedback)
  feedbackText.value = ''
}

</script>

<template>
  <section class="ldoc">
    <!-- 文档生成/完善失败提示（可关闭） -->
    <div v-if="learnStore.docError" class="ldoc-error">
      <span class="ldoc-error-mark">⚠</span>
      <span class="ldoc-error-text">{{ learnStore.docError }}</span>
      <button class="ldoc-error-close" @click="learnStore.clearDocError()">×</button>
    </div>

    <!-- 未选任务 -->
    <div v-if="!learnStore.activeTask" class="ldoc-empty">
      <div class="ldoc-empty-mark">✧</div>
      <div class="ldoc-empty-title">暂无文档</div>
      <div class="ldoc-empty-sub">从目录树或今日任务中打开一个学习任务</div>
    </div>

    <!-- 选中但无文档 -->
    <div v-else-if="!learnStore.activeDoc" class="ldoc-generate">
      <div class="ldoc-generate-head">
        <span class="ldoc-dot" :class="`ldoc-dot-${learnStore.activeTask.status}`"></span>
        <span class="ldoc-generate-title">{{ learnStore.activeTask.title }}</span>
      </div>
      <div class="ldoc-generate-body">
        <div class="ldoc-generate-icon">✦</div>
        <div class="ldoc-generate-text">尚未生成学习文档</div>
        <div class="ldoc-generate-sub">点击下方按钮，问星 AI 将基于你的方向定制学习文档</div>
        <button
          class="ldoc-btn-primary"
          :disabled="learnStore.generatingDocId === learnStore.activeTaskId"
          @click="onGenerate"
        >
          {{ learnStore.generatingDocId !== learnStore.activeTaskId ? '✦ 生成学习文档' : '生成中…' }}
        </button>
      </div>
    </div>

    <!-- 已有文档 -->
    <article v-else class="ldoc-content">
      <header class="ldoc-head">
        <span class="ldoc-dot" :class="`ldoc-dot-${learnStore.activeTask.status}`"></span>
        <h1 class="ldoc-title">{{ learnStore.activeTask.title }}</h1>
        <span v-if="learnStore.activeDoc?.updatedAt" class="ldoc-updated">已完善</span>
        <button
          v-if="learnStore.activeTask.status !== 'deep'"
          class="ldoc-done-btn"
          @click="markDone"
        >✓ 读完</button>
        <span v-else class="ldoc-done-flag">已读完</span>
      </header>
      <div class="ldoc-md" v-html="renderMarkdown(learnStore.activeDoc.content)"></div>

      <!-- 知识点导航 -->
      <div class="ldoc-nav">
        <button class="ldoc-nav-btn" :disabled="!prevTask" @click="goPrev">
          <span class="ldoc-nav-arrow">←</span>
          <span class="ldoc-nav-label">上一知识点</span>
          <span class="ldoc-nav-target" v-if="prevTask">{{ prevTask.title }}</span>
        </button>
        <button class="ldoc-nav-btn" :disabled="!nextTask" @click="goNext">
          <span class="ldoc-nav-arrow">→</span>
          <span class="ldoc-nav-label">下一知识点</span>
          <span class="ldoc-nav-target" v-if="nextTask">{{ nextTask.title }}</span>
        </button>
      </div>

      <!-- 定制下一个任务：深度掌握后 / 大纲学完后，从知识点树中追加 -->
      <div v-if="showCustomizeNext" class="ldoc-next">
        <button class="ldoc-next-btn" @click="showNextPicker = true">✦ 定制下一个任务</button>
        <span class="ldoc-next-hint">从知识星图中挑选下一个知识点，加入学习大纲</span>
      </div>
      <NextTaskPicker v-if="showNextPicker" @close="showNextPicker = false" />

      <!-- 反馈完善：调 AI 修订文档 -->
      <div class="ldoc-feedback">
        <div class="ldoc-feedback-title">读完后有困惑或建议？告诉问星 AI</div>
        <div class="ldoc-feedback-sub">发现错误、看不懂某段、希望补充场景示例，都可写下来。</div>
        <textarea
          v-model="feedbackText"
          rows="2"
          placeholder="例如：第二节的示例没看懂，能不能多解释一下…"
        ></textarea>
        <div class="ldoc-feedback-foot">
          <button
            class="ldoc-btn-primary"
            :disabled="revising || !feedbackText.trim()"
            @click="onRevise"
          >
            {{ revising ? '完善中…' : '✦ 完善本文档' }}
          </button>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.ldoc {
  min-height: 200px;
  padding: 12px;
}
.ldoc-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.35);
  font-size: 12px;
  color: #b42318;
}
.ldoc-error-mark {
  color: #f87171;
}
.ldoc-error-text {
  flex: 1;
  min-width: 0;
}
.ldoc-error-close {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #969799;
  font-size: 14px;
}
.ldoc-empty,
.ldoc-generate-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 36px 16px;
  text-align: center;
}
.ldoc-empty-mark,
.ldoc-generate-icon {
  font-size: 40px;
  color: #4f6ef2;
}
.ldoc-empty-title,
.ldoc-generate-text {
  font-size: 17px;
  font-weight: 600;
  color: #323233;
}
.ldoc-empty-sub,
.ldoc-generate-sub {
  font-size: 12.5px;
  color: #969799;
}
.ldoc-generate-head {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  margin-bottom: 6px;
}
.ldoc-generate-title {
  font-size: 13.5px;
  color: #646566;
}
.ldoc-btn-primary {
  margin-top: 6px;
  padding: 9px 26px;
  border: none;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
}
.ldoc-btn-primary:disabled {
  opacity: 0.5;
}
.ldoc-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c8c9cc;
}
.ldoc-dot-deep {
  background: #22c55e;
}
.ldoc-dot-light {
  background: #fbbf24;
}
.ldoc-dot-unknown {
  background: #c8c9cc;
}
.ldoc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebedf0;
}
.ldoc-title {
  flex: 1;
  min-width: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2329;
  line-height: 1.4;
}
.ldoc-updated {
  flex-shrink: 0;
  font-size: 10px;
  color: #0d9488;
  padding: 2px 8px;
  border: 1px solid rgba(13, 148, 136, 0.35);
  border-radius: 999px;
  background: rgba(13, 148, 136, 0.08);
  white-space: nowrap;
}
.ldoc-done-btn {
  flex-shrink: 0;
  padding: 5px 13px;
  font-size: 12px;
  font-weight: 600;
  color: #4f6ef2;
  border: 1px solid rgba(79, 110, 242, 0.4);
  border-radius: 999px;
  background: rgba(79, 110, 242, 0.08);
}
.ldoc-done-flag {
  flex-shrink: 0;
  font-size: 11px;
  color: #16a34a;
  padding: 2px 10px;
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.08);
  white-space: nowrap;
}
.ldoc-md {
  font-size: 14.5px;
  line-height: 1.75;
  color: #43474d;
  word-break: break-word;
}
.ldoc-md :deep(h1),
.ldoc-md :deep(h2),
.ldoc-md :deep(h3) {
  color: #1f2329;
  margin: 20px 0 10px;
  line-height: 1.4;
}
.ldoc-md :deep(h1) {
  font-size: 19px;
}
.ldoc-md :deep(h2) {
  font-size: 17px;
}
.ldoc-md :deep(h3) {
  font-size: 15px;
  color: #4f6ef2;
}
.ldoc-md :deep(h4),
.ldoc-md :deep(h5),
.ldoc-md :deep(h6) {
  margin: 14px 0 6px;
  font-size: 14px;
  color: #1f2329;
}
.ldoc-md :deep(h5) {
  font-size: 13.5px;
  color: #4f6ef2;
}
.ldoc-md :deep(h6) {
  font-size: 13px;
  color: #646566;
}
.ldoc-md :deep(p) {
  margin: 10px 0;
}
.ldoc-md :deep(ul),
.ldoc-md :deep(ol) {
  padding-left: 22px;
  margin: 10px 0;
}
.ldoc-md :deep(ol) {
  list-style: decimal;
}
.ldoc-md :deep(li) {
  margin: 4px 0;
}
.ldoc-md :deep(hr.wx-md-hr) {
  margin: 16px 0;
  border: none;
  border-top: 1px solid #ebedf0;
}
.ldoc-md :deep(a) {
  color: #4f6ef2;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}
.ldoc-md :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 12px auto;
  border-radius: 8px;
  border: 1px solid #ebedf0;
}
.ldoc-md :deep(.wx-md-table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 12px 0;
  border-collapse: collapse;
  font-size: 12.5px;
}
.ldoc-md :deep(.wx-md-table th),
.ldoc-md :deep(.wx-md-table td) {
  padding: 6px 9px;
  border: 1px solid #ebedf0;
  text-align: left;
  vertical-align: top;
  white-space: normal;
}
.ldoc-md :deep(.wx-md-table th) {
  background: rgba(79, 110, 242, 0.06);
  color: #1f2329;
  font-weight: 600;
}
.ldoc-md :deep(.wx-md-table tbody tr:nth-child(even)) {
  background: #fafafa;
}
.ldoc-md :deep(.wx-code-block) {
  display: block;
  margin: 14px 0;
  padding: 12px 14px;
  overflow-x: auto;
  background: #f5f6f8;
  border: 1px solid #ebedf0;
  border-radius: 8px;
}
.ldoc-md :deep(.wx-code-block code) {
  background: transparent;
  padding: 0;
  color: #1f2329;
}
.ldoc-md :deep(mark.wx-mark) {
  background: rgba(251, 191, 36, 0.3);
  color: inherit;
  padding: 0 2px;
}
.ldoc-md :deep(strong) {
  color: #1f2329;
}
.ldoc-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  padding: 2px 6px;
  background: rgba(79, 110, 242, 0.1);
  border-radius: 4px;
  color: #4f6ef2;
}
.ldoc-md :deep(pre) {
  margin: 14px 0;
  padding: 12px 14px;
  background: #f5f6f8;
  border: 1px solid #ebedf0;
  border-radius: 8px;
  overflow-x: auto;
}
.ldoc-md :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #1f2329;
}
.ldoc-md :deep(blockquote) {
  margin: 14px 0;
  padding: 8px 12px;
  border-left: 3px solid #4f6ef2;
  background: rgba(79, 110, 242, 0.06);
  border-radius: 0 8px 8px 0;
  color: #646566;
  font-style: italic;
}
.ldoc-nav {
  margin-top: 22px;
  padding: 12px;
  display: flex;
  align-items: stretch;
  gap: 10px;
  border-radius: 10px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
}
.ldoc-nav-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 9px 12px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #ebedf0;
  font-size: 12px;
  color: #646566;
  min-width: 0;
}
.ldoc-nav-btn:disabled {
  opacity: 0.4;
}
.ldoc-nav-arrow {
  font-size: 15px;
  color: #4f6ef2;
}
.ldoc-nav-label {
  font-size: 11px;
  color: #969799;
}
.ldoc-nav-target {
  font-size: 12.5px;
  color: #1f2329;
  font-weight: 600;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ldoc-next {
  margin-top: 12px;
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.05);
  border: 1px dashed rgba(79, 110, 242, 0.35);
}
.ldoc-next-btn {
  align-self: flex-start;
  padding: 7px 16px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  color: #4f6ef2;
  border: 1px solid rgba(79, 110, 242, 0.4);
  background: rgba(79, 110, 242, 0.1);
}
.ldoc-next-hint {
  font-size: 10.5px;
  color: #969799;
}

.ldoc-feedback {
  margin-top: 22px;
  padding: 14px;
  border-radius: 10px;
  background: rgba(79, 110, 242, 0.05);
  border: 1px solid #ebedf0;
}
.ldoc-feedback-title {
  font-size: 13px;
  font-weight: 600;
  color: #43474d;
  margin-bottom: 5px;
}
.ldoc-feedback-sub {
  font-size: 11px;
  line-height: 1.55;
  color: #969799;
  margin-bottom: 9px;
}
.ldoc-feedback textarea {
  width: 100%;
  resize: vertical;
  min-height: 52px;
  padding: 9px 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 8px;
  color: #323233;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.ldoc-feedback textarea:focus {
  border-color: #4f6ef2;
}
.ldoc-feedback-foot {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.ldoc-feedback-foot .ldoc-btn-primary {
  margin-top: 0;
}
</style>
