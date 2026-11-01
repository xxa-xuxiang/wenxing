// 问星 v0.1 — 答题会话 Store
// 管理：当前答题的 skillId、题目列表、作答记录、对错判定、最终成绩
// v0.5：提交后按题目 knowledgePoints 逐知识点回流 masteryStore，统计「新点亮 / 新已掌握」供结果页展示
// v1.1：交卷改为服务端判分（POST /api/quiz/sessions），结果与逐题明细来自后端；
//       交卷后可请求深度分析（错题精讲 + 薄弱点 + 总评），结果缓存在后端同一会话上
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Paper, Question } from '@/types'
import { useMasteryStore } from './masteryStore'
import { submitSession, analyzeSession, type QuizAnalysis, type JudgedItem } from '@/services/paperService'

export const useQuizStore = defineStore('quiz', () => {
  // 当前答题对应的 skillId（来自 learnStore.outline）
  const skillId = ref<string | null>(null)
  const skillTitle = ref<string>('')
  // v1.0 整卷答题：来自试卷时记录 paperId 与每题分值（用于分值加权得分与复盘）
  const paperId = ref<string | null>(null)
  const scorePer = ref<number>(0)
  // 题目列表（≥20 题：后端题库）
  const questions = ref<Question[]>([])
  // 作答记录：questionId → 用户输入
  const answers = ref<Record<string, string>>({})
  // 对错标记：questionId → true（对）/ false（错）/ undefined（未判）
  const results = ref<Record<string, boolean>>({})
  // 当前题目下标
  const currentIndex = ref(0)
  // 是否正在凑题
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  // 是否已提交（进入成绩展示阶段）
  const submitted = ref(false)
  // 交卷中（服务端判分）
  const submitting = ref(false)
  // v0.5：本次提交的知识点回流摘要（新点亮数 / 新已掌握数），提交前为 null
  const lastFlow = ref<{ lit: number; mastered: number } | null>(null)
  // v1.1：后端会话 id 与交卷深度分析
  const sessionId = ref<string | null>(null)
  const analysis = ref<QuizAnalysis | null>(null)
  const analyzing = ref(false)
  const analysisError = ref('')
  const judgedItems = ref<JudgedItem[]>([])

  const total = computed(() => questions.value.length)
  const currentQuestion = computed<Question | null>(() =>
    currentIndex.value >= 0 && currentIndex.value < questions.value.length
      ? questions.value[currentIndex.value]
      : null
  )
  const correctCount = computed(() => Object.values(results.value).filter(Boolean).length)
  const answeredCount = computed(
    () => Object.keys(answers.value).filter((k) => (answers.value[k] || '').trim() !== '').length
  )
  const score = computed(() => (total.value === 0 ? 0 : Math.round((correctCount.value / total.value) * 100)))
  // v1.0 整卷得分（仅试卷答题时有意义）：卷面总分 = 每题分值 × 题量；实得分 = 每题分值 × 答对题数
  const totalScore = computed(() => scorePer.value * total.value)
  const earnedScore = computed(() => scorePer.value * correctCount.value)

  /** 逐题判定结果（交卷后可用；供结果页展示解析与出处） */
  const itemById = computed<Record<string, JudgedItem>>(() =>
    Object.fromEntries(judgedItems.value.map((it) => [it.questionId, it]))
  )
  /** 错题列表（结果页重点展示） */
  const wrongItems = computed<JudgedItem[]>(() => judgedItems.value.filter((it) => !it.correct))

  /** 整卷复盘：按知识点聚合本次得分（正确率升序，最薄弱的知识点排最前） */
  const kpReview = computed(() => {
    const agg = new Map<string, { total: number; correct: number }>()
    for (const q of questions.value) {
      const ok = results.value[q.id] === true
      for (const kp of q.knowledgePoints ?? []) {
        const e = agg.get(kp) ?? { total: 0, correct: 0 }
        e.total += 1
        if (ok) e.correct += 1
        agg.set(kp, e)
      }
    }
    return [...agg.entries()]
      .map(([name, v]) => ({
        name,
        total: v.total,
        correct: v.correct,
        rate: v.total === 0 ? 0 : Math.round((v.correct / v.total) * 100)
      }))
      .sort((a, b) => a.rate - b.rate)
  })

  /** 直接以给定题组开始答题（题库/能力点入口）：skillId 可选，提交后回写能力点进度 */
  function startWithQuestions(title: string, list: Question[], startIndex = 0, opts?: { skillId?: string; leafKey?: string }) {
    skillId.value = opts?.skillId ?? null
    skillTitle.value = title
    paperId.value = null
    scorePer.value = 0
    questions.value = [...list]
    answers.value = {}
    results.value = {}
    currentIndex.value = Math.max(0, Math.min(startIndex, list.length - 1))
    submitted.value = false
    submitting.value = false
    lastFlow.value = null
    sessionId.value = null
    analysis.value = null
    analysisError.value = ''
    judgedItems.value = []
    loading.value = false
    loadError.value = null
  }

  /** v1.0 整卷答题：以试卷为会话（卷面题序 + 每题分值），提交后按分值加权判分并支持复盘 */
  function startWithPaper(paper: Paper) {
    skillId.value = null
    skillTitle.value = paper.title
    paperId.value = paper.id
    scorePer.value = paper.scorePer
    questions.value = [...paper.questions]
    answers.value = {}
    results.value = {}
    currentIndex.value = 0
    submitted.value = false
    submitting.value = false
    lastFlow.value = null
    sessionId.value = null
    analysis.value = null
    analysisError.value = ''
    judgedItems.value = []
    loading.value = false
    loadError.value = null
  }

  function setAnswer(qid: string, value: string) {
    answers.value[qid] = value
  }

  function next() {
    if (currentIndex.value < questions.value.length - 1) currentIndex.value += 1
  }
  function prev() {
    if (currentIndex.value > 0) currentIndex.value -= 1
  }
  function goto(i: number) {
    if (i >= 0 && i < questions.value.length) currentIndex.value = i
  }

  /**
   * 交卷：服务端判分（选择精确判 + 简答/编程关键词判），返回逐题对错；
   * 随后按题目 knowledgePoints 回流掌握度（v0.5 FR-5.1）
   */
  async function submit() {
    if (submitting.value || submitted.value) return
    submitting.value = true
    loadError.value = null
    try {
      const resp = await submitSession({
        title: skillTitle.value || '练习',
        paperId: paperId.value,
        scorePer: scorePer.value,
        answers: questions.value.map((q) => ({ questionId: q.id, userAnswer: answers.value[q.id] ?? '' }))
      })
      judgedItems.value = resp.results
      sessionId.value = resp.session.id
      const map: Record<string, boolean> = {}
      for (const it of resp.results) map[it.questionId] = it.correct
      results.value = map
      submitted.value = true

      // 按题目锚定的知识点回流掌握度；缺 knowledgePoints → 该题不计入，不阻断
      const mastery = useMasteryStore()
      let lit = 0
      let mastered = 0
      for (const q of questions.value) {
        const kps = q.knowledgePoints ?? []
        if (kps.length === 0) {
          console.warn(`[问星] 题目「${q.title}」缺少 knowledgePoints，不计入掌握度回流`)
          continue
        }
        const ok = map[q.id] === true
        for (const kp of kps) {
          const r = mastery.recordAnswer(kp, ok)
          if (r.prev === 'unlearned' && r.next !== 'unlearned') lit += 1
          if (r.prev !== 'mastered' && r.next === 'mastered') mastered += 1
        }
      }
      lastFlow.value = { lit, mastered }
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : '交卷失败，请确认后端已启动'
    } finally {
      submitting.value = false
    }
  }

  /** 交卷后的深度分析（错题精讲 + 薄弱点 + 总评）；同一会话后端只生成一次 */
  async function runAnalysis() {
    if (!sessionId.value || analyzing.value) return
    analyzing.value = true
    analysisError.value = ''
    try {
      const r = await analyzeSession(sessionId.value)
      analysis.value = r.analysis
    } catch (e) {
      analysisError.value = e instanceof Error ? e.message : '分析失败，请重试'
    } finally {
      analyzing.value = false
    }
  }

  function reset() {
    skillId.value = null
    skillTitle.value = ''
    paperId.value = null
    scorePer.value = 0
    questions.value = []
    answers.value = {}
    results.value = {}
    currentIndex.value = 0
    submitted.value = false
    submitting.value = false
    lastFlow.value = null
    sessionId.value = null
    analysis.value = null
    analysisError.value = ''
    judgedItems.value = []
    loading.value = false
    loadError.value = null
  }

  return {
    // state
    skillId,
    skillTitle,
    paperId,
    scorePer,
    questions,
    answers,
    results,
    currentIndex,
    loading,
    loadError,
    submitted,
    submitting,
    lastFlow,
    sessionId,
    analysis,
    analyzing,
    analysisError,
    judgedItems,
    // getters
    total,
    currentQuestion,
    correctCount,
    answeredCount,
    score,
    totalScore,
    earnedScore,
    kpReview,
    itemById,
    wrongItems,
    // actions
    startWithQuestions,
    startWithPaper,
    setAnswer,
    next,
    prev,
    goto,
    submit,
    runAnalysis,
    reset
  }
})
