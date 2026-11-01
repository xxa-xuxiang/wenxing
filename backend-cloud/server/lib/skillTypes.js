// 问星 — 学习计划安排 SOP 知识库（学习流程第 3-13 步）
// 服务端内置：5 类技能标准流程 / 校验门槛 / 工具-阶段绑定 / 常见失败原因、3 类群体适配策略、
// 8 组需求问卷、计划文档与知识目录规格、每日任务排期规则，以及各步 Prompt 拼装器。
// 供计划生成各步 AI 调用注入；本模块为纯常量与纯函数：不发起网络请求、不读写数据库、不依赖前端。

// ============ 一、5 类技能标准流程（步骤 4 · 6 · 8） ============

export const SKILL_TYPES = {
  immersive: {
    key: 'immersive',
    name: '沉浸式实践类',
    desc: '在真实或仿真场景中反复操作，靠实际操作与故障应对形成技能',
    /** 标准流程（步骤 8 大纲阶段必须严格套用） */
    flow: ['场景模拟', '实际操作', '故障模拟', '复盘修正', '技能豁免考核'],
    /** 校验门槛（步骤 8 必须写入计划） */
    gate: '技能豁免考核：连续 3 次无差错完成标准操作，且能正确应对异常场景',
    /** 工具-阶段绑定（步骤 6 拆解出的工具必须落到这些阶段） */
    toolBindings: [
      { tool: '仿真模拟软件', stage: '场景模拟' },
      { tool: '操作录制回放工具', stage: '复盘修正' }
    ],
    /** 常见失败原因（步骤 8 必须作为风险预警写入计划） */
    failures: [
      '只看演示不动手，用观摩代替实操，缺少肌肉记忆',
      '训练场景过于理想化，缺少故障与异常工况，迁移到真实环境即失效',
      '不复盘、不记录，同类错误反复出现',
      '缺少豁免考核标准，练到「感觉会了」就停'
    ]
  },
  theory: {
    key: 'theory',
    name: '理论识记类',
    desc: '以概念、原理与事实的理解记忆为主，靠间隔复习与输出检测巩固',
    flow: ['知识切块', '卡包录入', '间隔复习', '错题归类', '知识相联', '输出检测'],
    gate: '输出检测：主动复述 ≥80 分，并通过跨场景应用验证',
    toolBindings: [
      { tool: '知识图谱工具', stage: '知识切块' },
      { tool: '记忆卡工具', stage: '间隔复习' }
    ],
    failures: [
      '只反复阅读、不做输出检测，产生「熟悉感」而非真实掌握',
      '复习间隔随意，错过遗忘临界点，造成重复劳动',
      '错题不归类，同一盲区反复出错',
      '知识孤立记忆，未建立概念间关联，跨场景无法调用'
    ]
  },
  mimicry: {
    key: 'mimicry',
    name: '模仿演练类',
    desc: '从优秀样稿逐层复刻，靠对比差异与要素替换逼近标杆水准',
    flow: ['样稿拆解', '要素提取', '分层复刻', '对比差异', '要素替换', '风格混合'],
    gate: '分层复刻：每一层相似度 ≥90% 才能进入下一层',
    toolBindings: [
      { tool: '参考采集工具', stage: '样稿拆解' },
      { tool: '镜像复刻工具', stage: '分层复刻' }
    ],
    failures: [
      '样稿质量低或风格杂乱，复刻上限被拉低',
      '只抄结果不拆要素，换场景即无从下手',
      '跳过逐层相似度对比直接创作，偏差累积',
      '自评相似度不准，缺少外部镜像校验'
    ]
  },
  logic: {
    key: 'logic',
    name: '逻辑推导类',
    desc: '从问题定义到符号化推导，靠边界验证与多解替换训练严谨思维',
    flow: ['问题定义', '约束提取', '符号化', '推导求解', '验证替换', '结论产出'],
    gate: '验证替换：至少 3 种边界场景测试通过',
    toolBindings: [
      { tool: '结构梳理工具', stage: '约束提取' },
      { tool: '验证工具', stage: '验证替换' }
    ],
    failures: [
      '问题定义含糊、约束未穷举，推导建立在错误前提上',
      '符号化不严谨，变量含义中途漂移',
      '只求单解、不做替换验证，边界场景一测就崩',
      '缺少结论产出与反例记录，思维过程不可复用'
    ]
  },
  mixed: {
    key: 'mixed',
    name: '混合型技能',
    desc: '实践、识记、模仿、推导兼而有之，按阶段拆分主学习方式组合推进',
    flow: ['阶段拆分判定主学习方式', '选择对应流程子路径', '阶段转换', '整合输出'],
    gate: '主路径判定：单阶段某类任务占比 ≥60% 以该类流程为主路径；各类型均不足 60% 时，按任务依赖顺序依次匹配子流程',
    toolBindings: [],
    failures: [
      '阶段主学习方式判定随意，过程中反复切换导致断层',
      '子流程混用但未标注阶段转换点，前后衔接断裂',
      '只推进不整合，缺少统一成果输出'
    ]
  }
}

/** 取技能类型 SOP（未知 key 兜底混合型，与前端 skillTypeMeta 一致） */
export function skillTypeSop(key) {
  return SKILL_TYPES[key] ?? SKILL_TYPES.mixed
}

// ============ 二、3 类群体适配策略（步骤 7） ============

export const GROUP_TYPES = {
  student: {
    key: 'student',
    name: '学生',
    strategy:
      '资源优先级：证书备考 > 升学 > 兴趣；把打卡监督与社群陪学建议写进计划；按进度解锁后续阶段，避免前期堆量'
  },
  worker: {
    key: 'worker',
    name: '职场',
    strategy:
      '资源优先级：软技能 > 新兴技术 > 投资理财；线上线下混合安排；实践任务与项目案例挂钩，并关联晋升与岗位职责'
  },
  mass: {
    key: 'mass',
    name: '其他',
    strategy:
      '内容轻量化、高性价比、低成本替代方案优先；支持短视频与碎片化学习；以效果展示（可见成果）为导向'
  }
}

/** 取群体适配策略（未知 key 兜底其他） */
export function groupStrategy(key) {
  return GROUP_TYPES[key] ?? GROUP_TYPES.mass
}

// ============ 三、8 组需求问卷（步骤 5） ============

export const PLAN_QUESTIONS = [
  { key: 'goalType', title: '这次学习的目标是？', purpose: '决定计划侧重点与验收方式' },
  { key: 'goalHeight', title: '期望达到什么高度？', purpose: '对齐验收门槛（分数/证书/项目）', allowCustom: true },
  { key: 'weeklyTime', title: '每周能付出多少时间？', purpose: '决定任务粒度与周学习日数量' },
  { key: 'rhythm', title: '期望的学习节奏与每日时长？', purpose: '决定每日任务如何排期' },
  { key: 'deliverable', title: '期望的学习成果与交付物？', purpose: '围绕交付物倒排验收节点' },
  { key: 'baseline', title: '目前的知识基础？', purpose: '决定起点难度与入门阶段篇幅' },
  { key: 'deadline', title: '有特殊的时间安排吗？', purpose: '倒计时/截止日期，须在计划文档中标注', allowCustom: true },
  { key: 'typeAdapt', title: '技能类型适配题（随所选类型切换）', purpose: '补齐设备/仿真、记忆工具、素材库、建模验证等类型前置条件', dynamic: true }
]

// ============ 四、排期规则（步骤 11，确定性、不经 AI） ============

export const SCHEDULING_RULES = {
  /** 从 startDate 起，按 outlineStages 顺序展开各阶段 items */
  expand: '按 outlineStages 顺序依次展开各阶段 items，阶段内保持原序',
  /** 由问卷 weeklyTime + rhythm 决定每周学习日 */
  weeklyDays: {
    '每天推进，每次 20-45 分钟': '每周 7 个学习日',
    '每天推进，每次 1-2 小时': '每周 7 个学习日',
    '仅工作日学习，周末休息': '周一至周五',
    '仅周末集中投入': '周六、周日'
  },
  /** 逐日分配，date 顺延；每日 1-3 项 */
  granularity: '逐日分配、日期顺延，每日任务 1-3 项',
  /** 逾期为应用内标识，不做外部推送 */
  overdue: 'date 早于今天且未完成 → 标记逾期（仅应用内红点/顶栏 badge，无短信邮件系统通知）'
}

// ============ 五、计划文档与知识目录规格（步骤 8 · 10 · 13） ============

export const PLAN_DOC_SPEC = {
  /** 完整计划文档必须包含的章节 */
  sections: ['学习目标', '阶段安排', '每日任务', '资源清单', '进度追踪机制'],
  limits: {
    planDoc: '≤1200 字',
    stages: '阶段 ≤6 个',
    catalog: '知识目录 ≤3 层、≤20 个节点'
  },
  /** 每阶段必须写入的内容 */
  stageMust: '每阶段须写入：校验门槛、工具使用指导、该类技能常见失败原因作为风险预警',
  catalog: '知识与大纲阶段对应，树形（≤3 层），节点可逐层折叠，点击跳转对应大纲段落或筛选当日任务',
  report: '每周日生成学习周报：本周完成情况 + 知识掌握度复盘 + 下周建议；历史周报可回看'
}

// ============ 六、Prompt 注入拼装（供各步 AI 调用使用） ============

/** 把某技能类型 SOP + 群体策略 + 计划文档规格拼成一段可注入 system prompt 的知识块 */
export function sopContext(skillType, groupType) {
  const t = skillTypeSop(skillType)
  const g = groupStrategy(groupType)
  const lines = [
    `【技能类型 SOP · ${t.name}】`,
    `标准流程：${t.flow.join(' → ')}`,
    `校验门槛：${t.gate}`
  ]
  if (t.toolBindings.length) {
    lines.push(`工具-阶段绑定：${t.toolBindings.map((b) => `${b.tool} → ${b.stage}`).join('；')}`)
  }
  lines.push(
    `常见失败原因（须作为风险预警写入计划）：${t.failures.map((f, i) => `${i + 1}) ${f}`).join('；')}`,
    `【群体适配 · ${g.name}】`,
    g.strategy,
    `【计划文档规格】`,
    `章节：${PLAN_DOC_SPEC.sections.join(' / ')}；${PLAN_DOC_SPEC.stageMust}`,
    `篇幅限制：${PLAN_DOC_SPEC.limits.planDoc}，${PLAN_DOC_SPEC.limits.stages}，${PLAN_DOC_SPEC.limits.catalog}`
  )
  return lines.join('\n')
}

/** 5 类技能特征清单（供步骤 4 类型识别时作为判定依据） */
export function skillTypeCatalog() {
  return Object.values(SKILL_TYPES)
    .map((t) => `- ${t.key}（${t.name}）：${t.desc}；流程 ${t.flow.join('→')}`)
    .join('\n')
}

/**
 * 步骤 3-4 合并版：自由输入（可来自语音）→ 一次拆解出
 * 行业 / 知识大类 / 所需能力 / 需学软件 / 技能类型，返回同结构 JSON
 * @param {{goal:string, registry:{name:string,categories:string[]}[]}} p
 */
export function buildGoalDecomposePrompt({ goal, registry }) {
  const reg = Array.isArray(registry) ? registry : []
  const regText = reg
    .map((r) => {
      const cats = Array.isArray(r?.categories) ? r.categories : []
      const doms = r?.domains && typeof r.domains === 'object' ? r.domains : {}
      const body = cats
        .map((c) => {
          const list = Array.isArray(doms[c]) ? doms[c] : []
          return list.length ? `${c}（${list.join('、')}）` : c
        })
        .join('；')
      return `- ${r?.name ?? ''}：${body}`
    })
    .join('\n')
  return {
    system: `你是「问星」学习引擎的方向拆解器。用户用一句话（可能来自语音）描述想学的内容，你要判断它属于下列哪个行业，从中挑出最相关的知识大类，并在所选大类下挑出更细的细分方向，拆出所需能力与需学软件，并判定技能类型。

【可选行业与知识大类】（industry 与 categories 必须严格从此表逐字选取，不得编造；括号内为该大类下的细分方向）
${regText || '（注册表缺失：给出通用行业与大类名即可）'}

【技能类型判定依据】
${skillTypeCatalog()}

硬性要求：
- industry：必须严格等于上表某个行业名（冒号前的名字）
- categories：从该行业冒号后的大类里挑 1-4 个最相关的，逐字选取
- directions：从所选大类括号内的细分方向里挑 1-4 个最贴近用户目标的，逐字选取；用户目标明确指向某细分方向时（如"前端""运维""深度学习"）必须命中它
- capabilities：达成目标所需的核心能力（3-6 条，每条 12 字内，动词化）
- software：需要学习或使用的软件/工具/平台（0-6 条，没有则给空数组）
- skillType：${Object.keys(SKILL_TYPES).join(' | ')} 之一
- reason：判定理由（40 字内）

只返回 JSON：{"summary":"目标理解摘要（60 字内）","industry":"行业名","categories":["大类名"],"directions":["细分方向"],"capabilities":["能力"],"software":["软件"],"skillType":"...","reason":"..."}`,
    user: `我想学：${String(goal ?? '').trim() || '（未填写）'}`
  }
}

/** 步骤 3：学习目标理解 —— 返回 {summary, capabilities[], software[]} */
export function buildUnderstandPrompt(goal) {
  return {
    system: `你是「问星」学习引擎的学习目标理解器。理解用户想学的目标，输出其所需能力与需学软件。
只返回 JSON：{"summary":"对该学习内容的理解摘要（60 字内）","capabilities":["所需能力1","所需能力2"],"software":["需学软件/工具1","需学软件/工具2"]}`,
    user: `我要学习：${String(goal ?? '').trim() || '（未填写）'}`
  }
}

/** 步骤 4：技能类型识别 —— 返回 {skillType, reason} */
export function buildClassifyPrompt(goal, summary) {
  return {
    system: `你是「问星」学习引擎的技能类型识别器。依据下列 5 类技能特征，判定该学习目标归属的技能类型并给出理由。
${skillTypeCatalog()}
只返回 JSON：{"skillType":"immersive|theory|mimicry|logic|mixed","reason":"判定理由（40 字内）"}`,
    user: `学习目标：${String(goal ?? '').trim()}\n目标理解：${String(summary ?? '').trim()}`
  }
}

/**
 * 步骤 5-8：一次生成能力拆解 + 大纲阶段 + 计划文档 + 知识目录
 * 返回 {decomposition:{dimensions[],tools[],risks[]}, outlineStages:[{name,type,days,items[]}], planDoc, catalog}
 */
export function buildDraftPrompt({ goal, understanding, skillType, groupType, questionnaire }) {
  const t = skillTypeSop(skillType)
  const q = questionnaire && typeof questionnaire === 'object' ? questionnaire : {}
  const qText = Object.entries(q)
    .map(([k, v]) => `${k}：${Array.isArray(v) ? v.join('、') : v}`)
    .join('\n')
  return {
    system: `你是「问星」学习引擎的学习规划师，严格遵循下列 SOP 生成个性化学习计划，不得更改标准流程的顺序与门槛。

${sopContext(skillType, groupType)}

硬性要求：
- 大纲阶段必须严格套用所选类型的标准流程（共 ${t.flow.length} 段：${t.flow.join('→')}），可拆细但不可改名、不可跳段
- 各阶段的校验门槛原文写入计划文档
- 工具拆解必须与阶段绑定一致；无绑定关系的类型（混合型）按阶段主学习方式判定
- 风险预警须取自该类技能常见失败原因
- 知识目录与大纲阶段一一对应

只返回 JSON：{"decomposition":{"dimensions":["能力维度"],"tools":[{"name":"工具名","stage":"绑定阶段"}],"risks":["风险点"]},"outlineStages":[{"name":"阶段名","type":"immersive|theory|mimicry|logic|mixed","days":3,"items":["知识点1","知识点2"]}],"planDoc":"Markdown 计划文档","catalog":[{"id":"节点id","title":"节点标题","children":[]}]}`,
    user: `学习目标：${String(goal ?? '').trim()}
目标理解：${JSON.stringify(understanding ?? {})}
技能类型：${skillType}（${t.name}）
群体：${groupType}
【问卷答案】
${qText || '（未填写）'}`
  }
}

/** 步骤 9：按用户反馈重新生成计划 —— 返回同上 draft 结构 */
export function buildRevisePrompt({ planDoc, outlineStages, feedback, skillType, groupType }) {
  return {
    system: `你是「问星」学习引擎的学习规划师。按用户反馈修订既有学习计划，保持所选类型的标准流程与校验门槛不变。
${sopContext(skillType, groupType)}
只返回 JSON：{"outlineStages":[...],"planDoc":"Markdown 计划文档","catalog":[...]}`,
    user: `原计划文档：\n${String(planDoc ?? '')}\n\n原大纲阶段：\n${JSON.stringify(outlineStages ?? [])}\n\n用户修改要求：${String(feedback ?? '').trim()}`
  }
}

/** 步骤 12：生成学习周报（Markdown） */
export function buildReportPrompt({ goal, skillType, stats, weekStart, weekEnd, tasks }) {
  const t = skillTypeSop(skillType)
  return {
    system: `你是「问星」学习引擎的学习复盘师。根据本周任务完成情况，生成一份学习周报（Markdown）。
周报须包含三节：本周完成情况、知识掌握度复盘（结合 ${t.name} 的门槛：${t.gate}）、下周建议。
篇幅 ≤400 字，务实具体，不空喊口号。`,
    user: `学习目标：${String(goal ?? '').trim()}
周期：${weekStart} ~ ${weekEnd}
统计：${JSON.stringify(stats ?? {})}
本周任务：\n${JSON.stringify(tasks ?? [])}`
  }
}
