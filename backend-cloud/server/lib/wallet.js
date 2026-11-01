// 问星 v1.1 — 钱包核心库（余额 / 兑换码 / 充值订单 / 余额流水）
// 金额一律用整数「分」，避免浮点误差；所有写操作走 serializeWrite 串行队列，规避 SQLite 写锁争用。
import crypto from 'node:crypto'
import { db, serializeWrite } from './db.js'
import { getPricing } from './pricing.js'
import { createLogger } from './logger.js'

const log = createLogger('wallet')

/** 单笔充值上限（分）：1000 元 */
export const MAX_RECHARGE_FEN = 100000
/** 单批生成兑换码上限 */
export const MAX_GENERATE_COUNT = 200

/** 兑换码字符集：去掉 0/O/1/I 等易混淆字符 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 16

/** 分 → 元（两位小数数值） */
export function yuanOf(fen) {
  return Math.round(Number(fen) || 0) / 100
}

/** 某个 AI action 的单次扣费（分）；单价 0 或非法按免费处理 */
export function priceFenOf(action) {
  const pricing = getPricing([action])
  const price = Number(pricing?.items?.[action]?.pricePerCall)
  if (!Number.isFinite(price) || price <= 0) return 0
  return Math.max(1, Math.round(price * 100))
}

/** 输入归一化：去空格/横线、转大写，只保留字母数字 */
export function normalizeCode(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/** 展示格式：4 位一组，如 ABCD-EFGH-JKLM-NPQR */
export function formatCode(code) {
  const body = normalizeCode(code)
  return body.replace(/(.{4})/g, '$1-').replace(/-$/, '')
}

/** 生成一个 16 位随机兑换码（加密安全随机源） */
function randomCode() {
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)]
  }
  return out
}

/**
 * 读取钱包：余额 + 最近流水
 * @param {string} userId
 * @param {number} [limit] 流水条数（默认 20，上限 50）
 */
export async function getWallet(userId, limit = 20) {
  const take = Math.min(50, Math.max(1, Number(limit) || 20))
  const [user, txns] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { balanceFen: true } }),
    db.walletTxn.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, deltaFen: true, type: true, refId: true, balanceAfter: true, note: true, createdAt: true }
    })
  ])
  if (!user) return null
  return {
    balanceFen: user.balanceFen,
    balanceYuan: yuanOf(user.balanceFen),
    items: txns.map((t) => ({ ...t, deltaYuan: yuanOf(t.deltaFen), balanceYuan: yuanOf(t.balanceAfter) }))
  }
}

/**
 * 入账（兑换码 / 后台手动充值共用）：订单 + 余额 + 流水，单事务原子完成
 * @param {string} userId
 * @param {number} amountFen
 * @param {{ channel: 'redeem'|'manual', type: string, refCode?: string, note?: string, operator?: string }} opts
 * @returns {Promise<{ orderId:string, balanceFen:number }>}
 */
export async function creditBalance(userId, amountFen, opts) {
  const amount = Math.round(Number(amountFen) || 0)
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('入账金额必须为正整数（分）')
  if (amount > MAX_RECHARGE_FEN) throw new Error(`单笔金额不能超过 ${MAX_RECHARGE_FEN / 100} 元`)

  return serializeWrite(() =>
    db.$transaction(async (tx) => {
      const order = await tx.rechargeOrder.create({
        data: {
          userId,
          amountFen: amount,
          channel: opts.channel,
          status: 'paid',
          refCode: opts.refCode ?? null,
          note: String(opts.note ?? ''),
          operator: opts.operator ?? null
        }
      })
      const user = await tx.user.update({
        where: { id: userId },
        data: { balanceFen: { increment: amount } },
        select: { balanceFen: true }
      })
      await tx.walletTxn.create({
        data: {
          userId,
          deltaFen: amount,
          type: opts.type,
          refId: order.id,
          balanceAfter: user.balanceFen,
          note: String(opts.note ?? '')
        }
      })
      return { orderId: order.id, balanceFen: user.balanceFen }
    })
  )
}

/**
 * 扣费（AI 超出免费额度后按次扣）：条件更新保证余额不会被扣成负数
 * @param {string} userId
 * @param {number} amountFen
 * @param {{ refId?: string, note?: string }} [opts]
 * @returns {Promise<{ ok:boolean, balanceFen:number, amountFen:number, reason?:string }>}
 */
export async function debitBalance(userId, amountFen, opts = {}) {
  const amount = Math.round(Number(amountFen) || 0)
  if (amount <= 0) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { balanceFen: true } })
    return { ok: true, balanceFen: user?.balanceFen ?? 0, amountFen: 0 }
  }

  return serializeWrite(() =>
    db.$transaction(async (tx) => {
      // 条件更新：余额不足时 count=0，不会出现负余额
      const updated = await tx.user.updateMany({
        where: { id: userId, balanceFen: { gte: amount } },
        data: { balanceFen: { decrement: amount } }
      })
      const user = await tx.user.findUnique({ where: { id: userId }, select: { balanceFen: true } })
      const balanceFen = user?.balanceFen ?? 0
      if (updated.count === 0) return { ok: false, balanceFen, amountFen: amount, reason: 'INSUFFICIENT_BALANCE' }
      await tx.walletTxn.create({
        data: {
          userId,
          deltaFen: -amount,
          type: 'ai_consume',
          refId: opts.refId ?? null,
          balanceAfter: balanceFen,
          note: String(opts.note ?? '')
        }
      })
      return { ok: true, balanceFen, amountFen: amount }
    })
  )
}

/**
 * 按 action 单价从余额扣费（供 AI 闸门在免费额度用尽后调用）
 * 单价为 0 时直接放行，不扣费。
 */
export async function chargeForAction(userId, action) {
  const amountFen = priceFenOf(action)
  if (amountFen === 0) return { ok: true, amountFen: 0, balanceFen: null }
  try {
    return await debitBalance(userId, amountFen, { refId: action, note: `AI 调用 · ${action}` })
  } catch (e) {
    log.warn('余额扣费失败:', String(e?.message || e).slice(0, 160))
    return { ok: false, amountFen, balanceFen: 0, reason: 'CHARGE_FAILED' }
  }
}

/**
 * 核销兑换码：原子领取（usedBy 为空才可领取）→ 入账，全部在一个写事务内
 * @returns {Promise<{ ok:true, amountFen:number, balanceFen:number } | { ok:false, error:string }>}
 */
export async function redeemCode(userId, rawCode) {
  const code = normalizeCode(rawCode)
  if (code.length !== CODE_LEN) return { ok: false, error: '兑换码格式不正确（应为 16 位字母数字）' }

  return serializeWrite(() =>
    db.$transaction(async (tx) => {
      // 原子核销：只有未被使用过的码才能被领取
      const claimed = await tx.redeemCode.updateMany({
        where: { code, usedBy: null },
        data: { usedBy: userId, usedAt: new Date() }
      })
      if (claimed.count === 0) {
        const existing = await tx.redeemCode.findUnique({
          where: { code },
          select: { usedBy: true }
        })
        if (!existing) return { ok: false, error: '兑换码不存在，请核对后重试' }
        if (existing.usedBy === userId) return { ok: false, error: '该兑换码你已使用过' }
        return { ok: false, error: '兑换码已被使用' }
      }

      const redeem = await tx.redeemCode.findUnique({ where: { code } })
      const order = await tx.rechargeOrder.create({
        data: {
          userId,
          amountFen: redeem.amountFen,
          channel: 'redeem',
          status: 'paid',
          refCode: code,
          note: redeem.note ? `兑换码：${redeem.note}` : '兑换码充值'
        }
      })
      const user = await tx.user.update({
        where: { id: userId },
        data: { balanceFen: { increment: redeem.amountFen } },
        select: { balanceFen: true }
      })
      await tx.walletTxn.create({
        data: {
          userId,
          deltaFen: redeem.amountFen,
          type: 'recharge_redeem',
          refId: order.id,
          balanceAfter: user.balanceFen,
          note: `兑换码 ${formatCode(code)}`
        }
      })
      return { ok: true, amountFen: redeem.amountFen, balanceFen: user.balanceFen }
    })
  )
}

/**
 * 批量生成兑换码（去重 + 落库）
 * @param {{ count:number, amountFen:number, note?:string, createdBy?:string }} opts
 */
export async function generateCodes({ count, amountFen, note = '', createdBy = '' }) {
  const n = Math.round(Number(count) || 0)
  const amount = Math.round(Number(amountFen) || 0)
  if (!Number.isInteger(n) || n < 1 || n > MAX_GENERATE_COUNT) {
    throw new Error(`生成数量需在 1–${MAX_GENERATE_COUNT} 之间`)
  }
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('面额必须为正整数（分）')
  if (amount > MAX_RECHARGE_FEN) throw new Error(`面额不能超过 ${MAX_RECHARGE_FEN / 100} 元`)

  return serializeWrite(async () => {
    // 先生成候选集，再排除库里已存在的码（碰撞概率极低，仍做兜底）
    const picked = new Set()
    while (picked.size < n) picked.add(randomCode())
    let candidates = [...picked]

    const exists = await db.redeemCode.findMany({
      where: { code: { in: candidates } },
      select: { code: true }
    })
    const taken = new Set(exists.map((e) => e.code))
    candidates = candidates.filter((c) => !taken.has(c))
    while (candidates.length < n) {
      const c = randomCode()
      if (!picked.has(c) && !taken.has(c)) {
        picked.add(c)
        candidates.push(c)
      }
    }

    await db.redeemCode.createMany({
      data: candidates.map((code) => ({
        code,
        amountFen: amount,
        note: String(note || ''),
        createdBy: createdBy || null
      }))
    })
    return candidates
  })
}
