// 问星 v4 — 学习计划排期独立模块（纯函数，不依赖任何 store）
// 从 learnStore 抽出：日期工具 + 分块排期 + 确定性回退分块 + 大纲反推技能组 + 计划 Markdown 存档
import type { BaselineResult, Domain, KpPath, OutlineTask, PlanBlock } from '@/types'
import type { PlanBlockDraft, SkillGroup } from '@/services/aiService'

/** 本地日期格式化（YYYY-MM-DD，本地时区） */
export function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** YYYY-MM-DD → 本地 0 点 Date（与 fmtDate 互逆） */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** 从今日起为各模块顺序排期 */
export function scheduleBlocks(drafts: PlanBlockDraft[], tasks: OutlineTask[]): PlanBlock[] {
  const byTitle = new Map(tasks.map((t) => [t.title, t.id]))
  const assigned = new Set<string>()
  const blocks: PlanBlock[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  for (const d of drafts) {
    const taskIds = (d.items ?? [])
      .map((title) => byTitle.get(title))
      .filter((id): id is string => Boolean(id) && !assigned.has(id!))
    for (const id of taskIds) assigned.add(id)
    if (taskIds.length === 0) continue
    const durationDays = Math.max(1, Math.round(d.durationDays) || taskIds.length * 2)
    const start = new Date(cursor)
    const end = new Date(cursor)
    end.setDate(end.getDate() + durationDays - 1)
    blocks.push({
      id: `block-${Date.now()}-${blocks.length}`,
      name: d.name,
      goal: d.goal,
      durationDays,
      startDate: fmtDate(start),
      endDate: fmtDate(end),
      acceptance: d.acceptance,
      taskIds
    })
    cursor.setDate(cursor.getDate() + durationDays)
  }
  // 兜底：未被 AI 覆盖的任务追加为末位「补充巩固」模块，保证大纲任务全部分块
  const rest = tasks.filter((t) => !assigned.has(t.id)).map((t) => t.id)
  if (rest.length > 0) {
    const durationDays = rest.length * 2
    const start = new Date(cursor)
    const end = new Date(cursor)
    end.setDate(end.getDate() + durationDays - 1)
    blocks.push({
      id: `block-${Date.now()}-${blocks.length}`,
      name: '补充巩固',
      goal: '补齐学习计划未覆盖的知识点，做到不留盲区',
      durationDays,
      startDate: fmtDate(start),
      endDate: fmtDate(end),
      acceptance: '读完本模块全部知识点文档，并能复述每个知识点的核心概念',
      taskIds: rest
    })
  }
  return blocks
}

/** 确定性回退分块：每个技能组一块（AI 不可用 / 返回为空时）；有测评结果时薄弱模块优先且期限加权 */
export function fallbackDrafts(groups: SkillGroup[], baseline: BaselineResult | null): PlanBlockDraft[] {
  const rateByTitle = new Map<string, number>()
  for (const it of baseline?.items ?? []) rateByTitle.set(it.title, it.rate)
  const scored = groups.map((g) => {
    const rates = g.items
      .map((i) => rateByTitle.get(i.title))
      .filter((r): r is number => r !== undefined)
    // avg = -1 表示该组无测评数据（排在最后）
    const avg = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : -1
    const baseDays = Math.max(2, g.items.length * 2)
    return {
      avg,
      draft: {
        name: g.name,
        goal: `深度掌握「${g.name}」：${g.description || '覆盖全部知识点，能讲解并运用'}`,
        // 薄弱组（平均掌握率 < 60%）期限 ×1.5
        durationDays: avg >= 0 && avg < 0.6 ? Math.max(2, Math.round(baseDays * 1.5)) : baseDays,
        acceptance: '读完本模块全部知识点文档，并能向他人复述每个知识点的核心概念与用途',
        items: g.items.map((i) => i.title)
      } satisfies PlanBlockDraft
    }
  })
  // 有测评结果：掌握率低的模块排前面（无数据的排最后）
  scored.sort((a, b) => {
    if (a.avg < 0 && b.avg < 0) return 0
    if (a.avg < 0) return 1
    if (b.avg < 0) return -1
    return a.avg - b.avg
  })
  return scored.map((s) => s.draft)
}

/** 无待测评技能组时（如刷新后用本地大纲继续）→ 用大纲任务反向拼出分块输入 */
export function groupsFromOutline(outline: OutlineTask[]): SkillGroup[] {
  const buckets = new Map<string, OutlineTask[]>()
  for (const t of outline) {
    const key = t.description?.split(' · ')[0] || (t.kp?.category ?? '学习任务')
    const list = buckets.get(key) ?? []
    list.push(t)
    buckets.set(key, list)
  }
  return [...buckets.entries()].map(([name, tasks]) => ({
    name,
    description: tasks[0]?.description?.split(' · ').slice(1).join(' · ') ?? '',
    reason: '',
    items: tasks.map((t) => ({ title: t.title, description: t.description ?? '', kp: t.kp?.name }))
  }))
}

/** 学习计划 → Markdown 文本（存档到后端 data/plans/<行业>/<标题>.md） */
export function buildPlanMarkdown(blocks: PlanBlock[], domain: Domain | null, outline: OutlineTask[]): string {
  const lines: string[] = [
    `# ${domain?.name ?? ''} 学习计划`,
    '',
    `> 生成时间：${fmtDate(new Date())} · 共 ${blocks.length} 个模块 · 深度掌握导向`,
    ''
  ]
  for (const [i, b] of blocks.entries()) {
    lines.push(`## 模块 ${i + 1}：${b.name}`)
    lines.push('')
    lines.push(`- **学习目标**：${b.goal}`)
    lines.push(`- **学习期限**：${b.startDate} ~ ${b.endDate}（${b.durationDays} 天）`)
    lines.push(`- **验收标准**：${b.acceptance}`)
    lines.push('- **知识点**：')
    for (const id of b.taskIds) {
      const t = outline.find((x) => x.id === id)
      if (t) lines.push(`  - [ ] ${t.title}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 知识点路径 → 展示用完整路径文本 */
export function kpPathText(kp: KpPath | undefined, domainName: string): string {
  return kp ? `${domainName} / ${kp.category} / ${kp.domain} / ${kp.stack} / ${kp.name}` : ''
}
