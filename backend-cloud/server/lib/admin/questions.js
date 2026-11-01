// 问星 v1.4 — 管理后台题库与铺题路由（题目 CRUD / 铺题账本 / 叶子 / 语料）
import express from 'express'
import { db } from '../db.js'
import { wrap } from '../ai.js'
import { safeJson } from '../question-dto.js'
import { fillLeaf } from '../question-pipeline.js'
import { createLogger } from '../logger.js'

const router = express.Router()
const log = createLogger('admin-questions')

const QUESTION_STATUS = ['draft', 'verified', 'rejected']
const QUESTION_TYPES = ['single', 'multiple', 'short', 'coding']
const DIFFICULTIES = ['easy', 'medium', 'hard']
const FILL_STATUS = ['pending', 'materializing', 'filled', 'blocked', 'failed']
const DOC_STATUS = ['active', 'disabled']

/** 分页参数：page 从 1 开始，pageSize 默认 20、上限 100 */
function paging(query) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

/** 题目行（含 leaf）→ 管理后台 DTO */
function toAdminQuestion(q) {
  const leaf = q.leaf || {}
  const options = safeJson(q.options, [])
  const sources = safeJson(q.sources, [])
  return {
    id: q.id,
    status: q.status,
    type: q.type,
    difficulty: q.difficulty,
    title: q.title,
    body: q.body,
    answer: q.answer,
    explanation: q.explanation,
    options: Array.isArray(options) ? options : [],
    sources: Array.isArray(sources) ? sources : [],
    feedbackCount: q.feedbackCount,
    version: q.version,
    source: q.source,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    leaf: {
      leafKey: leaf.leafKey || '',
      pathText: leaf.pathText || '',
      industry: leaf.industry || '',
      category: leaf.category || '',
      domain: leaf.domain || '',
      stack: leaf.stack || '',
      name: leaf.name || ''
    }
  }
}

// ===== 题库列表 =====
router.get(
  '/questions',
  wrap(async (req, res) => {
    const { status, type, difficulty, industry, leafKey } = req.query
    if (status !== undefined && !QUESTION_STATUS.includes(String(status))) {
      res.status(400).json({ error: 'status 参数不合法' })
      return
    }
    if (type !== undefined && !QUESTION_TYPES.includes(String(type))) {
      res.status(400).json({ error: 'type 参数不合法' })
      return
    }
    if (difficulty !== undefined && !DIFFICULTIES.includes(String(difficulty))) {
      res.status(400).json({ error: 'difficulty 参数不合法' })
      return
    }

    const where = {}
    if (status) where.status = String(status)
    if (type) where.type = String(type)
    if (difficulty) where.difficulty = String(difficulty)

    const leafWhere = {}
    if (industry) leafWhere.industry = String(industry)
    if (leafKey) leafWhere.leafKey = String(leafKey)
    if (Object.keys(leafWhere).length) where.leaf = { is: leafWhere }

    const kw = String(req.query.q || '').trim().slice(0, 60)
    if (kw) {
      where.OR = [
        { title: { contains: kw } },
        { body: { contains: kw } },
        { leaf: { is: { name: { contains: kw } } } }
      ]
    }

    const { page, pageSize, skip, take } = paging(req.query)
    const [total, rows] = await Promise.all([
      db.question.count({ where }),
      db.question.findMany({
        where,
        include: { leaf: true },
        orderBy: { updatedAt: 'desc' },
        skip,
        take
      })
    ])
    res.json({ items: rows.map(toAdminQuestion), total, page, pageSize })
  })
)

// ===== 题目详情（含审计留痕） =====
router.get(
  '/questions/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id)
    const row = await db.question.findUnique({
      where: { id },
      include: { leaf: true, audits: { orderBy: { createdAt: 'desc' } } }
    })
    if (!row) {
      res.status(404).json({ error: '题目不存在' })
      return
    }
    const question = toAdminQuestion(row)
    question.audits = row.audits.map((a) => ({
      id: a.id,
      verdict: a.verdict,
      reason: a.reason,
      attempt: a.attempt,
      createdAt: a.createdAt
    }))
    res.json({ question })
  })
)

// ===== 编辑题目 =====
router.patch(
  '/questions/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id)
    const body = req.body ?? {}
    const data = {}

    if (body.status !== undefined) {
      if (!QUESTION_STATUS.includes(String(body.status))) {
        res.status(400).json({ error: 'status 参数不合法' })
        return
      }
      data.status = String(body.status)
    }
    if (body.type !== undefined) {
      if (!QUESTION_TYPES.includes(String(body.type))) {
        res.status(400).json({ error: 'type 参数不合法' })
        return
      }
      data.type = String(body.type)
    }
    if (body.difficulty !== undefined) {
      if (!DIFFICULTIES.includes(String(body.difficulty))) {
        res.status(400).json({ error: 'difficulty 参数不合法' })
        return
      }
      data.difficulty = String(body.difficulty)
    }
    for (const key of ['title', 'body', 'answer']) {
      if (body[key] === undefined) continue
      if (typeof body[key] !== 'string' || !body[key].trim()) {
        res.status(400).json({ error: `${key} 必须为非空字符串` })
        return
      }
      data[key] = body[key]
    }
    if (body.explanation !== undefined) {
      if (typeof body.explanation !== 'string') {
        res.status(400).json({ error: 'explanation 必须为字符串' })
        return
      }
      data.explanation = body.explanation
    }
    if (body.options !== undefined) {
      if (!Array.isArray(body.options) || body.options.some((o) => typeof o !== 'string')) {
        res.status(400).json({ error: 'options 必须是字符串数组' })
        return
      }
      data.options = JSON.stringify(body.options)
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: '没有可更新字段' })
      return
    }

    const exists = await db.question.findUnique({ where: { id }, select: { id: true } })
    if (!exists) {
      res.status(404).json({ error: '题目不存在' })
      return
    }

    const updated = await db.question.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
      include: { leaf: true }
    })
    res.json({ ok: true, question: toAdminQuestion(updated) })
  })
)

// ===== 删除题目（审计记录随题级联删除） =====
router.delete(
  '/questions/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id)
    const exists = await db.question.findUnique({ where: { id }, select: { id: true } })
    if (!exists) {
      res.status(404).json({ error: '题目不存在' })
      return
    }
    await db.question.delete({ where: { id } })
    res.json({ ok: true })
  })
)

// ===== 铺题任务列表 =====
router.get(
  '/fill-jobs',
  wrap(async (req, res) => {
    const { status, industry } = req.query
    if (status !== undefined && !FILL_STATUS.includes(String(status))) {
      res.status(400).json({ error: 'status 参数不合法' })
      return
    }
    const where = {}
    if (status) where.status = String(status)
    if (industry) where.leaf = { is: { industry: String(industry) } }

    const { page, pageSize, skip, take } = paging(req.query)
    const [total, rows] = await Promise.all([
      db.fillJobItem.count({ where }),
      db.fillJobItem.findMany({
        where,
        include: { leaf: true },
        orderBy: { updatedAt: 'desc' },
        skip,
        take
      })
    ])
    res.json({
      items: rows.map((r) => ({
        leafKey: r.leafKey,
        pathText: r.leaf?.pathText || '',
        industry: r.leaf?.industry || '',
        status: r.status,
        verifiedCount: r.verifiedCount,
        attempts: r.attempts,
        lastError: r.lastError,
        updatedAt: r.updatedAt
      })),
      total,
      page,
      pageSize
    })
  })
)

// ===== 技能叶子列表（无账本时按 pending 展示） =====
router.get(
  '/leaves',
  wrap(async (req, res) => {
    const { industry } = req.query
    const where = {}
    if (industry) where.industry = String(industry)
    const kw = String(req.query.q || '').trim().slice(0, 60)
    if (kw) {
      where.OR = [{ name: { contains: kw } }, { pathText: { contains: kw } }]
    }

    const { page, pageSize, skip, take } = paging(req.query)
    const [total, rows] = await Promise.all([
      db.skillLeaf.count({ where }),
      db.skillLeaf.findMany({
        where,
        include: { fillJob: true },
        orderBy: [{ industry: 'asc' }, { pathText: 'asc' }],
        skip,
        take
      })
    ])
    res.json({
      items: rows.map((r) => ({
        leafKey: r.leafKey,
        pathText: r.pathText,
        name: r.name,
        industry: r.industry,
        status: r.fillJob?.status || 'pending',
        verifiedCount: r.fillJob?.verifiedCount || 0,
        attempts: r.fillJob?.attempts || 0
      })),
      total,
      page,
      pageSize
    })
  })
)

// ===== 批量重置铺题任务 =====
router.post(
  '/fill-jobs/reset',
  wrap(async (req, res) => {
    const body = req.body ?? {}
    const leafKeys = Array.isArray(body.leafKeys) ? body.leafKeys.filter((k) => typeof k === 'string' && k) : []
    const { status, industry } = body
    if (status !== undefined && !FILL_STATUS.includes(String(status))) {
      res.status(400).json({ error: 'status 参数不合法' })
      return
    }
    if (leafKeys.length === 0 && !status && !industry) {
      res.status(400).json({ error: '请指定要重置的任务范围' })
      return
    }

    let where = {}
    if (leafKeys.length > 0) {
      where = { leafKey: { in: leafKeys } }
    } else {
      if (status) where.status = String(status)
      if (industry) {
        // 行业维度先换算成该行业下的全部 leafKey
        const leaves = await db.skillLeaf.findMany({
          where: { industry: String(industry) },
          select: { leafKey: true }
        })
        if (leaves.length === 0) {
          res.json({ ok: true, count: 0 })
          return
        }
        where.leafKey = { in: leaves.map((l) => l.leafKey) }
      }
    }

    const result = await db.fillJobItem.updateMany({
      where,
      data: { status: 'pending', attempts: 0, lastError: '', updatedAt: new Date() }
    })
    res.json({ ok: true, count: result.count })
  })
)

// ===== 单叶子触发铺题：进程内单并发排队，立即返回 =====
let chain = Promise.resolve()

router.post(
  '/fill-jobs/run',
  wrap(async (req, res) => {
    const leafKey = String(req.body?.leafKey || '').trim()
    if (!leafKey) {
      res.status(400).json({ error: '缺少 leafKey' })
      return
    }
    const leaf = await db.skillLeaf.findUnique({ where: { leafKey } })
    if (!leaf) {
      res.status(404).json({ error: '技能点不存在' })
      return
    }
    // 排入单并发队列，出题失败只告警，不影响本次响应
    chain = chain
      .then(() => fillLeaf(leaf, { fetchWeb: true }))
      .catch((e) => log.warn('管理后台触发出题失败：', String(e?.message || e).slice(0, 160)))
    res.json({ started: true })
  })
)

// ===== 语料文档列表 =====
router.get(
  '/corpus/docs',
  wrap(async (req, res) => {
    const { industry } = req.query
    const where = {}
    if (industry) where.industry = String(industry)
    const kw = String(req.query.q || '').trim().slice(0, 60)
    if (kw) {
      where.OR = [{ title: { contains: kw } }, { url: { contains: kw } }]
    }

    const { page, pageSize, skip, take } = paging(req.query)
    const [total, rows] = await Promise.all([
      db.sourceDoc.count({ where }),
      db.sourceDoc.findMany({
        where,
        include: { _count: { select: { chunks: true } } },
        orderBy: { fetchedAt: 'desc' },
        skip,
        take
      })
    ])
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title,
        siteDomain: r.siteDomain,
        industry: r.industry,
        license: r.license,
        status: r.status,
        chunkCount: r._count.chunks,
        fetchedAt: r.fetchedAt
      })),
      total,
      page,
      pageSize
    })
  })
)

// ===== 启停语料文档 =====
router.patch(
  '/corpus/docs/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id)
    const status = String(req.body?.status || '')
    if (!DOC_STATUS.includes(status)) {
      res.status(400).json({ error: 'status 参数不合法' })
      return
    }
    const exists = await db.sourceDoc.findUnique({ where: { id }, select: { id: true } })
    if (!exists) {
      res.status(404).json({ error: '语料文档不存在' })
      return
    }
    await db.sourceDoc.update({ where: { id }, data: { status } })
    res.json({ ok: true })
  })
)

// ===== 删除语料文档（切块级联删除） =====
router.delete(
  '/corpus/docs/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id)
    const exists = await db.sourceDoc.findUnique({ where: { id }, select: { id: true } })
    if (!exists) {
      res.status(404).json({ error: '语料文档不存在' })
      return
    }
    await db.sourceDoc.delete({ where: { id } })
    res.json({ ok: true })
  })
)

export default router
