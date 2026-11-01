// 社区书籍书架：开放教材检索 / 下载入库 / 上传 / 列表 / 文件读取
// 合规硬约束：只接受开放许可或官方免费来源；许可不明只存链接不落地文件
import express from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import { DATA_ROOT } from './docs-store.js'
import { safeRemove, safeWriteFile } from './fs-safe.js'
import { db, serializeWrite } from './db.js'
import { parseEpub } from './epub.js'
import { saveTextbook } from './textbook-store.js'
import { deepseek, takeLastUsage } from './ai.js'
import { aiGuard } from './ai-guard.js'
import { createRateLimit } from './rate-limit.js'
import { auth } from './auth.js'
import { adminAuth } from './admin-auth.js'
import { createLogger } from './logger.js'

const router = express.Router()
const log = createLogger('books')

const BOOKS_DIR = path.join(DATA_ROOT, 'books')
const FILES_DIR = path.join(BOOKS_DIR, 'files')
const COVERS_DIR = path.join(BOOKS_DIR, 'covers')

const MAX_SIZE = 100 * 1024 * 1024
const FORMATS = ['pdf', 'epub', 'txt', 'md', 'mobi', 'azw3']
const PREVIEWABLE = new Set(['pdf', 'epub', 'txt', 'md'])

/** 开放教材白名单（可用 BOOK_ALLOWED_DOMAINS 覆盖） */
const DEFAULT_ALLOWED = [
  'openstax.org',
  'open.umn.edu',
  'open.oregonstate.education',
  'opentextbc.ca',
  'pressbooks.oer.hawaii.edu',
  'www.gutenberg.org',
  'standardebooks.org',
  'doaj.org'
]
function allowedDomains() {
  const raw = String(process.env.BOOK_ALLOWED_DOMAINS || '').trim()
  return (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ALLOWED)
}
function isAllowedHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return allowedDomains().some((d) => host === d || host.endsWith(`.${d}`))
}

/* ---------------- 工具 ---------------- */
const str = (v) => (typeof v === 'string' ? v.trim() : '')

function extOf(name, fallback = '') {
  const ext = path.extname(String(name || '')).toLowerCase().replace('.', '')
  return FORMATS.includes(ext) ? ext : fallback
}

/** 魔数/结构校验，避免把任意文件当书入库 */
function detectFormat(buf, hint = '') {
  if (!buf || buf.length < 8) return null
  const head = buf.subarray(0, 8)
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'
  if (head[0] === 0x50 && head[1] === 0x4b) {
    // EPUB：zip 内含 mimetype=application/epub+zip
    const text = buf.subarray(0, Math.min(buf.length, 2048)).toString('latin1')
    if (text.includes('application/epub+zip')) return 'epub'
  }
  const s = buf.subarray(0, 100).toString('latin1')
  if (s.includes('BOOKMOBI')) {
    return hint === 'azw3' ? 'azw3' : 'mobi'
  }
  if (['txt', 'md'].includes(hint)) return hint
  return null
}

function safeId(v) {
  return String(v || '').replace(/[^a-zA-Z0-9_-]/g, '')
}

function coverUrlOf(id, coverPath) {
  return coverPath ? `/api/books/${id}/cover` : null
}

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format,
    fileSize: row.fileSize,
    coverUrl: coverUrlOf(row.id, row.coverPath),
    sourceUrl: row.sourceUrl,
    license: row.license,
    industry: row.industry,
    tags: row.tags,
    textbookSlug: row.textbookSlug,
    hasFile: Boolean(row.filePath),
    previewable: PREVIEWABLE.has(row.format),
    createdAt: new Date(row.createdAt).getTime()
  }
}

/* ---------------- SSRF 防护 ---------------- */
function isPrivateIp(ip) {
  if (!ip) return true
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true
  return false
}
async function assertPublicUrl(raw) {
  let u
  try {
    u = new URL(String(raw || ''))
  } catch {
    throw new Error('URL 不合法')
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('仅支持 http/https')
  if (u.username || u.password) throw new Error('URL 不允许携带凭证')
  if (!isAllowedHost(u.hostname)) throw new Error(`来源不在开放教材白名单：${u.hostname}`)
  const records = await dns.lookup(u.hostname, { all: true }).catch(() => [])
  if (records.length === 0) throw new Error('域名解析失败')
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new Error('禁止访问内网地址')
  }
  return u
}

/** 下载（逐跳校验重定向、大小与超时限制） */
async function download(url) {
  let current = await assertPublicUrl(url)
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current.href, {
      redirect: 'manual',
      headers: { 'User-Agent': 'WenxingBookBot/1.0 (+open textbook import)' },
      signal: AbortSignal.timeout(60000)
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error('重定向缺少 Location')
      current = await assertPublicUrl(new URL(loc, current).href)
      continue
    }
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_SIZE) throw new Error('文件超过 100MB 限制')
    const type = String(res.headers.get('content-type') || '').toLowerCase()
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_SIZE) throw new Error('文件超过 100MB 限制')
    return { buf, type, finalUrl: current.href }
  }
  throw new Error('重定向次数过多')
}

/* ---------------- 入库 ---------------- */
function ensureDirs() {
  fs.mkdirSync(FILES_DIR, { recursive: true })
  fs.mkdirSync(COVERS_DIR, { recursive: true })
}

/**
 * 保存书籍：写文件、抽取 EPUB 结构与封面、写 DB
 * @param {{buf:Buffer, format:string, title:string, author?:string, sourceUrl?:string, license?:string, industry?:string, tags?:string, coverBuf?:Buffer}} book
 */
async function saveBook(book) {
  ensureDirs()
  const id = crypto.randomUUID()
  const format = book.format
  let filePath = null
  let textbookSlug = null
  let coverPath = null

  if (book.buf && book.buf.length > 0) {
    const name = `${id}.${format}`
    filePath = path.join(FILES_DIR, name)
    safeWriteFile(filePath, book.buf)
  }

  // EPUB：复用现有解析器生成章节树 + 首图作封面
  if (format === 'epub' && book.buf) {
    try {
      const parsed = parseEpub(book.buf, { titleOverride: book.title })
      const saved = saveTextbook(parsed, { sourceFile: book.sourceUrl || book.title })
      textbookSlug = saved.slug
      const img = (parsed.assets ?? []).find((a) => String(a.mime || '').startsWith('image/'))
      if (img?.data) {
        const ext = path.extname(img.name || '.jpg') || '.jpg'
        const coverName = `${id}${ext}`
        safeWriteFile(path.join(COVERS_DIR, coverName), img.data)
        coverPath = path.join('books', 'covers', coverName)
      }
    } catch (e) {
      log.warn('EPUB 解析失败，仅存原文件:', e?.message || e)
    }
  }

  if (book.coverBuf?.length) {
    const ext = String(book.coverName || '').toLowerCase().endsWith('.png') ? '.png' : '.jpg'
    const coverName = `${id}${ext}`
    safeWriteFile(path.join(COVERS_DIR, coverName), book.coverBuf)
    coverPath = path.join('books', 'covers', coverName)
  }

  const fileSize = book.buf?.length ?? null
  let row
  try {
    row = await serializeWrite(() =>
      db.book.create({
        data: {
          title: book.title,
          author: book.author || null,
          format,
          filePath,
          fileSize,
          coverPath,
          sourceUrl: book.sourceUrl || null,
          license: book.license || null,
          industry: book.industry || null,
          tags: book.tags || null,
          textbookSlug
        }
      })
    )
  } catch (e) {
    // 入库失败回滚已落盘的文件，避免留下孤儿文件
    if (filePath) safeRemove(filePath)
    if (coverPath) safeRemove(path.join(DATA_ROOT, coverPath))
    throw e
  }
  return serialize(row)
}

/* ---------------- 路由 ---------------- */

// 书架列表
router.get('/', async (req, res) => {
  try {
    const industry = str(req.query.industry)
    const q = str(req.query.q)
    const where = {}
    if (industry) where.industry = industry
    if (q) where.OR = [{ title: { contains: q } }, { author: { contains: q } }]
    const rows = await db.book.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
    res.json({ items: rows.map(serialize) })
  } catch (e) {
    res.status(500).json({ error: e?.message || '书架读取失败' })
  }
})

// 检索开放教材：AI 只给白名单域名候选，逐条 HEAD 校验
router.post('/search', auth, aiGuard('books'), async (req, res) => {
  try {
    const query = str(req.body?.query)
    const moduleName = str(req.body?.module)
    const industry = str(req.body?.industry)
    if (!query && !moduleName) return res.status(400).json({ error: '缺少检索关键词' })

    const domains = allowedDomains()
    const raw = await deepseek(
      [
        {
          role: 'system',
          content: `你是开放教材检索助手。只从以下域名中推荐电子教材：
${domains.join('、')}

严格要求：
1. 只返回 JSON：{"items":[{"title":"","author":"","url":"","format":"pdf|epub|html","license":"CC BY|CC BY-SA|公有领域|官方免费","note":""}]}
2. URL 必须是真实可访问的直链或教材介绍页，域名必须在上面清单内；不确定就不要返回。
3. 优先 PDF/EPUB 直链；最多 6 条。
4. 不要编造链接，不要返回商业出版社或盗版站点。`
        },
        { role: 'user', content: `检索：${query || moduleName}${industry ? `（行业：${industry}）` : ''}` }
      ],
      true,
      req.headers['x-user-api-key']
    )
    const tokens = takeLastUsage().total_tokens
    const text = String(raw || '')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    let items = []
    try {
      items = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text)?.items ?? []
    } catch {
      items = []
    }
    const out = []
    for (const it of Array.isArray(items) ? items : []) {
      const url = str(it?.url)
      if (!url) continue
      try {
        const u = new URL(url)
        if (!isAllowedHost(u.hostname)) continue
        const head = await fetch(u.href, {
          method: 'HEAD',
          redirect: 'follow',
          headers: { 'User-Agent': 'WenxingBookBot/1.0' },
          signal: AbortSignal.timeout(6000)
        })
        if (!head.ok) continue
        const type = String(head.headers.get('content-type') || '').toLowerCase()
        const format = type.includes('pdf')
          ? 'pdf'
          : type.includes('epub')
            ? 'epub'
            : extOf(u.pathname) || 'html'
        out.push({
          title: str(it?.title) || u.pathname.split('/').pop() || u.hostname,
          author: str(it?.author),
          url: u.href,
          format,
          license: str(it?.license),
          note: str(it?.note),
          domain: u.hostname
        })
      } catch {
        /* 单条不可达：丢弃 */
      }
    }
    res.json({ items: out, usage: { tokens } })
  } catch (e) {
    res.status(502).json({ error: e?.message || '开放教材检索失败' })
  }
})

// 下载并入库
router.post('/import-url', auth, async (req, res) => {
  try {
    const url = str(req.body?.url)
    const license = str(req.body?.license)
    const title = str(req.body?.title)
    if (!url) return res.status(400).json({ error: '缺少 url' })
    if (!license) return res.status(400).json({ error: '缺少许可信息：许可不明只允许仅链接入库' })

    const { buf, type, finalUrl } = await download(url)
    const hint = type.includes('pdf') ? 'pdf' : type.includes('epub') ? 'epub' : extOf(new URL(finalUrl).pathname)
    const format = detectFormat(buf, hint)
    if (!format) return res.status(400).json({ error: '无法识别的电子书格式（仅支持 PDF/EPUB/TXT/MD/MOBI/AZW3）' })

    const item = await saveBook({
      buf,
      format,
      title: title || str(req.body?.fallbackTitle) || new URL(finalUrl).pathname.split('/').pop() || '未命名教材',
      author: str(req.body?.author),
      sourceUrl: finalUrl,
      license,
      industry: str(req.body?.industry),
      tags: str(req.body?.tags)
    })
    res.json({ ok: true, item })
  } catch (e) {
    res.status(400).json({ error: e?.message || '下载入库失败' })
  }
})

// 上传（多格式 + 可选封面）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE } })
// 上传限流：内存态 multer 单请求可占 100MB，必须在解析前按用户限速
const uploadLimit = createRateLimit({
  windowMs: 10 * 60_000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '上传过于频繁，请稍后再试'
})
router.post(
  '/upload',
  auth,
  uploadLimit,
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  async (req, res) => {
    try {
      const file = req.files?.file?.[0]
      if (!file) return res.status(400).json({ error: '缺少文件' })
      const hint = extOf(file.originalname)
      if (!hint) return res.status(400).json({ error: '不支持的格式（pdf/epub/txt/md/mobi/azw3）' })
      const format = detectFormat(file.buffer, hint)
      if (!format) return res.status(400).json({ error: '文件内容与格式不符' })
      const cover = req.files?.cover?.[0]
      const item = await saveBook({
        buf: file.buffer,
        format,
        title: str(req.body?.title) || path.basename(file.originalname, path.extname(file.originalname)),
        author: str(req.body?.author),
        license: str(req.body?.license),
        industry: str(req.body?.industry),
        tags: str(req.body?.tags),
        coverBuf: cover?.buffer,
        coverName: cover?.originalname
      })
      res.json({ ok: true, item })
    } catch (e) {
      res.status(400).json({ error: e?.message || '上传失败' })
    }
  }
)

// 书籍详情
router.get('/:id', async (req, res) => {
  try {
    const row = await db.book.findUnique({ where: { id: safeId(req.params.id) } })
    if (!row) return res.status(404).json({ error: '书籍不存在' })
    res.json({ item: serialize(row) })
  } catch (e) {
    res.status(500).json({ error: e?.message || '读取失败' })
  }
})

// 文件下载/预览
router.get('/:id/file', async (req, res) => {
  try {
    const row = await db.book.findUnique({ where: { id: safeId(req.params.id) } })
    if (!row?.filePath || !fs.existsSync(row.filePath)) return res.status(404).json({ error: '文件不存在' })
    const ext = row.format === 'md' ? 'text/markdown' : row.format === 'txt' ? 'text/plain' : 'application/octet-stream'
    res.setHeader('Content-Type', `${ext}; charset=utf-8`)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.title)}.${row.format}"`)
    fs.createReadStream(row.filePath).pipe(res)
  } catch (e) {
    res.status(500).json({ error: e?.message || '读取失败' })
  }
})

// 封面
router.get('/:id/cover', async (req, res) => {
  try {
    const row = await db.book.findUnique({ where: { id: safeId(req.params.id) } })
    if (!row?.coverPath) return res.status(404).end()
    const full = path.join(DATA_ROOT, row.coverPath)
    if (!fs.existsSync(full)) return res.status(404).end()
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(full).pipe(res)
  } catch {
    res.status(404).end()
  }
})

// 删除（书架为全局共享资源，仅管理员可删，避免任意登录用户清空书架）
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const id = safeId(req.params.id)
    const row = await db.book.findUnique({ where: { id } })
    if (!row) return res.status(404).json({ error: '书籍不存在' })
    if (row.filePath) safeRemove(row.filePath)
    if (row.coverPath) safeRemove(path.join(DATA_ROOT, row.coverPath))
    await serializeWrite(() => db.book.delete({ where: { id } }))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e?.message || '删除失败' })
  }
})

export { router as booksRouter }
export default router
