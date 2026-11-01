// 问星 v0.1 — 行业分类 md 解析器（星图 / 问卷 / 定制器共享）
// md 结构：# 编号大类 → ## 编号领域 → ### 编号技术栈 → - 能力项（知识点，叶子）
import type { KpPath } from '@/types'

export interface IndustryNode {
  name: string
  code: string
  children: IndustryNode[]
}

const parseCache = new Map<string, IndustryNode>()

export function parseIndustryMd(src: string): IndustryNode {
  const cached = parseCache.get(src)
  if (cached) return cached
  const root: IndustryNode = { name: '', code: '', children: [] }
  // stack[0] 为行业虚拟根；仅处理有编号的 # 大类（跳过「# 分类方式」说明章）
  const stack: Array<{ level: number; node: IndustryNode }> = [{ level: 0, node: root }]
  const pushNode = (level: number, name: string, code: string) => {
    const node: IndustryNode = { name, code, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop()
    stack[stack.length - 1].node.children.push(node)
    stack.push({ level, node })
  }
  for (const line of src.split('\n')) {
    const t = line.trim()
    const h = /^(#{1,3})\s+(.+)$/.exec(t)
    if (h) {
      const level = h[1].length
      const rawTitle = h[2].trim()
      const code = /^(\d+(?:\.\d+)*)/.exec(rawTitle)?.[1] ?? ''
      if (level === 1 && !code) continue // 无编号顶级章（如「分类方式」）跳过
      const name = rawTitle.replace(/^[\d.]+\s*/, '') || rawTitle
      pushNode(level, name, code)
      continue
    }
    const li = /^-\s+(.+)$/.exec(t)
    if (li && stack.length > 1) {
      // 能力项挂在当前技术栈(###)下，父级保持不变（不压栈）
      stack[stack.length - 1].node.children.push({ name: li[1].trim(), code: '', children: [] })
    }
  }
  parseCache.set(src, root)
  return root
}

/** 大类子树 → 紧凑文本（供 AI prompt 使用），知识点过多时截断防爆 token */
export function flattenCategory(category: IndustryNode, maxLeaves = 200): string {
  const lines: string[] = [`# ${category.name}`]
  let leaves = 0
  let truncated = false
  for (const domain of category.children) {
    lines.push(`## ${domain.name}`)
    for (const stack of domain.children) {
      const kps: string[] = []
      for (const kp of stack.children) {
        if (leaves >= maxLeaves) { truncated = true; break }
        kps.push(kp.name)
        leaves += 1
      }
      lines.push(`### ${stack.name}：${kps.join('、')}${truncated ? '…' : ''}`)
      if (truncated) break
    }
    if (truncated) break
  }
  return lines.join('\n')
}

/** 在大类子树中按知识点名查路径（叶子精确 → 技术栈/领域名兜底，锚到其下第一个叶子） */
export function findKpPath(category: IndustryNode, kpName: string): KpPath | null {
  for (const domain of category.children) {
    for (const stack of domain.children) {
      for (const kp of stack.children) {
        if (kp.name === kpName) {
          return { category: category.name, domain: domain.name, stack: stack.name, name: kp.name }
        }
      }
    }
  }
  // 兜底：AI 偶将技术栈/领域名当作知识点返回 → 锚到该节点下第一个叶子，保证星图状态球可点亮
  for (const domain of category.children) {
    if (domain.name === kpName) {
      const s = domain.children.find((x) => x.children.length > 0)
      if (s) return { category: category.name, domain: domain.name, stack: s.name, name: s.children[0].name }
    }
    for (const stack of domain.children) {
      if (stack.name === kpName && stack.children.length > 0) {
        return { category: category.name, domain: domain.name, stack: stack.name, name: stack.children[0].name }
      }
    }
  }
  return null
}

/**
 * v0.9 盲区映射兜底：用 AI 返回的盲区 concept 在大类子树中模糊匹配最相关的叶子知识点。
 * 匹配策略（按优先级）：
 *   1. 叶子名精确等于 concept
 *   2. 叶子名包含 concept 或 concept 包含叶子名（双向子串）
 *   3. 字符重叠率 ≥ 阈值时取最高（concept 去标点后与叶子名求共同字符集占比）
 * 全部失败返回 null（显式无效值，由调用方决定回退策略，不在此伪造业务值）。
 */
const OVERLAP_THRESHOLD = 0.4
export function findKpByConcept(category: IndustryNode, concept: string): KpPath | null {
  const c = concept.trim()
  if (!c) return null

  // 收集所有叶子 + 路径
  const leaves: Array<{ kp: string; domain: string; stack: string }> = []
  for (const domain of category.children) {
    for (const stack of domain.children) {
      for (const kp of stack.children) {
        leaves.push({ kp: kp.name, domain: domain.name, stack: stack.name })
      }
    }
  }
  if (leaves.length === 0) return null

  // 1. 精确匹配
  const exact = leaves.find((l) => l.kp === c)
  if (exact) {
    return { category: category.name, domain: exact.domain, stack: exact.stack, name: exact.kp }
  }

  // 2. 双向子串匹配
  const sub = leaves.find((l) => l.kp.includes(c) || c.includes(l.kp))
  if (sub) {
    return { category: category.name, domain: sub.domain, stack: sub.stack, name: sub.kp }
  }

  // 3. 字符重叠率
  const cSet = new Set([...c])
  let best: { l: typeof leaves[number]; score: number } | null = null
  for (const l of leaves) {
    const lSet = new Set([...l.kp])
    const common = [...cSet].filter((ch) => lSet.has(ch)).length
    const score = common / Math.max(cSet.size, lSet.size)
    if (!best || score > best.score) best = { l, score }
  }
  if (best && best.score >= OVERLAP_THRESHOLD) {
    return { category: category.name, domain: best.l.domain, stack: best.l.stack, name: best.l.kp }
  }
  return null
}
