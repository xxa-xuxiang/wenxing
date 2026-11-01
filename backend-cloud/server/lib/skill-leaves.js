// 问星 v1.1 — 技能叶子：稳定键与 md 解析（服务端共享：导入脚本 / 题目路由 / 填充管线）
import crypto from 'node:crypto'

/** 跨次导入/调用稳定的叶子唯一键（路径任一层改名都会成为新叶子，符合预期） */
export function leafKeyOf({ industry, category, domain, stack, name }) {
  return crypto
    .createHash('sha1')
    .update([industry ?? '', category ?? '', domain ?? '', stack ?? '', name ?? ''].join('|'))
    .digest('hex')
}

/**
 * 解析单个行业 md，产出叶子清单（逻辑对齐 web/src/utils/industryMd.ts）
 * md 结构：# 编号大类 → ## 编号领域 → ### 编号技术栈 → - 能力项（叶子）
 */
export function parseLeaves(src, industry) {
  const out = []
  let category = ''
  let domain = ''
  let stack = ''
  for (const line of String(src).split('\n')) {
    const t = line.trim()
    const h = /^(#{1,3})\s+(.+)$/.exec(t)
    if (h) {
      const level = h[1].length
      const rawTitle = h[2].trim()
      const code = /^(\d+(?:\.\d+)*)/.exec(rawTitle)?.[1] ?? ''
      if (level === 1 && !code) continue
      const name = rawTitle.replace(/^[\d.]+\s*/, '') || rawTitle
      if (level === 1) {
        category = name
        domain = ''
        stack = ''
      } else if (level === 2) {
        domain = name
        stack = ''
      } else {
        stack = name
      }
      continue
    }
    const li = /^-\s+(.+)$/.exec(t)
    if (li) {
      const name = li[1].trim()
      if (!name) continue
      out.push({
        industry,
        category,
        domain,
        stack,
        name,
        pathText: [industry, category, domain, stack, name].filter(Boolean).join(' / '),
        leafKey: leafKeyOf({ industry, category, domain, stack, name })
      })
    }
  }
  return out
}
