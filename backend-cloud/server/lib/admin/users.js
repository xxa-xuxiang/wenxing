// 问星 v1.4 — 管理后台用户与社区治理路由
import express from 'express'
import { db } from '../db.js'
import { wrap } from '../ai.js'
import { hashPassword } from '../auth.js'

const router = express.Router()

/** 分页参数：page 默认 1，pageSize 默认 20 上限 100 */
function pageParams(query) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  return { page, pageSize }
}

/** 字符串查询参数（去首尾空白） */
function queryText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** JSON 字符串 → string[]，解析失败返回空数组 */
function parseList(raw) {
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/** 作者精简信息 */
function authorOf(user) {
  return { nickname: user?.nickname || '', username: user?.username || '' }
}

/* ===== 用户 ===== */

// 用户列表：按用户名/昵称模糊搜索
router.get(
  '/users',
  wrap(async (req, res) => {
    const { page, pageSize } = pageParams(req.query)
    const q = queryText(req.query.q)
    const where = q
      ? { OR: [{ username: { contains: q } }, { nickname: { contains: q } }] }
      : {}

    const [total, rows] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          username: true,
          nickname: true,
          disabled: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { communityPosts: true } }
        }
      })
    ])

    res.json({
      items: rows.map((u) => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        disabled: u.disabled,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        postCount: u._count.communityPosts
      })),
      total,
      page,
      pageSize
    })
  })
)

// 用户详情：基础信息 + 学习档案 + 统计
router.get(
  '/users/:id',
  wrap(async (req, res) => {
    const user = await db.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        username: true,
        nickname: true,
        disabled: true,
        createdAt: true,
        lastLoginAt: true,
        profile: true
      }
    })
    if (!user) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    const [mastery, posts, comments, checkins, plans, lastSession, lastCheckin, lastPost] =
      await Promise.all([
        db.masteryRecord.count({ where: { userId: user.id } }),
        db.communityPost.count({ where: { userId: user.id } }),
        db.communityComment.count({ where: { userId: user.id } }),
        db.checkin.count({ where: { userId: user.id } }),
        db.learningPlan.count({ where: { userId: user.id } }),
        db.quizSession.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        }),
        db.checkin.findFirst({
          where: { userId: user.id },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true }
        }),
        db.communityPost.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        })
      ])

    // 最近活跃：答题 / 打卡 / 发帖取最晚
    const times = [lastSession?.createdAt, lastCheckin?.updatedAt, lastPost?.createdAt]
      .filter(Boolean)
      .map((d) => new Date(d).getTime())

    let profile = null
    if (user.profile) {
      try {
        profile = JSON.parse(user.profile)
      } catch {
        profile = null
      }
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        disabled: user.disabled,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
      },
      profile,
      stats: {
        mastery,
        posts,
        comments,
        checkins,
        plans,
        lastActiveAt: times.length ? new Date(Math.max(...times)).toISOString() : null
      }
    })
  })
)

// 重置用户密码
router.post(
  '/users/:id/reset-password',
  wrap(async (req, res) => {
    const { password } = req.body ?? {}
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: '密码至少 6 位' })
      return
    }
    const exists = await db.user.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!exists) {
      res.status(404).json({ error: '用户不存在' })
      return
    }
    await db.user.update({
      where: { id: req.params.id },
      data: { passwordHash: await hashPassword(password) }
    })
    res.json({ ok: true })
  })
)

// 更新用户：禁用状态 / 昵称
router.patch(
  '/users/:id',
  wrap(async (req, res) => {
    const { disabled, nickname } = req.body ?? {}
    const data = {}

    if (disabled !== undefined) {
      if (typeof disabled !== 'boolean') {
        res.status(400).json({ error: 'disabled 必须为布尔值' })
        return
      }
      data.disabled = disabled
    }
    if (nickname !== undefined) {
      if (typeof nickname !== 'string') {
        res.status(400).json({ error: '昵称格式不正确' })
        return
      }
      const trimmed = nickname.trim()
      if (!trimmed || trimmed.length > 30) {
        res.status(400).json({ error: '昵称不能为空且不超过 30 字' })
        return
      }
      data.nickname = trimmed
    }
    if (!Object.keys(data).length) {
      res.status(400).json({ error: '没有可更新的字段' })
      return
    }

    const exists = await db.user.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!exists) {
      res.status(404).json({ error: '用户不存在' })
      return
    }
    await db.user.update({ where: { id: req.params.id }, data })
    res.json({ ok: true })
  })
)

// 删除用户（关联数据由 schema 级联删除）
router.delete(
  '/users/:id',
  wrap(async (req, res) => {
    const exists = await db.user.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!exists) {
      res.status(404).json({ error: '用户不存在' })
      return
    }
    await db.user.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  })
)

/* ===== 社区帖子 ===== */

// 帖子列表：行业精确 + 标题/正文搜索 + 作者搜索 + 状态筛选（approved|rejected|空=全部）
router.get(
  '/posts',
  wrap(async (req, res) => {
    const { page, pageSize } = pageParams(req.query)
    const industry = queryText(req.query.industry)
    const q = queryText(req.query.q)
    const author = queryText(req.query.author)
    const status = queryText(req.query.status)

    const where = {}
    if (industry) where.industryId = industry
    if (status === 'approved' || status === 'rejected') where.status = status
    if (q) where.OR = [{ title: { contains: q } }, { content: { contains: q } }]
    if (author) {
      where.user = {
        is: { OR: [{ username: { contains: author } }, { nickname: { contains: author } }] }
      }
    }

    const [total, rows] = await Promise.all([
      db.communityPost.count({ where }),
      db.communityPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { username: true, nickname: true } },
          _count: { select: { comments: true, likes: true } }
        }
      })
    ])

    res.json({
      items: rows.map((p) => ({
        id: p.id,
        industryId: p.industryId,
        title: p.title,
        excerpt: p.content.replace(/\s+/g, ' ').trim().slice(0, 120),
        author: authorOf(p.user),
        status: p.status,
        auditReason: p.auditReason ?? null,
        likeCount: p._count.likes,
        commentCount: p._count.comments,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      })),
      total,
      page,
      pageSize
    })
  })
)

// 帖子详情（含评论）
router.get(
  '/posts/:id',
  wrap(async (req, res) => {
    const post = await db.communityPost.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { username: true, nickname: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { username: true, nickname: true } } }
        },
        _count: { select: { comments: true, likes: true, favorites: true } }
      }
    })
    if (!post) {
      res.status(404).json({ error: '帖子不存在' })
      return
    }

    res.json({
      post: {
        id: post.id,
        industryId: post.industryId,
        title: post.title,
        content: post.content,
        tags: parseList(post.tags),
        images: parseList(post.images),
        author: authorOf(post.user),
        status: post.status,
        auditReason: post.auditReason ?? null,
        likeCount: post._count.likes,
        commentCount: post._count.comments,
        favoriteCount: post._count.favorites,
        createdAt: post.createdAt,
        comments: post.comments.map((c) => ({
          id: c.id,
          content: c.content,
          author: authorOf(c.user),
          createdAt: c.createdAt
        }))
      }
    })
  })
)

// 审核帖子：管理员下架/恢复（auditBy=admin）
router.patch(
  '/posts/:id/audit',
  wrap(async (req, res) => {
    const { status, reason } = req.body ?? {}
    if (status !== 'approved' && status !== 'rejected') {
      res.status(400).json({ error: 'status 必须为 approved 或 rejected' })
      return
    }
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      res.status(400).json({ error: 'reason 必须为字符串' })
      return
    }
    const exists = await db.communityPost.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    })
    if (!exists) {
      res.status(404).json({ error: '帖子不存在' })
      return
    }
    await db.communityPost.update({
      where: { id: req.params.id },
      data: {
        status,
        auditReason: (typeof reason === 'string' && reason.trim()) ? reason.trim() : null,
        auditBy: 'admin',
        auditedAt: new Date()
      }
    })
    res.json({ ok: true })
  })
)

// 删除帖子（评论/点赞/收藏级联删除）
router.delete(
  '/posts/:id',
  wrap(async (req, res) => {
    const exists = await db.communityPost.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    })
    if (!exists) {
      res.status(404).json({ error: '帖子不存在' })
      return
    }
    await db.communityPost.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  })
)

/* ===== 社区评论 ===== */

// 评论列表：内容或所属帖子标题搜索
router.get(
  '/comments',
  wrap(async (req, res) => {
    const { page, pageSize } = pageParams(req.query)
    const q = queryText(req.query.q)
    const where = q
      ? { OR: [{ content: { contains: q } }, { post: { is: { title: { contains: q } } } }] }
      : {}

    const [total, rows] = await Promise.all([
      db.communityComment.count({ where }),
      db.communityComment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { username: true, nickname: true } },
          post: { select: { title: true } }
        }
      })
    ])

    res.json({
      items: rows.map((c) => ({
        id: c.id,
        content: c.content,
        author: authorOf(c.user),
        postId: c.postId,
        postTitle: c.post?.title || '',
        createdAt: c.createdAt
      })),
      total,
      page,
      pageSize
    })
  })
)

// 删除评论
router.delete(
  '/comments/:id',
  wrap(async (req, res) => {
    const exists = await db.communityComment.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    })
    if (!exists) {
      res.status(404).json({ error: '评论不存在' })
      return
    }
    await db.communityComment.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  })
)

export default router
