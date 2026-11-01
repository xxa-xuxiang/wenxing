// 问星 — 「学习计划skill」加载与校验（后端内置副本）
// 资产位于 server/skills/study-plan/（复制自仓库根 学习计划skill/）。
// 注意：后续修改仓库根的 skill 文件后，需要同步复制到本目录，部署环境不依赖仓库根目录。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = path.join(__dirname, '..', 'skills', 'study-plan')

/** 阶段元数据：与 SKILL.md 的五阶段 Procedure 对齐（validate 为本地校验阶段） */
export const PHASES = [
  { id: 'requirement', title: '学习需求确认', section: 1 },
  { id: 'resources', title: '学习资源准备', section: 2 },
  { id: 'framework', title: '学习计划制定', section: 3 },
  { id: 'visualization', title: '学习计划可视化', section: 4 },
  { id: 'followup', title: '学习跟进计划', section: 5 },
  { id: 'validate', title: '五阶段校验', section: 0 }
]

let cache = null

/** 读取并缓存 skill 资产（SKILL.md / 模板 / 大纲 / 编号表） */
function bundle() {
  if (cache) return cache
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
  const template = fs.readFileSync(path.join(SKILL_DIR, 'assets', 'plan-template.md'), 'utf8')
  const outline = fs.readFileSync(path.join(SKILL_DIR, 'references', '学习全流程规划大纲.md'), 'utf8')
  let codes
  try {
    codes = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'taxonomy-codes.json'), 'utf8')).codes ?? []
  } catch {
    codes = []
  }
  cache = { skill, template, outline, codes: Array.isArray(codes) ? codes : [] }
  return cache
}

/** 按「1. # 学习需求确认」这类一级编号标题切分大纲（只取前 5 节） */
function outlineSections() {
  const { outline } = bundle()
  const lines = outline.split(/\r?\n/)
  const marks = []
  lines.forEach((line, i) => {
    const m = line.match(/^(\d+)\.\s*#\s*(.+)$/)
    if (m) marks.push({ n: Number(m[1]), title: m[2].trim(), at: i })
  })
  const out = {}
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].at
    const end = k + 1 < marks.length ? marks[k + 1].at : lines.length
    out[marks[k].n] = lines.slice(start, end).join('\n')
  }
  return out
}

/** 取模板中指定关键词所在的「## 」小节（找不到则返回全文前 1200 字） */
function templateSection(keyword) {
  const { template } = bundle()
  const parts = template.split(/\n(?=##\s)/)
  const hit = parts.find((p) => p.includes(keyword))
  return hit ?? template.slice(0, 1200)
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** 各阶段输出契约（只返回 JSON，键名固定） */
const CONTRACTS = {
  requirement: `只返回 JSON，格式：
{"requirement":{"goal":"时空可量化的学习目标","demandType":"兴趣拓展|职业技能|应试通过","deliverable":"证书|作品|能力认证","baseline":"现有基础（引用测评数据）","timeBudget":"周均固定时长 + 碎片化时长","constraints":"截止日期/预算/资源约束","weaknesses":["薄弱项 1（含达标阈值）","薄弱项 2（含达标阈值）"],"acceptance":"验收标准（知识类≥85% / 技能类完成率100%·耗时≤120%）","milestones":"周测/月考/终期节点及未达标补学规则"},
"modules":[{"name":"能力模块（无重叠，3-5 个）","urgency":1,"dependency":1,"roi":1,"total":3,"level":"S|A|B","timeShare":"时间占比目标"}]}
评分规则：三项各 1-5 分，总分≥12 为 S，8-11 为 A，≤7 为 B。`,
  resources: `只返回 JSON，格式：
{"core":[{"name":"核心主教材","version":"版本/时效","coverage":"覆盖度≥90%","note":"备注"}],
"aux":[{"name":"辅助资料","version":"","coverage":"","note":"2-3 本"}],
"exercises":[{"name":"练习题/题库","version":"","coverage":"每知识点≥10题 基础:进阶:综合=5:3:2","note":""}],
"past":[{"name":"真题/案例","version":"","coverage":"≥80%场景","note":""}],
"extra":[{"name":"拓展课程/笔记/案例库","version":"","coverage":"","note":""}],
"tools":["专注计时","任务管理","进度追踪","笔记","思维导图"],
"environment":["硬件","免打扰","固定地点"]}
不确定版本时如实写「待核对最新版本」，禁止编造网址。`,
  framework: `只返回 JSON，格式：
{"blocks":[{"name":"模块名（10 字内）","goal":"深度掌握目标（30 字内）","durationDays":4,"acceptance":"可检验的验收标准（40 字内）","items":["知识点，必须逐字取自输入清单"]}],
"stages":[{"stage":"入门/基础|巩固/提升|冲刺","goal":"量化阶段目标","modules":"覆盖模块名","duration":"时长","review":"复习节点（当日/次日/周/月）","exam":"考核节点","passLine":"达标线（周测≥70%/月考≥75%）"}]}
块数 3-6，每块 2-5 个知识点；薄弱模块优先且适当加期限；基础时间分配 新学40%·练习30%·复习20%·模考10%。`,
  visualization: `只返回 JSON，格式：
{"gantt":"全局甘特图内容说明（横轴/纵轴/条形/进度）","milestones":"里程碑（周测/月考/阶段验收及颜色状态）","calendar":"日历视图要素（每日任务/打卡/复习提醒）","dashboard":"数据看板指标（总时长/完成率/掌握率/连续打卡/近7天趋势）","deviation":"偏差预警规则（≥10%黄 / ≥20%红及补学方案）","flexibility":"每周弹性时间与临时任务排序规则"}`,
  followup: `只返回 JSON，格式：
{"checkin":"每日打卡四要素与时限","weekly":"周复盘四维度与改进要求","monthly":"月总结完成率分级与三维归因","weak":"薄弱项专项突破四步法与达标线（≥20题/≥2小时/专项测试≥85%）","adjust":"动态调整触发条件、优先级与幅度、效果验证"}`
}

/**
 * 构建某阶段的对话消息
 * @param {string} phaseId 阶段 id
 * @param {object} input { domain, groups, questionnaire, baseline, skillType, groupType }
 * @param {object} prev 前序阶段产物（modules / blocks / stages）
 */
export function buildPhaseMessages(phaseId, input = {}, prev = {}) {
  const meta = PHASES.find((p) => p.id === phaseId)
  if (!meta) throw new Error(`未知阶段：${phaseId}`)
  const { skill } = bundle()
  const sections = outlineSections()
  const outlinePart = clip(sections[meta.section] ?? '', 4500)

  const qa = input.questionnaire ?? {}
  const groups = Array.isArray(input.groups) ? input.groups : []
  const groupText = groups
    .map((g, i) => `技能组 ${i + 1}：${g?.name ?? ''}（${g?.description || '无描述'}）\n知识点：${(Array.isArray(g?.items) ? g.items : []).join('、')}`)
    .join('\n\n')

  // 项目锚点：技能推荐阶段产出的 30 天真实项目，计划模块须与它对齐
  const project = input.project && typeof input.project === 'object' ? input.project : null
  const projectText = project && String(project.name || '').trim()
    ? `${String(project.name).trim()}｜交付物：${String(project.deliverable || '').trim() || '未指定'}｜验收：${String(project.acceptance || '').trim() || '未指定'}`
    : '未指定（请从 30 天目标反推一个可运行的真实交付物，并在计划中固定下来）'

  const templateKeyword = {
    requirement: '需求确认表',
    resources: '资源清单',
    framework: '阶段计划框架',
    visualization: '可视化展示',
    followup: '弹性与跟进机制'
  }[phaseId]

  const prevText = []
  if (prev.modules) prevText.push(`【已确认模块优先级】\n${JSON.stringify(prev.modules)}`)
  if (prev.blocks) prevText.push(`【已生成计划模块】\n${JSON.stringify(prev.blocks)}`)

  const system = `你正在执行「学习计划skill」的「${meta.title}」阶段，必须严格遵循下述 skill 规范，不得自行改变方法或阈值。

【Skill 规范 · SKILL.md】
${skill}

【本阶段权威流程与量化阈值 · references/学习全流程规划大纲.md 第 ${meta.section} 节】
${outlinePart || '（本节缺失，沿用 SKILL.md 中的阈值）'}

【输出模板参考 · assets/plan-template.md】
${templateSection(templateKeyword)}

【本阶段输出要求】
${CONTRACTS[phaseId]}
- 所有量化阈值（85% / 80% / 艾宾浩斯节点 / 优先级评分 / 时间占比）必须与大纲一致，禁止自创。
- 指标须满足 SMART，禁止「掌握 / 熟悉」等模糊表述。
- 计划必须围绕【30 天交付项目】倒排：模块即项目里程碑，验收对齐项目总体验收，禁止另起项目或写成泛化练习。
- 输出中文，只返回 JSON，不要任何解释或 Markdown 围栏。`

  const user = `行业：${input.domain || '信息技术与软件'}

【技能组与知识点清单】
${groupText || '（无）'}

【30 天交付项目】
${projectText}

【学习合同】
学习目的：${qa.sopPath || '从零入门'}
30 天目标：${qa.goal30 || '未指定'}
当前基线：${qa.baseline || '未指定'}
时间投入：${qa.timeCommitment || '未指定'}
最大障碍：${qa.obstacle || '未指定'}
技能类型：${input.skillType || '未指定'}${input.groupType ? ` · ${input.groupType}` : ''}
${input.baseline ? `\n【学前测评结果】\n${input.baseline}` : ''}
${prevText.length ? `\n${prevText.join('\n\n')}` : ''}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

/** 五件套产物按模板顺序拼装为完整计划文档 */
export function assemblePlanDoc(domain, artifacts) {
  const head = `# ${domain || '通用'} 学习计划

> 由「学习计划skill」五阶段方法论生成 · ${new Date().toLocaleDateString('zh-CN')} · 量化阈值取自《学习全流程规划大纲》
`
  return [head, ...artifacts.map((a) => a.markdown.trim()).filter(Boolean)].join('\n\n')
}

// 各阶段关键词（任一命中即视为该阶段已覆盖），与原 scripts/validate-plan.js 一致
const PHASE_RULES = [
  ['需求确认', /需求确认|核心目标|验收标准|学习目标/],
  ['资源准备', /资源准备|资源清单|教材|题库|练习题/],
  ['计划制定', /计划制定|计划框架|阶段目标|优先级|时间占比/],
  ['可视化', /可视化|甘特|日历视图|看板/],
  ['跟进', /跟进|打卡|复盘|动态调整/]
]

/**
 * 校验计划文档：五阶段覆盖 + 技能编号可追溯
 * 移植自 学习计划skill/scripts/validate-plan.js，改为纯函数返回结果
 */
export function validatePlan(planText) {
  const text = String(planText || '')
  const missingPhases = PHASE_RULES.filter(([, re]) => !re.test(text)).map(([key]) => key)
  const codeSet = new Set(bundle().codes)
  // 只把「带括号的显式引用」当作技能编号（如 [A1]、（B2）、【C3】）：
  // 计划里天然会出现 D30（第 30 天）、W1（第 1 周）这类普通记号，裸正则会把它们误判为不可追溯引用
  const refs = new Set(
    [...text.matchAll(/[[【（(]\s*([A-Z]\d{1,2})\s*[\]】）)]/g)].map((m) => m[1])
  )
  const untraceableRefs = [...refs].filter((code) => !codeSet.has(code))
  return {
    ok: missingPhases.length === 0 && untraceableRefs.length === 0,
    missingPhases,
    untraceableRefs,
    checkedRefs: refs.size,
    taxonomy: { codes: codeSet.size }
  }
}
