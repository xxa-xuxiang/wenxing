// 问星 v1.6 — 管理后台路由注册：登录/状态/当前管理员 + 全部子路由挂载
// v1.8：logout 吊销 jti + 审计日志查看
import fs from 'node:fs'
import { adminEnabled, adminLogin, adminAuth, adminRevoke } from './admin-auth.js'
import dashboardRouter from './admin/dashboard.js'
import questionsRouter from './admin/questions.js'
import usersRouter from './admin/users.js'
import contentRouter from './admin/content.js'
import analyticsRouter from './admin/analytics.js'
import revenueRouter from './admin/revenue.js'
import walletRouter from './admin/wallet.js'
import aiKeyRouter from './admin/ai-key.js'
import { createRateLimit } from './rate-limit.js'
import path from 'node:path'
import { DATA_ROOT } from './data-root.js'
import { safeAppendLine } from './fs-safe.js'

// 管理端写操作审计日志（JSONL，一行一条）
const ADMIN_AUDIT_LOG = path.join(DATA_ROOT, 'admin-audit.log')

// 管理员登录防爆破：5 次 / 5 分钟 / IP
const adminLoginLimiter = createRateLimit({
  windowMs: 5 * 60_000,
  max: 5,
  message: '登录尝试过于频繁，请稍后再试'
})

export default function registerAdminRoutes(app) {
  // 写操作审计：记录方法/路径/状态/IP/管理员，供事后追溯删用户、改题目、改密钥等动作
  app.use('/api/admin', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
    const startedAt = Date.now()
    res.on('finish', () => {
      safeAppendLine(
        ADMIN_AUDIT_LOG,
        JSON.stringify({
          at: new Date().toISOString(),
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          ms: Date.now() - startedAt,
          ip: req.ip,
          admin: req.admin?.username || null
        })
      )
    })
    next()
  })

  // 未登录可访问：管理员是否已配置 / 登录
  app.get('/api/admin/status', (req, res) => {
    res.json({ enabled: adminEnabled() })
  })

  app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
    if (!adminEnabled()) {
      res.status(503).json({ error: '服务端未配置管理员账号' })
      return
    }
    const { username = '', password = '' } = req.body ?? {}
    const result = adminLogin(String(username), String(password))
    if (!result) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }
    res.json(result)
  })

  app.get('/api/admin/me', adminAuth, (req, res) => {
    res.json({ username: req.admin.username })
  })

  // 退出登录：吊销当前 jti，token 立即失效（无需等 12h 自然过期）
  app.post('/api/admin/logout', adminAuth, async (req, res) => {
    await adminRevoke(req.admin.jti, req.admin.exp)
    res.json({ ok: true })
  })

  // 审计日志查看：读 JSONL 尾部，倒序返回（最新在前）
  app.get('/api/admin/audit-logs', adminAuth, (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 20))
    let lines = []
    try {
      if (fs.existsSync(ADMIN_AUDIT_LOG)) {
        lines = fs.readFileSync(ADMIN_AUDIT_LOG, 'utf-8').split('\n').filter((l) => l.trim())
      }
    } catch {
      lines = []
    }
    const items = []
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        items.push(JSON.parse(lines[i]))
      } catch {
        // 跳过损坏行
      }
    }
    const total = items.length
    const start = (page - 1) * pageSize
    res.json({ items: items.slice(start, start + pageSize), total, page, pageSize })
  })

  // 受保护子路由：统一先过管理员鉴权
  app.use('/api/admin', adminAuth, dashboardRouter)
  app.use('/api/admin', adminAuth, questionsRouter)
  app.use('/api/admin', adminAuth, usersRouter)
  app.use('/api/admin', adminAuth, contentRouter)
  // v1.6 数据分析（用户增长/日活/行为/邀请/社区统计）与 AI 盈利（计费/收入）
  app.use('/api/admin', adminAuth, analyticsRouter)
  app.use('/api/admin', adminAuth, revenueRouter)
  // v1.1 充值与余额（手动充值 / 兑换码 / 订单与流水）
  app.use('/api/admin', adminAuth, walletRouter)
  // 平台 AI 密钥（加密落盘 + 热切换）
  app.use('/api/admin', adminAuth, aiKeyRouter)
}
