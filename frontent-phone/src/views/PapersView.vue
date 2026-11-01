<!-- 我的试卷 — 全屏二级页：试卷列表（van-list）+ 组卷弹层 + 卷面详情（整卷答题 / 导出 Markdown / 删除） -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showDialog, showToast } from 'vant'
import { usePaperStore } from '@/stores/paperStore'
import { useQuizStore } from '@/stores/quizStore'
import PaperComposePanel from '@/components/quiz/PaperComposePanel.vue'
import type { Paper } from '@/types/quiz'

const router = useRouter()
const paperStore = usePaperStore()
const quiz = useQuizStore()

const typeText: Record<string, string> = { single: '单选', multiple: '多选', short: '简答', coding: '编程' }
const diffText: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }

const fmtTime = (t: number) => new Date(t).toLocaleString('zh-CN')

// ===== 视图模式：列表 / 详情（默认列表，点列表项进入详情） =====
const mode = ref<'list' | 'detail'>('list')
const activeId = ref<string>('')
const activePaper = computed<Paper | null>(() => paperStore.activePaper)
const detailLoading = computed(() => paperStore.loading)

// ===== 列表：van-list 本地增量（后端一次返回全部简要信息，分页仅裁剪展示） =====
const PAGE = 10
const shownCount = ref(0)
const listLoading = ref(false)
const listError = ref(false)
const finished = ref(false)
const attempted = ref(false)

async function onLoad() {
  try {
    if (!attempted.value) {
      await paperStore.loadList()
      attempted.value = true
    }
    if (paperStore.error && paperStore.papers.length === 0) {
      listError.value = true
      attempted.value = false // 允许下拉重试
      return
    }
    shownCount.value = Math.min(paperStore.papers.length, shownCount.value + PAGE)
    finished.value = shownCount.value >= paperStore.papers.length
    listError.value = false
  } finally {
    listLoading.value = false
  }
}

const shownPapers = computed(() => paperStore.papers.slice(0, shownCount.value))

async function openPaper(id: string) {
  activeId.value = id
  const p = await paperStore.load(id)
  mode.value = 'detail'
  if (!p) showToast(paperStore.error || '卷面加载失败')
}

function onBack() {
  if (mode.value === 'detail' && activeId.value) {
    // 详情返回列表
    mode.value = 'list'
    activeId.value = ''
    return
  }
  if (window.history.state && typeof window.history.state.back === 'string') router.back()
  else router.replace('/questions')
}

// ===== 组卷 =====
const composeOpen = ref(false)
function onCreated(paper: Paper) {
  attempted.value = true
  finished.value = shownCount.value >= paperStore.papers.length
  if (shownCount.value < paperStore.papers.length) shownCount.value = Math.min(paperStore.papers.length, shownCount.value + PAGE)
  void openPaper(paper.id)
}

// ===== 整卷答题（确认后进答题） =====
async function startPaper() {
  const p = activePaper.value
  if (!p) return
  if (p.questions.length === 0) {
    showToast('该试卷暂无题目，请重新组卷')
    return
  }
  try {
    await showDialog({
      title: '整卷答题',
      message: `共 ${p.questions.length} 题，卷面总分 ${p.totalScore} 分，交卷后按分值加权判分。`,
      showCancelButton: true,
      confirmButtonText: '开始答题'
    })
  } catch {
    return // 用户取消
  }
  quiz.startWithPaper(p)
  void router.push('/quiz')
}

// ===== 删除（确认后调用） =====
async function removePaper(id: string) {
  try {
    await showDialog({
      title: '删除试卷',
      message: '删除后不可恢复，确定删除该试卷？',
      showCancelButton: true,
      confirmButtonText: '删除',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return // 用户取消
  }
  try {
    await paperStore.remove(id)
    showToast('已删除')
    activeId.value = ''
    mode.value = 'list'
    shownCount.value = Math.min(paperStore.papers.length, shownCount.value || PAGE)
    finished.value = shownCount.value >= paperStore.papers.length
  } catch (e) {
    showToast(e instanceof Error ? e.message : '删除失败')
  }
}

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
  <div class="pp">
    <van-nav-bar
      fixed
      placeholder
      safe-area-inset-top
      :title="mode === 'detail' && activePaper ? activePaper.title : '我的试卷'"
      left-arrow
      @click-left="onBack"
    >
      <template #right>
        <span class="pp-compose" @click="composeOpen = true">＋ 新建试卷</span>
      </template>
    </van-nav-bar>

    <!-- 试卷列表 -->
    <div v-if="mode === 'list'" class="pp-list">
      <van-list
        v-model:loading="listLoading"
        v-model:error="listError"
        :finished="finished"
        finished-text="没有更多试卷了"
        error-text="加载失败，点击重试"
        @load="onLoad"
      >
        <div
          v-for="p in shownPapers"
          :key="p.id"
          class="pp-item"
          @click="openPaper(p.id)"
        >
          <div class="pp-item-title">{{ p.title }}</div>
          <div class="pp-item-meta">
            {{ p.questionCount }} 题 · 总分 {{ p.totalScore }} · {{ fmtTime(p.createdAt) }}
          </div>
          <div v-if="p.scope.length" class="pp-item-scope">
            <span v-for="s in p.scope.slice(0, 3)" :key="s" class="pp-tag">{{ s }}</span>
            <span v-if="p.scope.length > 3" class="pp-tag more">…</span>
          </div>
          <van-icon name="arrow" class="pp-item-arrow" />
        </div>
      </van-list>
      <van-empty v-if="finished && shownPapers.length === 0" description="还没有试卷，点右上角「新建试卷」按知识点范围组一份" />
    </div>

    <!-- 卷面详情 -->
    <div v-else class="pp-detail">
      <van-loading v-if="detailLoading && !activePaper" class="pp-detail-loading" size="24" vertical>卷面加载中…</van-loading>
      <template v-else-if="activePaper">
        <div class="pp-stats">
          <div class="pp-stat"><span class="v">{{ activePaper.questions.length }}</span><span class="l">题量</span></div>
          <div class="pp-stat"><span class="v">{{ activePaper.scorePer }}</span><span class="l">每题分值</span></div>
          <div class="pp-stat"><span class="v">{{ activePaper.totalScore }}</span><span class="l">总分</span></div>
          <div class="pp-stat"><span class="v small">{{ fmtTime(activePaper.createdAt) }}</span><span class="l">生成时间</span></div>
        </div>
        <div v-if="activePaper.scope.length" class="pp-scope">
          <span v-for="s in activePaper.scope" :key="s" class="pp-tag">{{ s }}</span>
        </div>

        <div class="pp-ops">
          <van-button type="primary" round block :disabled="activePaper.questions.length === 0" @click="startPaper">开始整卷答题</van-button>
          <div class="pp-ops-row">
            <van-button plain round size="small" icon="description" @click="exportMarkdown">导出 Markdown</van-button>
            <van-button plain round size="small" icon="delete-o" type="danger" @click="removePaper(activePaper.id)">删除</van-button>
          </div>
        </div>

        <div class="pp-qlist">
          <div v-for="(q, i) in activePaper.questions" :key="q.id" class="pp-q">
            <div class="pp-q-head">
              <span class="pp-q-no">{{ i + 1 }}</span>
              <span class="pp-q-title">{{ q.title }}</span>
            </div>
            <div class="pp-q-badges">
              <span class="pp-badge t">{{ typeText[q.type] }}</span>
              <span class="pp-badge" :class="`d-${q.difficulty}`">{{ diffText[q.difficulty] }}</span>
              <span class="pp-q-score">{{ activePaper.scorePer }} 分</span>
            </div>
            <p class="pp-q-body">{{ q.body }}</p>
            <div v-if="q.options?.length" class="pp-q-options">
              <div v-for="(o, oi) in q.options" :key="oi" class="pp-q-opt">{{ String.fromCharCode(65 + oi) }}. {{ o }}</div>
            </div>
            <div v-if="q.knowledgePoints?.length" class="pp-tags">
              <span v-for="k in q.knowledgePoints" :key="k" class="pp-tag">{{ k }}</span>
            </div>
          </div>
        </div>
      </template>
      <van-empty v-else :description="paperStore.error || '卷面加载失败，请返回重试'" />
    </div>

    <PaperComposePanel v-model:show="composeOpen" @created="onCreated" />
  </div>
</template>

<style scoped>
.pp {
  min-height: 100vh;
  background: #f7f8fa;
  display: flex;
  flex-direction: column;
}
.pp-compose { font-size: 13px; color: #1989fa; }

/* ===== 列表 ===== */
.pp-list { flex: 1; padding: 10px 14px calc(16px + env(safe-area-inset-bottom)); }
.pp-item {
  position: relative;
  padding: 13px 34px 13px 14px;
  margin-bottom: 10px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pp-item-title { font-size: 15px; font-weight: 600; color: #323233; }
.pp-item-meta { font-size: 11.5px; color: #969799; }
.pp-item-scope { display: flex; flex-wrap: wrap; gap: 6px; }
.pp-item-arrow {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #c8c9cc;
}

/* ===== 详情 ===== */
.pp-detail { flex: 1; padding: 10px 14px calc(20px + env(safe-area-inset-bottom)); }
.pp-detail-loading { padding: 80px 0; display: flex; justify-content: center; }
.pp-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
}
.pp-stat { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.pp-stat .v { font-size: 15px; font-weight: 600; color: #1989fa; }
.pp-stat .v.small { font-size: 10.5px; }
.pp-stat .l { font-size: 10.5px; color: #969799; }
.pp-scope { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pp-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e8faf3;
  color: #0fa37f;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pp-tag.more { background: #f2f3f5; color: #969799; }

.pp-ops { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.pp-ops-row { display: flex; gap: 10px; justify-content: center; }

.pp-qlist { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.pp-q {
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pp-q-head { display: flex; gap: 8px; align-items: flex-start; }
.pp-q-no {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #eef3ff;
  color: #1989fa;
  font-size: 12px;
}
.pp-q-title { font-size: 14px; font-weight: 600; color: #323233; line-height: 1.45; }
.pp-q-badges { display: flex; align-items: center; gap: 8px; font-size: 10.5px; }
.pp-badge { padding: 2px 8px; border-radius: 999px; background: #eef3ff; color: #1989fa; }
.pp-badge.d-easy { background: rgba(74, 222, 128, 0.14); color: #16a34a; }
.pp-badge.d-medium { background: rgba(251, 191, 36, 0.16); color: #d97706; }
.pp-badge.d-hard { background: rgba(248, 113, 113, 0.14); color: #dc2626; }
.pp-q-score { margin-left: auto; font-size: 11px; color: #d97706; }
.pp-q-body { margin: 0; font-size: 12.5px; line-height: 1.65; color: #646566; white-space: pre-wrap; }
.pp-q-options { display: flex; flex-direction: column; gap: 3px; }
.pp-q-opt { font-size: 12px; color: #646566; line-height: 1.5; }
.pp-tags { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
