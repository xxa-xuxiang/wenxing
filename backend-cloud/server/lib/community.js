// 问星 — 学习社区路由库
// 职责：帖子列表/详情/发布、点赞、收藏、评论、社区图片上传（base64 落盘）
// 挂载方式：app.use('/api/community', communityRouter)
//   静态目录：app.use('/uploads', express.static(path.join(DATA_ROOT, 'uploads')))
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { db } from './db.js'
import { auth, optionalAuth, optUserId } from './auth.js'
import { deepseek } from './ai.js'
import { aiQuotaAllowed, consumeAiQuota } from './ai-guard.js'
import { createRateLimit } from './rate-limit.js'
import { DATA_ROOT } from './data-root.js'
import { safeWriteFile } from './fs-safe.js'
import { createLogger } from './logger.js'
// 社区图片上传目录（导出供主服务挂载静态目录用）
export const COMMUNITY_UPLOAD_DIR = path.join(DATA_ROOT, 'uploads', 'community')

export const communityRouter = express.Router()
const log = createLogger('community')

// 统一错误包装：未捕获错误返回 502 + error 信息
const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res)
  } catch (e) {
    res.status(e?.status || 502).json({ error: e?.message || '服务器错误' })
  }
}

// JSON 数组容错解析：tags/images 存库为 JSON 字符串，出库时非数组一律按 [] 处理
function parseJsonArray(raw) {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/* ===== 敏感词前置拦截 + AI 异步复审 ===== */

// 敏感词库：data/sensitive-words.json（{"words":[...]}，可手动维护），60s 缓存减轻读盘
const SENSITIVE_WORDS_PATH = path.join(DATA_ROOT, 'sensitive-words.json')
const SENSITIVE_CACHE_TTL = 60 * 1000
let sensitiveCache = { words: null, loadedAt: 0 }

// 读取敏感词列表：命中缓存直接返回；文件缺失/损坏返回空数组（不拦截）
function loadSensitiveWords() {
  const now = Date.now()
  if (sensitiveCache.words && now - sensitiveCache.loadedAt < SENSITIVE_CACHE_TTL) {
    return sensitiveCache.words
  }
  let words = []
  try {
    const raw = JSON.parse(fs.readFileSync(SENSITIVE_WORDS_PATH, 'utf-8'))
    if (Array.isArray(raw?.words)) words = raw.words.filter((w) => typeof w === 'string' && w.trim())
  } catch {
    words = []
  }
  sensitiveCache = { words, loadedAt: now }
  return words
}

// 敏感词匹配：大小写不敏感 includes；命中返回该词，未命中返回 null
function hitSensitiveWord(text) {
  const words = loadSensitiveWords()
  if (!words.length) return null
  const hay = String(text || '').toLowerCase()
  for (const w of words) {
    if (hay.includes(w.toLowerCase())) return w
  }
  return null
}

// AI 复审 system prompt：仅判断是否违法违规，输出 JSON
const AI_AUDIT_PROMPT =
  '你是社区内容审核员。仅判断给定的帖子内容是否包含敏感或违法违规信息（政治敏感、色情低俗、赌博、诈骗、毒品、辱骂人身攻击等），' +
  '内容正常或仅是质量不高时一律视为不违规（violation=false）。不要评判内容质量、专业度或观点立场。' +
  '只输出 JSON 对象：{"violation":布尔值,"reason":字符串}；violation 为 true 时 reason 用一句话说明违规类别与依据，' +
  '为 false 时 reason 输出空字符串，不要输出任何其他文字。'

// AI 返回 JSON 容错解析：容忍 ```json 代码块包裹与前后缀文字，失败返回 null
function parseAiJson(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(text)
  } catch {
    const m = /\{[\s\S]*\}/.exec(text)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* fallthrough */
      }
    }
    return null
  }
}

// AI 异步复审：violation 为真则把帖子改为 rejected；整个过程静默失败（帖子保持可见）
// 复审固定走平台 Key（不透传用户 Key），按平台额度计；额度用尽时跳过复审，不阻断发帖
function auditByAi(req, postId, title, content) {
  if (!aiQuotaAllowed(req, 'chat', { honorUserKey: false })) return
  consumeAiQuota(req, 'chat', { honorUserKey: false })
  ;(async () => {
    try {
      const raw = await deepseek([
        { role: 'system', content: AI_AUDIT_PROMPT },
        { role: 'user', content: `标题：${title}\n正文：${content}` }
      ], true)
      const parsed = parseAiJson(raw)
      if (parsed?.violation === true) {
        await db.communityPost.update({
          where: { id: postId },
          data: {
            status: 'rejected',
            auditReason: String(parsed.reason || '内容涉嫌违规').slice(0, 200),
            auditBy: 'ai',
            auditedAt: new Date()
          }
        })
      }
    } catch (e) {
      log.warn('AI 复审失败（帖子保持可见）:', e?.message || e)
    }
  })()
}

// 批量查询当前用户对一组帖子的点赞/收藏状态（未登录返回空集合）
async function loadUserMarks(uid, postIds) {
  const marks = { liked: new Set(), favorited: new Set() }
  if (!uid || !postIds.length) return marks
  const [likes, favorites] = await Promise.all([
    db.communityLike.findMany({ where: { userId: uid, postId: { in: postIds } }, select: { postId: true } }),
    db.communityFavorite.findMany({ where: { userId: uid, postId: { in: postIds } }, select: { postId: true } })
  ])
  marks.liked = new Set(likes.map((l) => l.postId))
  marks.favorited = new Set(favorites.map((f) => f.postId))
  return marks
}

// 帖子摘要序列化（列表项）
function toListItem(post, marks) {
  const images = parseJsonArray(post.images)
  return {
    id: post.id,
    industryId: post.industryId,
    title: post.title,
    excerpt: post.content.replace(/[#>*`-]/g, '').slice(0, 80), // 摘要取正文纯文本前 80 字
    content: post.content,
    tags: parseJsonArray(post.tags),
    images,
    cover: images[0] ?? null,
    author: { nickname: post.user.nickname },
    likeCount: post._count.likes,
    commentCount: post._count.comments,
    createdAt: post.createdAt,
    liked: marks.liked.has(post.id),
    favorited: marks.favorited.has(post.id)
  }
}

// 排序方式 → Prisma orderBy（latest 最新 / hot 热榜 / recommend 推荐默认）
function orderByOf(sort) {
  if (sort === 'hot') return [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }]
  if (sort === 'comment') return [{ comments: { _count: 'desc' } }, { createdAt: 'desc' }]
  return [{ createdAt: 'desc' }]
}

// 帖子列表：按行业隔离，createdAt 倒序分页，支持 tag 精确匹配与 q 标题/正文模糊搜索
// 仅返回 status=approved 的帖子（rejected 帖对所有人隐藏，作者可在「我的文章」/详情中查看）
communityRouter.get('/posts', optionalAuth, wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20))
  const industryId = typeof req.query.industry === 'string' ? req.query.industry.trim() : ''
  const sort = typeof req.query.sort === 'string' ? req.query.sort : ''
  const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : ''
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  // 行业隔离：不同行业的内容互不可见（评论/点赞/收藏随帖隔离）；
  // industry=all / 缺省 = 全站推荐流（跨行业聚合，左侧「推荐」入口）
  const where = industryId && industryId !== 'all' ? { industryId } : {}
  // 可见性过滤：仅已审核通过的帖子对外可见
  where.status = 'approved'
  // tags 为 JSON 字符串，带引号包含匹配可精确命中整标签（避免"前端"误中"前端进阶"）
  if (tag) where.tags = { contains: `"${tag}"` }
  // SQLite 的 contains(LIKE) 对 ASCII 大小写不敏感，中文无大小写问题
  if (q) where.OR = [{ title: { contains: q } }, { content: { contains: q } }]
  const [total, rows] = await Promise.all([
    db.communityPost.count({ where }),
    db.communityPost.findMany({
      where,
      orderBy: orderByOf(sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { nickname: true } }, _count: { select: { likes: true, comments: true } } }
    })
  ])
  const marks = await loadUserMarks(optUserId(req), rows.map((r) => r.id))
  res.json({ items: rows.map((r) => toListItem(r, marks)), total, page, pageSize })
}))

// 行业内容计数：供左侧行业导航展示「内容数 / 草稿标记」（空行业=暂无内容）
communityRouter.get('/posts/stats', wrap(async (req, res) => {
  const grouped = await db.communityPost.groupBy({ by: ['industryId'], _count: { _all: true } })
  const counts = {}
  for (const g of grouped) counts[g.industryId] = g._count._all
  res.json({ counts })
}))

// 我发表的帖子列表（按 updatedAt 倒序，供个人文章管理界面）
// 注意：必须注册在 /posts/:id 之前，否则 mine 会被当作 :id 捕获
communityRouter.get('/posts/mine', auth, wrap(async (req, res) => {
  const rows = await db.communityPost.findMany({
    where: { userId: req.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: {
      user: { select: { nickname: true } },
      _count: { select: { likes: true, comments: true } }
    }
  })
  res.json({
    items: rows.map((r) => {
      const images = parseJsonArray(r.images)
      return {
        id: r.id,
        industryId: r.industryId,
        title: r.title,
        excerpt: r.content.replace(/[#>*`-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120), // 看板卡片内容预览
        tags: parseJsonArray(r.tags),
        cover: images[0] ?? null,
        likeCount: r._count.likes,
        commentCount: r._count.comments,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }
    })
  })
}))

// 通知列表：我发表的帖子收到的新点赞 / 新评论（不含本人操作），按时间倒序
communityRouter.get('/notifications', auth, wrap(async (req, res) => {
  const me = req.user.id
  const [likes, comments] = await Promise.all([
    db.communityLike.findMany({
      where: { post: { userId: me }, userId: { not: me } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        user: { select: { nickname: true } },
        post: { select: { id: true, title: true } }
      }
    }),
    db.communityComment.findMany({
      where: { post: { userId: me }, userId: { not: me } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        user: { select: { nickname: true } },
        post: { select: { id: true, title: true } }
      }
    })
  ])
  const items = [
    ...likes.map((l) => ({ id: `like:${l.id}`, kind: 'like', postId: l.post.id, postTitle: l.post.title, from: l.user.nickname, createdAt: l.createdAt })),
    ...comments.map((c) => ({ id: `comment:${c.id}`, kind: 'comment', postId: c.post.id, postTitle: c.post.title, from: c.user.nickname, excerpt: c.content.slice(0, 60), createdAt: c.createdAt }))
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50)
  res.json({ items })
}))

// 帖子详情：含完整正文/计数/评论（时间正序），不存在 404
// 可见性：仅 approved 对外可见；rejected 帖仅作者本人可查看（返回 auditReason），他人一律 404
communityRouter.get('/posts/:id', optionalAuth, wrap(async (req, res) => {
  const post = await db.communityPost.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { nickname: true } },
      _count: { select: { likes: true, comments: true, favorites: true } },
      comments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { nickname: true } } } }
    }
  })
  if (!post) return res.status(404).json({ error: '帖子不存在' })
  const isAuthor = req.user?.id && req.user.id === post.userId
  if (post.status !== 'approved' && !isAuthor) {
    return res.status(404).json({ error: '帖子不存在' })
  }
  const marks = await loadUserMarks(optUserId(req), [post.id])
  res.json({
    id: post.id,
    industryId: post.industryId,
    title: post.title,
    content: post.content,
    tags: parseJsonArray(post.tags),
    images: parseJsonArray(post.images),
    author: { nickname: post.user.nickname },
    likeCount: post._count.likes,
    commentCount: post._count.comments,
    favoriteCount: post._count.favorites,
    createdAt: post.createdAt,
    liked: marks.liked.has(post.id),
    favorited: marks.favorited.has(post.id),
    // 非 approved 帖（作者本人查看）附带审核状态与拦截原因
    ...(post.status !== 'approved' ? { status: post.status, auditReason: post.auditReason ?? null } : {}),
    comments: post.comments.map((c) => ({
      id: c.id,
      content: c.content,
      author: { nickname: c.user.nickname },
      createdAt: c.createdAt
    }))
  })
}))

// 发帖（需登录）：校验行业/标题/正文/标签/图片地址，创建后返回完整帖子
communityRouter.post('/posts', auth, wrap(async (req, res) => {
  const { title, content = '', tags = [], images = [], industryId = 'general' } = req.body ?? {}
  if (typeof industryId !== 'string' || !industryId.trim() || industryId.trim().length > 32) {
    return res.status(400).json({ error: '行业标识无效' })
  }
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 60) {
    return res.status(400).json({ error: '标题需为 1-60 字' })
  }
  if (typeof content !== 'string' || content.length > 20000) {
    return res.status(400).json({ error: '正文需为不超过 20000 字的文本' })
  }
  if (!Array.isArray(tags) || tags.length > 6 || tags.some((t) => typeof t !== 'string' || !t.trim() || t.trim().length > 20)) {
    return res.status(400).json({ error: '标签最多 6 个、每个 1-20 字' })
  }
  if (!Array.isArray(images) || images.length > 9 || images.some((u) => typeof u !== 'string' || !u.startsWith('/uploads/community/'))) {
    return res.status(400).json({ error: '图片最多 9 张，且须为 /uploads/community/ 下的地址' })
  }
  // 同步敏感词前置拦截：标题+正文+标签拼接后匹配，命中直接拒绝
  const hit = hitSensitiveWord([title.trim(), content, ...tags.map((t) => t.trim())].join('\n'))
  if (hit) {
    return res.status(400).json({ error: '内容包含违规敏感词，请修改后重试', reason: hit })
  }
  const post = await db.communityPost.create({
    data: {
      userId: req.user.id,
      industryId: industryId.trim(),
      title: title.trim(),
      content,
      tags: JSON.stringify(tags.map((t) => t.trim())),
      images: JSON.stringify(images)
    },
    include: { user: { select: { nickname: true } } }
  })
  const imgs = parseJsonArray(post.images)
  res.json({
    id: post.id,
    industryId: post.industryId,
    title: post.title,
    content: post.content,
    tags: parseJsonArray(post.tags),
    images: imgs,
    cover: imgs[0] ?? null,
    author: { nickname: post.user.nickname },
    likeCount: 0,
    commentCount: 0,
    favoriteCount: 0,
    createdAt: post.createdAt,
    liked: false,
    favorited: false
  })
  // 响应返回后再触发 AI 异步复审（不 await，不阻塞响应；违规改 rejected，失败静默）
  auditByAi(req, post.id, title.trim(), content)
}))

// 点赞/收藏共用的幂等切换：on=true 确保存在、false 确保不存在，返回最新总数
async function toggleRelation(model, postId, userId, on) {
  if (on) {
    await model.upsert({ where: { postId_userId: { postId, userId } }, create: { postId, userId }, update: {} })
  } else {
    await model.deleteMany({ where: { postId, userId } })
  }
  return model.count({ where: { postId } })
}

// 确认帖子存在（不存在 404），返回帖子 id
async function requirePost(req, res) {
  const post = await db.communityPost.findUnique({ where: { id: req.params.id }, select: { id: true } })
  if (!post) {
    res.status(404).json({ error: '帖子不存在' })
    return null
  }
  return post.id
}

// 点赞（幂等：已赞再 POST 不报错，返回现状）
communityRouter.post('/posts/:id/like', auth, wrap(async (req, res) => {
  const postId = await requirePost(req, res)
  if (!postId) return
  const likeCount = await toggleRelation(db.communityLike, postId, req.user.id, true)
  res.json({ liked: true, likeCount })
}))

// 取消点赞（幂等：未赞 DELETE 也不报错）
communityRouter.delete('/posts/:id/like', auth, wrap(async (req, res) => {
  const postId = await requirePost(req, res)
  if (!postId) return
  const likeCount = await toggleRelation(db.communityLike, postId, req.user.id, false)
  res.json({ liked: false, likeCount })
}))

// 收藏（幂等）
communityRouter.post('/posts/:id/favorite', auth, wrap(async (req, res) => {
  const postId = await requirePost(req, res)
  if (!postId) return
  const favoriteCount = await toggleRelation(db.communityFavorite, postId, req.user.id, true)
  res.json({ favorited: true, favoriteCount })
}))

// 取消收藏（幂等）
communityRouter.delete('/posts/:id/favorite', auth, wrap(async (req, res) => {
  const postId = await requirePost(req, res)
  if (!postId) return
  const favoriteCount = await toggleRelation(db.communityFavorite, postId, req.user.id, false)
  res.json({ favorited: false, favoriteCount })
}))

// 发评论（需登录）：1-500 字，返回新评论（含作者昵称）
communityRouter.post('/posts/:id/comments', auth, wrap(async (req, res) => {
  const { content } = req.body ?? {}
  if (typeof content !== 'string' || !content.trim() || content.trim().length > 500) {
    return res.status(400).json({ error: '评论需为 1-500 字' })
  }
  const postId = await requirePost(req, res)
  if (!postId) return
  const comment = await db.communityComment.create({
    data: { postId, userId: req.user.id, content: content.trim() },
    include: { user: { select: { nickname: true } } }
  })
  res.json({ id: comment.id, content: comment.content, author: { nickname: comment.user.nickname }, createdAt: comment.createdAt })
}))

// 图片上传（需登录）：data:image/(jpeg|png|webp|gif);base64 → 解码 ≤5MB 落盘，返回 /uploads/community/ 相对地址
// 限流：图片会真实写盘，防止登录用户无限刷盘
const uploadLimit = createRateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '图片上传过于频繁，请稍后再试'
})
communityRouter.post('/upload', auth, uploadLimit, wrap(async (req, res) => {
  const { image } = req.body ?? {}
  const m = typeof image === 'string' ? image.match(/^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/) : null
  if (!m) return res.status(400).json({ error: '图片需为 data:image/(jpeg|png|webp|gif);base64 格式' })
  const extMap = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' }
  const ext = extMap[m[1]] || 'png'
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length || buf.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: '图片解码后大小需不超过 5MB' })
  }
  const name = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`
  safeWriteFile(path.join(COMMUNITY_UPLOAD_DIR, name), buf)
  res.json({ url: `/uploads/community/${name}` })
}))
