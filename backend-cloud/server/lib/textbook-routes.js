// 问星 v1.7 — 教材导入路由
// POST /api/textbooks/import        原始二进制 epub → 解析 → 落盘 → 返回章节树
// GET  /api/textbooks/:slug/sections 按 id 读取分节 Markdown（缺省全部）
import express from 'express'
import { EpubError, parseEpub } from './epub.js'
import { readSections, readTree, safeTextbookSlug, saveTextbook } from './textbook-store.js'
import { createLogger } from './logger.js'
import { auth } from './auth.js'
import { createRateLimit } from './rate-limit.js'

const log = createLogger('textbook')

const RAW_TYPES = ['application/epub+zip', 'application/octet-stream']

// 教材导入：需登录 + 限流，且鉴权/限流放在 raw body 解析之前，避免未授权请求先吃掉 80MB 内存
const importLimit = createRateLimit({
  windowMs: 10 * 60_000,
  max: 3,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '教材导入过于频繁，请稍后再试'
})

function sendError(res, err) {
  if (err instanceof EpubError) {
    res.status(err.status || 400).json({ error: err.message })
    return
  }
  log.warn('教材解析失败:', err?.message || err)
  res.status(500).json({ error: '教材解析失败，请稍后重试' })
}

export function registerTextbookRoutes(app) {
  app.post(
    '/api/textbooks/import',
    auth,
    importLimit,
    express.raw({ type: RAW_TYPES, limit: '80mb' }),
    async (req, res) => {
      try {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: '未收到 epub 文件' })
          return
        }
        let sourceFile = ''
        try {
          sourceFile = decodeURIComponent(String(req.headers['x-file-name'] || ''))
        } catch {
          sourceFile = String(req.headers['x-file-name'] || '')
        }
        const parsed = parseEpub(req.body)
        const result = saveTextbook(parsed, { sourceFile })
        res.json(result)
      } catch (err) {
        sendError(res, err)
      }
    }
  )

  app.get('/api/textbooks/:slug/sections', (req, res) => {
    try {
      const slug = safeTextbookSlug(req.params.slug)
      const raw = String(req.query.ids ?? '').trim()
      const ids = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : undefined
      const sections = readSections(slug, ids)
      res.json({ slug, sections })
    } catch (err) {
      sendError(res, err)
    }
  })

  // 目录树（层级 nodes，供书籍阅读器左侧目录；独立路径不与 sections 冲突）
  app.get('/api/textbooks/:slug/tree', (req, res) => {
    try {
      const slug = safeTextbookSlug(req.params.slug)
      res.json(readTree(slug))
    } catch (err) {
      sendError(res, err)
    }
  })

  // 路由级错误处理：body 超限 → 413（raw 解析错误发生在进入 handler 之前）
  app.use('/api/textbooks', (err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'epub 文件过大（上限 80MB）' })
      return
    }
    next(err)
  })
}
