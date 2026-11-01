// 问星 v1.7 — 教材存储：<DATA_ROOT>/textbooks/<slug>/ 与 /uploads/textbooks/<slug>/assets/
// 结构：meta.json / tree.json / sections/<id>.md（带 frontmatter）+ assets（走现有 /uploads 静态路由）
import fs from 'node:fs'
import path from 'node:path'
import { DATA_ROOT, parseFrontmatter } from './docs-store.js'
import { EpubError, textbookSlug } from './epub.js'

export { textbookSlug }

export const TEXTBOOKS_DIR = path.join(DATA_ROOT, 'textbooks')
export const TEXTBOOK_UPLOADS_DIR = path.join(DATA_ROOT, 'uploads', 'textbooks')

const SLUG_RE = /^tb-[0-9a-f]{10}$/
const SECTION_ID_RE = /^s\d{3,4}$/

/** 校验 slug 并返回其目录（防目录穿越） */
export function safeTextbookSlug(slug) {
  const value = String(slug || '')
  if (!SLUG_RE.test(value)) throw new EpubError('教材标识不合法')
  return value
}

function textbookDir(slug) {
  const dir = path.resolve(TEXTBOOKS_DIR, safeTextbookSlug(slug))
  if (!dir.startsWith(path.resolve(TEXTBOOKS_DIR) + path.sep)) throw new EpubError('教材路径不合法')
  return dir
}

function assetDir(slug) {
  const dir = path.resolve(TEXTBOOK_UPLOADS_DIR, safeTextbookSlug(slug), 'assets')
  if (!dir.startsWith(path.resolve(TEXTBOOK_UPLOADS_DIR) + path.sep)) throw new EpubError('资源路径不合法')
  return dir
}

/** 单行化（frontmatter 值不允许换行） */
function oneLine(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
}

function sectionFrontmatter(node) {
  return [
    '---',
    `id: ${oneLine(node.id)}`,
    `ordinal: ${node.ordinal}`,
    `title: ${oneLine(node.title)}`,
    `chapter: ${oneLine(node.chapter)}`,
    `src: ${oneLine(node.src)}`,
    '---',
    ''
  ].join('\n')
}

/**
 * 写入解析结果（同 slug 覆盖重写 → 幂等）
 * @param {ReturnType<import('./epub.js').parseEpub>} parsed
 * @param {{ sourceFile?: string }} options
 */
export function saveTextbook(parsed, { sourceFile = '' } = {}) {
  const slug = safeTextbookSlug(parsed.meta.slug)
  const dir = textbookDir(slug)
  const assetsDir = assetDir(slug)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(assetsDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'sections'), { recursive: true })

  const importedAt = new Date().toISOString()
  const warnings = parsed.warnings ?? []
  const nodes = parsed.nodes ?? []
  const tree = {
    slug,
    title: parsed.meta.title,
    creator: parsed.meta.creator || '',
    importedAt,
    nodeCount: nodes.length,
    warnings,
    nodes
  }

  const byId = new Map()
  const collect = (list) => {
    for (const node of list ?? []) {
      byId.set(node.id, node)
      collect(node.children)
    }
  }
  collect(nodes)

  let chars = 0
  for (const [id, markdown] of Object.entries(parsed.sections ?? {})) {
    const node = byId.get(id)
    if (!node) continue
    const text = sectionFrontmatter(node) + markdown
    chars += markdown.length
    fs.writeFileSync(path.join(dir, 'sections', `${id}.md`), text, 'utf-8')
  }

  let assetCount = 0
  if (parsed.assets?.length) {
    fs.mkdirSync(assetsDir, { recursive: true })
    for (const asset of parsed.assets) {
      if (!asset?.name || !asset?.data) continue
      fs.writeFileSync(path.join(assetsDir, asset.name), asset.data)
      assetCount += 1
    }
  }

  const meta = {
    slug,
    title: parsed.meta.title,
    creator: parsed.meta.creator || '',
    language: parsed.meta.language || '',
    importedAt,
    sourceFile: String(sourceFile || '').slice(0, 200),
    sectionCount: nodes.length,
    assetCount,
    warnings
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
  fs.writeFileSync(path.join(dir, 'tree.json'), JSON.stringify(tree, null, 2), 'utf-8')

  return { slug, tree, stats: { sections: Object.keys(parsed.sections ?? {}).length, assets: assetCount, chars } }
}

/**
 * 读取教材分节正文（默认全部；指定 ids 时只读对应节）
 * @returns {Record<string, string>} id → 已剥离 frontmatter 的 Markdown
 */
export function readSections(slug, ids) {
  const dir = textbookDir(slug)
  if (!fs.existsSync(path.join(dir, 'tree.json'))) throw new EpubError('教材不存在', 404)
  const sectionsDir = path.join(dir, 'sections')
  if (!fs.existsSync(sectionsDir)) throw new EpubError('教材不存在', 404)

  let targets
  if (Array.isArray(ids) && ids.length > 0) {
    for (const id of ids) {
      if (!SECTION_ID_RE.test(String(id))) throw new EpubError('章节标识不合法')
    }
    targets = ids.map(String)
  } else {
    targets = fs
      .readdirSync(sectionsDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.replace(/\.md$/, ''))
      .sort()
  }

  const out = {}
  for (const id of targets) {
    const file = path.join(sectionsDir, `${id}.md`)
    if (!fs.existsSync(file)) continue
    const { body } = parseFrontmatter(fs.readFileSync(file, 'utf-8'))
    out[id] = body.trim()
  }
  return out
}

/**
 * 读取教材目录树（tree.json 的层级 nodes，供书籍阅读器左侧目录）
 * @returns {{ slug: string, title: string, nodes: any[] }}
 */
export function readTree(slug) {
  const dir = textbookDir(slug)
  const file = path.join(dir, 'tree.json')
  if (!fs.existsSync(file)) throw new EpubError('教材不存在', 404)
  const tree = JSON.parse(fs.readFileSync(file, 'utf-8'))
  return { slug, title: tree.title ?? '', nodes: Array.isArray(tree.nodes) ? tree.nodes : [] }
}
