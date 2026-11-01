// 问星 v0.6 — 鉴权库：bcrypt 密码哈希 + JWT 签发/校验 + Express 中间件
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db } from './db.js'
import { createLogger } from './logger.js'

const log = createLogger('auth')

const TOKEN_TTL = '7d'

/**
 * 读取必需的环境密钥：缺失或过短直接抛错，拒绝带弱密钥启动
 * @param {string} name 环境变量名
 * @param {number} [min] 最小长度
 */
function requireSecret(name, min = 32) {
  const value = String(process.env[name] || '')
  if (value.length < min) {
    throw new Error(`[问星] 环境变量 ${name} 缺失或长度不足 ${min} 位，请检查 backend-cloud/server/.env`)
  }
  return value
}

const JWT_SECRET = requireSecret('JWT_SECRET')

/** 密码哈希（bcrypt 10 轮） */
export function hashPassword(plain) {
  return bcrypt.hash(plain, 10)
}

/** 校验密码 */
export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash)
}

/** 签发 JWT（payload: uid + username） */
export function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL })
}

/** Express 中间件：校验 Authorization: Bearer <token> 与账号禁用状态，通过后挂 req.user */
export async function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ error: '未登录' })
  let payload
  try {
    payload = jwt.verify(token, JWT_SECRET)
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' })
  }
  // 管理员 token 无 uid，不能用于用户接口
  if (!payload?.uid) return res.status(401).json({ error: '登录已过期，请重新登录' })
  let user
  try {
    user = await db.user.findUnique({ where: { id: String(payload.uid) }, select: { disabled: true } })
  } catch (e) {
    log.warn('校验用户状态失败:', e?.message || e)
    return res.status(500).json({ error: '服务端校验失败，请稍后重试' })
  }
  if (!user) return res.status(401).json({ error: '用户不存在' })
  if (user.disabled) return res.status(403).json({ error: '账号已被禁用' })
  req.user = { id: payload.uid, username: payload.username }
  next()
}

/** 校验请求头 Bearer token，返回 payload；无 token / 非法 token 返回 null */
function verifyRequestToken(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

/** 可选鉴权：从 Bearer token 解析 userId，未登录/非法 token 返回 null（不拦截请求） */
export function optUserId(req) {
  return verifyRequestToken(req)?.uid ?? null
}

/** Express 中间件：可选鉴权——有合法 token 且账号可用则挂 req.user；无 token 按匿名继续
 *  注意：token 有效但账号已禁用/已删除时直接拒绝，避免被封账号继续调用 AI 等可选鉴权接口 */
export async function optionalAuth(req, res, next) {
  const payload = verifyRequestToken(req)
  if (!payload?.uid) return next()
  let user
  try {
    user = await db.user.findUnique({ where: { id: String(payload.uid) }, select: { disabled: true } })
  } catch (e) {
    log.warn('可选鉴权校验用户状态失败:', e?.message || e)
    return res.status(500).json({ error: '服务端校验失败，请稍后重试' })
  }
  if (!user) return res.status(401).json({ error: '用户不存在' })
  if (user.disabled) return res.status(403).json({ error: '账号已被禁用', code: 'ACCOUNT_DISABLED' })
  req.user = { id: payload.uid, username: payload.username }
  next()
}
