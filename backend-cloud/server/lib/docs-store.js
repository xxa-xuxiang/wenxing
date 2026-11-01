// 问星 v1.4 — 文档存储 helper：数据目录 / 路径安全 / frontmatter / 递归扫描 / 向量索引
import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.js'
import { chunkMarkdown, embed, embeddingModel } from './embedding.js'
import { DATA_ROOT } from './data-root.js'

// 数据根目录统一由 data-root.js 解析（此处 re-export，保持既有引用不变）
export { DATA_ROOT }
// 文档存档目录：<数据根>/docs/<行业>/<标题>.md
export const DOCS_DIR = path.join(DATA_ROOT, 'docs')
// 学习计划存档目录：<数据根>/plans/<行业>/<标题>.md
export const PLANS_DIR = path.join(DATA_ROOT, 'plans')

/** 文件名清洗：去掉非法字符并截断 */
export function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 60) || 'untitled'
}

/** 生成 frontmatter 头 */
export function buildFrontmatter(meta) {
  return [
    '---',
    `title: ${meta.title}`,
    `industry: ${meta.industry}`,
    `tags: [${(meta.tags || []).map((t) => JSON.stringify(t)).join(', ')}]`,
    `generatedAt: ${meta.generatedAt}`,
    `updatedAt: ${meta.updatedAt}`,
    // 归属标记（仅新文档写入）；用于阻止跨用户覆盖
    ...(meta.createdBy ? [`createdBy: ${meta.createdBy}`] : []),
    '---',
    ''
  ].join('\n')
}

/** 解析 frontmatter，返回 { meta, body } */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const meta = {}
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const k = line.slice(0, idx).trim()
      let v = line.slice(idx + 1).trim()
      if (v.startsWith('[') && v.endsWith(']')) {
        try {
          v = JSON.parse(v)
        } catch {
          v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
        }
      }
      meta[k] = v
    }
  }
  return { meta, body: m ? text.slice(m[0].length) : text }
}

/** 防目录穿越：解析后必须仍在文档目录内 */
export function safeDocPath(file) {
  const full = path.resolve(DOCS_DIR, String(file))
  if (!full.startsWith(path.resolve(DOCS_DIR) + path.sep)) throw new Error('文件路径不合法')
  return full
}

/** 读取文档 frontmatter tags（缺失返回 []） */
export function docTags(full) {
  try {
    const { meta } = parseFrontmatter(fs.readFileSync(full, 'utf-8'))
    return Array.isArray(meta.tags) ? meta.tags : []
  } catch {
    return []
  }
}

/**
 * 单篇文档索引：切块 → embed → 先删旧块再批量写入 DocVector
 * @returns {Promise<{chunks: number}>}
 */
export async function indexOneDoc({ industry, file, full }) {
  const md = fs.readFileSync(full, 'utf-8')
  const { meta } = parseFrontmatter(md)
  const chunks = chunkMarkdown(md)
  if (!chunks.length) {
    await db.docVector.deleteMany({ where: { industry, file } })
    return { chunks: 0 }
  }
  const vectors = await embed(chunks)
  const dim = vectors[0].length
  const model = embeddingModel()
  await db.$transaction([
    db.docVector.deleteMany({ where: { industry, file } }),
    db.docVector.createMany({
      data: chunks.map((text, i) => ({
        industry,
        file,
        title: meta.title ?? file.replace(/\.md$/, ''),
        chunkIndex: i,
        text,
        embedding: JSON.stringify(vectors[i]),
        dim,
        model
      }))
    })
  ])
  return { chunks: chunks.length }
}

/**
 * 递归扫描目录下全部 .md
 * @returns {Array<{industry:string,file:string,title:string,tags:string[],generatedAt:string,updatedAt:string,size:number}>}
 */
export function listMdFiles(dir) {
  const out = []
  const walk = (current) => {
    if (!fs.existsSync(current)) return
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        walk(full)
        continue
      }
      if (!name.endsWith('.md')) continue
      const file = path.relative(dir, full).split(path.sep).join('/')
      const { meta } = parseFrontmatter(fs.readFileSync(full, 'utf-8'))
      out.push({
        industry: file.includes('/') ? file.split('/')[0] : '',
        file,
        title: meta.title ?? name.replace(/\.md$/, ''),
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        generatedAt: meta.generatedAt ?? stat.mtime.toISOString(),
        updatedAt: meta.updatedAt ?? stat.mtime.toISOString(),
        size: stat.size
      })
    }
  }
  walk(dir)
  return out
}
