// 问星 v1.4 — 管理员鉴权：环境变量固定账号 + role=admin JWT
// 未配置 ADMIN_USERNAME / ADMIN_PASSWORD 时管理接口一律 503
// v1.8 安全增强：jti 吊销（logout 即失效）+ 密码戳（改密后旧 token 全部失效）
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { createLogger } from './logger.js'
import { db } from './db.js'

const log = createLogger('admin-auth')

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim()
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '')
const ADMIN_JWT_SECRET = String(process.env.ADMIN_JWT_SECRET || '')
const ADMIN_JWT_TTL = process.env.ADMIN_JWT_TTL || '12h'

// 密码戳：改密后所有已签发 token 因戳不匹配立即失效（无需服务端会话表）
const PWD_STAMP = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex').slice(0, 16)

// 管理员账号启用时，后台密钥必须独立且足够强：不复用 JWT_SECRET，也不允许源码兜底
if (ADMIN_USERNAME && ADMIN_PASSWORD) {
  if (ADMIN_JWT_SECRET.length < 32) {
    throw new Error('[问星] 已配置管理员账号，但 ADMIN_JWT_SECRET 缺失或长度不足 32 位')
  }
  if (ADMIN_JWT_SECRET === String(process.env.JWT_SECRET || '')) {
    throw new Error('[问星] ADMIN_JWT_SECRET 不得与 JWT_SECRET 相同')
  }
  if (ADMIN_PASSWORD.length < 12) {
    log.warn('ADMIN_PASSWORD 长度不足 12 位，建议更换为强密码')
  }
}

/** 管理员账号是否已配置 */
export function adminEnabled() {
  return Boolean(ADMIN_USERNAME && ADMIN_PASSWORD)
}

/** 比较 sha256 摘要，避免长度泄露 */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest()
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * 校验管理员账号密码并签发 token
 * @returns {{ token: string, username: string } | null}
 */
export function adminLogin(username, password) {
  if (!adminEnabled()) return null
  const okUser = safeEqual(username, ADMIN_USERNAME)
  const okPass = safeEqual(password, ADMIN_PASSWORD)
  if (!okUser || !okPass) return null
  const token = jwt.sign(
    { role: 'admin', username: ADMIN_USERNAME, jti: crypto.randomUUID(), pwd: PWD_STAMP },
    ADMIN_JWT_SECRET,
    { expiresIn: ADMIN_JWT_TTL }
  )
  return { token, username: ADMIN_USERNAME }
}

/** 吊销指定 jti（logout），并惰性清理已到期记录 */
export async function adminRevoke(jti, exp) {
  if (!jti || !exp) return
  try {
    await db.adminRevokedToken.upsert({
      where: { jti },
      create: { jti, expiresAt: new Date(exp * 1000) },
      update: {}
    })
    await db.adminRevokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  } catch (e) {
    log.warn('令牌吊销写入失败:', e?.message || e)
  }
}

/** Express 中间件：校验管理员 Bearer token（含密码戳 + jti 吊销检查），通过后挂 req.admin */
export async function adminAuth(req, res, next) {
  if (!adminEnabled()) {
    res.status(503).json({ error: '服务端未配置管理员账号' })
    return
  }
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) {
    res.status(401).json({ error: '管理员登录已过期，请重新登录' })
    return
  }
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET)
    if (payload?.role !== 'admin' || payload?.pwd !== PWD_STAMP) {
      res.status(401).json({ error: '管理员登录已过期，请重新登录' })
      return
    }
    if (payload.jti) {
      const revoked = await db.adminRevokedToken.findUnique({ where: { jti: payload.jti } })
      if (revoked) {
        res.status(401).json({ error: '管理员登录已过期，请重新登录' })
        return
      }
    }
    req.admin = { username: payload.username, jti: payload.jti || null, exp: payload.exp || 0 }
    next()
  } catch (e) {
    if (e instanceof Error && e.name !== 'JsonWebTokenError' && e.name !== 'TokenExpiredError') {
      log.warn('管理员鉴权异常:', e.message)
    }
    res.status(401).json({ error: '管理员登录已过期，请重新登录' })
  }
}
