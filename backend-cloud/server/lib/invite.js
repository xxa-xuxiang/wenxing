// 问星 v1.6 — 邀请码：生成/回填/按码找人
import { db } from './db.js'
import { createLogger } from './logger.js'
import crypto from 'node:crypto'

const log = createLogger('invite')

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉易混淆的 I/O/0/1

/** 生成一个未占用的 8 位邀请码 */
export async function newInviteCode() {
  for (let i = 0; i < 20; i++) {
    let code = ''
    for (let j = 0; j < 8; j++) code += ALPHABET[crypto.randomInt(ALPHABET.length)]
    const clash = await db.user.findUnique({ where: { inviteCode: code }, select: { id: true } })
    if (!clash) return code
  }
  throw new Error('邀请码生成失败，请重试')
}

/** 启动时惰性回填：为没有邀请码的存量用户补码 */
export async function ensureInviteCodes() {
  const missing = await db.user.findMany({ where: { inviteCode: null }, select: { id: true } })
  for (const u of missing) {
    try {
      await db.user.update({ where: { id: u.id }, data: { inviteCode: await newInviteCode() } })
    } catch (e) {
      log.warn('邀请码回填失败:', u.id, e?.message || e)
    }
  }
  if (missing.length) log.info(`已为 ${missing.length} 个存量用户回填邀请码`)
}

/** 按邀请码找邀请人（找不到返回 null，不抛错——填错码不阻断注册） */
export async function findInviterByCode(code) {
  const c = String(code || '').trim().toUpperCase()
  if (!c) return null
  try {
    return await db.user.findUnique({ where: { inviteCode: c }, select: { id: true } })
  } catch {
    return null
  }
}
