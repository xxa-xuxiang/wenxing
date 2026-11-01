<!-- 答题模式 — 全屏二级页：题目作答（单选/多选/简答/编程）+ 答题卡弹层 + 交卷服务端判分 -->
<!-- 结果页：正确率、新点亮/新掌握统计、深度分析（错题精讲+薄弱点+总评）、逐题解析可折叠、按知识点复盘 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showDialog, showToast } from 'vant'
import { useQuizStore } from '@/stores/quizStore'
import { useAuthStore } from '@/stores/authStore'
import { reportQuestion } from '@/services/questionService'

const quiz = useQuizStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const difficultyLabel: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }
const typeLabel: Record<string, string> = { single: '单选', multiple: '多选', short: '简答', coding: '编程' }

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

// 多选：以 toggle 维护字母集合（A/B/C…，按序拼接）
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

// ===== 退出（返回需确认未交卷丢弃） =====
function goBack() {
  const isPaper = quiz.paperId !== null
  quiz.reset()
  if (isPaper) router.push('/papers')
  else router.push('/questions')
}
async function onBack() {
  if (!quiz.submitted && quiz.total > 0 && quiz.answeredCount > 0) {
    try {
      await showDialog({
        title: '退出答题',
        message: '当前作答尚未交卷，退出后将全部丢弃，确定退出？',
        showCancelButton: true,
        confirmButtonText: '丢弃并退出'
      })
    } catch {
      return // 用户取消
    }
  }
  goBack()
}

// ===== 答题卡弹层 =====
const sheetOpen = ref(false)
function isDone(qid: string): boolean {
  return (quiz.answers[qid] || '').trim() !== ''
}

// ===== 交卷 =====
async function onSubmit() {
  if (quiz.submitting || quiz.submitted) return
  const unanswered = quiz.total - quiz.answeredCount
  try {
    await showDialog({
      title: '提交并判分',
      message:
        unanswered > 0
          ? `还有 ${unanswered} 题未作答，将按答错计分。确认交卷？`
          : `共 ${quiz.total} 题已全部作答，确认交卷？`,
      showCancelButton: true,
      confirmButtonText: '确认交卷'
    })
  } catch {
    return // 用户取消
  }
  sheetOpen.value = false
  await quiz.submit()
  if (quiz.loadError) showToast(quiz.loadError)
}

// ===== 结果页：逐题解析折叠 / 只看错题 / 纠错反馈 =====
const expanded = ref<Set<string>>(new Set())
function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
const onlyWrong = ref(false)
const resultItems = computed(() => (onlyWrong.value ? quiz.wrongItems : quiz.judgedItems))

const reported = ref<Set<string>>(new Set())
async function report(id: string) {
  if (reported.value.has(id)) return
  // 未登录不发请求：后端已要求登录且需存在该题作答记录
  if (!auth.user) {
    showToast('登录后才能提交纠错')
    return
  }
  try {
    const r = await reportQuestion(id, '交卷复盘时标记：答案或解析可能有误')
    const next = new Set(reported.value)
    next.add(id)
    reported.value = next
    showToast(r.retired ? '已收到反馈，该题已下架并将重新出题' : `已收到反馈（${r.feedbackCount}/3）`)
  } catch (e) {
    // 403（未作答过该题）等错误直接展示后端 error 文案
    showToast(e instanceof Error ? e.message : '反馈提交失败')
  }
}

/** 该题的 AI 错因 / 精讲（来自分析结果，index 为错题序号，1 起） */
function wrongIndexOf(questionId: string): number {
  return quiz.wrongItems.map((w) => w.questionId).indexOf(questionId) + 1
}
function diagnosisOf(questionId: string): string {
  if (!quiz.analysis) return ''
  const wi = wrongIndexOf(questionId)
  if (wi <= 0) return ''
  return quiz.analysis.wrongItems.find((w) => Number(w.index) === wi)?.diagnosis ?? ''
}
function deepDiveOf(questionId: string): string {
  if (!quiz.analysis) return ''
  const wi = wrongIndexOf(questionId)
  if (wi <= 0) return ''
  return quiz.analysis.keyItems.find((k) => Number(k.index) === wi)?.deepDive ?? ''
}

// 直开无题（刷新/直达）→ 回题库
onMounted(() => {
  if (!quiz.loading && quiz.total === 0 && !quiz.submitted) router.replace('/questions')
})
</script>

<template>
  <div class="qz">
    <van-nav-bar
      fixed
      placeholder
      safe-area-inset-top
      :title="quiz.submitted ? '答题结果' : quiz.skillTitle || '答题模式'"
      left-arrow
      @click-left="onBack"
    >
      <template #right>
        <span v-if="!quiz.submitted && quiz.total > 0" class="qz-sheet-entry" @click="sheetOpen = true">答题卡</span>
      </template>
    </van-nav-bar>

    <!-- 凑题 loading（题库入口已在进入前凑齐，一般不出现） -->
    <div v-if="quiz.loading" class="qz-center">
      <van-loading size="28" vertical>正在凑题…</van-loading>
      <p class="qz-loading-tip">seed 池 + 问星 AI 混合出题，约 20–60 秒</p>
    </div>

    <!-- 凑题失败（仅无题时展示，避免交卷失败覆盖答题界面） -->
    <div v-else-if="quiz.loadError && quiz.total === 0" class="qz-center">
      <div class="qz-fail">
        <div class="qz-fail-mark">⚠</div>
        <div class="qz-fail-title">凑题失败</div>
        <p class="qz-fail-sub">{{ quiz.loadError }}</p>
        <van-button size="small" round plain type="primary" @click="goBack">返回题库</van-button>
      </div>
    </div>

    <!-- 答题阶段 -->
    <div v-else-if="!quiz.submitted && quiz.total > 0" class="qz-stage">
      <div class="qz-progress">
        <div class="qz-progress-text">
          第 {{ quiz.currentIndex + 1 }} / {{ quiz.total }} 题 · 已答 {{ quiz.answeredCount }} 题
        </div>
        <van-progress
          :percentage="Math.round(((quiz.currentIndex + 1) / quiz.total) * 100)"
          stroke-width="4"
          :show-pivot="false"
        />
      </div>

      <div v-if="quiz.currentQuestion" class="qz-scroll">
        <div class="qz-card">
          <div class="qz-meta">
            <span class="qz-badge" :class="`d-${quiz.currentQuestion.difficulty}`">
              {{ difficultyLabel[quiz.currentQuestion.difficulty] }}
            </span>
            <span class="qz-badge t">{{ typeLabel[quiz.currentQuestion.type] }}</span>
            <span class="qz-badge s" :class="`src-${quiz.currentQuestion.source}`">
              {{ quiz.currentQuestion.source === 'ai' ? 'AI' : '人工' }}
            </span>
          </div>
          <h3 class="qz-q-title">{{ quiz.currentQuestion.title }}</h3>
          <p v-if="quiz.currentQuestion.body" class="qz-q-body">{{ quiz.currentQuestion.body }}</p>

          <!-- 单选 -->
          <div v-if="quiz.currentQuestion.type === 'single'" class="qz-options">
            <button
              v-for="(opt, i) in quiz.currentQuestion.options"
              :key="i"
              class="qz-opt"
              :class="{ picked: isPicked(opt, i) }"
              @click="currentAnswer = String.fromCharCode(65 + i)"
            >
              <span class="qz-opt-letter">{{ String.fromCharCode(65 + i) }}</span>
              <span class="qz-opt-text">{{ opt }}</span>
            </button>
          </div>

          <!-- 多选 -->
          <div v-else-if="quiz.currentQuestion.type === 'multiple'" class="qz-options">
            <button
              v-for="(opt, i) in quiz.currentQuestion.options"
              :key="i"
              class="qz-opt"
              :class="{ picked: isPicked(opt, i) }"
              @click="toggleOption(opt, i)"
            >
              <span class="qz-opt-letter">{{ String.fromCharCode(65 + i) }}</span>
              <span class="qz-opt-text">{{ opt }}</span>
            </button>
          </div>

          <!-- 简答 / 编程 -->
          <template v-else>
            <van-field
              v-model="currentAnswer"
              class="qz-field"
              :class="{ mono: quiz.currentQuestion.type === 'coding' }"
              type="textarea"
              rows="5"
              autosize
              :placeholder="quiz.currentQuestion.type === 'coding' ? '在此填写代码，关键词命中即判对' : '在此作答，命中答案关键词即判对'"
            />
          </template>
        </div>
      </div>

      <!-- 底部导航 -->
      <div v-if="quiz.loadError && !quiz.submitting" class="qz-submit-err">⚠ {{ quiz.loadError }}</div>
      <div class="qz-foot">
        <van-button size="small" round plain :disabled="quiz.currentIndex === 0" @click="quiz.prev()">上一题</van-button>
        <button class="qz-foot-sheet" @click="sheetOpen = true">答题卡</button>
        <van-button
          v-if="quiz.currentIndex < quiz.total - 1"
          type="primary"
          size="small"
          round
          @click="quiz.next()"
        >下一题</van-button>
        <van-button v-else type="primary" size="small" round :loading="quiz.submitting" @click="onSubmit">
          {{ quiz.submitting ? '判分中…' : '提交并判分' }}
        </van-button>
      </div>
    </div>

    <!-- 成绩展示 -->
    <div v-else-if="quiz.submitted" class="qz-result">
      <div class="qz-score" :class="{ pass: quiz.score >= 60 }">
        <span class="qz-score-n">{{ quiz.score }}</span>
        <span class="qz-score-u">分</span>
      </div>
      <div class="qz-result-sum">
        {{ quiz.correctCount }} / {{ quiz.total }} 题答对
        <span class="qz-result-rate">· 正确率 {{ quiz.score }}%</span>
      </div>
      <div v-if="quiz.paperId" class="qz-paper-score">
        卷面得分 <b>{{ quiz.earnedScore }}</b> / {{ quiz.totalScore }} 分（每题 {{ quiz.scorePer }} 分）
      </div>
      <div v-if="quiz.lastFlow" class="qz-flow">
        <template v-if="quiz.lastFlow.lit > 0 || quiz.lastFlow.mastered > 0">
          ✦ 新点亮 {{ quiz.lastFlow.lit }} 个知识点<template v-if="quiz.lastFlow.mastered > 0"> · 新掌握 {{ quiz.lastFlow.mastered }} 个</template>
        </template>
        <template v-else>知识点进度已记录，再练几轮即可点亮星图</template>
      </div>
      <div class="qz-tip">
        {{ quiz.score >= 80 ? '深度掌握中，继续保持' : quiz.score >= 60 ? '已轻掌握，再练几次可加深' : '还需多看文档与练题，继续加油' }}
        <span v-if="quiz.skillId" class="qz-tip-effect">· 已累计到该能力点的掌握进度</span>
      </div>

      <!-- 深度分析 -->
      <div class="qz-analysis">
        <div class="qz-analysis-head">
          <span class="qz-analysis-title">✦ 深度分析</span>
          <van-button
            v-if="!quiz.analysis"
            size="mini"
            plain
            round
            type="primary"
            :disabled="quiz.analyzing || !quiz.sessionId"
            @click="quiz.runAnalysis()"
          >
            {{ quiz.analyzing ? '分析中，请稍候（约 20–60 秒）…' : '生成错题精讲与薄弱点报告' }}
          </van-button>
        </div>
        <div v-if="quiz.analysisError" class="qz-err">⚠ {{ quiz.analysisError }}</div>
        <template v-if="quiz.analysis">
          <div v-if="quiz.analysis.overall" class="qz-overall">{{ quiz.analysis.overall }}</div>
          <div v-if="quiz.analysis.weakPoints.length" class="qz-block">
            <div class="qz-block-title">薄弱知识点与补强建议</div>
            <div v-for="w in quiz.analysis.weakPoints" :key="w.name" class="qz-weak">
              <span class="qz-weak-name">{{ w.name }}</span>
              <span class="qz-weak-advice">{{ w.advice }}</span>
            </div>
          </div>
          <div v-if="quiz.analysis.keyItems.length" class="qz-block">
            <div class="qz-block-title">关键错题精讲</div>
            <div v-for="k in quiz.analysis.keyItems" :key="`${k.index}-${k.question}`" class="qz-key">
              <div class="qz-key-title">第 {{ k.index }} 题 · {{ k.question }}</div>
              <div class="qz-key-body">{{ k.deepDive }}</div>
            </div>
          </div>
          <div v-if="quiz.analysis.nextSteps.length" class="qz-block">
            <div class="qz-block-title">下一步行动</div>
            <ol class="qz-steps">
              <li v-for="(s, i) in quiz.analysis.nextSteps" :key="i">{{ s }}</li>
            </ol>
          </div>
        </template>
      </div>

      <!-- 逐题解析（可折叠） -->
      <div class="qz-list-head">
        <span>逐题解析（{{ resultItems.length }} 题）</span>
        <button class="qz-toggle-wrong" :class="{ active: onlyWrong }" @click="onlyWrong = !onlyWrong">
          {{ onlyWrong ? '显示全部' : `只看错题（${quiz.wrongItems.length}）` }}
        </button>
      </div>
      <div v-if="resultItems.length === 0" class="qz-list-empty">
        {{ onlyWrong ? '本次没有错题，全部答对 ✓' : '暂无逐题解析' }}
      </div>
      <div class="qz-result-list">
        <div v-for="it in resultItems" :key="it.questionId" class="qz-r-item">
          <div class="qz-r-row" :class="{ right: it.correct, wrong: !it.correct }" @click="toggleExpand(it.questionId)">
            <span class="qz-r-idx">{{ quiz.questions.findIndex((x) => x.id === it.questionId) + 1 }}</span>
            <span class="qz-r-title">{{ it.question.title }}</span>
            <span class="qz-r-flag">{{ it.correct ? '✓' : '✗' }}</span>
          </div>
          <div v-if="diagnosisOf(it.questionId)" class="qz-r-diag">{{ diagnosisOf(it.questionId) }}</div>
          <div v-if="expanded.has(it.questionId)" class="qz-r-detail">
            <div class="qz-r-line">
              <span class="lab">你的作答</span>
              <span class="val" :class="{ bad: !it.correct }">{{ it.userAnswer || '（未作答）' }}</span>
            </div>
            <div class="qz-r-line">
              <span class="lab">标准答案</span>
              <span class="val good">{{ it.question.answer }}</span>
            </div>
            <div v-if="it.question.options?.length" class="qz-r-line">
              <span class="lab">选项</span>
              <span class="val">
                <span v-for="(o, oi) in it.question.options" :key="oi" class="qz-r-opt">
                  {{ String.fromCharCode(65 + oi) }}. {{ o }}
                </span>
              </span>
            </div>
            <div v-if="it.question.explanation" class="qz-r-line">
              <span class="lab">解析</span>
              <span class="val">{{ it.question.explanation }}</span>
            </div>
            <div v-if="deepDiveOf(it.questionId)" class="qz-r-line">
              <span class="lab">AI 精讲</span>
              <span class="val">{{ deepDiveOf(it.questionId) }}</span>
            </div>
            <div v-if="it.question.sources?.length" class="qz-r-line">
              <span class="lab">出处</span>
              <span class="val">
                <a
                  v-for="(s, si) in it.question.sources"
                  :key="si"
                  class="qz-r-src"
                  :href="s.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ s.title || s.url }}</a>
              </span>
            </div>
            <button class="qz-report" :disabled="reported.has(it.questionId)" @click="report(it.questionId)">
              {{ reported.has(it.questionId) ? '已反馈' : auth.user ? '题目有误？反馈' : '登录后可提交纠错' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 按知识点复盘 -->
      <div v-if="quiz.kpReview.length" class="qz-review">
        <div class="qz-review-title">复盘 · 按知识点得分</div>
        <div v-for="r in quiz.kpReview" :key="r.name" class="qz-review-row">
          <span class="qz-review-name">{{ r.name }}</span>
          <span class="qz-review-bar">
            <span class="fill" :class="{ weak: r.rate < 60 }" :style="{ width: `${r.rate}%` }"></span>
          </span>
          <span class="qz-review-meta">{{ r.correct }}/{{ r.total }} · {{ r.rate }}%</span>
        </div>
        <div class="qz-review-tip">
          {{ (quiz.kpReview[0]?.rate ?? 100) < 60 ? `建议优先重看「${quiz.kpReview[0]?.name}」` : '各知识点掌握均衡，可推进下一模块' }}
        </div>
      </div>

      <div class="qz-result-foot">
        <van-button type="primary" round block @click="goBack">
          {{ quiz.paperId ? '完成 · 返回试卷' : '完成 · 返回题库' }}
        </van-button>
      </div>
    </div>

    <!-- 答题卡弹层 -->
    <van-popup v-model:show="sheetOpen" position="bottom" round :style="{ maxHeight: '78vh' }">
      <div class="qz-sheet">
        <div class="qz-sheet-head">答题卡 · 已答 {{ quiz.answeredCount }} / {{ quiz.total }}</div>
        <div class="qz-sheet-grid">
          <button
            v-for="(q, i) in quiz.questions"
            :key="q.id"
            class="qz-cell"
            :class="{ done: isDone(q.id), cur: i === quiz.currentIndex }"
            @click="
              () => {
                quiz.goto(i)
                sheetOpen = false
              }
            "
          >
            {{ i + 1 }}
          </button>
        </div>
        <div class="qz-sheet-legend">
          <span class="lg"><i class="dot done"></i>已答</span>
          <span class="lg"><i class="dot"></i>未答</span>
          <span class="lg"><i class="dot cur"></i>当前</span>
        </div>
        <div class="qz-sheet-foot">
          <van-button type="primary" round block :loading="quiz.submitting" @click="onSubmit">
            {{ quiz.submitting ? '判分中…' : '提交并判分' }}
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.qz {
  min-height: 100vh;
  background: #f7f8fa;
  display: flex;
  flex-direction: column;
}
.qz-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 80px 20px; }
.qz-loading-tip { margin: 0; font-size: 11.5px; color: #969799; text-align: center; }
.qz-fail { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.qz-fail-mark { font-size: 40px; color: #ee0a24; }
.qz-fail-title { font-size: 18px; font-weight: 600; color: #323233; }
.qz-fail-sub { margin: 0 0 6px; max-width: 280px; font-size: 12.5px; line-height: 1.6; color: #969799; }
.qz-sheet-entry { font-size: 13px; color: #1989fa; }

/* ===== 答题阶段 ===== */
.qz-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.qz-progress { padding: 4px 14px 10px; }
.qz-progress-text { font-size: 12px; color: #969799; margin-bottom: 8px; }
.qz-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 14px; }
.qz-card {
  padding: 16px 14px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.qz-meta { display: flex; gap: 8px; font-size: 10.5px; }
.qz-badge { padding: 2px 9px; border-radius: 999px; background: rgba(74, 222, 128, 0.14); color: #16a34a; }
.qz-badge.d-medium { background: rgba(251, 191, 36, 0.16); color: #d97706; }
.qz-badge.d-hard { background: rgba(248, 113, 113, 0.14); color: #dc2626; }
.qz-badge.t { background: #eef3ff; color: #1989fa; }
.qz-badge.s { background: #f2f3f5; color: #969799; }
.qz-badge.s.src-ai { background: #e8faf3; color: #0fa37f; }
.qz-q-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.5; color: #323233; }
.qz-q-body { margin: 0; font-size: 14px; line-height: 1.7; color: #646566; white-space: pre-wrap; }

.qz-options { display: flex; flex-direction: column; gap: 10px; }
.qz-opt {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border-radius: 12px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  color: #323233;
  text-align: left;
  font-size: 14px;
  line-height: 1.5;
}
.qz-opt.picked { border-color: #1989fa; background: #f2f6ff; }
.qz-opt-letter {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #eef3ff;
  color: #1989fa;
  font-size: 13px;
  font-weight: 600;
}
.qz-opt.picked .qz-opt-letter { background: #1989fa; color: #fff; }
.qz-opt-text { flex: 1; }

.qz-field { padding: 0; background: transparent; }
.qz-field :deep(.van-field__control) { font-size: 14px; line-height: 1.6; }
.qz-field.mono :deep(.van-field__control) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }

.qz-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #f2f3f5;
}
.qz-submit-err {
  margin: 8px 14px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  font-size: 12px;
  line-height: 1.5;
  color: #ee0a24;
}
.qz-foot-sheet {
  flex: 1;
  padding: 7px 0;
  border-radius: 999px;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
  font-size: 13px;
  color: #646566;
}

/* ===== 结果页 ===== */
.qz-result {
  flex: 1;
  padding: 16px 14px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.qz-score {
  width: 104px;
  height: 104px;
  border-radius: 50%;
  background: #fff1f0;
  border: 1px solid rgba(238, 10, 36, 0.35);
  color: #ee0a24;
  display: flex;
  align-items: baseline;
  justify-content: center;
  padding-top: 26px;
  box-sizing: border-box;
}
.qz-score.pass { background: #e8faf3; border-color: rgba(15, 163, 127, 0.4); color: #0fa37f; }
.qz-score-n { font-size: 38px; font-weight: 700; line-height: 1; }
.qz-score-u { font-size: 13px; margin-left: 2px; }
.qz-result-sum { font-size: 16px; font-weight: 600; color: #323233; }
.qz-result-rate { font-size: 12px; font-weight: 400; color: #969799; }
.qz-paper-score { font-size: 12.5px; color: #646566; }
.qz-paper-score b { color: #1989fa; }
.qz-flow {
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 12.5px;
  color: #1989fa;
  background: #f2f6ff;
  border: 1px solid #dce6fd;
}
.qz-tip { font-size: 11.5px; color: #969799; text-align: center; }
.qz-tip-effect { color: #0fa37f; }

.qz-analysis {
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  text-align: left;
}
.qz-analysis-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.qz-analysis-title { font-size: 14px; font-weight: 600; }
.qz-err { margin-top: 8px; font-size: 12px; color: #ee0a24; }
.qz-overall { margin-top: 10px; font-size: 13px; line-height: 1.75; color: #646566; }
.qz-block { margin-top: 14px; }
.qz-block-title { font-size: 12px; color: #969799; margin-bottom: 6px; }
.qz-weak { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; font-size: 12.5px; }
.qz-weak-name { color: #1989fa; font-weight: 600; }
.qz-weak-advice { color: #646566; line-height: 1.6; }
.qz-key { margin-bottom: 8px; padding: 8px 10px; border-radius: 8px; background: #f7f8fa; }
.qz-key-title { font-size: 12.5px; color: #323233; font-weight: 600; margin-bottom: 4px; }
.qz-key-body { font-size: 12.5px; line-height: 1.75; color: #646566; }
.qz-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
.qz-steps li { font-size: 12.5px; line-height: 1.6; color: #646566; }

.qz-list-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  color: #969799;
  margin-top: 6px;
}
.qz-toggle-wrong {
  font-size: 11.5px;
  padding: 4px 12px;
  border-radius: 999px;
  color: #646566;
  border: 1px solid #ebedf0;
  background: #fff;
}
.qz-toggle-wrong.active { color: #1989fa; border-color: #1989fa; background: #f2f6ff; }

.qz-result-list { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.qz-list-empty {
  width: 100%;
  padding: 18px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px dashed #ebedf0;
  text-align: center;
  font-size: 12.5px;
  color: #969799;
}
.qz-r-item { display: flex; flex-direction: column; }
.qz-r-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  background: #fff;
  border: 1px solid #ebedf0;
}
.qz-r-row.right { border-left: 3px solid #16a34a; }
.qz-r-row.wrong { border-left: 3px solid #ee0a24; }
.qz-r-idx { color: #969799; width: 22px; flex-shrink: 0; font-size: 12px; }
.qz-r-title {
  flex: 1;
  color: #323233;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qz-r-flag { font-size: 14px; }
.qz-r-row.right .qz-r-flag { color: #16a34a; }
.qz-r-row.wrong .qz-r-flag { color: #ee0a24; }
.qz-r-diag { padding: 4px 12px 0; font-size: 11.5px; color: #ee0a24; text-align: left; }
.qz-r-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  margin: 4px 0;
  border-radius: 10px;
  background: #fff;
  border: 1px dashed #ebedf0;
}
.qz-r-line { display: flex; gap: 8px; font-size: 12.5px; line-height: 1.65; text-align: left; }
.qz-r-line .lab { flex-shrink: 0; width: 60px; color: #969799; }
.qz-r-line .val { flex: 1; color: #323233; white-space: pre-wrap; overflow-wrap: anywhere; }
.qz-r-line .val.good { color: #16a34a; }
.qz-r-line .val.bad { color: #ee0a24; }
.qz-r-opt { display: block; }
.qz-r-src { display: block; color: #1989fa; word-break: break-all; }
.qz-report {
  align-self: flex-end;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  color: #969799;
  border: 1px solid #ebedf0;
  background: #fff;
}
.qz-report:disabled { opacity: 0.5; }

.qz-review {
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  text-align: left;
}
.qz-review-title { font-size: 13.5px; font-weight: 600; margin-bottom: 10px; }
.qz-review-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.qz-review-name {
  width: 92px;
  flex-shrink: 0;
  font-size: 12px;
  color: #646566;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qz-review-bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: #f2f3f5;
  overflow: hidden;
}
.qz-review-bar .fill { display: block; height: 100%; border-radius: 999px; background: #1989fa; }
.qz-review-bar .fill.weak { background: linear-gradient(90deg, #f87171, #fbbf24); }
.qz-review-meta {
  width: 84px;
  flex-shrink: 0;
  text-align: right;
  font-size: 11px;
  color: #969799;
}
.qz-review-tip {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #969799;
}

.qz-result-foot { width: 100%; padding: 8px 0 calc(12px + env(safe-area-inset-bottom)); }

/* ===== 答题卡弹层 ===== */
.qz-sheet { padding: 16px 16px 0; display: flex; flex-direction: column; }
.qz-sheet-head { font-size: 14px; font-weight: 600; text-align: center; margin-bottom: 12px; }
.qz-sheet-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
  max-height: 40vh;
  overflow-y: auto;
}
.qz-cell {
  height: 38px;
  border-radius: 10px;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
  font-size: 13px;
  color: #969799;
}
.qz-cell.done { background: #eef3ff; color: #1989fa; border-color: #dce6fd; }
.qz-cell.cur { border-color: #1989fa; color: #fff; background: #1989fa; }
.qz-sheet-legend { display: flex; justify-content: center; gap: 16px; padding: 12px 0; font-size: 11.5px; color: #969799; }
.lg { display: inline-flex; align-items: center; gap: 5px; }
.dot { width: 10px; height: 10px; border-radius: 3px; background: #f2f3f5; border: 1px solid #ebedf0; }
.dot.done { background: #eef3ff; border-color: #dce6fd; }
.dot.cur { background: #1989fa; border-color: #1989fa; }
.qz-sheet-foot { padding-bottom: calc(14px + env(safe-area-inset-bottom)); }
</style>
