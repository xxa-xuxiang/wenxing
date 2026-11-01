// 问星 v1.7 — 零依赖 EPUB 解析
// 流程：ZIP 中央目录 → META-INF/container.xml → OPF(manifest/spine/metadata) → 目录(nav/ncx)
//      → 按 spine + 目录切节 → HTML 转 Markdown → 图片资源抽取
// 约束：不引入任何第三方库（node:zlib 解压 + 手写 ZIP 结构解析 + 正则解析 XML/HTML）
import { inflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** 解析类错误：统一携带 HTTP 状态（路由层直接透传） */
export class EpubError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'EpubError'
    this.status = status
  }
}

const MAX_ENTRY_BYTES = 20 * 1024 * 1024
const MAX_BOOK_TEXT = 8 * 1024 * 1024
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_WARNINGS = 30
const MAX_SECTION_CHARS = 3000
const MIN_SECTION_CHARS = 50
/** 超长节按段落继续拆分时的目标字数 */
const SPLIT_TARGET_CHARS = 2000
/** 章标题模式：识别正文起点，剔除其之前的版权页/目录页/前言等 */
const CHAPTER_TITLE_RE =
  /^(?:第\s*[0-9一二三四五六七八九十百千〇零]+\s*[章节部分篇讲卷]|chapter\s+[0-9ivxlcdm]+|part\s+[0-9ivxlcdm]+|lesson\s+\d+|项目\s*\d+|\d{1,3}[.、]\s*\S)/i

const IMAGE_EXT = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml']
])

const RUNNABLE_LANGS = new Set([
  'js', 'javascript', 'ts', 'typescript', 'python', 'py',
  'c', 'cpp', 'c++', 'java', 'go', 'rust', 'sql', 'html', 'css', 'bash', 'shell'
])

/** 书名 → 稳定 slug（纯 ASCII，可作目录名与 URL 段） */
export function textbookSlug(title) {
  return `tb-${createHash('sha1').update(String(title || 'untitled')).digest('hex').slice(0, 10)}`
}

// ===== ZIP =====

/** 从尾部向前找 EOCD（0x06054b50），最多回扫 66KB */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 66 * 1024)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

/** 读中央目录：返回 Map<条目名, { name, method, compSize, rawSize, localOffset }> */
function readCentralDirectory(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new EpubError('文件为空或不是有效的 epub')
  const eocd = findEocd(buf)
  if (eocd < 0) throw new EpubError('不是有效的 epub（未找到 ZIP 目录）')
  const total = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (total === 0xffff || cdOffset === 0xffffffff) throw new EpubError('暂不支持 ZIP64 / 分卷 epub')

  const entries = new Map()
  let p = cdOffset
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const rawSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (name) entries.set(name, { name, method, compSize, rawSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  if (entries.size === 0) throw new EpubError('epub 压缩包内没有可读取的文件')
  return entries
}

/** 按中央目录信息读取并解压单个条目 */
function readEntryData(buf, meta) {
  const lo = meta.localOffset
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) {
    throw new EpubError('epub 压缩包结构损坏')
  }
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const size = meta.compSize || meta.rawSize
  const end = start + size
  if (end > buf.length) throw new EpubError('epub 压缩包数据不完整')
  if (meta.rawSize > MAX_ENTRY_BYTES) throw new EpubError('epub 内单个文件解压后过大')
  if (meta.method === 0) return buf.subarray(start, end)
  if (meta.method === 8) {
    try {
      return inflateRawSync(buf.subarray(start, end), { maxOutputLength: MAX_ENTRY_BYTES })
    } catch {
      throw new EpubError('epub 压缩数据解压失败')
    }
  }
  throw new EpubError('epub 使用了不支持的压缩方式')
}

// ===== 路径工具 =====

function normalizeName(name) {
  return String(name || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 相对路径拼接（base 为文件所在目录，rel 为 href 路径部分） */
function joinPath(base, rel) {
  const parts = (base ? normalizeName(base).split('/') : []).concat(normalizeName(rel).split('/'))
  const out = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function dirOf(file) {
  const i = normalizeName(file).lastIndexOf('/')
  return i >= 0 ? normalizeName(file).slice(0, i) : ''
}

/** 拆分 href：路径（解码）+ 锚点 */
function splitHref(href) {
  const [beforeHash, fragment = ''] = String(href || '').split('#')
  const [pathPart = ''] = beforeHash.split('?')
  return { path: decodeSafe(pathPart), fragment }
}

function makeEntryIndex(entries) {
  const index = new Map()
  for (const meta of entries.values()) {
    index.set(normalizeName(decodeSafe(meta.name)).toLowerCase(), meta)
  }
  return index
}

function findEntry(index, name) {
  if (!name) return null
  return index.get(normalizeName(decodeSafe(name)).toLowerCase()) ?? null
}

// ===== XML / HTML 小工具 =====

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all
    }
    const v = ENTITIES[body.toLowerCase()]
    return v === undefined ? all : v
  })
}

/** 取标签属性值（兼容单/双引号） */
function attr(tag, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?:^|\\s)${esc}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : ''
}

/** 去标签保留文本 */
function stripTags(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
}

function cleanText(s) {
  return stripTags(s).replace(/\s+/g, ' ').trim()
}

/** 取标签内文本（首个匹配） */
function tagText(xml, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return m ? cleanText(m[1]) : ''
}

// ===== container.xml / OPF =====

function parseContainer(readData, index) {
  const meta = findEntry(index, 'META-INF/container.xml')
  if (!meta) throw new EpubError('epub 缺少 META-INF/container.xml')
  const xml = readData(meta).toString('utf8')
  const m = /<rootfile\b[^>]*>/i.exec(xml)
  const fullPath = m ? attr(m[0], 'full-path') : ''
  if (!fullPath) throw new EpubError('epub 的 container.xml 未声明 OPF 文件')
  return normalizeName(fullPath)
}

function parseOpf(xml, opfPath) {
  const dir = dirOf(opfPath)
  const manifest = new Map()
  for (const tag of xml.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attr(tag, 'id')
    const href = attr(tag, 'href')
    if (!id || !href) continue
    manifest.set(id, {
      href: joinPath(dir, splitHref(href).path),
      mediaType: attr(tag, 'media-type').toLowerCase(),
      properties: attr(tag, 'properties').toLowerCase()
    })
  }
  const spine = []
  for (const tag of xml.match(/<itemref\b[^>]*>/gi) ?? []) {
    const idref = attr(tag, 'idref')
    if (idref) spine.push({ idref, linear: attr(tag, 'linear').toLowerCase() })
  }
  const navItem = [...manifest.values()].find((m) => /(^|\s)nav(\s|$)/.test(m.properties))
  const ncxItem = [...manifest.values()].find((m) => m.mediaType.includes('dtbncx'))
  return {
    dir,
    title: tagText(xml, 'dc:title') || tagText(xml, 'title'),
    creator: tagText(xml, 'dc:creator') || tagText(xml, 'creator'),
    language: tagText(xml, 'dc:language') || tagText(xml, 'language'),
    manifest,
    spine,
    navPath: navItem?.href ?? '',
    ncxPath: ncxItem?.href ?? ''
  }
}

// ===== 目录（nav.xhtml / toc.ncx） =====

function parseNavToc(html, navPath) {
  const nav = /<nav\b[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i.exec(html)
  const src = nav ? nav[1] : html
  const dir = dirOf(navPath)
  const items = []
  let depth = 0
  const tokenRe = /<\/?ol\b[^>]*>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (let m; (m = tokenRe.exec(src)); ) {
    const token = m[0]
    if (/^<ol/i.test(token)) {
      depth += 1
      continue
    }
    if (/^<\/ol/i.test(token)) {
      depth = Math.max(0, depth - 1)
      continue
    }
    const href = attr(`<a ${m[1]}>`, 'href')
    const title = cleanText(m[2])
    if (!href || !title) continue
    const { path: hrefPath, fragment } = splitHref(href)
    items.push({ title, href: joinPath(dir, hrefPath), fragment, level: Math.max(1, depth) })
  }
  return items
}

function parseNcxToc(xml, ncxPath) {
  const dir = dirOf(ncxPath)
  const items = []
  const stack = []
  const tokenRe = /<navPoint\b[^>]*>|<\/navPoint>|<text\b[^>]*>([\s\S]*?)<\/text>|<content\b[^>]*>/gi
  for (let m; (m = tokenRe.exec(xml)); ) {
    const token = m[0]
    if (/^<navPoint/i.test(token)) {
      const node = { title: '', href: '', fragment: '', level: stack.length + 1 }
      items.push(node)
      stack.push(node)
      continue
    }
    if (/^<\/navPoint/i.test(token)) {
      stack.pop()
      continue
    }
    if (/^<text/i.test(token)) {
      if (stack.length) stack[stack.length - 1].title = cleanText(m[1])
      continue
    }
    if (stack.length) {
      const { path: hrefPath, fragment } = splitHref(attr(token, 'src'))
      stack[stack.length - 1].href = joinPath(dir, hrefPath)
      stack[stack.length - 1].fragment = fragment
    }
  }
  return items.filter((t) => t.href && t.title)
}

// ===== HTML → Markdown =====

function tableToMd(inner) {
  const rows = []
  for (const tr of inner.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<(td|th)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? []).map((c) =>
      cleanText(c).replace(/\|/g, '\\|')
    )
    if (cells.length) rows.push(cells)
  }
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r) => [...r, ...Array(width - r.length).fill('')]
  const lines = [
    `| ${pad(rows[0]).join(' | ')} |`,
    `| ${pad(rows[0]).map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`)
  ]
  return lines.join('\n')
}

/** 图片地址 → 资源 URL（外链原样保留；本地图片抽成资源） */
function makeAssetResolver(readData, index, slug, warnings, assets) {
  return (href, baseDir) => {
    const raw = String(href || '').trim()
    if (!raw) return ''
    if (/^(https?:)?\/\//i.test(raw) || /^data:/i.test(raw)) return raw
    const { path: relPath } = splitHref(raw)
    const target = joinPath(baseDir, relPath)
    const ext = path.extname(target).toLowerCase()
    if (!IMAGE_EXT.has(ext)) return ''
    const meta = findEntry(index, target)
    if (!meta) return ''
    const data = readData(meta)
    if (data.length > MAX_IMAGE_BYTES) {
      warnings.push(`图片超过 3MB 已跳过：${target}`)
      return ''
    }
    const name = `${createHash('sha1').update(data).digest('hex').slice(0, 8)}${ext}`
    if (!assets.has(name)) assets.set(name, { name, mime: IMAGE_EXT.get(ext), data })
    return `/uploads/textbooks/${slug}/assets/${name}`
  }
}

/** HTML → Markdown + 代码块统计（runnable / hasExercise） */
function htmlToMarkdown(html, { baseDir, resolveAsset }) {
  let src = String(html || '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<nav\b[^>]*epub:type\s*=\s*["']toc["'][^>]*>[\s\S]*?<\/nav>/gi, '')
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(src)
  if (body) src = body[1]

  // 表格先整体转 Markdown，避免内部 td/th 被后续规则打散
  src = src.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => {
    const table = tableToMd(inner)
    return table ? `\n\n${table}\n\n` : '\n\n'
  })

  // 代码块：占位保护，最后一并还原
  const blocks = []
  src = src.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const codeTag = /<code\b([^>]*)>/i.exec(inner)
    const cls = codeTag ? attr(`<code ${codeTag[1]}>`, 'class') : ''
    const lang = (/language-([a-z0-9+#-]+)/i.exec(cls)?.[1] ?? '').toLowerCase()
    const code = stripTags(inner).replace(/^\n+|\s+$/g, '').replace(/[ \t]+$/gm, '')
    blocks.push({ lang, code })
    return `\n\n\u0000PRE${blocks.length - 1}\u0000\n\n`
  })

  // 行内代码
  src = src.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => {
    const text = stripTags(inner).replace(/\s+/g, ' ').trim()
    return text ? `\`${text}\`` : ''
  })

  // 图片：先占位（Markdown 图片语法的尖括号会被后续去标签步骤误伤）
  const images = []
  src = src.replace(/<img\b[^>]*>/gi, (tag) => {
    const rawSrc = attr(tag, 'src')
    const url = resolveAsset(rawSrc.split('#')[0], baseDir)
    if (!url) return ''
    const alt = attr(tag, 'alt').replace(/[[\]]/g, '')
    images.push({ alt, url })
    return `\n\n\u0000IMG${images.length - 1}\u0000\n\n`
  })

  // 链接：仅保留外链，内部锚点/相对链接降级为文本
  src = src.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (tag, inner) => {
    const href = attr(/^<a\b[^>]*>/i.exec(tag)?.[0] ?? tag, 'href')
    const text = stripTags(inner).replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return /^https?:\/\//i.test(href) ? `[${text}](${href})` : text
  })

  // 有序 / 无序列表（嵌套列表按扁平处理）
  src = src.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let n = 0
    const lines = (inner.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) ?? [])
      .map((li) => `${++n}. ${cleanText(li)}`)
      .filter((line) => line.length > 3)
    return lines.length ? `\n\n${lines.join('\n')}\n\n` : '\n\n'
  })
  src = src.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const lines = (inner.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) ?? [])
      .map((li) => `- ${cleanText(li)}`)
      .filter((line) => line.length > 2)
    return lines.length ? `\n\n${lines.join('\n')}\n\n` : '\n\n'
  })

  // 标题
  src = src.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const text = cleanText(inner)
    return text ? `\n\n${'#'.repeat(Number(level))} ${text}\n\n` : '\n\n'
  })

  // 强调
  src = src.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => {
    const text = stripTags(inner).trim()
    return text ? `**${text}**` : ''
  })
  src = src.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => {
    const text = stripTags(inner).trim()
    return text ? `*${text}*` : ''
  })

  // 块级结构
  src = src
    .replace(/<blockquote\b[^>]*>/gi, '\n\n> ')
    .replace(/<\/blockquote>/gi, '\n\n')
    .replace(/<hr\b[^>]*>/gi, '\n\n---\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|aside|figure|figcaption|li|tr|dd|dt)>/gi, '\n\n')
    .replace(/<(p|div|section|article|aside|figure|figcaption|li|tr|dd|dt)\b[^>]*>/gi, '\n\n')

  // 剩余标签全部去掉
  src = src.replace(/<[^>]+>/g, '')
  src = decodeEntities(src)

  // 空白规整（在还原代码块/图片之前，避免破坏代码缩进）
  src = src
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')

  // 还原代码块（围栏长度按内容自适应）
  // 占位符使用 \u0000 包裹，属于刻意设计（正文不可能出现 NUL）
  // eslint-disable-next-line no-control-regex
  src = src.replace(/\u0000PRE(\d+)\u0000/g, (_, i) => {
    const block = blocks[Number(i)]
    if (!block) return ''
    const longest = Math.max(3, ...(block.code.match(/`{3,}/g) ?? []).map((s) => s.length + 1))
    const fence = '`'.repeat(longest)
    return `${fence}${block.lang ? block.lang : ''}\n${block.code}\n${fence}`
  })

  // 还原图片
  // eslint-disable-next-line no-control-regex
  src = src.replace(/\u0000IMG(\d+)\u0000/g, (_, i) => {
    const img = images[Number(i)]
    if (!img) return ''
    return `![${img.alt}](<${img.url}>)`
  })

  const markdown = src.replace(/\n{3,}/g, '\n\n').trim()

  return {
    markdown,
    codeBlocks: blocks.length,
    runnable: blocks.reduce((best, b) => {
      const rank = codeRank(b)
      return rank > best ? rank : best
    }, 1),
    hasExercise: /(练习|习题|自测|思考题|exercises?|problems?)/i.test(markdown)
  }
}

/** 从代码内容推测语言（无 class 时兜底） */
function sniffLang(code) {
  if (/^\s*>>>\s/m.test(code) || /^\s*(def|class)\s+\w+/m.test(code) || /^\s*(import|from)\s+[\w.]+/m.test(code) || /^\s*print\s*\(/m.test(code)) return 'python'
  if (/(^|\s)(function|const|let|var)\s+\w+/m.test(code) || /console\.log\s*\(/m.test(code)) return 'javascript'
  if (/^\s*#include\s*[<"]/m.test(code)) return 'c'
  if (/\bpublic\s+(static\s+)?(void|class)\b/.test(code)) return 'java'
  if (/^\s*(SELECT|INSERT|UPDATE|CREATE)\s/im.test(code)) return 'sql'
  if (/^\s*(#!\/(bin\/)?(ba)?sh|\$\s)/m.test(code)) return 'bash'
  return ''
}

/** 代码块可运行档位：3 runnable / 2 partial / 1 illustrative */
function codeRank(block) {
  if (!block.code || block.code.length < 20) return 1
  const lang = block.lang || sniffLang(block.code)
  if (!RUNNABLE_LANGS.has(lang)) return 1
  const placeholder = /(<\.\.\.>|省略|TODO|待补充)/i.test(block.code)
  return placeholder ? 2 : 3
}

const RANK_NAME = { 1: 'illustrative', 2: 'partial', 3: 'runnable' }

// ===== 章节切分 =====

/** 取 HTML 中首个标题文本（目录缺失时的兜底标题） */
function inferTitle(html) {
  return inferHeading(html).title
}

/** 取 HTML 中首个标题及其层级（h1-h3；无标题返回 level 0） */
function inferHeading(html) {
  const m = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(html)
  return m ? { level: Number(m[1]), title: cleanText(m[2]) } : { level: 0, title: '' }
}

function splitByFragments(html, list) {
  const positions = list.map((entry) => {
    if (!entry.fragment) return 0
    const esc = entry.fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`(?:id|name)\\s*=\\s*["']${esc}["']`, 'i').exec(html)
    return m ? Math.max(0, html.lastIndexOf('<', m.index)) : -1
  })
  if (positions.some((p) => p < 0) || positions.every((p, i) => i === 0 || p <= positions[i - 1])) {
    return [{ entry: list[0], html }]
  }
  const ordered = list.map((entry, i) => ({ entry, pos: positions[i] })).sort((a, b) => a.pos - b.pos)
  return ordered.map((item, i) => ({
    entry: item.entry,
    html: html.slice(item.pos, i + 1 < ordered.length ? ordered[i + 1].pos : html.length)
  }))
}

/**
 * 按 spine + 目录切节，返回阅读顺序的扁平节列表
 * @returns {Array<{ title, level, src, html }>}
 */
function splitSpine({ readText, index, opf, toc, warnings }) {
  const docs = opf.spine
    .filter((s) => s.linear !== 'no')
    .map((s) => opf.manifest.get(s.idref))
    .filter((m) => m && /html|xml/i.test(m.mediaType) && m.href !== opf.navPath)

  const tocByPath = new Map()
  for (const entry of toc) {
    const list = tocByPath.get(entry.href) ?? []
    list.push(entry)
    tocByPath.set(entry.href, list)
  }

  const sections = []
  const usedPaths = new Set()
  let untracked = 0
  // 最近一个目录收录节的层级：未收录页按阅读顺序就地挂到它的下一级
  let lastTocLevel = 0

  for (const doc of docs) {
    const meta = findEntry(index, doc.href)
    if (!meta) continue
    const html = readText(meta.name)
    if (!html) continue
    const list = tocByPath.get(doc.href) ?? []
    usedPaths.add(doc.href)
    if (list.length === 0) {
      if (cleanText(html).length >= 200) {
        untracked += 1
        const head = inferHeading(html)
        // 页首是 h1 → 视为顶层（前言/致谢等）；否则挂到最近目录节的下一级
        const level = head.level === 1 ? 1 : Math.min(6, lastTocLevel + 1)
        if (level === 1) lastTocLevel = 1
        sections.push({ title: head.title || '未命名正文', level, src: doc.href, html })
      }
      continue
    }
    if (list.length === 1 && !list[0].fragment) {
      sections.push({ title: list[0].title, level: list[0].level, src: doc.href, html })
      lastTocLevel = list[0].level
      continue
    }
    for (const piece of splitByFragments(html, list)) {
      sections.push({
        title: piece.entry.title,
        level: piece.entry.level,
        src: piece.entry.fragment ? `${doc.href}#${piece.entry.fragment}` : doc.href,
        html: piece.html
      })
      lastTocLevel = piece.entry.level
    }
  }

  if (untracked) warnings.push(`${untracked} 个正文页未收录于目录，已按阅读顺序插入相邻章节下`)
  const missing = [...tocByPath.keys()].filter((href) => !usedPaths.has(href))
  if (missing.length) warnings.push(`${missing.length} 个目录条目未匹配到正文`)
  return subsplitSections(mergeAdjacentDuplicates(sections))
}

/** 相邻同级同名节合并（目录封面页与正文标题页重复的场景） */
function mergeAdjacentDuplicates(list) {
  const norm = (t) => String(t || '').replace(/\s+/g, '')
  const merged = []
  for (const s of list) {
    const prev = merged[merged.length - 1]
    if (prev && prev.level === s.level && norm(prev.title) && norm(prev.title) === norm(s.title)) {
      prev.html += '\n' + s.html
      continue
    }
    merged.push(s)
  }
  return merged
}

/**
 * 页内下一级标题拆成子节：正文含 ≥2 个 h(level+1) 且平均每段 ≥150 字才拆
 * （最多拆到 3 级；前导内容保留在父节）
 */
function subsplitSections(list) {
  const out = []
  for (const s of list) {
    const next = s.level + 1
    if (next > 3) {
      out.push(s)
      continue
    }
    const re = new RegExp(`<h${next}\\b[^>]*>[\\s\\S]*?</h${next}>`, 'gi')
    const marks = []
    for (let m; (m = re.exec(s.html)); ) {
      const title = cleanText(m[0])
      if (title) marks.push({ index: m.index, title })
    }
    if (marks.length < 2 || cleanText(s.html).length / marks.length < 150) {
      out.push(s)
      continue
    }
    out.push({ ...s, html: s.html.slice(0, marks[0].index) })
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : s.html.length
      out.push({
        title: mk.title,
        level: next,
        src: `${s.src}#sec-${i + 1}`,
        html: s.html.slice(mk.index, end)
      })
    })
  }
  return out
}

/**
 * 目录页判定：标题为「目录」，或链接密集且每行都很短（整本目录被当成正文页的场景）
 */
function looksLikeToc(raw) {
  const title = String(raw.title || '').trim()
  if (/^(目\s*录|contents|table\s+of\s+contents|brief\s+contents)$/i.test(title)) return true
  const anchors = (raw.html.match(/<a\b/gi) || []).length
  if (anchors < 10) return false
  const text = cleanText(raw.html)
  if (text.length < 400) return false
  return text.length / anchors < 200
}

/**
 * 剔除正文前内容（版权页/目录页/前言/致谢等）：定位首个章标题节，丢弃其之前所有节。
 * 找不到章标题时保持原样，避免误删无编号章节的书籍正文。
 */
function pruneFrontMatter(list, warnings) {
  if (list.length <= 3) return list
  const isChapter = (s) => CHAPTER_TITLE_RE.test(String(s.title || '').trim())
  let start = list.findIndex((s) => s.level === 1 && isChapter(s))
  if (start < 0) start = list.findIndex(isChapter)
  if (start <= 0) return list.filter((s) => !looksLikeToc(s))
  const dropped = list.slice(0, start).filter((s) => cleanText(s.html).length > 0).length
  if (dropped) warnings.push(`已剔除正文前的 ${dropped} 节（版权页/目录页/前言等）`)
  return list.slice(start).filter((s) => !looksLikeToc(s))
}

/** 取 HTML 内所有标题（层级 + 位置 + 文本） */
function listHeadings(html) {
  const out = []
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const title = cleanText(m[2])
    if (title) out.push({ level: Number(m[1]), index: m.index, title })
  }
  return out
}

/** 按块级标签边界切 HTML，并按目标字数聚合（单块超长时独立成节） */
function splitByParagraphs(s) {
  const blocks = s.html.split(/(?=<(?:p|div|h[1-6]|li|blockquote|pre|table|figure|section)\b)/i)
  const chunks = []
  let buf = ''
  let bufLen = 0
  const flush = () => {
    if (buf.trim()) chunks.push(buf)
    buf = ''
    bufLen = 0
  }
  for (const block of blocks) {
    const len = cleanText(block).length
    if (bufLen > 0 && bufLen + len > SPLIT_TARGET_CHARS) flush()
    buf += block
    bufLen += len
  }
  flush()
  if (chunks.length <= 1) return [s]
  return chunks.map((html, i) => ({
    title: i === 0 ? s.title : `${s.title}（续 ${i + 1}）`,
    level: s.level,
    src: i === 0 ? s.src : `${s.src}#part-${i + 1}`,
    html
  }))
}

/** 超长节继续下拆：优先用更深层标题，其次按段落等分 */
function splitOversize(list) {
  const out = []
  const visit = (s) => {
    if (cleanText(s.html).length <= MAX_SECTION_CHARS) {
      out.push(s)
      return
    }
    const deeper = listHeadings(s.html).filter((h) => h.level > s.level)
    if (deeper.length >= 2) {
      const parts = []
      const lead = s.html.slice(0, deeper[0].index)
      // 保留父节标题（即使正文很短），避免拆分后章节标题丢失
      if (cleanText(lead).length > 0) parts.push({ ...s, html: lead })
      deeper.forEach((h, i) => {
        const end = i + 1 < deeper.length ? deeper[i + 1].index : s.html.length
        parts.push({
          title: h.title,
          level: Math.min(6, h.level),
          src: `${s.src}#sub-${i + 1}`,
          html: s.html.slice(h.index, end)
        })
      })
      parts.forEach(visit)
      return
    }
    splitByParagraphs(s).forEach(visit)
  }
  list.forEach(visit)
  return out
}

/** 无目录时按 h1/h2 标题切分 */
function splitByHeadings(html, bookTitle) {
  const marks = []
  const re = /<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  for (let m; (m = re.exec(html)); ) {
    const title = cleanText(m[2])
    if (title) marks.push({ index: m.index, level: Number(m[1]), title })
  }
  if (marks.length <= 1) return [{ title: bookTitle, level: 1, src: '', html }]
  const out = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index
    const end = i + 1 < marks.length ? marks[i + 1].index : html.length
    out.push({ title: marks[i].title, level: marks[i].level, src: '', html: html.slice(start, end) })
  }
  return out
}

// ===== 主流程 =====

function detectDrm(readData, index) {
  const meta = findEntry(index, 'META-INF/encryption.xml')
  if (!meta) return false
  const xml = readData(meta).toString('utf8')
  const refs = [...xml.matchAll(/<CipherReference\b[^>]*>/gi)].map((m) => attr(m[0], 'URI').toLowerCase())
  const decryptable = refs.filter((uri) => uri)
  if (decryptable.length === 0) return true
  return decryptable.some((uri) => !/\.(otf|ttf|woff2?)$/.test(uri))
}

/**
 * 解析 epub
 * @param {Buffer} buffer epub 原始字节
 * @param {{ titleOverride?: string }} options
 */
export function parseEpub(buffer, { titleOverride = '' } = {}) {
  const entries = readCentralDirectory(buffer)
  const index = makeEntryIndex(entries)
  const warnings = []
  const pushWarning = (message) => {
    if (warnings.length < MAX_WARNINGS && !warnings.includes(message)) warnings.push(message)
  }

  /** 读取条目原始字节（统一入口，避免各处重复传 entries） */
  const readData = (meta) => readEntryData(buffer, meta)

  if (detectDrm(readData, index)) {
    throw new EpubError('该 epub 受 DRM 保护，无法解析（请使用 DRM-free 版本）')
  }

  const readText = (name) => {
    const meta = findEntry(index, name)
    if (!meta) return ''
    return readData(meta).toString('utf8').replace(/^\uFEFF/, '')
  }

  const opfPath = parseContainer(readData, index)
  const opfMeta = findEntry(index, opfPath)
  if (!opfMeta) throw new EpubError('epub 缺少 OPF 描述文件')
  const opf = parseOpf(readText(opfMeta.name), opfPath)
  if (opf.spine.length === 0) throw new EpubError('epub 的 OPF 未声明正文（spine 为空）')

  let toc = []
  if (opf.navPath) {
    toc = parseNavToc(readText(opf.navPath), opf.navPath)
  }
  if (toc.length === 0 && opf.ncxPath) {
    toc = parseNcxToc(readText(opf.ncxPath), opf.ncxPath)
  }
  if (toc.length === 0) pushWarning('未找到目录，已按标题自动切分章节')

  const title = String(titleOverride || opf.title || '').trim() || '未命名教材'
  const slug = textbookSlug(title)

  let rawSections = toc.length > 0
    ? splitSpine({ readText, index, opf, toc, warnings })
    : opf.spine
        .filter((s) => s.linear !== 'no')
        .map((s) => opf.manifest.get(s.idref))
        .filter((m) => m && /html|xml/i.test(m.mediaType) && m.href !== opf.navPath)
        .flatMap((doc) => {
          const meta = findEntry(index, doc.href)
          if (!meta) return []
          const html = readText(meta.name)
          return html ? splitByHeadings(html, title).map((s) => ({ ...s, src: doc.href })) : []
        })

  if (rawSections.length === 0) throw new EpubError('未能从 epub 中提取到任何正文章节')

  // 剔除正文前的版权页/目录页/前言等，并把超长章节继续下拆
  rawSections = pruneFrontMatter(rawSections, warnings)
  rawSections = splitOversize(rawSections)

  const assets = new Map()
  const resolveAsset = makeAssetResolver(readData, index, slug, warnings, assets)
  const nodes = []
  const sections = {}
  const parents = []
  let totalChars = 0
  // 目录中无正文的章节页数（多为封面/章名页）：保留为分组节点，聚合为一条警告
  let emptySections = 0
  // 阅读顺序序号：与树形层级解耦（子节点也必须拿到独立 id）
  let seq = 0

  rawSections.forEach((raw) => {
    const baseDir = dirOf((raw.src || '').split('#')[0])
    const md = htmlToMarkdown(raw.html, { baseDir, resolveAsset })
    if (!md.markdown.trim()) emptySections += 1
    seq += 1
    const ordinal = seq
    const id = `s${String(ordinal).padStart(3, '0')}`
    const charCount = md.markdown.replace(/\s+/g, '').length
    totalChars += md.markdown.length

    const titleText = raw.title || inferTitle(raw.html) || `第 ${ordinal} 节`
    const level = Math.max(1, Math.min(6, Number(raw.level) || 1))
    let chapter = titleText
    if (level > 1) {
      const top = [...parents].reverse().find((p) => p.level === 1)
      chapter = top?.title || title
    }

    if (charCount > 0 && charCount < MIN_SECTION_CHARS) pushWarning(`「${titleText}」正文仅 ${charCount} 字`)
    if (charCount > MAX_SECTION_CHARS) pushWarning(`「${titleText}」拆分后正文仍超过 ${MAX_SECTION_CHARS} 字`)

    const node = {
      id,
      ordinal,
      level,
      title: titleText,
      chapter,
      file: `sections/${id}.md`,
      src: raw.src || '',
      charCount,
      codeBlocks: md.codeBlocks,
      runnable: RANK_NAME[md.runnable] ?? 'illustrative',
      hasExercise: md.hasExercise,
      children: []
    }
    while (parents.length && parents[parents.length - 1].level >= level) parents.pop()
    if (parents.length) parents[parents.length - 1].children.push(node)
    else nodes.push(node)
    parents.push(node)
    sections[id] = md.markdown
  })

  if (nodes.length === 0) throw new EpubError('未能从 epub 中提取到任何正文章节')
  if (totalChars > MAX_BOOK_TEXT) throw new EpubError('教材正文过大（超过 8MB），请拆分后导入')
  if (emptySections) pushWarning(`${emptySections} 个目录章节页无正文（多为封面/章名页），已保留为分组节点`)

  const normalizedWarnings = warnings.slice(0, MAX_WARNINGS)
  return {
    meta: {
      slug,
      title,
      creator: opf.creator || '',
      language: opf.language || '',
      sourceFile: ''
    },
    warnings: normalizedWarnings,
    nodes,
    sections,
    assets: [...assets.values()]
  }
}
