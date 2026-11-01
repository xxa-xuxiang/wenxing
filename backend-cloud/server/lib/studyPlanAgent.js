// 问星 — 学习计划 Agent（按「学习计划skill」五阶段逐段执行并推送事件）
// 设计：每个阶段一次 DeepSeek JSON 调用 → 产出该阶段产物 → emit 事件；
//       阶段 3（计划制定）为强依赖阶段，失败向上抛错，前端走原有降级链路。
import { deepseek, takeLastUsage } from './ai.js'
import { PHASES, buildPhaseMessages, assemblePlanDoc, validatePlan } from './studyPlanSkill.js'

/** 强依赖阶段：失败必须终止（否则没有 blocks 可排期） */
const REQUIRED = new Set(['framework'])

/** 从模型输出里稳健提取 JSON（兼容 ```json 围栏与前后杂字符） */
function parseJson(raw) {
  let text = String(raw || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  return JSON.parse(text)
}

/** 表格单元格：去换行、转义竖线 */
function cell(v) {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(cell).join('；')
  if (typeof v === 'object') {
    return Object.values(v).filter((x) => x !== null && x !== undefined && x !== '').map(cell).join(' · ')
  }
  return String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '／').trim()
}

const table = (headers, rows) => {
  const head = `| ${headers.join(' | ')} |`
  const sep = `|${headers.map(() => '---').join('|')}|`
  const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

/** 阶段 1：需求确认表 + 模块优先级 */
function requirementArtifacts(data) {
  const r = data?.requirement ?? {}
  const modules = Array.isArray(data?.modules) ? data.modules : []
  const reqMd = `## 一、需求确认表

${table(
    ['项', '内容'],
    [
      ['学习目标（时空可量化）', r.goal],
      ['核心诉求类型', r.demandType],
      ['最终可交付成果', r.deliverable],
      ['现有基础', r.baseline],
      ['可支配学习时间', r.timeBudget],
      ['约束条件', r.constraints],
      ['薄弱项（≥2）', r.weaknesses],
      ['验收标准', r.acceptance],
      ['考核节点', r.milestones]
    ]
  )}`
  const moduleMd = `## 二、模块优先级

${table(
    ['模块', '急需(1-5)', '前置依赖(1-5)', '投入产出(1-5)', '总分', '等级', '时间占比目标'],
    modules.map((m) => [m.name, m.urgency, m.dependency, m.roi, m.total, m.level, m.timeShare])
  )}`
  const levels = modules.reduce((acc, m) => {
    const k = ['S', 'A', 'B'].includes(m.level) ? m.level : 'A'
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
  return {
    artifacts: [
      { id: 'requirement-table', title: '一、需求确认表', markdown: reqMd },
      { id: 'requirement-modules', title: '二、模块优先级', markdown: moduleMd }
    ],
    summary: `${modules.length} 个模块：S ${levels.S ?? 0} / A ${levels.A ?? 0} / B ${levels.B ?? 0}`,
    modules
  }
}

/** 阶段 2：资源清单 */
function resourceArtifact(data) {
  const d = data ?? {}
  const row = (v) => [v?.name, v?.version, v?.coverage, v?.note]
  const md = `## 三、资源清单

${table(
    ['类别', '资源', '版本/时效', '覆盖度', '备注'],
    [
      ...(Array.isArray(d.core) ? d.core : []).map((x) => ['核心主教材', ...row(x)]),
      ...(Array.isArray(d.aux) ? d.aux : []).map((x) => ['辅助资料', ...row(x)]),
      ...(Array.isArray(d.exercises) ? d.exercises : []).map((x) => ['练习题/题库', ...row(x)]),
      ...(Array.isArray(d.past) ? d.past : []).map((x) => ['真题/案例', ...row(x)]),
      ...(Array.isArray(d.extra) ? d.extra : []).map((x) => ['拓展资源', ...row(x)]),
      ['工具', Array.isArray(d.tools) ? d.tools : [], '—', '—', '专注/任务/追踪/笔记/导图'],
      ['环境', Array.isArray(d.environment) ? d.environment : [], '—', '—', '硬件/免打扰/固定地点']
    ]
  )}`
  const count = ['core', 'aux', 'exercises', 'past', 'extra'].reduce(
    (n, k) => n + (Array.isArray(d[k]) ? d[k].length : 0),
    0
  )
  return {
    artifact: { id: 'resources', title: '三、资源清单', markdown: md },
    summary: `${count} 项资源已配齐`
  }
}

/** 阶段 3：阶段计划框架 + blocks */
function frameworkArtifacts(data) {
  const blocks = (Array.isArray(data?.blocks) ? data.blocks : [])
    .filter((b) => b && typeof b.name === 'string')
    .map((b) => ({
      name: b.name,
      goal: String(b.goal || ''),
      durationDays: Number.isFinite(Number(b.durationDays)) ? Math.max(1, Math.round(Number(b.durationDays))) : 3,
      acceptance: String(b.acceptance || ''),
      items: Array.isArray(b.items) ? b.items.filter((i) => typeof i === 'string') : []
    }))
  if (blocks.length === 0) throw new Error('计划制定阶段未返回有效模块')
  const stages = Array.isArray(data?.stages) ? data.stages : []
  const md = `## 四、阶段计划框架

${table(
    ['阶段', '目标（量化）', '覆盖模块', '时长', '复习节点', '考核节点', '达标线'],
    stages.map((s) => [s.stage, s.goal, s.modules, s.duration, s.review, s.exam, s.passLine])
  )}

**时间分配**：新学 40% · 练习 30% · 复习 20% · 模考 10%；薄弱模块额外 +50%。`
  return {
    artifact: { id: 'framework', title: '四、阶段计划框架', markdown: md },
    blocks,
    summary: `${blocks.length} 个学习模块 · ${stages.length} 个阶段`
  }
}

/** 阶段 4：可视化展示 */
function visualizationArtifact(data) {
  const d = data ?? {}
  const md = `## 五、可视化展示

### 全局甘特图
- ${cell(d.gantt)}

### 里程碑
- ${cell(d.milestones)}

### 辅助视图
- 日历视图：${cell(d.calendar)}
- 数据看板：${cell(d.dashboard)}

### 偏差预警
- ${cell(d.deviation)}

### 弹性调整
- ${cell(d.flexibility)}`
  return { artifact: { id: 'visualization', title: '五、可视化展示', markdown: md }, summary: '甘特图 · 里程碑 · 日历/看板要素已生成' }
}

/** 阶段 5：弹性与跟进机制 */
function followupArtifact(data) {
  const d = data ?? {}
  const md = `## 六、弹性与跟进机制

${table(
    ['项', '规则'],
    [
      ['每周弹性时间', '2–3 小时（占 5%–10%）'],
      ['临时任务排序', '紧急重要 > 重要不紧急 > 紧急不重要 > 不紧急不重要'],
      ['进度滞后补学', '1–3天：碎片补；4–7天：每日+30-60分；>7天：调周期（≤+20%）'],
      ['每日打卡', d.checkin],
      ['周复盘', d.weekly],
      ['月总结', d.monthly],
      ['薄弱专项', d.weak],
      ['动态调整触发', d.adjust]
    ]
  )}`
  return { artifact: { id: 'followup', title: '六、弹性与跟进机制', markdown: md }, summary: '打卡 / 复盘 / 专项突破 / 动态调整规则已生成' }
}

/**
 * 运行学习计划 Agent
 * @param {object} input 与 /api/ai/plan-blocks 入参一致
 * @param {{ userApiKey?: string, emit?: (event: object) => void }} opts
 * @returns {Promise<{ blocks: object[], planDoc: string, validation: object, tokens: number }>}
 */
export async function runStudyPlanAgent(input = {}, { userApiKey = '', emit = () => {} } = {}) {
  const artifacts = []
  const prev = {}
  let blocks = []
  let tokens = 0

  const emitFailureArtifact = (phase, message) => {
    const title = PHASES.find((p) => p.id === phase)?.title ?? phase
    artifacts.push({
      id: `${phase}-failed`,
      title: `${title}`,
      markdown: `### ${title}\n\n> 该阶段生成失败：${message}`
    })
  }

  for (const phase of PHASES) {
    if (phase.id === 'validate') continue
    emit({ type: 'phase', id: phase.id, status: 'running', title: phase.title })
    const started = Date.now()
    try {
      const messages = buildPhaseMessages(phase.id, input, prev)
      const raw = await deepseek(messages, true, userApiKey)
      tokens += takeLastUsage().total_tokens
      const data = parseJson(raw)

      if (phase.id === 'requirement') {
        const res = requirementArtifacts(data)
        artifacts.push(...res.artifacts)
        prev.modules = res.modules
        emit({ type: 'artifact', id: res.artifacts[0].id, title: res.artifacts[0].title, markdown: res.artifacts[0].markdown })
        emit({ type: 'artifact', id: res.artifacts[1].id, title: res.artifacts[1].title, markdown: res.artifacts[1].markdown })
        emit({ type: 'log', phase: phase.id, text: `完成 ${res.summary} 的优先级评分` })
        emit({ type: 'phase', id: phase.id, status: 'done', ms: Date.now() - started, summary: res.summary })
        continue
      }

      if (phase.id === 'resources') {
        const res = resourceArtifact(data)
        artifacts.push(res.artifact)
        emit({ type: 'artifact', ...res.artifact })
        emit({ type: 'phase', id: phase.id, status: 'done', ms: Date.now() - started, summary: res.summary })
        continue
      }

      if (phase.id === 'framework') {
        const res = frameworkArtifacts(data)
        artifacts.push(res.artifact)
        prev.blocks = res.blocks
        blocks = res.blocks
        emit({ type: 'artifact', ...res.artifact })
        emit({ type: 'blocks', blocks: res.blocks })
        emit({ type: 'phase', id: phase.id, status: 'done', ms: Date.now() - started, summary: res.summary })
        continue
      }

      if (phase.id === 'visualization') {
        const res = visualizationArtifact(data)
        artifacts.push(res.artifact)
        emit({ type: 'artifact', ...res.artifact })
        emit({ type: 'phase', id: phase.id, status: 'done', ms: Date.now() - started, summary: res.summary })
        continue
      }

      if (phase.id === 'followup') {
        const res = followupArtifact(data)
        artifacts.push(res.artifact)
        emit({ type: 'artifact', ...res.artifact })
        emit({ type: 'phase', id: phase.id, status: 'done', ms: Date.now() - started, summary: res.summary })
      }
    } catch (e) {
      const message = e?.message || '生成失败'
      emit({ type: 'phase', id: phase.id, status: 'error', ms: Date.now() - started, summary: message })
      emit({ type: 'log', phase: phase.id, text: message })
      if (REQUIRED.has(phase.id)) throw e
      emitFailureArtifact(phase.id, message)
    }
  }

  // 阶段 6：本地校验（不调用模型）
  emit({ type: 'phase', id: 'validate', status: 'running', title: '五阶段校验' })
  const startedAt = Date.now()
  const planDoc = assemblePlanDoc(input.domain, artifacts)
  const validation = validatePlan(planDoc)
  emit({
    type: 'phase',
    id: 'validate',
    status: validation.ok ? 'done' : 'error',
    ms: Date.now() - startedAt,
    summary: validation.ok
      ? '五阶段覆盖 ✓ · 引用可追溯 ✓'
      : `缺失阶段 ${validation.missingPhases.length} · 不可追溯 ${validation.untraceableRefs.length}`
  })
  emit({ type: 'validation', result: validation })
  emit({ type: 'planDoc', markdown: planDoc })

  return { blocks, planDoc, validation, tokens }
}
