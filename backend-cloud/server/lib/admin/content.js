// 问星 v1.4 — 管理后台内容与反馈路由：文档 / 星图反馈
import fs from 'node:fs'
import express from 'express'
import { db } from '../db.js'
import { wrap } from '../ai.js'
import {
  DOCS_DIR,
  listMdFiles,
  safeDocPath,
  indexOneDoc
} from '../docs-store.js'
import { readFeedback, deleteFeedback, setFeedbackStatus, FEEDBACK_STATUS } from '../feedback-store.js'
import { safeWriteFile, safeRemove } from '../fs-safe.js'
import { createLogger } from '../logger.js'

const router = express.Router()
const log = createLogger('admin-content')

/** 分页参数：page 默认 1，pageSize 默认 20，上限 100 */
function paging(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20))
  return { page, pageSize }
}

/** 列表通用逻辑：行业过滤 + 关键词匹配 + 按 updatedAt 倒序 + 内存分页 */
function listContent(dir, query) {
  const { page, pageSize } = paging(query)
  const industry = String(query.industry || '').trim()
  const q = String(query.q || '').trim().toLowerCase()

  let items = listMdFiles(dir)
  if (industry) items = items.filter((x) => x.industry === industry)
  if (q) {
    items = items.filter(
      (x) =>
        x.title.toLowerCase().includes(q) ||
        x.file.toLowerCase().includes(q) ||
        x.tags.some((t) => String(t).toLowerCase().includes(q))
    )
  }
  items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  const total = items.length
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), total, page, pageSize }
}

/** 校验 file 查询参数并解析为绝对路径；失败时已写响应，返回 null */
function resolveFile(req, res, safe) {
  const file = String(req.query.file || '').trim()
  if (!file) {
    res.status(400).json({ error: '缺少文件参数' })
    return null
  }
  try {
    return { file, full: safe(file) }
  } catch {
    res.status(400).json({ error: '文件路径不合法' })
    return null
  }
}

/** 把 frontmatter 内的 updatedAt 替换为当前时间（无 frontmatter / 无该行则原样返回） */
function touchUpdatedAt(content) {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end < 0) return content
  const head = content.slice(0, end)
  if (!/^updatedAt:/m.test(head)) return content
  const now = new Date().toISOString()
  return head.replace(/^updatedAt:[^\r\n]*/m, `updatedAt: ${now}`) + content.slice(end)
}

/* ===== 文档 ===== */

// 文档列表
router.get(
  '/docs',
  wrap(async (req, res) => {
    res.json(listContent(DOCS_DIR, req.query))
  })
)

// 文档原文（含 frontmatter）
router.get(
  '/docs/content',
  wrap(async (req, res) => {
    const target = resolveFile(req, res, safeDocPath)
    if (!target) return
    if (!fs.existsSync(target.full)) {
      res.status(404).json({ error: '文档不存在' })
      return
    }
    res.json({ file: target.file, content: fs.readFileSync(target.full, 'utf-8') })
  })
)

// 保存文档：写盘后重建向量索引（索引失败不影响保存结果）
router.put(
  '/docs/content',
  wrap(async (req, res) => {
    const { file, content } = req.body ?? {}
    if (typeof file !== 'string' || !file.trim()) {
      res.status(400).json({ error: '缺少文件参数' })
      return
    }
    if (typeof content !== 'string') {
      res.status(400).json({ error: '内容格式不合法' })
      return
    }
    let full
    try {
      full = safeDocPath(file)
    } catch {
      res.status(400).json({ error: '文件路径不合法' })
      return
    }

    const next = touchUpdatedAt(content)
    safeWriteFile(full, next)

    try {
      await indexOneDoc({ industry: file.split('/')[0] || '', file, full })
    } catch (e) {
      log.warn('文档索引失败：', e?.message || e)
    }
    res.json({ ok: true, file })
  })
)

// 删除文档及其向量切块
router.delete(
  '/docs/content',
  wrap(async (req, res) => {
    const target = resolveFile(req, res, safeDocPath)
    if (!target) return
    if (!fs.existsSync(target.full)) {
      res.status(404).json({ error: '文档不存在' })
      return
    }
    if (!safeRemove(target.full)) {
      res.status(500).json({ error: '文档删除失败，文件可能被占用，请稍后重试' })
      return
    }
    await db.docVector.deleteMany({ where: { file: target.file } })
    res.json({ ok: true })
  })
)

/* ===== 星图反馈 ===== */

// 反馈列表（readFeedback 已按时间倒序）
router.get(
  '/feedback',
  wrap(async (req, res) => {
    const industry = String(req.query.industry || '').trim()
    const items = readFeedback().filter((x) => !industry || x.industry === industry)
    res.json({ items, total: items.length })
  })
)

// 删除反馈：time 为空则清空该行业
router.delete(
  '/feedback',
  wrap(async (req, res) => {
    const { industry, time } = req.body ?? {}
    if (typeof industry !== 'string' || !industry.trim()) {
      res.status(400).json({ error: '缺少行业参数' })
      return
    }
    const removed = deleteFeedback({ industry, time })
    res.json({ ok: true, removed })
  })
)

// 流转反馈处理状态：pending → processing → done
router.patch(
  '/feedback',
  wrap(async (req, res) => {
    const { industry, time, status } = req.body ?? {}
    if (typeof industry !== 'string' || !industry.trim() || typeof time !== 'string' || !time.trim()) {
      res.status(400).json({ error: '缺少行业或时间参数' })
      return
    }
    if (!FEEDBACK_STATUS.includes(status)) {
      res.status(400).json({ error: '状态值不合法（可选：pending / processing / done）' })
      return
    }
    const exists = readFeedback().some((x) => x.industry === industry && x.time === time)
    if (!exists) {
      res.status(404).json({ error: '反馈不存在' })
      return
    }
    setFeedbackStatus({ industry, time, status })
    res.json({ ok: true })
  })
)

export default router
