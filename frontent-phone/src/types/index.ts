// 问星 — 数据模型 TypeScript 接口〔自桌面端 types/index.ts 完整移植〕
// 现有 data/domains.ts 等已依赖 '@/types'，故沿用 index.ts 作为唯一数据模型出口，
// 保证并行开发的星图/题库等其他页面对类型引用的一致性。

/** 学习状态三态 */
export type LearnStatus = 'unknown' | 'light' | 'deep'

/** 行业领域词条（由 20 行业注册表派生，全部可选） */
export interface Domain {
  id: string
  name: string
  tagline: string
  tags: string[]
  available: boolean
}

/** 知识点路径（行业 md：大类 → 领域 → 技术栈 → 能力项） */
export interface KpPath {
  category: string
  domain: string
  stack: string
  name: string
}

/** 大纲任务 = 扁平化的能力点 */
export interface OutlineTask {
  id: string
  title: string
  domainId: string
  status: LearnStatus
  description?: string
  /** 锚定的星图知识点（AI 推荐时从所选大类清单中解析；定制任务必填） */
  kp?: KpPath
  // ===== AI 精细拆解出的任务卡四字段（全部可选，老数据缺字段时降级展示） =====
  /** 预计分钟数 */
  estMinutes?: number
  /** 脚手架级别：3 完整样例 / 2 补全 / 1 提示 / 0 独立 */
  scaffoldLevel?: 0 | 1 | 2 | 3
  /** 是否关键路径 */
  isCriticalPath?: boolean
  /** 一句话说明「这是你项目的第几步」 */
  onboardingNote?: string
  /** 怎么做 */
  steps?: string[]
  /** 去哪学 */
  resources?: Array<{ type: string; title: string; url?: string; durationMin?: number; anchor?: string }>
  /** 做出什么 */
  deliverable?: string
  /** 怎么算会 */
  acceptance?: string[]
  /** 常见错误 */
  commonErrors?: Array<{ error: string; diagnose: string }>
}

/** 教科书目录树（资源准备阶段生成；仅展示，不落库） */
export interface TextbookOutlineNode {
  title: string
  /** 卷 / 章 / 节 */
  level: 'volume' | 'chapter' | 'section'
  /** 预计页数 */
  pages?: number
  /** 预计学时 */
  hours?: number
  children?: TextbookOutlineNode[]
}

export interface TextbookOutline {
  modules: Array<{
    module: string
    goal?: string
    tree: TextbookOutlineNode[]
  }>
  summary?: string
}

/** 学习文档 */
export interface LearningDoc {
  id: string
  skillId: string
  content: string
  generatedAt: number
  updatedAt?: number
  source: 'ai' | 'manual'
}

/** 学习计划模块（确认技能组后按块生成，深度掌握导向） */
export interface PlanBlock {
  id: string
  /** 模块名 */
  name: string
  /** 深度掌握目标（本模块要学成什么样） */
  goal: string
  /** 学习期限（天） */
  durationDays: number
  /** 排期（YYYY-MM-DD，顺序排期） */
  startDate: string
  endDate: string
  /** 验收标准（可检验） */
  acceptance: string
  /** 本模块包含的大纲任务 id 列表 */
  taskIds: string[]
  /** 优先级（学习计划制定阶段可调，S 最高） */
  priority?: 'S' | 'A' | 'B'
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

/** 单个任务的学前测评结果 */
export interface BaselineTaskResult {
  taskId: string
  title: string
  /** 抽到的题量 */
  total: number
  correct: number
  /** 掌握率 0~1 */
  rate: number
}

/** 学前测评汇总（纯本地判分，不入库、不写掌握度） */
export interface BaselineResult {
  items: BaselineTaskResult[]
  /** 实际作答的题数（未作答任务不计） */
  answered: number
  at: number
}

/** 对话消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  /** AI 给出的可点选项（选择题） */
  options?: string[]
  /** 用户已选中的选项（选中后其余按钮置灰） */
  chosen?: string
}

/** 题目 */
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
  // v1.1 后端题库字段
  /** 解析（为什么对/错、关键思路） */
  explanation?: string
  /** 出处 [{url,title,snippet}] */
  sources?: QuestionSource[]
  /** 所属技能叶子键 */
  leafKey?: string
  leafName?: string
  industry?: string
  pathText?: string
}

/** 题目出处（grounding 留痕） */
export interface QuestionSource {
  url: string
  title: string
  snippet?: string
}

/** 书架中的一本书（与后端 Book 模型对应） */
export interface BookItem {
  id: string
  title: string
  author?: string | null
  format: 'pdf' | 'epub' | 'txt' | 'md' | 'mobi' | 'azw3'
  fileSize?: number | null
  coverUrl?: string | null
  sourceUrl?: string | null
  license?: string | null
  industry?: string | null
  tags?: string | null
  textbookSlug?: string | null
  createdAt: number
  /** 是否有可下载文件（许可不明时只存链接） */
  hasFile?: boolean
  /** 是否支持在线预览（pdf/epub/txt/md） */
  previewable?: boolean
}

/** 试卷（v1.0 智能组卷产物）：成卷标题 + 知识点范围 + 每题分值 + 题序即卷面顺序 */
export interface Paper {
  id: string
  /** 成卷标题 */
  title: string
  createdAt: number
  /** 组卷覆盖的知识点范围（每个知识点一项） */
  scope: string[]
  /** 每题分值 */
  scorePer: number
  /** 卷面总分 = scorePer × 题量 */
  totalScore: number
  /** 卷面题目（顺序即题号） */
  questions: Question[]
}

/** 学习计划方案（多套计划并存：非激活方案以完整快照归档在 planSchemes 中） */
export interface PlanScheme {
  id: string
  /** 方案名（如「前端入门」「数据库专项」） */
  name: string
  createdAt: number
  domain: Domain | null
  questionnaire: QuestionnaireAnswers | null
  outline: OutlineTask[]
  plan: PlanBlock[]
  planConfirmed: boolean
  resourcesConfirmed: boolean
  baselineResult: BaselineResult | null
  activeTaskId: string | null
  openTaskIds: string[]
  /** 学习计划skill 五件套完整文档（旧方案可能为空，展示时回退 buildPlanMarkdown） */
  planDoc?: string
  /** 学前测评是否已完成（含跳过） */
  baselineDone?: boolean
}

/** 学习计划 Agent：阶段状态 */
export type PlanAgentPhaseStatus = 'pending' | 'running' | 'done' | 'error'

/** 学习计划 Agent：单阶段产物 */
export interface PlanAgentArtifact {
  id: string
  title: string
  markdown: string
}

/** 学习计划 Agent：单阶段运行视图 */
export interface PlanAgentPhase {
  id: string
  title: string
  status: PlanAgentPhaseStatus
  /** 耗时（毫秒，完成后写入） */
  ms?: number
  summary?: string
  artifacts: PlanAgentArtifact[]
  logs: string[]
}

/** 学习计划 Agent：五阶段 + 编号追溯校验结果 */
export interface PlanAgentValidation {
  ok: boolean
  missingPhases: string[]
  untraceableRefs: string[]
  checkedRefs: number
  taxonomy?: { codes: number }
}

/** 学习计划 Agent：一次完整运行 */
export interface PlanAgentRun {
  active: boolean
  startedAt: number
  phases: PlanAgentPhase[]
  validation?: PlanAgentValidation
  planDoc?: string
  error?: string
}

/** Anki 记忆卡片（本地 SM-2 间隔复习） */
export interface AnkiCard {
  id: string
  front: string
  back: string
  /** 来源：手动建卡 / 学习文档抽卡 / 错题本抽卡 */
  source: 'manual' | 'doc' | 'wrong'
  taskId?: string
  kpName?: string
  createdAt: number
  /** 下次复习时间戳 */
  dueAt: number
  /** 当前间隔（天） */
  interval: number
  /** 难度因子（初始 2.5，下限 1.3） */
  ease: number
  reps: number
  lapses: number
}

/** 问卷答案（SOP 驱动 · 学习合同） */
export interface QuestionnaireAnswers {
  /** 所选知识大类（行业 md 的 # 级，多选） */
  categories: string[]
  /** 所选大类下的细分方向（行业 md 的 ## 级，来自方向拆解） */
  directions?: string[]
  /** 学习目的（六类 SOP 路径） */
  sopPath: string
  /** 30 天目标（节点0 必答） */
  goal30: string
  /** 当前基线（能力基线 0-4 级简化） */
  baseline: string
  /** 每周可投入时间（调度阈值） */
  timeCommitment: string
  /** 最大学习障碍 */
  obstacle: string
  /** 方向拆解得到的技能类型（immersive|theory|mimicry|logic|mixed，用于注入 SOP） */
  skillType?: string
  /** 群体适配类型（student|worker|mass） */
  groupType?: string
}
