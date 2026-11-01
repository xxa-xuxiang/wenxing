// 问星 — 行业分类 md 解析器（学习页问卷/推荐链路用）〔自桌面端 utils/industryMd.ts 移植〕
// 文件名避开常见名，防与其他并行任务冲突。
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
        if (leaves >= maxLeaves) {
          truncated = true
          break
        }
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
