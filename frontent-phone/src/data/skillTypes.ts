// 问星 — 个性化学习计划：5 类技能展示信息 + 3 类群体 + 8 组需求问卷定义
// 问卷第 8 题（typeAdapt）按所选技能类型动态切换；goalHeight / deadline / typeAdapt 允许填空

export interface SkillTypeMeta {
  key: string // immersive | theory | mimicry | logic | mixed
  name: string // 中文名
  desc: string // 卡片描述
  icon: string // 图标字符
  color: string // 甘特阶段条 / 标签配色
}

export const skillTypes: SkillTypeMeta[] = [
  {
    key: 'immersive',
    name: '沉浸式实践类',
    desc: '在真实或仿真场景中反复操作，靠实际操作与故障应对形成技能',
    icon: '◉',
    color: '#2dd4bf'
  },
  {
    key: 'theory',
    name: '理论识记类',
    desc: '以概念、原理与事实的理解记忆为主，靠间隔复习与输出检测巩固',
    icon: '▤',
    color: '#818cf8'
  },
  {
    key: 'mimicry',
    name: '模仿演练类',
    desc: '从优秀样稿逐层复刻，靠对比差异与要素替换逼近标杆水准',
    icon: '❖',
    color: '#c084fc'
  },
  {
    key: 'logic',
    name: '逻辑推导类',
    desc: '从问题定义到符号化推导，靠边界验证与多解替换训练严谨思维',
    icon: '∴',
    color: '#fbbf24'
  },
  {
    key: 'mixed',
    name: '混合型技能',
    desc: '实践、识记、模仿、推导兼而有之，按阶段拆分主学习方式组合推进',
    icon: '✦',
    color: '#f87171'
  }
]

/** 按 key 取类型展示信息（未知 key 兜底为混合型） */
export function skillTypeMeta(key: string): SkillTypeMeta {
  return skillTypes.find((t) => t.key === key) ?? skillTypes[skillTypes.length - 1]
}

export interface GroupTypeMeta {
  key: string // student | worker | mass
  name: string
  desc: string
  icon: string
}

export const groupTypes: GroupTypeMeta[] = [
  { key: 'student', name: '学生', desc: '在校学习 / 备考升学', icon: '✎' },
  { key: 'worker', name: '职场', desc: '在职提升 / 转行求职', icon: '◈' },
  { key: 'mass', name: '其他', desc: '兴趣自学 / 灵活安排', icon: '✿' }
]

export interface PlanQuestionOption {
  label: string
  value: string
}

export interface PlanQuestion {
  key: string
  title: string
  subtitle?: string
  options: PlanQuestionOption[]
  /** 是否允许「其他」填空 */
  allowCustom: boolean
}

// 前 7 组固定问卷（第 8 组见 typeAdaptQuestions，按所选类型动态取题）
export const planQuestions: PlanQuestion[] = [
  {
    key: 'goalType',
    title: '这次学习的目标是？',
    subtitle: '目标类型决定计划的侧重点与验收方式',
    allowCustom: false,
    options: [
      { label: '应对考试', value: '应对考试' },
      { label: '技能提升', value: '技能提升' },
      { label: '兴趣驱动', value: '兴趣驱动' }
    ]
  },
  {
    key: 'goalHeight',
    title: '期望达到什么高度？',
    subtitle: '可填考试分数 / 目标证书 / 完整项目等具体高度',
    allowCustom: true,
    options: [
      { label: '达到及格线，通过考试', value: '达到及格线，通过考试' },
      { label: '拿到目标证书或目标分数', value: '拿到目标证书或目标分数' },
      { label: '独立完成一个完整项目', value: '独立完成一个完整项目' },
      { label: '达到可接单、可上岗的水准', value: '达到可接单、可上岗的水准' }
    ]
  },
  {
    key: 'weeklyTime',
    title: '每周能付出多少时间？',
    subtitle: '按稳定可投入的中位数估计，决定任务粒度',
    allowCustom: false,
    options: [
      { label: '每周 3 小时以内', value: '每周 3 小时以内' },
      { label: '每周 3-7 小时', value: '每周 3-7 小时' },
      { label: '每周 7-14 小时', value: '每周 7-14 小时' },
      { label: '每周 14 小时以上', value: '每周 14 小时以上' }
    ]
  },
  {
    key: 'rhythm',
    title: '期望的学习节奏与每日时长？',
    subtitle: '决定每日任务如何排期',
    allowCustom: false,
    options: [
      { label: '每天推进，每次 20-45 分钟', value: '每天推进，每次 20-45 分钟' },
      { label: '每天推进，每次 1-2 小时', value: '每天推进，每次 1-2 小时' },
      { label: '仅工作日学习，周末休息', value: '仅工作日学习，周末休息' },
      { label: '仅周末集中投入', value: '仅周末集中投入' }
    ]
  },
  {
    key: 'deliverable',
    title: '期望的学习成果与交付物？',
    subtitle: '计划将围绕交付物倒排验收节点',
    allowCustom: false,
    options: [
      { label: '可运行的项目作品', value: '可运行的项目作品' },
      { label: '作品集或成果展示', value: '作品集或成果展示' },
      { label: '证书或考试成绩', value: '证书或考试成绩' },
      { label: '笔记与知识体系沉淀', value: '笔记与知识体系沉淀' }
    ]
  },
  {
    key: 'baseline',
    title: '目前的知识基础？',
    subtitle: '基线决定起点难度与入门阶段的篇幅',
    allowCustom: false,
    options: [
      { label: '零基础，完全没接触过', value: '零基础，完全没接触过' },
      { label: '了解概念，但没动手做过', value: '了解概念，但没动手做过' },
      { label: '跟过教程，能照做完成', value: '跟过教程，能照做完成' },
      { label: '有项目经验，想系统提升', value: '有项目经验，想系统提升' }
    ]
  },
  {
    key: 'deadline',
    title: '有特殊的时间安排吗？',
    subtitle: '如考试倒计时 / 截止日期，将在计划文档中标注；没有可直选',
    allowCustom: true,
    options: [
      { label: '没有明确期限，按节奏稳步来', value: '没有明确期限' },
      { label: '1 个月内有明确节点', value: '1 个月内有明确节点' },
      { label: '3 个月内有明确节点', value: '3 个月内有明确节点' },
      { label: '半年内有明确节点', value: '半年内有明确节点' }
    ]
  }
]

// 第 8 题：技能类型适配题（按步骤 3 所选类型动态切换，均允许填空）
export const typeAdaptQuestions: Record<string, PlanQuestion> = {
  immersive: {
    key: 'typeAdapt',
    title: '你具备哪些实践 / 仿真条件？',
    subtitle: '沉浸式实践依赖场景与设备，计划将按你的条件安排场景模拟',
    allowCustom: true,
    options: [
      { label: '有真实操作环境（设备 / 账号 / 场地）', value: '有真实操作环境（设备/账号/场地）' },
      { label: '有仿真或模拟软件条件', value: '有仿真或模拟软件条件' },
      { label: '只有普通电脑，需纯软件方案', value: '只有普通电脑，需纯软件方案' },
      { label: '暂无条件，需要低成本替代方案', value: '暂无条件，需要低成本替代方案' }
    ]
  },
  theory: {
    key: 'typeAdapt',
    title: '你平时习惯用什么记忆工具？',
    subtitle: '理论识记类计划将把知识切块接入你的记忆工具习惯',
    allowCustom: true,
    options: [
      { label: '记忆卡工具（如 Anki）', value: '习惯用记忆卡工具（如 Anki）' },
      { label: '思维导图或知识图谱', value: '习惯用思维导图或知识图谱' },
      { label: '纸质笔记、手写整理', value: '习惯纸质笔记、手写整理' },
      { label: '没有固定工具，需要推荐', value: '没有固定工具，需要推荐' }
    ]
  },
  mimicry: {
    key: 'typeAdapt',
    title: '你手上有可模仿的素材库吗？',
    subtitle: '模仿演练从样稿拆解开始，素材质量决定复刻上限',
    allowCustom: true,
    options: [
      { label: '有现成的高质量样稿或作品集', value: '有现成的高质量样稿或作品集' },
      { label: '知道去哪找素材，但没整理过', value: '知道去哪找素材，但没整理过' },
      { label: '完全没有素材，需要推荐采集渠道', value: '完全没有素材，需要推荐采集渠道' },
      { label: '有自己的作品，想对标优秀样稿提升', value: '有自己的作品，想对标优秀样稿提升' }
    ]
  },
  logic: {
    key: 'typeAdapt',
    title: '你习惯用什么建模 / 验证工具？',
    subtitle: '逻辑推导类计划将把约束梳理与边界验证嵌入你的工具流',
    allowCustom: true,
    options: [
      { label: '习惯纸笔推导', value: '习惯纸笔推导' },
      { label: '习惯流程图或结构梳理工具', value: '习惯流程图或结构梳理工具' },
      { label: '习惯用编程或计算工具做验证', value: '习惯用编程或计算工具做验证' },
      { label: '没有固定工具，需要推荐', value: '没有固定工具，需要推荐' }
    ]
  },
  mixed: {
    key: 'typeAdapt',
    title: '你更希望计划侧重哪个阶段？',
    subtitle: '混合型技能按阶段拆分主学习方式，可指定侧重点',
    allowCustom: true,
    options: [
      { label: '侧重先打理论基础，再进入实践', value: '侧重先打理论基础，再进入实践' },
      { label: '侧重直接上手实践，边做边补理论', value: '侧重直接上手实践，边做边补理论' },
      { label: '侧重模仿优秀案例优先', value: '侧重模仿优秀案例优先' },
      { label: '均衡推进，由 AI 按阶段判定', value: '均衡推进，由 AI 按阶段判定' }
    ]
  }
}

/** 取第 index 题（0-6 为固定题；7 为类型适配题，按所选技能类型动态切换） */
export function questionAt(index: number, skillType: string): PlanQuestion {
  if (index < planQuestions.length) return planQuestions[index]
  return typeAdaptQuestions[skillType] ?? typeAdaptQuestions.mixed
}
