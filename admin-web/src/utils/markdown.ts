// 问星 — Markdown 渲染（增强版，无第三方依赖）
// 供文档中心使用：标题锚点 / 代码块 / 表格 / 引用 / 有序无序列表 / 链接 / 行内格式 / 分隔线
// renderMarkdown 与 extractHeadings 共享 slug 规则与去重顺序，锚点 id 保持一致

export interface MdHeading {
  id: string
  text: string
  level: number
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 标题 slug：保留中文/字母/数字，连接符合并为 -；空标题兜底 */
function slugOf(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^\w一-龥\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
  return s || 'section'
}

/** 去掉行内 md 符号，得到纯标题文本 */
function plainText(s: string): string {
  return s.replace(/[`*]/g, '').trim()
}

/** 仅允许 http/https/mailto 与站内相对路径，阻断 javascript:/data: 等危险协议 */
function safeUrl(url: string): string {
  const u = url.trim()
  if (/^(#|\.{1,2}\/|\/(?!\/))/.test(u)) return u
  if (/^(https?:|mailto:)/i.test(u)) return u
  return ''
}

/** 行内格式：行内代码（占位保护）→ 链接 → 粗体 → 斜体 → 还原代码 */
function inlineMd(raw: string): string {
  const codes: string[] = []
  let s = raw.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const href = safeUrl(url)
    // 非白名单协议不生成可点击链接，避免 javascript: 伪协议执行
    return href
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : `<span>${label}</span>`
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/==([^=]+)==/g, '<mark class="wx-mark">$1</mark>')
  s = s.replace(/__([^_]+)__/g, '<u>$1</u>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, n) => `<code>${codes[Number(n)]}</code>`)
  return s
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((x) => x.trim())
}

export function renderMarkdown(src: string): string {
  const idCount = new Map<string, number>()
  const uniqueId = (text: string): string => {
    const base = slugOf(text)
    const n = idCount.get(base) ?? 0
    idCount.set(base, n + 1)
    return n === 0 ? base : `${base}-${n + 1}`
  }

  const lines = String(src).replace(/\r\n?/g, '\n').split('\n')
  let html = ''
  let i = 0
  let listType: 'ul' | 'ol' | null = null
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`
      listType = null
    }
  }

  while (i < lines.length) {
    const raw0 = lines[i]
    const t = raw0.trim()

    // 代码块
    if (t.startsWith('```')) {
      closeList()
      // 语言标识只保留安全字符，防止通过 ```"><img ...> 注入标签
      const lang = t.slice(3).trim().replace(/[^\w+#.-]/g, '').slice(0, 20)
      i += 1
      let code = ''
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code += `${escapeHtml(lines[i])}\n`
        i += 1
      }
      i += 1 // 跳过结束围栏
      const cls = lang ? ` class="lang-${lang}"` : ''
      html += `<pre class="wx-code-block"${cls}><code>${code.replace(/\n$/, '')}</code></pre>`
      continue
    }

    // 表格：当前行 | 开头且下一行是 |---| 分隔
    if (
      t.startsWith('|') &&
      i + 1 < lines.length &&
      lines[i + 1].includes('-') &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])
    ) {
      closeList()
      const header = splitTableRow(escapeHtml(t))
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(escapeHtml(lines[i])))
        i += 1
      }
      html += '<table class="wx-md-table"><thead><tr>'
      html += header.map((h) => `<th>${inlineMd(h)}</th>`).join('')
      html += '</tr></thead><tbody>'
      for (const r of rows) {
        html += '<tr>' + r.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>'
      }
      html += '</tbody></table>'
      continue
    }

    // 标题 h1-h4
    const h = /^(#{1,4})\s+(.+)$/.exec(t)
    if (h) {
      closeList()
      const level = h[1].length
      const text = plainText(h[2])
      const id = uniqueId(text)
      html += `<h${level} id="${id}">${inlineMd(escapeHtml(h[2]).replace(/\s#+\s*$/, ''))}</h${level}>`
      i += 1
      continue
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      closeList()
      html += '<hr class="wx-md-hr"/>'
      i += 1
      continue
    }

    // 引用块
    if (t.startsWith('>')) {
      closeList()
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(escapeHtml(lines[i].trim().replace(/^>\s?/, '')))
        i += 1
      }
      html += `<blockquote>${quoteLines.map((q) => inlineMd(q)).join('<br/>')}</blockquote>`
      continue
    }

    // 无序列表
    if (/^[-*]\s+/.test(t)) {
      if (listType !== 'ul') {
        closeList()
        html += '<ul>'
        listType = 'ul'
      }
      html += `<li>${inlineMd(escapeHtml(t.replace(/^[-*]\s+/, '')))}</li>`
      i += 1
      continue
    }

    // 有序列表
    if (/^\d+\.\s+/.test(t)) {
      if (listType !== 'ol') {
        closeList()
        html += '<ol>'
        listType = 'ol'
      }
      html += `<li>${inlineMd(escapeHtml(t.replace(/^\d+\.\s+/, '')))}</li>`
      i += 1
      continue
    }

    // 空行
    if (t === '') {
      closeList()
      i += 1
      continue
    }

    // 普通段落（合并紧随的连续文本行）
    closeList()
    let para = escapeHtml(t)
    i += 1
    while (i < lines.length) {
      const nt = lines[i].trim()
      if (!nt || /^(#{1,4}\s|```|> |[-*]\s|\d+\.\s|\|)/.test(nt)) break
      para += ` ${escapeHtml(nt)}`
      i += 1
    }
    html += `<p>${inlineMd(para)}</p>`
  }

  closeList()
  return html
}

/** 提取标题（默认 h2/h3，右侧「本文内容」导航用），id 规则与渲染器一致；levels 可指定 1-4 */
export function extractHeadings(src: string, levels: number[] = [2, 3]): MdHeading[] {
  const idCount = new Map<string, number>()
  const out: MdHeading[] = []
  for (const line of String(src).replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line.trim())
    if (!m || !levels.includes(m[1].length)) continue
    const text = plainText(m[2])
    const base = slugOf(text)
    const n = idCount.get(base) ?? 0
    idCount.set(base, n + 1)
    const id = n === 0 ? base : `${base}-${n + 1}`
    out.push({ id, text, level: m[1].length })
  }
  return out
}
