// 问星 v1.1 — 公开语料库：文档/切块入库 + 向量检索（出题 grounding 的唯一素材来源）
// 所有进入题目的事实必须能在 SourceChunk 中找到出处；语料与题目解耦，同一份语料可复用出题
import { PrismaClient } from '@prisma/client'
import { chunkMarkdown, embed, embeddingModel, cosine } from './embedding.js'
import { vecToBlob, blobToVec } from './vec.js'
import { serializeWrite } from './db.js'

const db = new PrismaClient()

/** 白名单域名集合（小写、不带协议与路径） */
export function allowedDomains() {
  return String(process.env.CORPUS_ALLOWED_DOMAINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl)
    const host = u.hostname.toLowerCase()
    return allowedDomains().some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/** 极简 frontmatter 解析（title/tags/license） */
export function parseFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(src ?? ''))
  if (!m) return { meta: {}, body: String(src ?? '') }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim())
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return { meta, body: String(src).slice(m[0].length) }
}

/**
 * 一篇语料入库：切块 → 向量化 → 覆盖写（同 URL 重新抓取时替换旧切块）
 * @returns {Promise<{docId:string,chunks:number,provider:string}>}
 */
export async function ingestText({ url, title, siteDomain, industry = '', license = '', text }) {
  if (!url || !text || !title) throw new Error('ingestText 缺少 url/title/text')
  const bodyChunks = chunkMarkdown(text)
  if (bodyChunks.length === 0) throw new Error('正文切块为空，跳过入库')

  const model = embeddingModel()
  const vectors = []
  for (let i = 0; i < bodyChunks.length; i += 32) {
    vectors.push(...(await embed(bodyChunks.slice(i, i + 32))))
  }

  const doc = await serializeWrite(() =>
    db.sourceDoc.upsert({
      where: { url },
      update: { title, siteDomain, industry, license, status: 'active' },
      create: { url, title, siteDomain, industry, license, status: 'active' }
    })
  )
  await serializeWrite(() => db.sourceChunk.deleteMany({ where: { docId: doc.id } }))
  await serializeWrite(() =>
    db.sourceChunk.createMany({
      data: bodyChunks.map((t, i) => ({
        docId: doc.id,
        chunkIndex: i,
        text: t,
        embedding: vecToBlob(vectors[i]),
        dim: vectors[i]?.length ?? 0,
        model
      }))
    })
  )
  return { docId: doc.id, chunks: bodyChunks.length, provider: model }
}

/**
 * 语料语义检索：query 向量化后在候选切块上算余弦
 * 候选集默认按行业过滤（题量级别下只在同行业语料内算，避免全表扫描）
 * @returns {Promise<Array<{text,url,title,siteDomain,score,chunkIndex}>>}
 */
export async function retrieveChunks(queryText, { industry = '', topK = 8 } = {}) {
  const [qv] = await embed([queryText])
  const where = {}
  if (industry) {
    where.doc = { is: { industry } }
  }
  const rows = await db.sourceChunk.findMany({
    where,
    select: {
      chunkIndex: true,
      text: true,
      dim: true,
      embedding: true,
      doc: { select: { url: true, title: true, siteDomain: true } }
    }
  })
  const scored = rows.map((r) => ({
    text: r.text,
    url: r.doc.url,
    title: r.doc.title,
    siteDomain: r.doc.siteDomain,
    chunkIndex: r.chunkIndex,
    score: r.embedding ? cosine(qv, blobToVec(r.embedding)) : 0
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/** 语料库规模统计 */
export async function corpusStats() {
  const [docs, chunks] = await Promise.all([db.sourceDoc.count(), db.sourceChunk.count()])
  return { docs, chunks }
}

export { db as corpusDb }
