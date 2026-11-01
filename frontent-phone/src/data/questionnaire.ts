// 问星 v0.1 — 学习合同问卷（SOP 驱动）
// 步骤 0「起始领域」（行业 + 大类多选）为动态数据，不在此表；此处为 SOP 固定五题
// 每题为选择题 + 「其他」填空项

export interface QuestionOption {
  label: string
  value: string
}

export interface QuestionStep {
  key: string
  title: string
  subtitle?: string
  options: QuestionOption[]
}

export const questionnaireSteps: QuestionStep[] = [
  {
    key: 'sopPath',
    title: '这次学习的目的是？',
    subtitle: '目的决定路径：问星将按对应的 SOP 节奏为你规划',
    options: [
      { label: '从零入门', value: '从零入门' },
      { label: '转行迁移', value: '转行迁移' },
      { label: '短期考证', value: '短期考证' },
      { label: '岗位晋升', value: '岗位晋升' },
      { label: '跨岗扩展', value: '跨岗扩展' },
      { label: '项目式实战', value: '项目式实战' }
    ]
  },
  {
    key: 'goal30',
    title: '30 天后，你希望独立完成什么？',
    subtitle: '锁定可观察、可验收的结果（SOP 节点0 必答）',
    options: [
      { label: '独立复现 3-5 个关键任务，产出首份作品', value: '独立复现 3-5 个关键任务，产出首份作品' },
      { label: '通过目标证书或考试', value: '通过目标证书或考试' },
      { label: '在岗位上承担更复杂的任务', value: '在岗位上承担更复杂的任务' },
      { label: '交付一个可运行的真实项目', value: '交付一个可运行的真实项目' }
    ]
  },
  {
    key: 'baseline',
    title: '对所选方向，你目前的基线是？',
    subtitle: '基线决定起点难度（能力基线 0-4 级）',
    options: [
      { label: '完全没接触过', value: '完全没接触过' },
      { label: '了解概念，但没动手做过', value: '了解概念，但没动手做过' },
      { label: '能在提示或教程下完成', value: '能在提示或教程下完成' },
      { label: '能独立完成符合标准的任务', value: '能独立完成符合标准的任务' }
    ]
  },
  {
    key: 'timeCommitment',
    title: '每周可稳定投入多少时间？',
    subtitle: '按中位数估计，不按最好状态（决定任务粒度）',
    options: [
      { label: '每天不到 20 分钟', value: '每天不到 20 分钟（只做微任务）' },
      { label: '每天 20-45 分钟', value: '每天 20-45 分钟' },
      { label: '每天 1-2 小时', value: '每天 1-2 小时' },
      { label: '不固定，仅周末集中投入', value: '不固定，仅周末集中投入' }
    ]
  },
  {
    key: 'obstacle',
    title: '你最大的学习障碍是？',
    subtitle: '问星将为你的计划配上对应的纠正措施',
    options: [
      { label: '拖延', value: '拖延' },
      { label: '完美主义', value: '完美主义' },
      { label: '畏难', value: '畏难' },
      { label: '时间碎片化', value: '时间碎片化' },
      { label: '缺少反馈', value: '缺少反馈' }
    ]
  }
]
