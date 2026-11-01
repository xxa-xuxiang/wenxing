<script setup lang="ts">
// 我的试卷（v1.1 后端化）：左侧试卷列表（后端简要信息）+ 右侧卷面详情（按需拉取）
// 详情可执行：整卷答题（服务端判分 + 按知识点复盘）/ 导出 Markdown / 删除
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { usePaperStore } from '@/stores/paperStore'
import { useQuizStore } from '@/stores/quizStore'
import PaperComposePanel from '@/components/quiz/PaperComposePanel.vue'
import type { Paper } from '@/types'

const router = useRouter()
const paperStore = usePaperStore()
const quiz = useQuizStore()

const composeOpen = ref(false)
const activeId = ref<string>('')
/** 正在加载卷面正文 */
const detailLoading = ref(false)

const activePaper = computed<Paper | null>(() => paperStore.activePaper)

const typeText: Record<string, string> = { single: '单选', multiple: '多选', short: '简答', coding: '编程' }
const diffText: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }

const fmtTime = (t: number) => new Date(t).toLocaleString('zh-CN')

async function openPaper(id: string) {
  activeId.value = id
  detailLoading.value = true
  try {
    await paperStore.load(id)
  } finally {
    detailLoading.value = false
  }
}

function onCreated(paper: Paper) {
  void openPaper(paper.id)
}

async function startPaper() {
  const p = activePaper.value
  if (!p || p.questions.length === 0) return
  quiz.startWithPaper(p)
  void router.push('/quiz')
}

async function removePaper(id: string) {
  await paperStore.remove(id)
  const next = paperStore.papers[0]?.id ?? ''
  activeId.value = next
  if (next) await openPaper(next)
}

onMounted(async () => {
  await paperStore.loadList()
  const first = paperStore.papers[0]?.id ?? ''
  if (first) await openPaper(first)
})

// 组卷面板新建后自动切到新卷
watch(composeOpen, (open) => {
  if (!open && paperStore.papers.length && !activeId.value) {
    void openPaper(paperStore.papers[0].id)
  }
})

/** 导出 Markdown（卷面 + 参考答案，便于打印或转 PDF） */
function exportMarkdown() {
  const p = activePaper.value
  if (!p) return
  const lines: string[] = [
    `# ${p.title}`,
    '',
    `> 知识点范围：${p.scope.join('、')} ｜ 题量：${p.questions.length} 题 ｜ 每题分值：${p.scorePer} 分 ｜ 总分：${p.totalScore} 分`,
    `> 生成时间：${fmtTime(p.createdAt)}`,
    '',
    '---',
    ''
  ]
  p.questions.forEach((q, i) => {
    lines.push(`## ${i + 1}. ${q.title}（${typeText[q.type]} · ${diffText[q.difficulty]} · ${p.scorePer} 分）`)
    lines.push('')
    lines.push(q.body)
    lines.push('')
    if (q.options?.length) {
      q.options.forEach((o, oi) => lines.push(`${String.fromCharCode(65 + oi)}. ${o}`))
      lines.push('')
    }
    lines.push(`**参考答案**：${q.answer || '（略）'}`)
    if (q.knowledgePoints?.length) lines.push(`\n*知识点：${q.knowledgePoints.join('、')}*`)
    lines.push('')
    lines.push('---')
    lines.push('')
  })

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${p.title.replace(/[\\/:*?"<>|]/g, '_')}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="wx-papers">
    <div class="wx-papers-head">
      <div class="wx-papers-head-main">
        <h1 class="wx-papers-title">我的试卷</h1>
        <p class="wx-papers-sub">
          按知识点范围组卷 · 分值权重 · 整卷答题与复盘 · 导出 Markdown
        </p>
      </div>
      <div class="wx-papers-actions">
        <button class="wx-papers-btn wx-pressable" @click="router.push('/questions')">
          返回题库
        </button>
        <button
          class="wx-papers-btn wx-pressable"
          :class="{ active: composeOpen }"
          @click="composeOpen = !composeOpen"
        >
          ✦ 新建试卷
        </button>
      </div>
    </div>

    <div class="wx-papers-body">
      <!-- 左：试卷列表 -->
      <aside class="wx-papers-list">
        <div class="wx-papers-list-title">试卷（{{ paperStore.papers.length }}）</div>
        <div v-if="paperStore.papers.length === 0" class="wx-papers-list-empty">
          还没有试卷，点右上角「新建试卷」按知识点范围组一份
        </div>
        <ul v-else class="wx-papers-list-ul">
          <li
            v-for="p in paperStore.papers"
            :key="p.id"
            class="wx-papers-item"
            :class="{ active: p.id === activeId }"
            @click="openPaper(p.id)"
          >
            <div class="wx-papers-item-title">{{ p.title }}</div>
            <div class="wx-papers-item-meta">
              {{ p.questionCount }} 题 · {{ p.totalScore }} 分 · {{ fmtTime(p.createdAt) }}
            </div>
          </li>
        </ul>
      </aside>

      <!-- 右：卷面详情 -->
      <section v-if="activePaper" class="wx-papers-detail" :class="{ loading: detailLoading }">
        <div class="wx-papers-detail-head">
          <div>
            <h2 class="wx-papers-detail-title">{{ activePaper.title }}</h2>
            <p class="wx-papers-detail-meta">
              知识点范围：{{ activePaper.scope.join('、') }}
            </p>
          </div>
          <div class="wx-papers-detail-ops">
            <button class="wx-btn-gradient wx-pressable" @click="startPaper">开始整卷答题</button>
            <button class="wx-papers-btn wx-pressable" @click="exportMarkdown">导出 Markdown</button>
            <button class="wx-papers-btn wx-pressable danger" @click="removePaper(activePaper.id)">
              删除
            </button>
          </div>
        </div>

        <div class="wx-papers-stats">
          <div class="wx-papers-stat">
            <span class="val">{{ activePaper.questions.length }}</span>
            <span class="lab">题量</span>
          </div>
          <div class="wx-papers-stat">
            <span class="val">{{ activePaper.scorePer }}</span>
            <span class="lab">每题分值</span>
          </div>
          <div class="wx-papers-stat">
            <span class="val">{{ activePaper.totalScore }}</span>
            <span class="lab">卷面总分</span>
          </div>
          <div class="wx-papers-stat">
            <span class="val">{{ fmtTime(activePaper.createdAt) }}</span>
            <span class="lab">生成时间</span>
          </div>
        </div>

        <ol class="wx-papers-qlist">
          <li v-for="(q, i) in activePaper.questions" :key="q.id" class="wx-papers-q">
            <span class="wx-papers-q-no">{{ i + 1 }}</span>
            <div class="wx-papers-q-main">
              <div class="wx-papers-q-top">
                <span class="wx-papers-q-title">{{ q.title }}</span>
                <span class="wx-papers-q-badge">{{ typeText[q.type] }}</span>
                <span class="wx-papers-q-badge" :class="`d-${q.difficulty}`">{{ diffText[q.difficulty] }}</span>
                <span class="wx-papers-q-score">{{ activePaper.scorePer }} 分</span>
              </div>
              <div class="wx-papers-q-body">{{ q.body }}</div>
              <div v-if="q.knowledgePoints?.length" class="wx-papers-q-tags">
                <span v-for="k in q.knowledgePoints" :key="k" class="wx-papers-q-tag">{{ k }}</span>
              </div>
            </div>
          </li>
        </ol>
      </section>

      <section v-else class="wx-papers-empty">
        <div class="wx-papers-empty-mark">✧</div>
        <div class="wx-papers-empty-title">还没有试卷</div>
        <div class="wx-papers-empty-sub">点击右上角「新建试卷」，按知识点范围生成一份测评卷</div>
      </section>

      <!-- 右分栏：组卷面板 -->
      <PaperComposePanel v-if="composeOpen" @close="composeOpen = false" @created="onCreated" />
    </div>
  </div>
</template>

<style scoped>
.wx-papers {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wx-papers-head {
  padding: 18px 28px 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-papers-title {
  font-family: var(--wx-font-serif);
  font-size: 26px;
  font-weight: 600;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-papers-sub { margin-top: 4px; font-size: 12px; color: var(--wx-text-tertiary); }
.wx-papers-actions { display: flex; gap: 8px; padding-top: 4px; }
.wx-papers-btn {
  padding: 7px 16px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-papers-btn:hover { color: var(--wx-color-primary-soft); border-color: var(--wx-border-glow); }
.wx-papers-btn.active {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
}
.wx-papers-btn.danger:hover { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 45%, transparent); }

.wx-papers-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* 左列表 */
.wx-papers-list {
  width: 260px;
  flex-shrink: 0;
  padding: 20px 16px;
  border-right: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 22%, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}
.wx-papers-list-title { font-size: 14px; font-weight: 600; padding: 0 6px; }
.wx-papers-list-empty { font-size: 12px; color: var(--wx-text-muted); line-height: 1.7; padding: 0 6px; }
.wx-papers-list-ul {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 88px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wx-papers-item {
  padding: 10px 12px;
  border-radius: var(--wx-radius-md);
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-papers-item:hover { border-color: var(--wx-border-glow); }
.wx-papers-item.active {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-papers-item-title {
  font-size: 13px;
  color: var(--wx-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-papers-item-meta { margin-top: 4px; font-size: 11px; color: var(--wx-text-muted); }

/* 右详情 */
.wx-papers-detail {
  flex: 1;
  min-width: 0;
  padding: 20px 28px 110px;
  overflow-y: auto;
}
.wx-papers-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-papers-detail-title { font-family: var(--wx-font-serif); font-size: 18px; color: var(--wx-text-primary); }
.wx-papers-detail-meta { margin-top: 6px; font-size: 12px; color: var(--wx-text-tertiary); }
.wx-papers-detail-ops { display: flex; gap: 8px; flex-shrink: 0; }
.wx-papers-detail-ops .wx-btn-gradient { padding: 7px 16px; font-size: 12.5px; }

.wx-papers-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding: 16px 0;
}
.wx-papers-stat { display: flex; flex-direction: column; gap: 4px; }
.wx-papers-stat .val { font-family: var(--wx-font-mono); font-size: 15px; color: var(--wx-color-primary-soft); }
.wx-papers-stat .lab { font-size: 11px; color: var(--wx-text-muted); }

.wx-papers-qlist {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  counter-reset: none;
}
.wx-papers-q {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-papers-q-no {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  color: var(--wx-color-primary-soft);
  font-size: 12px;
  font-family: var(--wx-font-mono);
}
.wx-papers-q-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.wx-papers-q-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wx-papers-q-title { font-size: 13.5px; font-weight: 600; color: var(--wx-text-primary); }
.wx-papers-q-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  color: var(--wx-text-tertiary);
}
.wx-papers-q-badge.d-easy { background: color-mix(in srgb, var(--wx-state-deep) 15%, transparent); color: var(--wx-state-deep); }
.wx-papers-q-badge.d-medium { background: color-mix(in srgb, var(--wx-color-amber) 15%, transparent); color: var(--wx-color-amber); }
.wx-papers-q-badge.d-hard { background: color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent); color: var(--wx-color-vermilion); }
.wx-papers-q-score { margin-left: auto; font-size: 11.5px; color: var(--wx-color-amber); font-family: var(--wx-font-mono); }
.wx-papers-q-body {
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--wx-text-tertiary);
  white-space: pre-wrap;
}
.wx-papers-q-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.wx-papers-q-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent);
  color: var(--wx-color-yanqing);
}

/* 空态 */
.wx-papers-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.wx-papers-empty-mark { font-size: 28px; color: var(--wx-color-primary); opacity: 0.8; }
.wx-papers-empty-title { font-size: 16px; font-family: var(--wx-font-serif); color: var(--wx-text-primary); }
.wx-papers-empty-sub { font-size: 12px; color: var(--wx-text-tertiary); }
</style>
