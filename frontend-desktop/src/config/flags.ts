// 特性开关：默认值集中在此，线上可通过 localStorage.flags_override 临时覆盖（无需发版）
// 用法：组件内 import { FLAGS } from '@/config/flags'，模板中 v-if="FLAGS.XXX" 或动态组件切换
export interface FeatureFlags {
  /** 夜间主题 */
  NIGHT_THEME: boolean
  /** 任务卡四字段 */
  TASK_CARD_V2: boolean
  /** 微反馈 */
  FEEDBACK_V1: boolean
  /** Agent 面板整改 */
  AGENT_PANEL_V2: boolean
  /** 单文档模式（去掉标签栏） */
  SINGLE_DOC_MODE: boolean
  /** epub 异步备份 */
  EPUB_BACKUP: boolean
  /** 题库卡片改版 */
  QB_CARD_V2: boolean
  /** 学习计划流程重构（单页合同 / 测评后置 / AI 精细大纲 / 深规划确认） */
  PLAN_FLOW_V2: boolean
  /** 社区书籍书架 */
  BOOKSHELF_V1: boolean
}

export const FLAGS: FeatureFlags = {
  NIGHT_THEME: true,
  TASK_CARD_V2: true,
  FEEDBACK_V1: true,
  AGENT_PANEL_V2: true,
  SINGLE_DOC_MODE: true,
  EPUB_BACKUP: true,
  QB_CARD_V2: true,
  PLAN_FLOW_V2: true,
  BOOKSHELF_V1: true
}

/**
 * 读取 localStorage.flags_override 覆盖默认值。
 * 只接受 FLAGS 中已声明的键且值为布尔，其余字段与非法 JSON 一律忽略。
 * 必须在应用挂载前调用一次。
 */
export function applyFlagsOverride(): void {
  try {
    const raw = localStorage.getItem('flags_override')
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const patch = parsed as Record<string, unknown>
    for (const key of Object.keys(FLAGS) as Array<keyof FeatureFlags>) {
      const value = patch[key]
      if (typeof value === 'boolean') FLAGS[key] = value
    }
  } catch {
    // 覆盖配置损坏时保留默认值，不影响启动
  }
}
