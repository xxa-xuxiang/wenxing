<script setup lang="ts">
// 答题模式 — 全屏页面（v0.9 由模态框改版）：凑题 loading / 答题进度 / 题目卡片 / 交卷成绩
// v1.1：交卷走服务端判分；成绩页逐题可展开「你的作答 vs 标准答案 + 解析 + 出处」，
//       并可请求 AI 深度分析（关键错题精讲 + 薄弱知识点 + 总评）
// 直开无题（刷新/直达）→ 回题库；完成后返回题库并清理 skill 参数
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuizStore } from '@/stores/quizStore'
import { useAuthStore } from '@/stores/authStore'
import { reportQuestion } from '@/services/questionService'

const quiz = useQuizStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

/** 已报错的题目 id（本地置灰，避免重复提交） */
const reported = ref<Set<string>>(new Set())
const reportTip = ref('')

/** 题目有误反馈：需登录且做过该题；累计 3 次后端自动下架并重新出题 */
async function report(id: string) {
  if (reported.value.has(id)) return
  // 未登录不发请求：后端已要求登录且需存在该题作答记录
  if (!auth.user) {
    reportTip.value = '登录后才能提交纠错'
    window.setTimeout(() => { reportTip.value = '' }, 4000)
    return
  }
  try {
    const r = await reportQuestion(id, '交卷复盘时标记：答案或解析可能有误')
    const next = new Set(reported.value)
    next.add(id)
    reported.value = next
    reportTip.value = r.retired ? '已收到反馈，该题已下架并将重新出题' : `已收到反馈（${r.feedbackCount}/3），累计到 3 次将下架重出`
    window.setTimeout(() => { reportTip.value = '' }, 4000)
  } catch (e) {
    // 403（未作答过该题）等错误直接展示后端 error 文案
    reportTip.value = e instanceof Error ? e.message : '反馈提交失败'
    window.setTimeout(() => { reportTip.value = '' }, 4000)
  }
}

/** 成绩页：展开查看解析的题目 id 集合 */
const expanded = ref<Set<string>>(new Set())
function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
/** 只显示错题 */
const onlyWrong = ref(false)

/** 结果页题目（可切换只看错题） */
const resultItems = computed(() => (onlyWrong.value ? quiz.wrongItems : quiz.judgedItems))

/** 第 index 题的 AI 错因（来自分析结果的 wrongItems，index 为错题序号，1 起） */
function diagnosisOf(questionId: string): string {
  const a = quiz.analysis
  if (!a) return ''
  const wrongList = quiz.wrongItems.map((w) => w.questionId)
  const wrongIndex = wrongList.indexOf(questionId) + 1
  if (wrongIndex <= 0) return ''
  return a.wrongItems.find((w) => Number(w.index) === wrongIndex)?.diagnosis ?? ''
}
/** 该题是否属于被精讲的 keyItems（按错题序号匹配） */
function deepDiveOf(questionId: string): string {
  const a = quiz.analysis
  if (!a) return ''
  const wrongIndex = quiz.wrongItems.map((w) => w.questionId).indexOf(questionId) + 1
  if (wrongIndex <= 0) return ''
  return a.keyItems.find((k) => Number(k.index) === wrongIndex)?.deepDive ?? ''
}

// 当前题的作答值
const currentAnswer = computed<string>({
  get() {
    const q = quiz.currentQuestion
    return q ? quiz.answers[q.id] || '' : ''
  },
  set(v: string) {
    const q = quiz.currentQuestion
    if (q) quiz.setAnswer(q.id, v)
  }
})

// 多选：以 toggle 维护字符串集合
function toggleOption(_opt: string, i: number) {
  const q = quiz.currentQuestion
  if (!q) return
  const cur = (quiz.answers[q.id] || '').split('').filter(Boolean)
  const letter = String.fromCharCode(65 + i)
  const exists = cur.includes(letter)
  const next = exists ? cur.filter((c) => c !== letter) : [...cur, letter].sort()
  quiz.setAnswer(q.id, next.join(''))
}

function isPicked(_opt: string, i: number): boolean {
  const q = quiz.currentQuestion
  if (!q) return false
  return (quiz.answers[q.id] || '').includes(String.fromCharCode(65 + i))
}

const difficultyLabel: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难'
}
const typeLabel: Record<string, string> = {
  single: '单选',
  multiple: '多选',
  short: '简答',
  coding: '编程'
}

/** 退出答题：清会话并返回来源页（整卷答题回「我的试卷」，其余回题库） */
function exitQuiz() {
  const isPaper = quiz.paperId !== null
  quiz.reset()
  if (isPaper) router.push('/papers')
  else if (route.query.skill) router.replace({ path: '/questions' })
  else router.push('/questions')
}

onMounted(() => {
  // 直达本页但会话为空 → 回题库
  if (!quiz.loading && quiz.total === 0 && !quiz.submitted) router.replace('/questions')
})
</script>

<template>
  <div class="wx-quiz-page">
    <!-- 顶栏 -->
    <header class="wx-quiz-head">
      <div class="wx-quiz-head-title">
        <span class="wx-quiz-mark">✦</span>
        <span>{{ quiz.paperId ? '整卷答题' : '答题模式' }} · {{ quiz.skillTitle || '题库练习' }}</span>
      </div>
      <button class="wx-quiz-close wx-pressable" @click="exitQuiz" title="退出答题">× 退出</button>
    </header>

    <!-- 凑题 loading -->
    <div v-if="quiz.loading" class="wx-quiz-loading">
      <div class="wx-quiz-orb">✦</div>
      <div class="wx-quiz-loading-text">正在凑齐 20 道题…</div>
      <div class="wx-quiz-loading-sub">seed 池 + 问星 AI（DeepSeek）混合出题</div>
    </div>

    <!-- 凑题失败 -->
    <div v-else-if="quiz.loadError" class="wx-quiz-loading">
      <div class="wx-quiz-orb wx-quiz-orb-error">⚠</div>
      <div class="wx-quiz-loading-text">凑题失败</div>
      <div class="wx-quiz-loading-sub">{{ quiz.loadError }}</div>
      <button class="wx-pressable wx-quiz-back-btn" @click="exitQuiz">返回题库</button>
    </div>

    <!-- 答题阶段 -->
    <div v-else-if="!quiz.submitted && quiz.total > 0" class="wx-quiz-body">
      <div class="wx-quiz-progress">
        <div class="wx-quiz-progress-text">
          第 {{ quiz.currentIndex + 1 }} / {{ quiz.total }} 题
          <span class="wx-quiz-progress-sep">·</span>
          已答 {{ quiz.answeredCount }} 题
        </div>
        <div class="wx-quiz-progress-bar">
          <div class="wx-quiz-progress-fill" :style="{ width: `${((quiz.currentIndex + 1) / quiz.total) * 100}%` }"></div>
        </div>
      </div>

      <div v-if="quiz.currentQuestion" class="wx-quiz-card">
        <div class="wx-quiz-card-meta">
          <span class="wx-quiz-diff" :class="`diff-${quiz.currentQuestion.difficulty}`">
            {{ difficultyLabel[quiz.currentQuestion.difficulty] }}
          </span>
          <span class="wx-quiz-type">{{ typeLabel[quiz.currentQuestion.type] }}</span>
          <span class="wx-quiz-source" :class="`src-${quiz.currentQuestion.source}`">
            {{ quiz.currentQuestion.source === 'ai' ? 'AI' : '人工' }}
          </span>
        </div>
        <h3 class="wx-quiz-card-title">{{ quiz.currentQuestion.title }}</h3>
        <p class="wx-quiz-card-body">{{ quiz.currentQuestion.body }}</p>

        <!-- 单选 -->
        <div v-if="quiz.currentQuestion.type === 'single'" class="wx-quiz-options">
          <button
            v-for="(opt, i) in quiz.currentQuestion.options"
            :key="i"
            class="wx-quiz-opt wx-pressable"
            :class="{ picked: isPicked(opt, i) }"
            @click="currentAnswer = String.fromCharCode(65 + i)"
          >
            <span class="wx-quiz-opt-letter">{{ String.fromCharCode(65 + i) }}</span>
            <span class="wx-quiz-opt-text">{{ opt }}</span>
          </button>
        </div>

        <!-- 多选 -->
        <div v-else-if="quiz.currentQuestion.type === 'multiple'" class="wx-quiz-options">
          <button
            v-for="(opt, i) in quiz.currentQuestion.options"
            :key="i"
            class="wx-quiz-opt wx-pressable"
            :class="{ picked: isPicked(opt, i) }"
            @click="toggleOption(opt, i)"
          >
            <span class="wx-quiz-opt-letter">{{ String.fromCharCode(65 + i) }}</span>
            <span class="wx-quiz-opt-text">{{ opt }}</span>
          </button>
        </div>

        <!-- 简答 / 编程 -->
        <div v-else class="wx-quiz-input-wrap">
          <textarea
            v-if="quiz.currentQuestion.type === 'coding'"
            v-model="currentAnswer"
            rows="8"
            class="wx-quiz-code"
            placeholder="在此处填写代码，关键词命中即判对"
          ></textarea>
          <textarea
            v-else
            v-model="currentAnswer"
            rows="4"
            class="wx-quiz-text"
            placeholder="在此作答，命中答案关键词即判对"
          ></textarea>
        </div>
      </div>

      <!-- 底部导航 -->
      <div class="wx-quiz-foot">
        <button class="wx-pressable wx-quiz-nav" :disabled="quiz.currentIndex === 0" @click="quiz.prev()">
          ← 上一题
        </button>
        <div class="wx-quiz-foot-dots">
          <button
            v-for="(q, i) in quiz.questions"
            :key="q.id"
            class="wx-quiz-dot"
            :class="{ done: (quiz.answers[q.id] || '').trim() !== '', cur: i === quiz.currentIndex }"
            @click="quiz.goto(i)"
          >
            {{ i + 1 }}
          </button>
        </div>
        <button
          v-if="quiz.currentIndex < quiz.total - 1"
          class="wx-btn-gradient wx-pressable wx-quiz-nav"
          @click="quiz.next()"
        >下一题 →</button>
        <button
          v-else
          class="wx-btn-gradient wx-pressable wx-quiz-submit"
          :disabled="quiz.submitting"
          @click="quiz.submit()"
        >{{ quiz.submitting ? '判分中…' : '✦ 提交并判分' }}</button>
      </div>
    </div>

    <!-- 成绩展示 -->
    <div v-else-if="quiz.submitted" class="wx-quiz-result">
      <div class="wx-quiz-result-orb" :class="{ pass: quiz.score >= 60 }">
        <span class="wx-quiz-result-score">{{ quiz.score }}</span>
        <span class="wx-quiz-result-unit">分</span>
      </div>
      <div class="wx-quiz-result-summary">
        {{ quiz.correctCount }} / {{ quiz.total }} 题答对
      </div>
      <!-- v1.0：整卷答题按分值加权计分（卷面总分 = 每题分值 × 题量） -->
      <div v-if="quiz.paperId" class="wx-quiz-result-paper">
        卷面得分 <b>{{ quiz.earnedScore }}</b> / {{ quiz.totalScore }} 分
        <span class="dim">（每题 {{ quiz.scorePer }} 分）</span>
      </div>
      <!-- v0.5：知识点回流摘要（FR-5.1） -->
      <div v-if="quiz.lastFlow" class="wx-quiz-result-flow">
        <template v-if="quiz.lastFlow.lit > 0 || quiz.lastFlow.mastered > 0">
          ✦ 本次点亮 {{ quiz.lastFlow.lit }} 个知识点
          <template v-if="quiz.lastFlow.mastered > 0">
            · {{ quiz.lastFlow.mastered }} 个达成已掌握
          </template>
        </template>
        <template v-else>知识点进度已记录，再练几轮即可点亮星图</template>
      </div>
      <div class="wx-quiz-result-tip">
        {{ quiz.score >= 80 ? '深度掌握中，继续保持' : quiz.score >= 60 ? '已轻掌握，再练几次可加深' : '还需多看文档与练题，继续加油' }}
        <span v-if="quiz.skillId" class="wx-quiz-result-effect">· 已累计到该能力点的掌握进度</span>
      </div>

      <!-- v1.1：交卷深度分析（AI 生成，按会话缓存） -->
      <div class="wx-quiz-analysis">
        <div class="wx-quiz-analysis-head">
          <span class="wx-quiz-analysis-title">✦ 深度分析</span>
          <button
            v-if="!quiz.analysis"
            class="wx-quiz-analysis-btn wx-pressable"
            :disabled="quiz.analyzing || !quiz.sessionId"
            @click="quiz.runAnalysis()"
          >
            {{ quiz.analyzing ? '分析中，请稍候（约 20–60 秒）…' : '生成错题精讲与薄弱点报告' }}
          </button>
        </div>

        <div v-if="quiz.analysisError" class="wx-quiz-analysis-err">⚠ {{ quiz.analysisError }}</div>

        <template v-if="quiz.analysis">
          <div v-if="quiz.analysis.overall" class="wx-quiz-analysis-overall">{{ quiz.analysis.overall }}</div>

          <div v-if="quiz.analysis.weakPoints.length" class="wx-quiz-analysis-block">
            <div class="wx-quiz-analysis-block-title">薄弱知识点与补强建议</div>
            <ul class="wx-quiz-analysis-weak">
              <li v-for="w in quiz.analysis.weakPoints" :key="w.name">
                <span class="wx-quiz-analysis-weak-name">{{ w.name }}</span>
                <span class="wx-quiz-analysis-weak-advice">{{ w.advice }}</span>
              </li>
            </ul>
          </div>

          <div v-if="quiz.analysis.keyItems.length" class="wx-quiz-analysis-block">
            <div class="wx-quiz-analysis-block-title">关键错题精讲</div>
            <div v-for="k in quiz.analysis.keyItems" :key="`${k.index}-${k.question}`" class="wx-quiz-analysis-key">
              <div class="wx-quiz-analysis-key-title">第 {{ k.index }} 题 · {{ k.question }}</div>
              <div class="wx-quiz-analysis-key-body">{{ k.deepDive }}</div>
            </div>
          </div>

          <div v-if="quiz.analysis.nextSteps.length" class="wx-quiz-analysis-block">
            <div class="wx-quiz-analysis-block-title">下一步行动</div>
            <ol class="wx-quiz-analysis-steps">
              <li v-for="(s, i) in quiz.analysis.nextSteps" :key="i">{{ s }}</li>
            </ol>
          </div>
        </template>
      </div>

      <!-- 题目列表：点开看解析 / 答案 / 出处 -->
      <div class="wx-quiz-result-list-head">
        <span>逐题解析（{{ resultItems.length }} 题）</span>
        <button class="wx-quiz-toggle-wrong wx-pressable" :class="{ active: onlyWrong }" @click="onlyWrong = !onlyWrong">
          {{ onlyWrong ? '显示全部' : `只看错题（${quiz.wrongItems.length}）` }}
        </button>
      </div>
      <div class="wx-quiz-result-list">
        <div v-for="it in resultItems" :key="it.questionId" class="wx-quiz-result-item">
          <div
            class="wx-quiz-result-row wx-pressable"
            :class="{ right: it.correct, wrong: !it.correct }"
            @click="toggleExpand(it.questionId)"
          >
            <span class="wx-quiz-result-idx">{{ quiz.questions.findIndex((x) => x.id === it.questionId) + 1 }}</span>
            <span class="wx-quiz-result-title">{{ it.question.title }}</span>
            <span v-if="diagnosisOf(it.questionId)" class="wx-quiz-result-diag">{{ diagnosisOf(it.questionId) }}</span>
            <span class="wx-quiz-result-flag">{{ it.correct ? '✓' : '✗' }}</span>
          </div>
          <div v-if="expanded.has(it.questionId)" class="wx-quiz-result-detail">
            <div class="wx-quiz-result-line">
              <span class="lab">你的作答</span>
              <span class="val" :class="{ bad: !it.correct }">{{ it.userAnswer || '（未作答）' }}</span>
            </div>
            <div class="wx-quiz-result-line">
              <span class="lab">标准答案</span>
              <span class="val good">{{ it.question.answer }}</span>
            </div>
            <div v-if="it.question.options?.length" class="wx-quiz-result-line">
              <span class="lab">选项</span>
              <span class="val">
                <span v-for="(o, oi) in it.question.options" :key="oi" class="wx-quiz-result-opt">
                  {{ String.fromCharCode(65 + oi) }}. {{ o }}
                </span>
              </span>
            </div>
            <div v-if="it.question.explanation" class="wx-quiz-result-line">
              <span class="lab">解析</span>
              <span class="val">{{ it.question.explanation }}</span>
            </div>
            <div v-if="deepDiveOf(it.questionId)" class="wx-quiz-result-line">
              <span class="lab">AI 精讲</span>
              <span class="val">{{ deepDiveOf(it.questionId) }}</span>
            </div>
            <div v-if="it.question.sources?.length" class="wx-quiz-result-line">
              <span class="lab">出处</span>
              <span class="val">
                <a
                  v-for="(s, si) in it.question.sources"
                  :key="si"
                  class="wx-quiz-result-src"
                  :href="s.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ s.title || s.url }}</a>
              </span>
            </div>
            <div class="wx-quiz-result-actions">
              <button
                class="wx-quiz-report wx-pressable"
                :disabled="reported.has(it.questionId)"
                @click="report(it.questionId)"
              >{{ reported.has(it.questionId) ? '已反馈' : auth.user ? '题目有误？反馈' : '登录后可提交纠错' }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- v1.0：整卷复盘——按知识点聚合本次得分，最薄弱的排最前 -->
      <div v-if="quiz.kpReview.length" class="wx-quiz-review">
        <div class="wx-quiz-review-title">复盘 · 按知识点得分</div>
        <div v-for="r in quiz.kpReview" :key="r.name" class="wx-quiz-review-row">
          <span class="wx-quiz-review-name" :title="r.name">{{ r.name }}</span>
          <span class="wx-quiz-review-bar">
            <span class="fill" :class="{ weak: r.rate < 60 }" :style="{ width: `${r.rate}%` }"></span>
          </span>
          <span class="wx-quiz-review-meta">{{ r.correct }}/{{ r.total }} · {{ r.rate }}%</span>
        </div>
        <div class="wx-quiz-review-tip">
          {{ (quiz.kpReview[0]?.rate ?? 100) < 60 ? `建议优先重看「${quiz.kpReview[0]?.name}」` : '各知识点掌握均衡，可推进下一模块' }}
        </div>
      </div>

      <button class="wx-btn-gradient wx-pressable wx-quiz-result-close" @click="exitQuiz">
        {{ quiz.paperId ? '完成 · 返回试卷' : '完成 · 返回题库' }}
      </button>
    </div>
  </div>

  <!-- 反馈提示 -->
  <Transition name="wx-fade">
    <div v-if="reportTip" class="wx-quiz-toast">{{ reportTip }}</div>
  </Transition>
</template>

<style scoped>
.wx-quiz-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wx-quiz-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 28px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 22%, transparent);
  flex-shrink: 0;
}
.wx-quiz-head-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--wx-font-serif);
  font-size: 17px;
  color: var(--wx-text-primary);
  letter-spacing: 0.04em;
}
.wx-quiz-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 8px var(--wx-color-primary));
}
.wx-quiz-close {
  padding: 7px 16px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  font-size: 12.5px;
  color: var(--wx-text-secondary);
}
.wx-quiz-close:hover { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }
.wx-quiz-back-btn {
  padding: 8px 20px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  color: var(--wx-text-secondary);
  font-size: 13px;
}

.wx-quiz-loading {
  flex: 1;
  padding: 64px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.wx-quiz-orb {
  font-size: 52px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 14px var(--wx-color-primary));
  animation: wx-breathe 3s var(--wx-ease-in-out-soft) infinite alternate;
}
.wx-quiz-orb-error { color: var(--wx-color-vermilion); filter: drop-shadow(0 0 10px var(--wx-color-vermilion)); }
.wx-quiz-loading-text { font-size: 19px; font-family: var(--wx-font-serif); color: var(--wx-text-primary); }
.wx-quiz-loading-sub { font-size: 12px; color: var(--wx-text-tertiary); }

.wx-quiz-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 28px 96px;
  overflow: hidden;
}
.wx-quiz-progress {
  padding: 16px 0 10px;
  flex-shrink: 0;
}
.wx-quiz-progress-text { font-size: 12px; color: var(--wx-text-tertiary); margin-bottom: 6px; }
.wx-quiz-progress-sep { margin: 0 6px; color: var(--wx-text-muted); }
.wx-quiz-progress-bar {
  height: 4px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  border-radius: 999px;
  overflow: hidden;
}
.wx-quiz-progress-fill {
  height: 100%;
  background: var(--wx-gradient-primary);
  transition: width var(--wx-duration-mid) var(--wx-ease-spring);
}

.wx-quiz-card {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 24px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wx-quiz-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.wx-quiz-diff,
.wx-quiz-type,
.wx-quiz-source {
  padding: 2px 10px;
  border-radius: 999px;
  text-transform: uppercase;
}
.wx-quiz-diff.diff-easy { background: color-mix(in srgb, var(--wx-state-deep) 15%, transparent); color: var(--wx-state-deep); }
.wx-quiz-diff.diff-medium { background: color-mix(in srgb, var(--wx-color-amber) 15%, transparent); color: var(--wx-color-amber); }
.wx-quiz-diff.diff-hard { background: color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent); color: var(--wx-color-vermilion); }
.wx-quiz-type { background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent); color: var(--wx-color-primary-soft); }
.wx-quiz-source.src-manual { background: color-mix(in srgb, var(--wx-ink) 6%, transparent); color: var(--wx-text-tertiary); }
.wx-quiz-source.src-ai { background: color-mix(in srgb, var(--wx-color-yanqing) 15%, transparent); color: var(--wx-color-yanqing); }
.wx-quiz-card-title {
  font-family: var(--wx-font-serif);
  font-size: 19px;
  font-weight: 600;
  color: var(--wx-text-primary);
  letter-spacing: 0.03em;
}
.wx-quiz-card-body {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--wx-text-secondary);
  white-space: pre-wrap;
}

.wx-quiz-options { display: flex; flex-direction: column; gap: 10px; }
.wx-quiz-opt {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-secondary);
  text-align: left;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-quiz-opt:hover {
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-quiz-opt.picked {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--wx-color-primary) 25%, transparent);
}
.wx-quiz-opt-letter {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  color: var(--wx-color-primary-soft);
  font-size: 13px;
  font-weight: 600;
}
.wx-quiz-opt.picked .wx-quiz-opt-letter {
  background: var(--wx-color-primary);
  color: var(--wx-text-on-accent);
}
.wx-quiz-opt-text { flex: 1; font-size: 13px; }

.wx-quiz-input-wrap { display: flex; flex-direction: column; }
.wx-quiz-text,
.wx-quiz-code {
  width: 100%;
  resize: vertical;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-primary);
  font-size: 13px;
  padding: 12px 14px;
  outline: none;
  font-family: var(--wx-font-sans);
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-quiz-code { font-family: var(--wx-font-mono); font-size: 12.5px; }
.wx-quiz-text:focus,
.wx-quiz-code:focus { border-color: var(--wx-border-glow); }

.wx-quiz-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* 右侧预留 88px：避开右下角 AI 悬浮球（默认位置右 24px / 宽 60px）对「下一题」的遮挡 */
  padding: 14px 88px 14px 0;
  flex-shrink: 0;
}
.wx-quiz-nav {
  padding: 8px 16px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  font-size: 12px;
}
.wx-quiz-nav:disabled { opacity: 0.4; cursor: not-allowed; }
.wx-quiz-submit { padding: 8px 18px; font-size: 13px; font-weight: 600; }
.wx-quiz-foot-dots {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}
.wx-quiz-dot {
  min-width: 24px;
  height: 24px;
  padding: 0 5px;
  border-radius: 7px;
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid transparent;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-quiz-dot.done { color: var(--wx-color-primary-soft); background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent); }
.wx-quiz-dot.cur { border-color: var(--wx-border-glow); color: var(--wx-text-on-accent); background: color-mix(in srgb, var(--wx-color-primary) 28%, transparent); }

.wx-quiz-result {
  flex: 1;
  padding: 36px 28px 90px;
  text-align: center;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.wx-quiz-result-orb {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
  display: flex;
  align-items: baseline;
  justify-content: center;
  color: var(--wx-color-vermilion);
}
.wx-quiz-result-orb.pass {
  background: color-mix(in srgb, var(--wx-state-deep) 12%, transparent);
  border-color: color-mix(in srgb, var(--wx-state-deep) 40%, transparent);
  color: var(--wx-state-deep);
}
.wx-quiz-result-score { font-size: 42px; font-weight: 700; font-family: var(--wx-font-serif); }
.wx-quiz-result-unit { font-size: 14px; margin-left: 2px; }
.wx-quiz-result-summary {
  font-size: 16px;
  color: var(--wx-text-primary);
  font-family: var(--wx-font-serif);
}
.wx-quiz-result-tip {
  font-size: 12px;
  color: var(--wx-text-tertiary);
  line-height: 1.6;
  max-width: 520px;
}
.wx-quiz-result-effect { color: var(--wx-color-yanqing); }

/* v0.5：知识点回流摘要 */
.wx-quiz-result-flow {
  padding: 8px 18px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  border: 1px solid var(--wx-border-glow);
  box-shadow: 0 0 14px color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
}

.wx-quiz-result-list {
  width: 100%;
  max-width: 720px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 340px;
  overflow-y: auto;
  /* 父级是受限高度的 flex 列：overflow 元素 min-height 解析为 0，不显式禁止收缩会被压成 0 高 */
  flex-shrink: 0;
}
.wx-quiz-result-item { display: flex; flex-direction: column; }
.wx-quiz-result-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--wx-radius-sm);
  font-size: 12px;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-quiz-result-row.right { border-left: 2px solid var(--wx-state-deep); }
.wx-quiz-result-row.wrong { border-left: 2px solid var(--wx-color-vermilion); }
.wx-quiz-result-idx { color: var(--wx-text-muted); width: 24px; }
.wx-quiz-result-title { color: var(--wx-text-secondary); text-align: left; }
.wx-quiz-result-diag { flex: 1; font-size: 11px; color: var(--wx-color-vermilion); opacity: 0.85; text-align: left; }
.wx-quiz-result-row.right .wx-quiz-result-title { flex: 1; }
.wx-quiz-result-flag { font-size: 14px; margin-left: auto; }
.wx-quiz-result-row.right .wx-quiz-result-flag { color: var(--wx-state-deep); }
.wx-quiz-result-row.wrong .wx-quiz-result-flag { color: var(--wx-color-vermilion); }

.wx-quiz-result-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px 36px;
  margin-bottom: 4px;
  border-left: 2px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 28%, transparent);
}
.wx-quiz-result-line { display: flex; gap: 8px; font-size: 12px; line-height: 1.65; text-align: left; }
.wx-quiz-result-line .lab { flex-shrink: 0; width: 56px; color: var(--wx-text-muted); }
.wx-quiz-result-line .val { flex: 1; color: var(--wx-text-secondary); white-space: pre-wrap; }
.wx-quiz-result-line .val.good { color: var(--wx-state-deep); }
.wx-quiz-result-line .val.bad { color: var(--wx-color-vermilion); }
.wx-quiz-result-opt { display: block; }
.wx-quiz-result-src { display: block; color: var(--wx-color-primary-soft); word-break: break-all; }
.wx-quiz-result-actions { display: flex; justify-content: flex-end; margin-top: 2px; }
.wx-quiz-report {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  color: var(--wx-text-muted);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
}
.wx-quiz-report:hover:not(:disabled) { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }
.wx-quiz-report:disabled { opacity: 0.5; cursor: default; }

.wx-quiz-toast {
  position: fixed;
  top: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 80;
  padding: 9px 20px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 92%, transparent);
  border: 1px solid var(--wx-border-glow);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35);
}

.wx-quiz-result-list-head {
  width: 100%;
  max-width: 720px;
  margin-top: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}
.wx-quiz-toggle-wrong {
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 999px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
}
.wx-quiz-toggle-wrong.active { color: var(--wx-text-on-accent); border-color: var(--wx-border-glow); background: color-mix(in srgb, var(--wx-color-primary) 28%, transparent); }

/* 深度分析卡片 */
.wx-quiz-analysis {
  width: 100%;
  max-width: 720px;
  margin-top: 20px;
  padding: 14px 16px;
  text-align: left;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 32%, transparent);
  flex-shrink: 0;
}
.wx-quiz-analysis-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.wx-quiz-analysis-title { font-size: 13px; color: var(--wx-text-primary); }
.wx-quiz-analysis-btn {
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 999px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-quiz-analysis-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.wx-quiz-analysis-err { margin-top: 8px; font-size: 12px; color: var(--wx-color-vermilion); }
.wx-quiz-analysis-overall { margin-top: 10px; font-size: 12.5px; line-height: 1.75; color: var(--wx-text-secondary); }
.wx-quiz-analysis-block { margin-top: 14px; }
.wx-quiz-analysis-block-title { font-size: 12px; color: var(--wx-text-tertiary); margin-bottom: 6px; }
.wx-quiz-analysis-weak { display: flex; flex-direction: column; gap: 6px; }
.wx-quiz-analysis-weak li { display: flex; gap: 8px; font-size: 12px; line-height: 1.6; }
.wx-quiz-analysis-weak-name { flex-shrink: 0; color: var(--wx-color-primary-soft); }
.wx-quiz-analysis-weak-advice { color: var(--wx-text-secondary); }
.wx-quiz-analysis-key {
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-quiz-analysis-key-title { font-size: 12px; color: var(--wx-text-primary); margin-bottom: 4px; }
.wx-quiz-analysis-key-body { font-size: 12px; line-height: 1.75; color: var(--wx-text-secondary); }
.wx-quiz-analysis-steps { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.wx-quiz-analysis-steps li { font-size: 12px; line-height: 1.6; color: var(--wx-text-secondary); list-style: decimal; }

.wx-quiz-result-close { margin-top: 16px; padding: 10px 22px; font-size: 13px; }

/* v1.0 整卷计分与复盘 */
.wx-quiz-result-paper {
  margin-top: 8px;
  font-size: 13px;
  color: var(--wx-text-secondary);
}
.wx-quiz-result-paper b {
  font-family: var(--wx-font-mono);
  font-size: 17px;
  color: var(--wx-color-primary-soft);
}
.wx-quiz-result-paper .dim { color: var(--wx-text-muted); font-size: 11.5px; }

.wx-quiz-review {
  width: 100%;
  max-width: 560px;
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border: 1px solid var(--wx-border-soft);
  text-align: left;
}
.wx-quiz-review-title {
  font-family: var(--wx-font-serif);
  font-size: 13.5px;
  color: var(--wx-text-primary);
  margin-bottom: 10px;
}
.wx-quiz-review-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}
.wx-quiz-review-name {
  width: 110px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--wx-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-quiz-review-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 7%, transparent);
  overflow: hidden;
}
.wx-quiz-review-bar .fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--wx-gradient-primary);
  transition: width var(--wx-duration-mid) var(--wx-ease-out-soft);
}
.wx-quiz-review-bar .fill.weak { background: linear-gradient(90deg, var(--wx-color-vermilion), var(--wx-color-amber)); }
.wx-quiz-review-meta {
  width: 84px;
  flex-shrink: 0;
  text-align: right;
  font-size: 11px;
  color: var(--wx-text-muted);
  font-family: var(--wx-font-mono);
}
.wx-quiz-review-tip {
  margin-top: 10px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}
</style>
