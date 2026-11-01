// 问星 v0.1 — 本地后端
// 职责：1) 代理 DeepSeek API（Key 只存在服务端，不经浏览器） 2) 学习文档 md 存档（按行业分文件夹 + frontmatter 标签）
// 启动：server 目录下 npm run dev（依赖 server/.env 的 DEEPSEEK_API_KEY）
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYaml } from './utils/miniYaml.js'
import { db } from './lib/db.js'
import { hashPassword, verifyPassword, signToken, auth, optUserId } from './lib/auth.js'
import { countUsage, getUsage, getTokenStats, getDebtFen, settleAiFee, DAILY_LIMITS, ANON_DAILY_LIMITS, BILLING, hasUserKey, actorOf } from './lib/aiUsage.js'
import { createRateLimit } from './lib/rate-limit.js'
import { takeAiQuota, aiBurstOnly, authorizeAiCall, respondAiDenied } from './lib/ai-guard.js'
import { adminAuth } from './lib/admin-auth.js'
import { embed, cosine, embeddingProvider } from './lib/embedding.js'
import { communityRouter } from './lib/community.js'
import { deepseek, deepseekStream, wrap, takeLastUsage, runInUsageContext } from './lib/ai.js'
import { runStudyPlanAgent } from './lib/studyPlanAgent.js'
import { refineOutline } from './lib/outlineRefine.js'
import { buildTextbookOutline } from './lib/textbookOutline.js'
import { buildGoalDecomposePrompt, sopContext } from './lib/skillTypes.js'
import registerQuestionRoutes from './lib/questions-routes.js'
import registerQuizRoutes from './lib/quiz-routes.js'
import registerCheckinRoutes from './lib/checkin-routes.js'
import registerAdminRoutes from './lib/admin-routes.js'
import { registerTextbookRoutes } from './lib/textbook-routes.js'
import trackRouter from './lib/track.js'
import billingRouter from './lib/pricing.js'
import walletRouter from './lib/wallet-routes.js'
import { ensureInviteCodes, newInviteCode, findInviterByCode } from './lib/invite.js'
import translateRouter from './lib/translate-routes.js'
import feedbackRouter from './lib/feedback-routes.js'
import { listExtraNodes, appendExtraNodes, syncSkillLeaves } from './lib/atlas-extra.js'
import booksRouter from './lib/books-routes.js'
import { listAgents, runAgent } from './lib/agents/index.js'
import { OPTIONS_HINT, splitOptions } from './lib/chat-options.js'
import {
  DATA_ROOT,
  DOCS_DIR,
  safeName,
  parseFrontmatter,
  buildFrontmatter,
  safeDocPath,
  docTags,
  indexOneDoc
} from './lib/docs-store.js'
import { readFeedback } from './lib/feedback-store.js'
import { safeWriteFile } from './lib/fs-safe.js'
import { createLogger } from './lib/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const log = createLogger('server')
// 数据根目录与文档目录由 lib/docs-store.js 统一解析（WENXING_DATA_ROOT 语义不变）
const DATA_DIR = DOCS_DIR
const PORT = Number(process.env.PORT) || 3001
// 监听地址：默认 0.0.0.0（局域网/桌面端直连）；生产置于 Nginx 之后建议 HOST=127.0.0.1
const HOST = String(process.env.HOST || '0.0.0.0')

const app = express()
app.disable('x-powered-by')
// 仅在本机/内网试用；部署在反向代理后可用 TRUST_PROXY 恢复客户端真实 IP
app.set('trust proxy', Number(process.env.TRUST_PROXY) || false)

// 请求级 AI usage 上下文：并发请求各自记录 tokens，避免模块级变量串号导致计费不准
app.use((req, res, next) => runInUsageContext(next))

// 基础安全响应头（CSP / X-Frame-Options 会与书籍 PDF iframe 预览冲突，需按域名白名单单独配置，暂不启用）
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  next()
})

// CORS 白名单：显式配置 + 本机/局域网 + Tauri 源；无 Origin（curl/原生客户端）放行
const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const localOriginRe =
  /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?|http:\/\/tauri\.localhost|tauri:\/\/localhost)$/
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || corsOrigins.includes(origin) || localOriginRe.test(origin)) return cb(null, true)
      cb(null, false)
    }
  })
)
app.use(express.json({ limit: '4mb' }))
// 全局限流：覆盖所有 /api 请求，兜底防止单 IP 高频刷接口（可用 GLOBAL_RATE_MAX 调整）
const globalApiLimiter = createRateLimit({
  windowMs: 60_000,
  max: Number(process.env.GLOBAL_RATE_MAX) || 600,
  message: '请求过于频繁，请稍后再试'
})
app.use('/api', globalApiLimiter)
// 社区图片静态目录：/uploads/community/<文件名>
app.use('/uploads', express.static(path.join(DATA_ROOT, 'uploads')))
// 学习社区路由（帖子/点赞/收藏/评论/图片上传）
app.use('/api/community', communityRouter)
// v1.6 行为埋点上报（可选登录：未登录按匿名会话统计）
app.use('/api/track', trackRouter)
// v1.6 公开计费标准读取（桌面端/网页端展示与变更提醒）
app.use('/api/billing', billingRouter)
// v1.1 钱包（余额查询 / 兑换码核销）
app.use('/api/wallet', walletRouter)
// v1.1 题库路由（浏览/分面/按叶子凑题 JIT/覆盖度/旧题迁移）
registerQuestionRoutes(app)
// v1.1 试卷与答题会话路由（试卷 ID 引用 / 交卷服务端判分 / 交卷深度分析）
registerQuizRoutes(app)
// v1.2 学习流程路由（每日打卡 / 每周复盘）
registerCheckinRoutes(app)
// v1.7 教材导入路由（epub 解析为章节树 + 分节 md）
registerTextbookRoutes(app)
// v1.4 管理后台路由（管理员鉴权 / 数据看板 / 题库 / 用户 / 内容）
registerAdminRoutes(app)
// v1.5 划词翻译路由（术语库 CRUD / 译文缓存 / 翻译）
app.use('/api/translate', translateRouter)
// 社区书籍书架（开放教材检索 / 下载入库 / 上传 / 列表）
app.use('/api/books', booksRouter)
// 知识星图运行时增量（AI 精细大纲补充的新学科/能力）
app.get('/api/atlas/extra', (req, res) => {
  res.json({ nodes: listExtraNodes() })
})
const atlasWriteLimiter = createRateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '星图更新过于频繁，请稍后再试'
})
app.post('/api/atlas/extra', auth, atlasWriteLimiter, wrap(async (req, res) => {
  const { nodes = [], industry = '' } = req.body ?? {}
  const merged = appendExtraNodes(nodes, industry)
  // 同步 SkillLeaf：失败不阻断星图增量落盘
  let leavesAdded = 0
  try {
    leavesAdded = await syncSkillLeaves(nodes, industry)
  } catch (e) {
    log.warn('星图增量写 SkillLeaf 失败:', e?.message || e)
  }
  res.json({ ok: true, added: merged.added, total: merged.total, leavesAdded })
}))
// 微反馈归因闭环 + 学习埋点（挂 /api/micro，避免与星图反馈 /api/feedback 冲突）
app.use('/api/micro', feedbackRouter)
// 统一计量口径：走平台 Key 才计量；自带 Key 完全免费，不计
// opts 可带 { tokens }（本次调用 tokens，记入收入台账与长期 token 计量）
// 登录用户调用完成后异步结算（后付费：次数费 + 超额 token 费，余额不足记欠费）
const aiUsage = (req, action, opts = {}) => {
  const byoKey = hasUserKey(req)
  const r = countUsage(actorOf(req), action, { byoKey, meter: true, ...opts })
  const uid = optUserId(req)
  if (uid && !byoKey) {
    settleAiFee(String(uid), Number(opts.tokens) || 0).catch((e) =>
      log.warn('AI 计量结算失败:', e?.message || e)
    )
  }
  return r
}

// AI 额度闸门：先校验账号可用性；自带 Key 直接放行；登录用户为后付费计量
// （有未清欠费且余额不足时 402），匿名请求按每日次数上限 429。
const aiGate = (action) => async (req, res, next) => {
  // 可选鉴权路由不会拦禁用账号，这里补一次状态校验，避免封号后仍能消耗 AI 额度
  const uid = optUserId(req)
  if (uid) {
    let user
    try {
      user = await db.user.findUnique({ where: { id: String(uid) }, select: { disabled: true } })
    } catch (e) {
      log.warn('AI 闸门校验用户状态失败:', e?.message || e)
      return res.status(500).json({ error: '服务端校验失败，请稍后重试' })
    }
    if (!user) return res.status(401).json({ error: '用户不存在' })
    if (user.disabled) return res.status(403).json({ error: '账号已被禁用', code: 'ACCOUNT_DISABLED' })
  }
  if (hasUserKey(req)) return next()
  // 免费额度未用尽直接放行；否则尝试余额扣费（不递增免费计数，计数仍由路由末尾 aiUsage 负责）
  const result = await authorizeAiCall(req, action, { honorUserKey: false })
  if (result.mode === 'denied') return respondAiDenied(res, result)
  next()
}

// AI 接口分钟级突发限流：仅 POST（含流式），20 次/分钟/IP
const aiBurstLimiter = createRateLimit({
  windowMs: 60_000,
  max: 20,
  message: 'AI 请求过于频繁，请稍后再试'
})
app.use('/api/ai', (req, res, next) =>
  req.method === 'POST' ? aiBurstLimiter(req, res, next) : next()
)

// v1.5 Agent 注册表（预留）：列表 + 运行（未注册返回 501）
app.get('/api/ai/agents', (req, res) => res.json({ items: listAgents() }))
app.post('/api/ai/agents/:name/run', aiGate('recommend'), async (req, res) => {
  try {
    const result = await runAgent(String(req.params.name), req.body ?? {})
    res.json({ result })
  } catch (e) {
    res.status(e?.status === 501 ? 501 : 502).json({ error: e?.message || 'agent 运行失败' })
  }
})

// 健康检查（探活/部署验证）
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'wenxing-server' }))

// 查询 AI 用量、余额与当前计费口径（未登录也可查，used/balance 均为 0）
app.get('/api/ai/usage', wrap(async (req, res) => {
  const byoKey = hasUserKey(req)
  const uid = optUserId(req)
  let balanceFen = 0
  if (uid) {
    const user = await db.user.findUnique({ where: { id: String(uid) }, select: { balanceFen: true } })
    balanceFen = user?.balanceFen ?? 0
  }
  res.json({
    usage: getUsage(uid),
    limits: uid ? DAILY_LIMITS : ANON_DAILY_LIMITS,
    billing: BILLING,
    // 长期计量：token 累计 / 免费配额 / 调用总次数 / 未清欠费
    metering: uid ? { ...getTokenStats(String(uid)), debtFen: getDebtFen(String(uid)) } : null,
    balanceFen,
    balanceYuan: Math.round(balanceFen) / 100,
    // 当前模式：自带 Key = 完全免费；平台 Key = token + 调用次数计量
    mode: byoKey ? 'byo' : 'platform',
    hasKey: byoKey
  })
}))

// ===== AI 业务接口 =====

// 方向拆解（v1.3）：自由输入/语音 → AI 一次拆出「行业 + 知识大类 + 所需能力 + 需学软件 + 技能类型」
// 入参 { goal, registry:[{name,categories[]}] }；出参 { summary, industry, categories[], capabilities[], software[], skillType, reason }
app.post('/api/ai/understand-goal', aiGate('recommend'), wrap(async (req, res) => {
  const { goal, registry } = req.body ?? {}
  const goalText = String(goal ?? '').trim()
  if (!goalText) throw new Error('请先描述你想学的方向')
  const reg = Array.isArray(registry) ? registry : []
  const prompt = buildGoalDecomposePrompt({ goal: goalText, registry: reg })
  const raw = await deepseek([
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ], true, req.headers['x-user-api-key'])
  const parsed = JSON.parse(raw)
  // 行业名必须命中注册表，否则回退首个行业；大类名必须属于该行业，否则回退其前若干大类
  const names = reg.map((r) => r?.name).filter((n) => typeof n === 'string')
  const industry = names.includes(parsed.industry) ? parsed.industry : (names[0] ?? '信息技术与软件')
  const catPool = (reg.find((r) => r?.name === industry)?.categories ?? []).filter((c) => typeof c === 'string')
  let categories = Array.isArray(parsed.categories)
    ? parsed.categories.map(String).filter((c) => catPool.includes(c))
    : []
  if (categories.length === 0) categories = catPool.slice(0, 3)
  // 细分方向：只允许落在所选大类下的二级领域，禁止编造；未命中则做去空格/标点的模糊匹配
  const ind = reg.find((r) => r?.name === industry)
  const domainPool = new Set()
  for (const c of categories) {
    const list = ind?.domains && typeof ind.domains === 'object' ? ind.domains[c] : null
    if (Array.isArray(list)) list.forEach((d) => typeof d === 'string' && domainPool.add(d))
  }
  const norm = (s) => String(s || '').replace(/[\s·、，,（）()/]/g, '').toLowerCase()
  const rawDirections = Array.isArray(parsed.directions) ? parsed.directions.map(String).filter(Boolean) : []
  const pool = [...domainPool]
  const directions = [...new Set(
    rawDirections
      .map((d) =>
        pool.find((p) => p === d) ??
        pool.find((p) => norm(p) === norm(d)) ??
        pool.find((p) => norm(p).includes(norm(d)) || norm(d).includes(norm(p)))
      )
      .filter(Boolean)
  )].slice(0, 4)
  res.json({
    summary: String(parsed.summary || '').slice(0, 120),
    industry,
    categories,
    directions,
    capabilities: Array.isArray(parsed.capabilities)
      ? parsed.capabilities.map(String).filter(Boolean).slice(0, 8)
      : [],
    software: Array.isArray(parsed.software)
      ? parsed.software.map(String).filter(Boolean).slice(0, 8)
      : [],
    skillType: ['immersive', 'theory', 'mimicry', 'logic', 'mixed'].includes(parsed.skillType)
      ? parsed.skillType
      : 'mixed',
    reason: String(parsed.reason || '').slice(0, 80),
    usage: aiUsage(req, 'recommend')
  })
}))

// 技能推荐：根据学习合同问卷 + 所选大类知识点清单，返回技能组 + 锚定知识点的大纲
app.post('/api/ai/recommend-skills', aiGate('recommend'), wrap(async (req, res) => {
  const { domain, categories, directions, categoryTrees, sopPath, goal30, baseline, timeCommitment, obstacle, skillType, groupType } = req.body ?? {}
  const catList = Array.isArray(categories) ? categories : []
  const dirList = Array.isArray(directions) ? directions.map(String).filter(Boolean) : []
  const trees = Array.isArray(categoryTrees) ? categoryTrees : []
  const raw = await deepseek([
    {
      role: 'system',
      content: `你是「问星」学习引擎的技能推荐器，遵循职业技能学习 SOP。根据用户的学习合同与所选知识大类的知识点清单，先确定一个 30 天内可交付的真实项目，再围绕该项目倒排推荐 3-5 个循序渐进的技能组。

硬性要求：
- 项目优先：project 必须是一个具体、可运行、30 天内可验收的真实项目，由用户的 30 天目标与细分方向决定；禁止写成「最小闭环」「练手 demo」「基础入门」这类泛化说法
- 倒排技能组：每个技能组对应项目的一个里程碑，reason 必须写明它推进项目哪一步、产出哪个项目部件，不能只写能力名
- 严格适配基线：基线为「完全没接触过」时，第 1 组只能是环境搭建 + 最小可运行验证，单任务 ≤30 分钟；30 天内用不到的高阶技术（如 Kubernetes、Terraform）不得出现
- 严格适配时间：每天 1-2 小时 → 单任务 20-45 分钟，同一组内不得叠加两个全新概念；障碍为时间碎片化 → 每个任务可独立完成、可中断，并产出可见小成果
- 任务必须锚定知识点清单：清单格式为「# 大类 → ## 领域 → ### 技术栈：知识点1、知识点2、…」，kp 字段必须逐字取自「### 行冒号之后、顿号分隔」的知识点原名（最细粒度），禁止取 # / ## / ### 各级标题名，禁止编造清单外内容
- 按学习目的定节奏：从零入门→先 20% 前置知识再大量复现；转行迁移→旧证据映射只补差异；短期考证→大纲覆盖+错题闭环；岗位晋升→责任升级与带教；跨岗扩展→只学相邻 10% 新动作；项目式实战→真实约束的最小可用版本
- 任务描述采用「动词＋对象＋约束＋标准」风格，20 字内；每组最后一个任务必须产出可运行或可截图的项目部件

${skillType ? `${sopContext(skillType, groupType)}

按上述 SOP 组织技能组：每组对应 SOP 标准流程中的一段，任务粒度要能落到「每日可执行」；把校验门槛与常见失败原因体现在任务标准里。
` : ''}每个技能组包含：
- name：技能名称（简洁）
- description：一句话描述（15 字内）
- reason：为什么推荐给该用户（结合学习合同与项目里程碑，20 字内）
- items：3-6 个具体学习任务，每个含 title + description + kp（知识点原名）

只返回 JSON：{"project":{"name":"项目名（12 字内）","deliverable":"一句话交付物","acceptance":"可检验验收标准（40 字内）"},"skills":[{"name":"HTML","description":"超文本标记语言","reason":"项目第 1 步：搭出可访问首页","items":[{"title":"搭建语义化页面骨架","description":"用 html/head/body 写出可访问的页面结构","kp":"HTML 文档结构"}]}]}`
    },
    {
      role: 'user',
      content: `行业：${domain || '信息技术与软件'}
所选知识大类：${catList.join('、') || '未指定'}
细分方向：${dirList.join('、') || '未指定'}（任务优先覆盖这些细分方向）

【知识点清单（任务必须从中锚定 kp）】
${trees.join('\n\n') || '（清单缺失：请依据所选大类通用核心知识点给出 kp，仍需真实具体）'}

【学习合同】
学习目的（SOP 路径）：${sopPath || '从零入门'}
30 天目标：${goal30 || '未指定'}
当前基线：${baseline || '未指定'}
时间投入：${timeCommitment || '未指定'}
最大障碍：${obstacle || '未指定'}`
    }
  ], true, req.headers['x-user-api-key'])
  const parsed = JSON.parse(raw)
  const skills = parsed.skills ?? parsed
  if (!Array.isArray(skills)) throw new Error('技能推荐格式解析失败')
  const p = parsed.project && typeof parsed.project === 'object' ? parsed.project : {}
  const project = {
    name: String(p.name || '').trim().slice(0, 24),
    deliverable: String(p.deliverable || '').trim().slice(0, 80),
    acceptance: String(p.acceptance || '').trim().slice(0, 120)
  }
  res.json({
    project: project.name ? project : null,
    skills: skills
      .filter((s) => s && typeof s.name === 'string')
      .map((s) => ({
        name: s.name,
        description: s.description || '',
        reason: s.reason || '',
        items: Array.isArray(s.items)
          ? s.items
              .filter((i) => i && typeof i.title === 'string')
              .map((i) => ({
                title: i.title,
                description: i.description || '',
                kp: typeof i.kp === 'string' ? i.kp : ''
              }))
          : []
      })),
    usage: aiUsage(req, 'recommend')
  })
}))

// 文档生成：返回 { content }（Markdown）
app.post('/api/ai/doc', aiGate('doc'), wrap(async (req, res) => {
  const { title, context } = req.body ?? {}
  const content = await deepseek([
    {
      role: 'system',
      content:
        '你是「问星」学习引擎的文档作者。针对给定能力点写一份中文学习文档（Markdown），必须包含以下小节：## 概念定义、## 核心要点（3-5 条）、## 代码示例、## 常见误区、## 小结。内容要具体、技术准确，全文 500-800 字。只输出文档本身，不要输出任何解释。'
    },
    { role: 'user', content: `能力点：${title}\n用户背景与方向：${context || '无'}` }
  ], false, req.headers['x-user-api-key'])
  const usage = aiUsage(req, 'doc')
  res.json({ content, usage })
}))

// 文档完善（用户反馈后修订）：返回 { content }
app.post('/api/ai/revise', aiGate('revise'), wrap(async (req, res) => {
  const { title, content, feedback } = req.body ?? {}
  const revised = await deepseek([
    {
      role: 'system',
      content:
        '你是「问星」AI 文档审校员。根据用户反馈修正学习文档中的技术错误与不足，保持原有 Markdown 结构与小节，输出修订后的完整文档全文，不要输出任何解释。'
    },
    {
      role: 'user',
      content: `文档标题：${title}\n\n原文档：\n${content}\n\n用户反馈：${feedback}\n\n请输出修订后的完整文档。`
    }
  ], false, req.headers['x-user-api-key'])
  const usage = aiUsage(req, 'revise')
  res.json({ content: revised, usage })
}))

// 学习大纲 AI 精细拆解：一次调用返回四字段任务 + 需补充星图的新节点
app.post('/api/ai/outline-refine', aiGate('recommend'), wrap(async (req, res) => {
  const result = await refineOutline(req.body ?? {}, {
    userApiKey: req.headers['x-user-api-key']
  })
  const usage = aiUsage(req, 'recommend', { tokens: result.tokens })
  res.json({ groups: result.groups, newNodes: result.newNodes, usage })
}))

// 教科书级目录树：按学习模块生成卷/章/节（仅返回 JSON）
app.post('/api/ai/textbook-outline', aiGate('recommend'), wrap(async (req, res) => {
  const result = await buildTextbookOutline(req.body ?? {}, {
    userApiKey: req.headers['x-user-api-key']
  })
  const usage = aiUsage(req, 'recommend', { tokens: result.tokens })
  res.json({ modules: result.modules, summary: result.summary, usage })
}))

// 学习计划分块：把已确认的技能组重组为「模块式」学习计划（深度掌握导向），返回 { blocks }
app.post('/api/ai/plan-blocks', aiGate('recommend'), wrap(async (req, res) => {
  const { domain, groups, project, questionnaire, baseline, skillType, groupType } = req.body ?? {}
  const gList = Array.isArray(groups) ? groups : []
  const qa = questionnaire ?? {}
  const projectText = project && String(project.name || '').trim()
    ? `${String(project.name).trim()}｜交付物：${String(project.deliverable || '').trim() || '未指定'}｜验收：${String(project.acceptance || '').trim() || '未指定'}`
    : '未指定（请从 30 天目标反推一个可运行的真实交付物）'
  const baselineText = typeof baseline === 'string' && baseline.trim() ? baseline.trim() : ''
  const groupText = gList
    .map((g, i) => `技能组 ${i + 1}：${g?.name ?? ''}（${g?.description || '无描述'}）\n知识点：${(Array.isArray(g?.items) ? g.items : []).join('、')}`)
    .join('\n\n')
  const raw = await deepseek([
    {
      role: 'system',
      content: `你是「问星」学习引擎的学习规划师。把用户已确认的技能组重组为「分块式」学习计划，目标是深度掌握而不是浅尝辄止。

${skillType ? `${sopContext(skillType, groupType)}

硬性要求（SOP）：
- 模块划分须贴合所选类型的标准流程顺序，每个模块在 goal 中写明该阶段要练成的可观察能力，并把校验门槛写入 acceptance
- 把该类型常见失败原因作为风险提示写入对应模块的 goal/acceptance 表述中
` : ''}
硬性要求：
- 分为 3-6 个模块，每个模块包含 2-5 个知识点；items 中的知识点必须逐字取自输入清单，禁止编造，可按主题重新归组
- name：模块名（10 字内，体现主题而非堆砌知识点名）
- goal：深度掌握目标，说明学完本模块能达到的可观察能力（30 字内）
- durationDays：学习期限（天），按知识点数量与难度估算，每个知识点 1-3 天
- acceptance：验收标准，必须可检验（能默写 / 能复述 / 能独立完成一个小练习），40 字内
- 模块按学习先后顺序排列，循序渐进
- 模块必须围绕【30 天交付项目】倒排：模块即项目里程碑，acceptance 对齐项目总体验收，禁止另起项目
- 若提供了「学前测评结果」，掌握率低的技能点所在模块要排在前面并适当增加期限（薄弱模块优先）

只返回 JSON：{"blocks":[{"name":"页面结构基石","goal":"能独立搭建语义化、可访问的页面骨架","durationDays":4,"acceptance":"读完本模块全部文档，并能脱稿讲清每个知识点的核心概念","items":["HTML 文档结构","语义化标签"]}]}`
    },
    {
      role: 'user',
      content: `行业：${domain || '信息技术与软件'}

【技能组与知识点清单】
${groupText || '（无）'}

【30 天交付项目】
${projectText}

【学习合同】
学习目的：${qa.sopPath || '从零入门'}
30 天目标：${qa.goal30 || '未指定'}
当前基线：${qa.baseline || '未指定'}
时间投入：${qa.timeCommitment || '未指定'}
最大障碍：${qa.obstacle || '未指定'}${baselineText ? `\n\n【学前测评结果】\n${baselineText}` : ''}`
    }
  ], true, req.headers['x-user-api-key'])
  const parsed = JSON.parse(raw)
  const blocks = parsed.blocks ?? parsed
  if (!Array.isArray(blocks)) throw new Error('学习计划格式解析失败')
  res.json({
    blocks: blocks
      .filter((b) => b && typeof b.name === 'string')
      .map((b) => ({
        name: b.name,
        goal: String(b.goal || ''),
        durationDays: Number.isFinite(Number(b.durationDays))
          ? Math.max(1, Math.round(Number(b.durationDays)))
          : 3,
        acceptance: String(b.acceptance || ''),
        items: Array.isArray(b.items) ? b.items.filter((i) => typeof i === 'string') : []
      })),
    usage: aiUsage(req, 'recommend')
  })
}))

// 学习计划 Agent（SSE）：按「学习计划skill」五阶段逐段执行并推送过程事件
// 入参同 /api/ai/plan-blocks；事件 type：phase / log / artifact / blocks / validation / planDoc / done / error
app.post('/api/ai/plan-agent-stream', aiGate('recommend'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const emit = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  try {
    const result = await runStudyPlanAgent(req.body ?? {}, {
      userApiKey: req.headers['x-user-api-key'],
      emit
    })
    // 一次 Agent 运行只记一次 recommend 动作，tokens 为各阶段累计
    const usage = aiUsage(req, 'recommend', { tokens: result.tokens })
    emit({ type: 'done', usage })
  } catch (e) {
    log.error('plan-agent 运行失败:', e?.message || e)
    emit({ type: 'error', error: e?.message || '学习计划 Agent 运行失败' })
  } finally {
    res.end()
  }
})

// 对话聊天（v0.10 定制化 Agent）：返回 { content }
// 入参 { messages, context? }，context 为用户学习上下文（当前知识点/掌握度/目标），注入 system prompt 实现定制化
app.post('/api/ai/chat', aiGate('chat'), wrap(async (req, res) => {
  const { messages, context } = req.body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('消息为空')

  const ctx = typeof context === 'string' && context.trim() ? context.trim() : null
  const systemPrompt = `你是「问星」AI 学习伙伴，不是通用助手，是陪用户一起学的同事。

人设：
- 像一个懂学习方法的同事，语气直接、口语化，不说官话
- 回答简短，适合语音朗读（单句不超过 40 字，整体不超过 150 字）
- 不空洞鼓励（不说"加油""你可以的"），给具体可执行的下一步
- 用户卡住时，先问 1 个澄清问题（目标/卡点/已尝试），再给建议

行为规则：
1. 用户问知识点 → 用"是什么+为什么+一个例子"三段式回答，控制在 3 句话
2. 用户说不会/不懂 → 先确认卡点，再给最小可理解的解释，不堆术语
3. 用户问怎么学 → 给 1 个具体动作（如"先做 3 道 XX 题"），不要列清单
4. 不确定时直说"这个我需要查一下"，不编造

${ctx ? `用户当前学习上下文：\n${ctx}\n（回答时结合这个上下文，不要脱离用户正在学的内容）` : ''}

回复风格：口语化，有温度，但不卖弄。${OPTIONS_HINT}`

  const raw = await deepseek([
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? '')
    }))
  ], false, req.headers['x-user-api-key'])
  const { content, options } = splitOptions(raw)
  // 取本次调用 tokens 并计入用量/收入台账
  const { total_tokens: tokens } = takeLastUsage()
  const usage = aiUsage(req, 'chat', { tokens })
  res.json({ content, options, usage })
}))

// v0.10 流式对话（SSE）：用于语音通话的低延迟回复
// 返回 text/event-stream，每段文本以 "data: <text>\n\n" 推送，结束推 "data: [DONE]\n\n"
app.post('/api/ai/chat-stream', aiGate('chat'), async (req, res) => {
  const { messages, context } = req.body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: '消息为空' })
    return
  }
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const ctx = typeof context === 'string' && context.trim() ? context.trim() : null
  const systemPrompt = `你是「问星」AI 学习伙伴，不是通用助手，是陪用户一起学的同事。
像懂学习方法的同事，语气直接口语化。回答简短适合朗读（单句不超40字，整体不超150字）。不空洞鼓励，给具体下一步。
${ctx ? `用户学习上下文：${ctx}` : ''}
回复口语化，有温度。`

  try {
    for await (const chunk of deepseekStream([
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content ?? '')
      }))
    ], req.headers['x-user-api-key'])) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
    // 取本次流式调用 tokens 并计入用量/收入台账
    const { total_tokens: tokens } = takeLastUsage()
    aiUsage(req, 'chat', { tokens })
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e?.message || 'AI 调用失败' })}\n\n`)
    res.write('data: [DONE]\n\n')
  } finally {
    res.end()
  }
})

// 批量出题（凑齐 20 题进入答题模式）：一次性生成 count 道题，混合 easy/medium/hard
// 入参 { skillTitle, context, count }，返回 { questions: Question[] }
app.post('/api/ai/questions-batch', aiGate('questions'), wrap(async (req, res) => {
  const { skillTitle, context, count = 20 } = req.body ?? {}
  const n = Math.max(4, Math.min(40, Number(count) || 20))
  const raw = await deepseek([
    {
      role: 'system',
      content:
        `你是「问星」题库出题器。围绕给定能力点出 ${n} 道循序渐进的题目，题目严格围绕给定的知识点路径（行业/大类/领域/技术栈/知识点），题干带真实应用场景（身份、信号、约束、验收标准）。要求覆盖 easy/medium/hard 三档（约 4:4:2 比例），题型混合 single（单选，必带 options 4 项）/multiple（多选，必带 options 4 项）/short（简答）/coding（编程）。每题包含：
- title：简洁题目标题（10 字内）
- body：完整题干（含选项提示如「请选出最合适的」/「请用 100 字内回答」/「给出可运行代码片段」）
- answer：标准答案（单选/多选给出选项字母，如 "A" 或 "AC"；简答给出参考答案要点；coding 给出关键代码或思路）
- difficulty：easy | medium | hard
- knowledgePoints：知识点字符串数组
- type：single | multiple | short | coding
- options：仅 single/multiple 必填，4 个字符串
只返回 JSON：{"questions":[{...}]}，不要输出任何解释。`
    },
    {
      role: 'user',
      content: `能力点：${skillTitle}\n用户学习方向：${context || '通用基础'}\n请出 ${n} 道题。`
    }
  ], true, req.headers['x-user-api-key'])
  const parsed = JSON.parse(raw)
  const list = Array.isArray(parsed) ? parsed : (parsed.questions ?? [])
  if (!Array.isArray(list) || list.length === 0) throw new Error('AI 出题格式解析失败')
  const questions = list
    .filter((q) => q && typeof q.title === 'string')
    .map((q, i) => ({
      id: `ai-q-${Date.now()}-${i}`,
      title: String(q.title).slice(0, 60),
      body: String(q.body || q.title),
      answer: String(q.answer || ''),
      difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
      knowledgePoints: Array.isArray(q.knowledgePoints) ? q.knowledgePoints.map(String) : [],
      type: ['single', 'multiple', 'short', 'coding'].includes(q.type) ? q.type : 'short',
      source: 'ai',
      options: Array.isArray(q.options) ? q.options.map(String) : undefined
    }))
  const usage = aiUsage(req, 'questions')
  res.json({ questions, usage })
}))

// 费曼讲解检测（v0.9）：评估用户讲解文本，返回 4 维度评分 + 盲区清单 + 总结
// 入参 { kp, transcript, context }，返回 { scores, total, passed, gaps, strengths, summary }
app.post('/api/ai/explain-check', aiGate('explainCheck'), wrap(async (req, res) => {
  const { kp, transcript, context } = req.body ?? {}
  if (!kp || typeof kp !== 'string') throw new Error('缺少 kp')
  if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
    throw new Error('讲解内容为空')
  }
  const text = transcript.trim().slice(0, 4000) // 防超长
  const raw = await deepseek([
    {
      role: 'system',
      content: `你是「问星」的费曼讲解评估器。用户刚用自己的话讲解了一个知识点，你要像一位严格但友善的同事，从四个维度评估这次讲解，找出理解盲区。

评分维度（每项 0-25 分，整数）：
1. accuracy 概念准确：核心定义讲对了吗？有没有混淆、错误、张冠李戴？
2. structure 结构条理：讲解有清晰的展开顺序吗？听者能跟上吗？
3. analogy 类比落地：用了生活例子、类比或具体场景帮助理解吗？（没有用例子≠0 分，讲得清楚也可得中高分）
4. gapAwareness 盲区自知：用户主动说清了哪里不懂、哪里不确定吗？（完全没提不确定性≠0 分，讲解本身准确即可）

通过线：总分 ≥ 70 分为 passed=true。

盲区识别要求：
- gaps 数组列出用户讲解中暴露的具体盲区，每个盲区包含：
  - concept：盲区涉及的具体概念（尽量用星图知识点原名，5-15 字）
  - issue：用户哪里讲错了或没讲到（20 字内）
  - suggestion：针对性补强建议（20 字内）
- 如果讲解很好没有明显盲区，gaps 返回空数组

strengths 数组：列出讲解中做得好的 1-3 点（每点 15 字内）

summary：一段 60-100 字的总结点评，语气直接、具体，不空洞鼓励，像同事 review 一样指出关键问题和下一步。

只返回 JSON：
{"scores":{"accuracy":N,"structure":N,"analogy":N,"gapAwareness":N},"total":N,"passed":true|false,"gaps":[{"concept":"...","issue":"...","suggestion":"..."}],"strengths":["..."],"summary":"..."}`
    },
    {
      role: 'user',
      content: `知识点：${kp}
所属路径：${context || '通用'}

用户讲解原文：
${text}

请按四维 rubric 评估。`
    }
  ], true, req.headers['x-user-api-key'])
  const parsed = JSON.parse(raw)
  const s = parsed.scores ?? {}
  const clamp = (v) => Math.max(0, Math.min(25, Math.round(Number(v) || 0)))
  const scores = {
    accuracy: clamp(s.accuracy),
    structure: clamp(s.structure),
    analogy: clamp(s.analogy),
    gapAwareness: clamp(s.gapAwareness)
  }
  const total = scores.accuracy + scores.structure + scores.analogy + scores.gapAwareness
  const passed = total >= 70
  const gaps = Array.isArray(parsed.gaps)
    ? parsed.gaps
        .filter((g) => g && typeof g.concept === 'string')
        .map((g) => ({
          concept: String(g.concept).slice(0, 30),
          issue: String(g.issue || '').slice(0, 80),
          suggestion: String(g.suggestion || '').slice(0, 80)
        }))
    : []
  const strengths = Array.isArray(parsed.strengths)
    ? parsed.strengths.filter((x) => typeof x === 'string').slice(0, 3)
    : []
  const summary = String(parsed.summary || '').slice(0, 300)
  // v0.8 额度计数：每次讲解检测消耗 1 次
  const usage = aiUsage(req, 'explainCheck')
  res.json({ scores, total, passed, gaps, strengths, summary, usage })
}))

// ===== 文档中心：YML 目录树 + md 正文（首次打开由 AI 生成并写盘） =====

// 目录树：GET /api/docs/tree?industry=cs → { ready, tree }
app.get('/api/docs/tree', (req, res) => {
  const industry = String(req.query.industry ?? '').trim()
  if (!industry || industry.includes('..') || !/^[\w-]+$/.test(industry)) {
    res.status(400).json({ error: '参数 industry 不合法' })
    return
  }
  const ymlPath = path.join(DATA_DIR, `${industry}.yml`)
  if (!fs.existsSync(ymlPath)) {
    res.json({ ready: false })
    return
  }
  const tree = parseYaml(fs.readFileSync(ymlPath, 'utf-8'))
  res.json({ ready: true, tree })
})

// 正文：GET /api/docs/content?industry=cs&file=cs/programming/java.md
// 文件存在直接读；不存在 → AI 生成 → 写盘（仅成功才落盘）
app.get('/api/docs/content', wrap(async (req, res) => {
  const industry = String(req.query.industry ?? '').trim()
  const file = String(req.query.file ?? '').trim()
  if (!industry || !file || file.includes('..')) {
    res.status(400).json({ error: '参数不合法' })
    return
  }
  const full = path.resolve(DATA_DIR, file)
  // 安全：解析后必须在 DOCS_DIR 内，且文件必须位于该行业目录下
  if (!full.startsWith(DATA_DIR + path.sep) || !file.startsWith(`${industry}/`)) {
    res.status(400).json({ error: '文件路径不合法' })
    return
  }
  if (fs.existsSync(full)) {
    res.json({ content: fs.readFileSync(full, 'utf-8'), generated: false })
    return
  }

  // 本地文件未命中 → 即将调用平台 AI，必须先过统一闸门（额度校验 + 计数）
  if (!(await takeAiQuota(req, res, 'doc'))) return

  // 从 yml 查行业/大类/文档标题（喂给 AI 保证切题）
  const ymlPath = path.join(DATA_DIR, `${industry}.yml`)
  let docTitle = file
  let categoryTitle = ''
  let industryTitle = industry
  if (fs.existsSync(ymlPath)) {
    const tree = parseYaml(fs.readFileSync(ymlPath, 'utf-8'))
    industryTitle = tree.title || industry
    for (const cat of tree.categories ?? []) {
      for (const dom of cat.domains ?? []) {
        for (const d of dom.docs ?? []) {
          if (d.file === file) {
            docTitle = d.title
            categoryTitle = cat.title
          }
        }
      }
    }
  }

  const content = await deepseek([
    {
      role: 'system',
      content:
        '你是「问星」文档中心的中文技术文档作者，面向零基础到入门阶段的大学生。请输出一份结构完整、技术准确的 Markdown 文档。\n\n结构要求：\n1. 第一行：# 文档标题\n2. 学习导引：用 > 引用块写 2-3 句，说明本文能学到什么、适合谁\n3. 4-6 个 ## 二级章节，循序渐进覆盖：核心概念（尽量配 Markdown 表格或列表做对比）、原理与运行机制、可运行的代码示例（代码块标注语言，如 ```java）、实践要点或常见误区\n4. ## 小结：3-5 条要点\n5. ## 延伸资源：3-5 条学习建议（官方文档、经典书籍、练习方向）\n\n写作要求：技术名词准确、示例可运行、讲解有层次；中文为主，代码与术语保留原文；全文 800-1500 字；只输出 Markdown 本体，不要任何额外解释。'
    },
    {
      role: 'user',
      content: `行业：${industryTitle}\n专业知识大类：${categoryTitle || '通用'}\n文档主题：${docTitle}`
    }
  ], false, req.headers['x-user-api-key'])

  safeWriteFile(full, content)
  res.json({ content, generated: true })
}))

// ===== 文档存档：data/docs/<行业>/<标题>.md（frontmatter 打标签） =====

// 保存文档（AI 生成 / 反馈完善后均调用）
app.post('/api/docs/save', auth, wrap(async (req, res) => {
  const { industry = '通用', title, tags = [], content = '' } = req.body ?? {}
  if (!title) throw new Error('缺少文档标题')
  const dir = path.join(DATA_DIR, safeName(industry))
  const file = `${safeName(title)}.md`
  const full = path.join(dir, file)
  // 覆盖保存（反馈完善）时保留首次生成时间
  let generatedAt = new Date().toISOString()
  let createdBy = req.user.id
  if (fs.existsSync(full)) {
    const old = parseFrontmatter(fs.readFileSync(full, 'utf-8'))
    if (old.meta.generatedAt) generatedAt = old.meta.generatedAt
    // 归属校验：他人创建的文档禁止覆盖（历史文档无 createdBy 时由当前用户认领）
    if (old.meta.createdBy && old.meta.createdBy !== req.user.id) {
      res.status(403).json({ error: '该文档由其他用户创建，无法覆盖' })
      return
    }
    if (old.meta.createdBy) createdBy = old.meta.createdBy
  }
  const text = buildFrontmatter({ title, industry, tags, generatedAt, createdBy, updatedAt: new Date().toISOString() }) + content
  safeWriteFile(full, text)
  // 保存成功后异步向量化入库（fire-and-forget，绝不阻塞响应；未配置远端 Embedding 时自动用本地哈希嵌入）
  // file 统一为相对 DATA_DIR 的行业前缀路径，与检索接口返回的 file 保持一致
  const relFile = `${safeName(industry)}/${file}`
  indexOneDoc({ industry: safeName(industry), file: relFile, full })
    .catch((e) => log.warn('文档向量索引失败:', e?.message || e))
  res.json({ ok: true, industry, file, path: path.relative(path.resolve(__dirname, '..'), full) })
}))

// ===== 学习计划存档：data/plans/<行业>/<标题>.md（frontmatter 打标签，不做向量索引） =====
app.post('/api/plans/save', auth, wrap(async (req, res) => {
  const { industry = '通用', title, content = '' } = req.body ?? {}
  if (!title) throw new Error('缺少计划标题')
  const dir = path.join(DATA_ROOT, 'plans', safeName(industry))
  fs.mkdirSync(dir, { recursive: true })
  const file = `${safeName(title)}.md`
  const full = path.join(dir, file)
  // 覆盖保存（重新生成计划）时保留首次生成时间
  let generatedAt = new Date().toISOString()
  if (fs.existsSync(full)) {
    const old = parseFrontmatter(fs.readFileSync(full, 'utf-8'))
    if (old.meta.generatedAt) generatedAt = old.meta.generatedAt
  }
  const text = buildFrontmatter({
    title,
    industry,
    tags: [industry, '学习计划'],
    generatedAt,
    updatedAt: new Date().toISOString()
  }) + content
  safeWriteFile(full, text)
  res.json({ ok: true, industry, file, path: path.relative(path.resolve(__dirname, '..'), full) })
}))

// 列出全部文档（扫描各行业文件夹）
app.get('/api/docs/list', wrap(async (req, res) => {
  const out = []
  if (fs.existsSync(DATA_DIR)) {
    for (const industry of fs.readdirSync(DATA_DIR)) {
      const dir = path.join(DATA_DIR, industry)
      if (!fs.statSync(dir).isDirectory()) continue
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.md')) continue
        const { meta } = parseFrontmatter(fs.readFileSync(path.join(dir, file), 'utf-8'))
        out.push({
          industry,
          file,
          title: meta.title ?? file.replace(/\.md$/, ''),
          tags: meta.tags ?? [],
          generatedAt: meta.generatedAt,
          updatedAt: meta.updatedAt
        })
      }
    }
  }
  res.json({ docs: out })
}))

// 读取单篇文档
app.get('/api/docs/get', wrap(async (req, res) => {
  const { industry, file } = req.query
  if (!industry || !file || String(file).includes('..')) throw new Error('参数不合法')
  const full = path.join(DATA_DIR, safeName(String(industry)), safeName(String(file)))
  const { meta, body } = parseFrontmatter(fs.readFileSync(full, 'utf-8'))
  res.json({ meta, content: body })
}))

// ===== 星图节点文档生成：POST /api/skill-doc/generate =====
// 入参 { title, path: string[] }；已存在同名文档直接返回，不重复消耗 AI
// 落盘 data/docs/技能文档/<标题>.md，并异步向量化
app.post('/api/skill-doc/generate', auth, wrap(async (req, res) => {
  const { title, path: segs = [] } = req.body ?? {}
  const cleanTitle = String(title ?? '').trim()
  if (!cleanTitle) throw new Error('缺少文档标题')
  const industry = '技能文档'
  const dir = path.join(DATA_DIR, industry)
  fs.mkdirSync(dir, { recursive: true })
  const file = `${safeName(cleanTitle)}.md`
  const full = path.join(dir, file)
  const relFile = `${industry}/${file}`

  if (fs.existsSync(full)) {
    const { meta, body } = parseFrontmatter(fs.readFileSync(full, 'utf-8'))
    res.json({
      industry,
      file: relFile,
      title: meta.title ?? cleanTitle,
      content: body
    })
    return
  }

  // 本地无同名文档 → 即将调用平台 AI，必须先过统一闸门（额度校验 + 计数）
  if (!(await takeAiQuota(req, res, 'doc'))) return

  const pathList = (Array.isArray(segs) ? segs : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
  const pathText = pathList.length ? pathList.join(' → ') : cleanTitle

  const content = await deepseek([
    {
      role: 'system',
      content: `你是「问星」学习引擎的文档作者。针对技能星图中的一个最小学习主题写一份中文学习文档（Markdown）。

硬性要求：
- 第一行必须是「# 文档标题」（标题取用户给出的主题名）
- 第二行用 > 引用块写一句话学习导引
- 正文 4-6 个 ## 章节，必须覆盖：核心概念、原理机制、可运行示例、实践要点与常见误区
- 章节内可用列表、代码块、表格；示例要能直接运行或落地
- 最后两节固定为「## 小结」「## 延伸资源」
- 全文 800-1500 字，术语准确，不要空话套话
- 只输出文档本身，不要输出任何解释或前后缀`
    },
    {
      role: 'user',
      content: `主题：${cleanTitle}\n所属路径：${pathText}\n请围绕该主题写文档，并在示例中体现其所属领域的具体用法。`
    }
  ], false, req.headers['x-user-api-key'])

  safeWriteFile(full, buildFrontmatter({
    title: cleanTitle,
    industry,
    tags: pathList,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }) + content, 'utf-8')
  // 异步向量化，不阻塞响应
  indexOneDoc({ industry, file: relFile, full })
    .catch((e) => log.warn('技能文档向量索引失败:', e?.message || e))

  res.json({ industry, file: relFile, title: cleanTitle, content })
}))

// ===== 文档向量库：切块 → Embedding → SQLite DocVector，余弦相似度 TopK 检索 =====

// 单篇入库/重建：{ industry, file }
app.post('/api/vector/index', auth, wrap(async (req, res) => {
  const { industry = '', file = '' } = req.body ?? {}
  if (!file || String(file).includes('..')) throw new Error('参数不合法')
  const full = safeDocPath(file)
  if (!fs.existsSync(full)) throw new Error('文档不存在')
  const result = await indexOneDoc({ industry: String(industry), file: String(file), full })
  res.json({ ok: true, provider: embeddingProvider(), ...result })
}))

// 全量重建：递归扫描文档目录下所有 .md（会产生全量 Embedding 开销，仅管理员可触发）
app.post('/api/vector/reindex', adminAuth, wrap(async (req, res) => {
  let indexed = 0
  let failed = 0
  const walk = async (dir) => {
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (fs.statSync(full).isDirectory()) {
        await walk(full)
      } else if (name.endsWith('.md')) {
        const rel = path.relative(DATA_DIR, full).split(path.sep).join('/')
        const industry = rel.split('/')[0]
        try {
          await indexOneDoc({ industry, file: rel, full })
          indexed++
        } catch (e) {
          log.warn(`索引失败 ${rel}:`, e?.message || e)
          failed++
        }
      }
    }
  }
  await walk(DATA_DIR)
  res.json({ ok: true, indexed, failed })
}))

// 语义检索：查询文本向量化后与库内全量向量做余弦相似度，聚合到文档粒度取 TopK；
// 未配置 Embedding 时降级为标题/标签模糊匹配（degraded: true）
const vectorSearchLimiter = aiBurstOnly('vectorSearch', { burst: 30 })
app.get('/api/vector/search', vectorSearchLimiter, wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5))
  if (!q) throw new Error('缺少查询词 q')

  const rows = await db.docVector.findMany()

  // 降级：向量库为空（尚未索引任何文档）时，扫描文档标题/标签做分词模糊匹配
  if (!rows.length) {
    const tokens = q.toLowerCase().split(/[\s,，。;；、/\\·+\-*/()（）[\]【】"']+/).filter((t) => t.length >= 2)
    if (!tokens.length) tokens.push(q.toLowerCase())
    const docs = []
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        if (fs.statSync(full).isDirectory()) {
          walk(full)
        } else if (name.endsWith('.md')) {
          const { meta } = parseFrontmatter(fs.readFileSync(full, 'utf-8'))
          const title = meta.title ?? name.replace(/\.md$/, '')
          const tags = Array.isArray(meta.tags) ? meta.tags : []
          const industry = path.relative(DATA_DIR, full).split(path.sep)[0]
          const file = path.relative(DATA_DIR, full).split(path.sep).join('/')
          const hit = tokens.some(
            (t) => title.toLowerCase().includes(t) || tags.some((tag) => String(tag).toLowerCase().includes(t))
          )
          if (hit) docs.push({ industry, file, title, tags, score: null, snippet: '' })
        }
      }
    }
    walk(DATA_DIR)
    res.json({ docs: docs.slice(0, limit), degraded: true, provider: embeddingProvider() })
    return
  }

  const [qv] = await embed([q])
  // 聚合到文档粒度：每篇取最高分块
  const best = new Map()
  for (const r of rows) {
    let vec
    try {
      vec = JSON.parse(r.embedding)
    } catch {
      continue
    }
    const score = cosine(qv, vec)
    const key = `${r.industry}/${r.file}`
    const cur = best.get(key)
    if (!cur || score > cur.score) {
      best.set(key, {
        industry: r.industry,
        file: r.file,
        title: r.title,
        score,
        snippet: r.text.slice(0, 120)
      })
    }
  }
  const docs = [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  // 补充标签信息
  for (const d of docs) {
    d.tags = docTags(path.join(DATA_DIR, d.file))
  }
  res.json({ docs, degraded: false, provider: embeddingProvider() })
}))

// 单篇文档读取（供关联文档面板预览）：?file
app.get('/api/vector/doc', wrap(async (req, res) => {
  const { file = '' } = req.query
  if (!file || String(file).includes('..')) throw new Error('参数不合法')
  const full = safeDocPath(file)
  const { meta, body } = parseFrontmatter(fs.readFileSync(full, 'utf-8'))
  res.json({ meta, content: body })
}))

// ===== 文档收藏（登录用户，按用户隔离） =====

// 收藏：{ industry, file, title }
app.post('/api/docs/favorite', auth, wrap(async (req, res) => {
  const { industry = '', file = '', title = '' } = req.body ?? {}
  if (!file) throw new Error('参数不合法')
  await db.docFavorite.upsert({
    where: { userId_industry_file: { userId: req.user.id, industry: String(industry), file: String(file) } },
    update: { title: String(title) },
    create: { userId: req.user.id, industry: String(industry), file: String(file), title: String(title) }
  })
  res.json({ ok: true, favorited: true })
}))

// 取消收藏：?industry&file
app.delete('/api/docs/favorite', auth, wrap(async (req, res) => {
  const { industry = '', file = '' } = req.query
  if (!file) throw new Error('参数不合法')
  await db.docFavorite.deleteMany({ where: { userId: req.user.id, industry: String(industry), file: String(file) } })
  res.json({ ok: true, favorited: false })
}))

// 收藏列表
app.get('/api/docs/favorites', auth, wrap(async (req, res) => {
  const rows = await db.docFavorite.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' }
  })
  res.json({
    favorites: rows.map((r) => ({ industry: r.industry, file: r.file, title: r.title, createdAt: r.createdAt }))
  })
}))

// 星图反馈入口：缺少的能力追加到 data/feedback/<行业>.md
app.post('/api/feedback', auth, wrap(async (req, res) => {
  const { industry = '通用', content = '', source = 'atlas' } = req.body ?? {}
  const text = String(content).trim()
  if (!text) {
    res.status(400).json({ error: '反馈内容为空' })
    return
  }
  const dir = path.join(DATA_ROOT, 'feedback')
  fs.mkdirSync(dir, { recursive: true })
  const full = path.join(dir, `${safeName(String(industry))}.md`)
  const time = new Date().toLocaleString('zh-CN', { hour12: false })
  fs.appendFileSync(full, `\n## ${time}（来源：${source}）\n\n${text}\n`, 'utf-8')
  res.json({ ok: true })
}))

// 反馈中心：读取 data/feedback/*.md，解析为按时间倒序的列表
app.get('/api/feedback', auth, wrap(async (req, res) => {
  res.json({ items: readFeedback() })
}))

// ===== 用户账号：注册 / 登录 / 当前用户（v0.6，JWT Bearer） =====

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_]{1,24}$/

function publicUser(u) {
  return { id: u.id, username: u.username, nickname: u.nickname, profile: u.profile, inviteCode: u.inviteCode ?? null, createdAt: u.createdAt }
}

// 注册：{ username, password, nickname?, inviteCode? } → { token, user }（inviteCode 填错不阻断注册）
// 登录/注册防爆破：登录 10 次/5 分钟/IP，注册 5 次/小时/IP
const loginLimiter = createRateLimit({ windowMs: 5 * 60_000, max: 10, message: '登录尝试过于频繁，请稍后再试' })
const registerLimiter = createRateLimit({ windowMs: 60 * 60_000, max: 5, message: '注册过于频繁，请稍后再试' })

app.post('/api/auth/register', registerLimiter, wrap(async (req, res) => {
  const { username = '', password = '', nickname = '', inviteCode = '' } = req.body ?? {}
  const name = String(username).trim()
  const pwd = String(password)
  if (!USERNAME_RE.test(name)) {
    res.status(400).json({ error: '用户名需为 2-24 位中文、字母、数字或下划线' })
    return
  }
  if (pwd.length < 6 || pwd.length > 128) {
    res.status(400).json({ error: '密码需为 6-128 位' })
    return
  }
  const exists = await db.user.findUnique({ where: { username: name } })
  if (exists) {
    res.status(409).json({ error: '用户名已被占用' })
    return
  }
  const inviter = await findInviterByCode(inviteCode)
  const user = await db.user.create({
    data: {
      username: name,
      passwordHash: await hashPassword(pwd),
      nickname: String(nickname).trim().slice(0, 32) || name,
      inviteCode: await newInviteCode(),
      invitedById: inviter?.id ?? undefined
    }
  })
  res.json({ token: signToken(user), user: publicUser(user) })
}))

// 登录：{ username, password } → { token, user }
app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const { username = '', password = '' } = req.body ?? {}
  const pwd = String(password)
  if (pwd.length > 128) {
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }
  const user = await db.user.findUnique({ where: { username: String(username).trim() } })
  if (!user) {
    // 用户不存在时也跑一次同成本 bcrypt，抹平响应时间差，避免用户名枚举
    await hashPassword('dummy-password-for-timing')
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }
  if (!(await verifyPassword(pwd, user.passwordHash))) {
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }
  if (user.disabled) {
    res.status(403).json({ error: '账号已被禁用' })
    return
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  res.json({ token: signToken(user), user: publicUser(user) })
}))

// 当前登录用户（token 校验）
app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.user.id } })
  if (!user) {
    res.status(401).json({ error: '用户不存在' })
    return
  }
  res.json({ user: publicUser(user) })
}))

// 保存学习档案（首次进入引导采集）：{ profile: "{identity, stage, school, major}" }
app.put('/api/auth/profile', auth, wrap(async (req, res) => {
  const profile = typeof req.body?.profile === 'string' ? req.body.profile : null
  if (profile === null || profile.length > 2048) {
    res.status(400).json({ error: '档案数据不合法' })
    return
  }
  const user = await db.user.update({ where: { id: req.user.id }, data: { profile } })
  res.json({ ok: true, user: publicUser(user) })
}))

// ===== 学习进度同步（登录后按用户读写） =====

// 拉取全量：→ { mastery: [{kp, ok, t}], learning: string | null }
app.get('/api/progress', auth, wrap(async (req, res) => {
  const records = await db.masteryRecord.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'asc' },
    select: { kp: true, ok: true, createdAt: true }
  })
  const state = await db.learningState.findUnique({ where: { userId: req.user.id } })
  res.json({
    mastery: records.map((r) => ({ kp: r.kp, ok: r.ok, t: r.createdAt.getTime() })),
    learning: state?.data ?? null
  })
}))

// 推送答题记录：{ records: [{kp, ok, t}] }（增量追加，按客户端时间戳落库）
app.post('/api/progress/mastery', auth, wrap(async (req, res) => {
  const list = Array.isArray(req.body?.records) ? req.body.records : []
  const data = []
  for (const r of list.slice(0, 2000)) {
    const kp = typeof r?.kp === 'string' ? r.kp.trim() : ''
    const t = Number(r?.t)
    if (!kp || !Number.isFinite(t)) continue
    data.push({ userId: req.user.id, kp, ok: Boolean(r.ok), createdAt: new Date(t) })
  }
  if (data.length > 0) await db.masteryRecord.createMany({ data })
  res.json({ ok: true, inserted: data.length })
}))

// 保存学习状态快照：{ data: "<JSON 字符串>" }（整存整取 upsert）
app.put('/api/progress/learning', auth, wrap(async (req, res) => {
  const data = typeof req.body?.data === 'string' ? req.body.data : null
  if (data === null) {
    res.status(400).json({ error: '缺少 data 字段' })
    return
  }
  await db.learningState.upsert({
    where: { userId: req.user.id },
    update: { data },
    create: { userId: req.user.id, data }
  })
  res.json({ ok: true })
}))

// 重置学习数据（保留账号，清空掌握度记录与学习状态快照）
app.delete('/api/progress', auth, wrap(async (req, res) => {
  await db.masteryRecord.deleteMany({ where: { userId: req.user.id } })
  await db.learningState.deleteMany({ where: { userId: req.user.id } })
  res.json({ ok: true })
}))

// 统一错误兜底：body 解析失败、未被 wrap 包裹的同步异常统一返回 JSON，避免默认 HTML 错误页
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  const status = Number(err?.status || err?.statusCode) || 500
  log.error(`请求异常 ${req.method} ${req.originalUrl}:`, err?.stack || err)
  if (status === 413) return res.status(413).json({ error: '请求体过大' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体不是合法 JSON' })
  // 5xx 不回传内部错误信息，避免泄露堆栈细节
  res.status(status).json({ error: status >= 500 ? '服务器内部错误' : err?.message || '请求不合法' })
})

// 启动监听：端口被占用 → 自动递增重试（最多 3 次：3001/3002/3003），前端启动时会按序探测
let httpServer = null

function listenWithRetry(port, attemptsLeft) {
  const server = app.listen(port, HOST, () => {
    log.info(`后端已启动: http://${HOST}:${port}`)
    log.info(`数据目录: ${DATA_ROOT}`)
  })
  httpServer = server
  server.on('error', (err) => {
    if (err?.code === 'EADDRINUSE' && attemptsLeft > 1) {
      log.warn(`端口 ${port} 被占用，尝试 ${port + 1}`)
      listenWithRetry(port + 1, attemptsLeft - 1)
    } else {
      log.error(`后端启动失败: ${err?.message || err}`)
      process.exit(1)
    }
  })
}
listenWithRetry(PORT, 3)

// ===== 进程级兜底：异常必须留痕，退出前先收尾 =====
// 关停：先停止接收新连接，再断开 Prisma；5 秒兜底强退，避免 keep-alive 连接拖住进程
function shutdown(code = 0) {
  const done = () => process.exit(code)
  if (!httpServer) return done()
  httpServer.close(() => {
    db.$disconnect().catch(() => {}).finally(done)
  })
  setTimeout(done, 5000).unref()
}

// 未处理的 Promise 拒绝：记录堆栈后继续服务（多数来自后台任务，不应直接拖垮进程）
process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : String(reason)
  log.error('未处理的 Promise 拒绝:', detail)
})

// 未捕获异常：进程状态已不可信，记录堆栈后优雅退出，交给外部重启
process.on('uncaughtException', (err) => {
  log.error('未捕获异常，准备退出:', err?.stack || err)
  shutdown(1)
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// v1.6 启动回填：为存量用户补齐邀请码（一次性，失败不阻断服务）
ensureInviteCodes().catch((e) => log.warn('邀请码回填异常:', e?.message || e))
