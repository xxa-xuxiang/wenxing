// 问星社区 — Notion 式块编辑器：块数据模型 + Markdown 序列化 + 子页面存储
// 每一行内容是一个独立的块；发布时序列化为 Markdown（与详情页 renderMarkdown 渲染兼容）
// 行内格式采用 Markdown 记号：**粗体** *斜体* __下划线__ ~~删除线~~ `代码` ==颜色== [文本](链接)

// 子页面数据统一走 @/utils/storage（命名空间 wenxing:v01: + 用户隔离 + 异常降级）。
// 注：storage.ts 不反向依赖本文件，不存在循环依赖。
import { storage } from '@/utils/storage'

export type BlockType =
  | 'p' | 'h1' | 'h2' | 'h3'
  | 'ul' | 'ol' | 'todo' | 'quote'
  | 'code' | 'divider' | 'image' | 'table' | 'db'
  | 'toggle' | 'mindmap' | 'file' | 'embed' | 'page' | 'columns'

export interface EdBlock {
  id: string
  type: BlockType
  /** 行内内容（Markdown 记号）；代码块为代码全文，思维导图为按行节点（两位空格一层） */
  text: string
  /** 缩进层级 0-3（列表/待办/段落） */
  indent: number
  /** todo 勾选 */
  checked?: boolean
  /** 代码块语言 */
  lang?: string
  /** 图片/文件/嵌入 URL */
  url?: string
  /** 图片说明 / 文件名 */
  name?: string
  /** 折叠块展开状态 */
  open?: boolean
  /** 表格 / 多维表数据（首行为表头） */
  rows?: string[][]
  /** 折叠块子块 */
  children?: EdBlock[]
  /** 分栏：每列一个块数组 */
  cols?: EdBlock[][]
  /** 页面引用：sp_* = 子页面（本地），post:<id> = 社区帖子 */
  pageId?: string
  /** 文字颜色（调色板 id） */
  color?: string
}

let seq = 0
export function uid(): string {
  seq += 1
  return `bk_${Date.now().toString(36)}_${seq}`
}

export function newBlock(type: BlockType = 'p', text = ''): EdBlock {
  const b: EdBlock = { id: uid(), type, text, indent: 0 }
  if (type === 'todo') b.checked = false
  if (type === 'code') { b.lang = ''; b.text = '' }
  if (type === 'table' || type === 'db') b.rows = [['列1', '列2'], ['内容', '内容']]
  if (type === 'toggle') { b.open = true; b.children = [] }
  if (type === 'mindmap') b.text = '中心主题\n  分支一\n  分支二'
  if (type === 'columns') b.cols = [[], []]
  return b
}

/** 新文档初始块 */
export function defaultDoc(): EdBlock[] {
  return [newBlock('p', '')]
}

// ===== Markdown 序列化（发布用，与详情页渲染器兼容） =====
const COLOR_LABELS: Record<string, string> = {
  amber: '琥珀',
  teal: '青绿',
  rose: '绯红',
  violet: '紫罗兰'
}

export function colorLabel(c?: string): string {
  return c ? COLOR_LABELS[c] ?? c : ''
}

function tableToMd(rows: string[][]): string[] {
  if (!rows || rows.length === 0) return []
  const head = `| ${rows[0].join(' | ')} |`
  const sep = `| ${rows[0].map(() => '---').join(' | ')} |`
  const body = rows.slice(1).map((r) => `| ${r.join(' | ')} |`)
  return [head, sep, ...body]
}

function serializeList(list: EdBlock[], extraIndent = ''): string[] {
  const out: string[] = []
  let ol = 0
  for (const b of list) {
    const pad = extraIndent + '  '.repeat(b.indent)
    ol = b.type === 'ol' ? ol + 1 : 0
    switch (b.type) {
      case 'h1': out.push(`# ${b.text}`); break
      case 'h2': out.push(`## ${b.text}`); break
      case 'h3': out.push(`### ${b.text}`); break
      case 'ul': out.push(`${pad}- ${b.text}`); break
      case 'ol': out.push(`${pad}${ol}. ${b.text}`); break
      case 'todo': out.push(`${pad}- [${b.checked ? 'x' : ' '}] ${b.text}`); break
      case 'quote': out.push(`> ${b.text}`); break
      case 'code': out.push('```' + (b.lang || ''), b.text, '```'); break
      case 'divider': out.push('---'); break
      case 'image': out.push(`![${b.name || '图片'}](${b.url || ''})`); break
      case 'table': out.push(...tableToMd(b.rows ?? [])); break
      case 'db':
        out.push(...tableToMd(b.rows ?? []))
        break
      case 'toggle':
        out.push(`${pad}- **▸ ${b.text}**`)
        if (b.children?.length) out.push(...serializeList(b.children, `${pad}  `))
        break
      case 'mindmap':
        for (const line of b.text.split('\n')) {
          const m = /^(\s*)-(.*)$/.exec(line.trim()) ?? null
          out.push(`${pad}- ${(m ? m[2] : line).trim()}`)
        }
        break
      case 'file': out.push(`[📄 ${b.name || '附件'}](${b.url || ''})`); break
      case 'embed': out.push(`[🔗 嵌入内容](${b.url || ''})`); break
      case 'page':
        if (b.pageId?.startsWith('post:')) out.push(`[📄 ${b.text}](#/community/${b.pageId.slice(5)})`)
        else out.push(`📄 子页面：${b.text}`)
        break
      case 'columns':
        for (const cell of b.cols ?? []) out.push(...serializeList(cell, extraIndent))
        break
      default:
        out.push(pad + b.text)
    }
  }
  return out
}

/** 块树 → Markdown 文本 */
export function blocksToMarkdown(blocks: EdBlock[]): string {
  return serializeList(blocks).join('\n')
}

// ===== Markdown → 块（AI 结果 / 文本导入的逆向解析，覆盖常用语法） =====
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((x) => x.trim())
}

export function markdownToBlocks(src: string): EdBlock[] {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n')
  const out: EdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const s = raw.trim()
    if (s.startsWith('```')) {
      const lang = s.slice(3).trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // 跳过结束围栏
      const b = newBlock('code')
      b.lang = lang
      b.text = body.join('\n')
      out.push(b)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(s)) {
      out.push(newBlock('divider'))
      i += 1
      continue
    }
    const h = /^(#{1,4})\s+(.+?)\s*#*$/.exec(s)
    if (h) {
      const b = newBlock(h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3')
      b.text = h[2].trim()
      out.push(b)
      i += 1
      continue
    }
    const todo = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(s)
    if (todo) {
      const b = newBlock('todo')
      b.text = todo[2]
      b.checked = todo[1].toLowerCase() === 'x'
      out.push(b)
      i += 1
      continue
    }
    if (/^[-*]\s+/.test(s)) {
      const b = newBlock('ul')
      b.text = s.replace(/^[-*]\s+/, '')
      b.indent = Math.min(3, Math.floor((raw.length - raw.trimStart().length) / 2))
      out.push(b)
      i += 1
      continue
    }
    if (/^\d+\.\s+/.test(s)) {
      const b = newBlock('ol')
      b.text = s.replace(/^\d+\.\s+/, '')
      out.push(b)
      i += 1
      continue
    }
    if (s.startsWith('>')) {
      const b = newBlock('quote')
      b.text = s.replace(/^>\s?/, '')
      out.push(b)
      i += 1
      continue
    }
    if (s.startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const rows: string[][] = [splitRow(s)]
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      const b = newBlock('table')
      b.rows = rows
      out.push(b)
      continue
    }
    if (s === '') {
      i += 1
      continue
    }
    const b = newBlock('p')
    b.text = s
    out.push(b)
    i += 1
  }
  return out.length ? out : defaultDoc()
}

/** 全文档纯文本字数（不含空白） */
export function blocksCharCount(blocks: EdBlock[]): number {
  let n = 0
  const walk = (list: EdBlock[]) => {
    for (const b of list) {
      n += b.text.replace(/\s/g, '').length
      if (b.rows) for (const r of b.rows) for (const c of r) n += c.replace(/\s/g, '').length
      if (b.cols) walk(b.cols.flat())
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  return n
}

/** 统计子页面数 */
export function blocksPageCount(blocks: EdBlock[]): number {
  let n = 0
  const walk = (list: EdBlock[]) => {
    for (const b of list) {
      if (b.type === 'page' && b.pageId && !b.pageId.startsWith('post:')) n += 1
      if (b.cols) walk(b.cols.flat())
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  return n
}

/** 收集全部图片 URL（块图片 + 附件） */
export function blocksImageUrls(blocks: EdBlock[]): string[] {
  const urls: string[] = []
  const walk = (list: EdBlock[]) => {
    for (const b of list) {
      if (b.type === 'image' && b.url) urls.push(b.url)
      if (b.cols) walk(b.cols.flat())
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  return urls
}

// ===== 子页面（本地存储：草稿内嵌页面，点击块展开为全屏子编辑器） =====
export interface SubPageDoc {
  id: string
  title: string
  blocks: EdBlock[]
  updatedAt: number
}

const SUB_KEY = 'community:subpage'

export function loadSubPage(id: string): SubPageDoc | null {
  return storage.get<SubPageDoc | null>(`${SUB_KEY}:${id}`, null)
}

export function saveSubPage(doc: SubPageDoc): void {
  storage.set(`${SUB_KEY}:${doc.id}`, doc)
}

export function deleteSubPage(id: string): void {
  storage.remove(`${SUB_KEY}:${id}`)
}

// ===== 块样式定义（斜杠菜单 / 转换菜单共用） =====
export interface BlockDef {
  type: BlockType
  label: string
  hint: string
  desc: string
}

export const BLOCK_DEFS: BlockDef[] = [
  { type: 'p', label: '正文', hint: '¶', desc: '普通段落文本' },
  { type: 'h1', label: '一级标题', hint: 'H1', desc: '大节标题' },
  { type: 'h2', label: '二级标题', hint: 'H2', desc: '章节标题' },
  { type: 'h3', label: '三级标题', hint: 'H3', desc: '小节标题' },
  { type: 'ul', label: '无序列表', hint: '•', desc: '圆点列表' },
  { type: 'ol', label: '有序列表', hint: '1.', desc: '编号列表' },
  { type: 'todo', label: '待办', hint: '☑', desc: '可勾选任务' },
  { type: 'quote', label: '引用', hint: '❝', desc: '强调一段话' },
  { type: 'code', label: '代码块', hint: '{ }', desc: '等宽代码' },
  { type: 'divider', label: '分割线', hint: '—', desc: '分隔内容' },
  { type: 'image', label: '图片', hint: '▣', desc: '上传或粘贴图片' },
  { type: 'table', label: '表格', hint: '⊞', desc: '可编辑表格' },
  { type: 'db', label: '多维表', hint: '▦', desc: '带表头着色的数据表' },
  { type: 'toggle', label: '折叠列表', hint: '▸', desc: '可展开收起的分组' },
  { type: 'mindmap', label: '思维导图', hint: '🌲', desc: '按行编辑节点，自动成图' },
  { type: 'file', label: '文件', hint: '📎', desc: '附件链接卡片' },
  { type: 'embed', label: '嵌入内容', hint: '⧉', desc: 'B站/YouTube 等嵌入' },
  { type: 'page', label: '页面', hint: '📄', desc: '子页面或帖子引用' }
]
