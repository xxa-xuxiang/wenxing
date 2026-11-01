// 问星移动端 — 题库/答题/试卷数据模型（自桌面端 types/index.ts 按需裁剪移植）

/** 题目出处（grounding 留痕） */
export interface QuestionSource {
  url: string
  title: string
  snippet?: string
}

/** 题目（后端题库 DTO） */
export interface Question {
  id: string
  title: string
  body: string
  answer: string
  difficulty: 'easy' | 'medium' | 'hard'
  knowledgePoints: string[]
  type: 'single' | 'multiple' | 'short' | 'coding'
  source: 'manual' | 'ai'
  options?: string[]
  /** 解析（为什么对/错、关键思路） */
  explanation?: string
  /** 出处 [{url,title,snippet}] */
  sources?: QuestionSource[]
  /** 所属技能叶子 */
  leafKey?: string
  leafName?: string
  industry?: string
  pathText?: string
}

/** 试卷（组卷产物）：题序即卷面顺序 */
export interface Paper {
  id: string
  title: string
  createdAt: number
  /** 组卷覆盖的知识点范围 */
  scope: string[]
  /** 每题分值 */
  scorePer: number
  /** 卷面总分 = scorePer × 题量 */
  totalScore: number
  questions: Question[]
}

/** 错题本条目（服务端按题目聚合：最近一次作答为错即入选） */
export interface WrongItem {
  question: Question
  /** 最近一次的错误作答 */
  userAnswer: string
  /** 服务端判分理由 / LLM 错因（可能为空） */
  judgeNote: string
  /** 累计答错次数 */
  wrongCount: number
  /** 最近一次答错时间戳 */
  lastWrongAt: number
}

/** 交卷判分返回的逐题明细 */
export interface JudgedItem {
  questionId: string
  correct: boolean
  userAnswer: string
  question: Question
}

/** 交卷会话概要（服务端判分结果） */
export interface SessionDetail {
  id: string
  title: string
  total: number
  correctCount: number
  score: number
  earnedScore: number
  totalScore: number
  kpReview: { name: string; total: number; correct: number; rate: number }[]
  createdAt: number
}

/** 交卷后深度分析（错题精讲 + 薄弱点 + 总评） */
export interface QuizAnalysis {
  wrongItems: { index: number; question: string; diagnosis: string; correctThinking: string; knowledgePoint: string }[]
  keyItems: { index: number; question: string; deepDive: string }[]
  weakPoints: { name: string; advice: string }[]
  overall: string
  nextSteps: string[]
}
