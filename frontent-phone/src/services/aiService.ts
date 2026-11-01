// 问星 — AI 服务统一层〔自桌面端 services/aiService.ts 移植，去 Tauri 化〕
// 全部请求经后端 /api 代理：Key 保存在 server/.env，不经浏览器；后端与厂商解耦，换厂商只改 server。
// 流式对话（chat-stream）经 authHeaders() 复用 token 注入，fetch reader 模式逐段回调。
import { apiUrl } from './apiBase'
import { authHeaders, http } from './http'

export interface OutlineItem {
  title: string
  description: string
  /** 锚定的星图知识点原名（须来自所选大类清单） */
  kp?: string
  // ===== AI 精细拆解（可选；缺字段时按标题降级渲染） =====
  estMinutes?: number
  scaffoldLevel?: 0 | 1 | 2 | 3
  isCriticalPath?: boolean
  onboardingNote?: string
  steps?: string[]
  resources?: Array<{ type: string; title: string; url?: string; durationMin?: number; anchor?: string }>
  deliverable?: string
  acceptance?: string[]
  commonErrors?: Array<{ error: string; diagnose: string }>
}

/** 技能组（AI 推荐结果：技能 + 具体大纲） */
export interface SkillGroup {
  name: string
  description: string
  reason: string
  items: OutlineItem[]
}

/** 方向拆解结果（自由输入 → AI 拆出 行业/大类/细分方向/能力/需学软件/技能类型） */
export interface GoalDecomposition {
  summary: string
  industry: string
  categories: string[]
  /** 大类下的二级领域（细分方向，如 Web前端 / Web后端 / 深度学习） */
  directions: string[]
  capabilities: string[]
  software: string[]
  skillType: string
  reason: string
}

/** 把一段自由描述交给 AI 拆解为「行业 + 知识大类 + 细分方向 + 能力 + 需学软件 + 技能类型」 */
export async function decomposeGoal(
  goal: string,
  registry: { name: string; categories: string[]; domains?: Record<string, string[]> }[]
): Promise<GoalDecomposition> {
  return http<GoalDecomposition>('/api/ai/understand-goal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal, registry })
  })
}

/** 项目锚点：30 天内要交付的真实项目（技能推荐阶段产出，贯穿大纲与计划） */
export interface ProjectAnchor {
  name: string
  deliverable: string
  acceptance: string
}

/** 根据问卷答案推荐技能 + 具体学习大纲（任务锚定所选大类的知识点） */
export async function recommendSkills(answers: {
  domain: string
  categories: string[]
  /** 方向拆解得到的细分方向（二级领域，任务优先覆盖） */
  directions?: string[]
  categoryTrees: string[]
  sopPath: string
  goal30: string
  baseline: string
  timeCommitment: string
  obstacle: string
  /** 方向拆解得到的技能类型（注入 SOP，让技能组更细） */
  skillType?: string
  groupType?: string
}): Promise<{ skills: SkillGroup[]; project: ProjectAnchor | null }> {
  const data = await http<{ skills: SkillGroup[]; project?: ProjectAnchor | null }>('/api/ai/recommend-skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answers)
  })
  return { skills: data.skills ?? [], project: data.project ?? null }
}

/** 生成学习文档（Markdown） */
export async function generateDoc(skillTitle: string, context: string): Promise<string> {
  const data = await http<{ content: string }>('/api/ai/doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: skillTitle, context })
  })
  return data.content
}

/** 学习计划模块草稿（AI 分块结果：名称/目标/期限/验收标准/知识点标题清单） */
export interface PlanBlockDraft {
  name: string
  goal: string
  durationDays: number
  acceptance: string
  items: string[]
}

/** 按技能组生成「分块式」学习计划（深度掌握导向，任务标题与大纲任务一一对应） */
export async function generatePlanBlocks(input: {
  domain: string
  groups: { name: string; description: string; items: string[] }[]
  /** 30 天真实项目锚点（计划模块须与之对齐） */
  project?: ProjectAnchor | null
  questionnaire?: {
    sopPath: string
    goal30: string
    baseline: string
    timeCommitment: string
    obstacle: string
  } | null
  /** 学前测评结果文本（薄弱技能点清单，供规划师优先安排薄弱模块） */
  baseline?: string
  /** 技能类型 + 群体（注入 SOP，让计划模块更细、更贴合标准流程） */
  skillType?: string
  groupType?: string
}): Promise<PlanBlockDraft[]> {
  const data = await http<{ blocks: PlanBlockDraft[] }>('/api/ai/plan-blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  return data.blocks ?? []
}

// ===== 学习大纲 AI 精细拆解（四字段任务 + 星图新节点）=====

/** 需要补充进知识星图的新节点 */
export interface AtlasNewNode {
  leixing: string
  zu: string
  xiang: string
  kp: string[]
  reason?: string
}

export interface OutlineRefineResult {
  groups: SkillGroup[]
  newNodes: AtlasNewNode[]
}

/** 精细拆解：入参与 plan-blocks 一致，额外带第 1 步技能组与测评薄弱点 */
export async function refineOutline(input: {
  domain: string
  categories: string[]
  /** 项目锚点（技能推荐阶段产出，任务产出对齐项目部件） */
  project?: ProjectAnchor | null
  questionnaire?: {
    sopPath: string
    goal30: string
    baseline: string
    timeCommitment: string
    obstacle: string
  } | null
  baseline?: string
  skillGroups: SkillGroup[]
}): Promise<OutlineRefineResult> {
  const data = await http<OutlineRefineResult>('/api/ai/outline-refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    timeout: 180000
  })
  return { groups: data.groups ?? [], newNodes: data.newNodes ?? [] }
}

// ===== 教科书级目录树（资源准备阶段）=====

export interface TextbookOutlineModule {
  module: string
  goal?: string
  tree: import('@/types').TextbookOutlineNode[]
}

/** 按学习模块生成卷/章/节目录树 */
export async function generateTextbookOutline(input: {
  domain: string
  goal30?: string
  timeBudget?: string
  modules: Array<{ name: string; goal?: string; items?: string[] }>
}): Promise<{ modules: TextbookOutlineModule[]; summary?: string }> {
  const data = await http<{ modules: TextbookOutlineModule[]; summary?: string }>('/api/ai/textbook-outline', {
    method: 'POST',
    body: JSON.stringify(input),
    timeout: 180000
  })
  return { modules: data.modules ?? [], summary: data.summary }
}

/** 流式接口失败时读取后端 { error } 文案，读取失败回落到调用方提供的默认文案 */
async function readStreamError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    return data.error || fallback
  } catch {
    return fallback
  }
}

// ===== 学习计划 Agent（学习计划skill 五阶段，SSE 过程事件）=====

export interface PlanAgentHandlers {
  onPhase?: (id: string, status: 'running' | 'done' | 'error', ms?: number, summary?: string) => void
  onArtifact?: (id: string, title: string, markdown: string) => void
  onLog?: (phase: string, text: string) => void
  onBlocks?: (blocks: PlanBlockDraft[]) => void
  onValidation?: (result: import('@/types').PlanAgentValidation) => void
  onPlanDoc?: (markdown: string) => void
}

/** 流式生成学习计划：按五阶段推送过程事件，最终返回可排期的 blocks */
export async function generatePlanAgentStream(
  input: Parameters<typeof generatePlanBlocks>[0],
  handlers: PlanAgentHandlers,
  signal?: AbortSignal
): Promise<PlanBlockDraft[]> {
  const res = await fetch(apiUrl('/api/ai/plan-agent-stream'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
    signal
  })
  // 非 2xx 优先展示后端 error（如 AI 额度用尽 429），避免被泛化状态码文案覆盖
  if (!res.ok) throw new Error(await readStreamError(res, `计划 Agent 接口错误 ${res.status}`))
  if (!res.body) throw new Error('无响应流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let blocks: PlanBlockDraft[] = []
  let failure = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data: ')) continue
      const payload = t.slice(6)
      try {
        const event = JSON.parse(payload)
        if (event.type === 'phase') {
          handlers.onPhase?.(event.id, event.status, event.ms, event.summary)
        } else if (event.type === 'artifact') {
          handlers.onArtifact?.(event.id, event.title, event.markdown)
        } else if (event.type === 'log') {
          handlers.onLog?.(event.phase, event.text)
        } else if (event.type === 'blocks') {
          blocks = Array.isArray(event.blocks) ? event.blocks : []
          handlers.onBlocks?.(blocks)
        } else if (event.type === 'validation') {
          handlers.onValidation?.(event.result)
        } else if (event.type === 'planDoc') {
          handlers.onPlanDoc?.(event.markdown)
        } else if (event.type === 'error') {
          failure = String(event.error || '计划 Agent 运行失败')
        }
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }

  if (failure) throw new Error(failure)
  return blocks
}

/** 根据用户反馈完善文档 */
export async function reviseDoc(skillTitle: string, content: string, feedback: string): Promise<string> {
  const data = await http<{ content: string }>('/api/ai/revise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: skillTitle, content, feedback })
  })
  return data.content
}

/** 对话聊天（学习页 AI 伙伴；后端返回 options 时前端渲染可点选项） */
export async function chat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  context?: string
): Promise<{ content: string; options?: string[] }> {
  const body: Record<string, unknown> = { messages }
  if (context) body.context = context
  return http<{ content: string; options?: string[] }>('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

/**
 * 流式对话（SSE）：逐段回调 onChunk，返回完整文本。
 * @param signal 中断信号（用户关闭对话/重新发送时 abort）
 */
export async function chatStream(
  messages: { role: 'user' | 'assistant'; content: string }[],
  context: string | undefined,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const headers = authHeaders({ 'Content-Type': 'application/json' })
  const body: Record<string, unknown> = { messages }
  if (context) body.context = context

  const res = await fetch(apiUrl('/api/ai/chat-stream'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })
  // 非 2xx 优先展示后端 error（如 AI 额度用尽 429），避免被泛化状态码文案覆盖
  if (!res.ok) throw new Error(await readStreamError(res, `流式接口错误 ${res.status}`))
  if (!res.body) throw new Error('无响应流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data: ')) continue
      const payload = t.slice(6)
      if (payload === '[DONE]') return full
      try {
        const obj = JSON.parse(payload)
        if (obj.error) throw new Error(obj.error)
        if (obj.content) {
          full += obj.content
          onChunk(obj.content)
        }
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
  }
  return full
}

// ===== 费曼讲解检测（自桌面端移植） =====

export interface GapItem {
  concept: string
  issue: string
  suggestion: string
}

export interface AiUsage {
  used: number
  limit: number
  remaining: number
  limited: boolean
}

export interface ExplainResult {
  scores: {
    accuracy: number // 0-25
    structure: number // 0-25
    analogy: number // 0-25
    gapAwareness: number // 0-25
  }
  total: number // 0-100
  passed: boolean // total >= 70
  gaps: GapItem[]
  strengths: string[]
  summary: string
  usage?: AiUsage
}

/** 提交讲解录音转录文本，返回 4 维度评估结果 */
export async function explainCheck(
  kp: string,
  transcript: string,
  context: string
): Promise<ExplainResult> {
  return http<ExplainResult>('/api/ai/explain-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kp, transcript, context })
  })
}
