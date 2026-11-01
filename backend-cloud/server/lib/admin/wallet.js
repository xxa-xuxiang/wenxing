// 问星 v1.1 — 管理后台「充值与余额」：手动充值 / 兑换码生成与管理 / 订单与流水
import express from 'express'
import { db } from '../db.js'
import { wrap } from '../ai.js'
import {
  MAX_RECHARGE_FEN,
  creditBalance,
  formatCode,
  generateCodes,
  yuanOf
} from '../wallet.js'

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

/** 今日零点（服务器本地时区） */
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** 分 → 元，保留两位 */
const toYuan = (fen) => yuanOf(fen)

/* ===== 概览 ===== */

router.get(
  '/wallet/overview',
  wrap(async (req, res) => {
    const today = startOfToday()
    const [balanceAgg, balanceUsers, todayRecharge, totalRecharge, consumeAgg, todayConsume, unusedCodes] =
      await Promise.all([
        db.user.aggregate({ _sum: { balanceFen: true } }),
        db.user.count({ where: { balanceFen: { gt: 0 } } }),
        db.rechargeOrder.aggregate({
          _sum: { amountFen: true },
          where: { status: 'paid', createdAt: { gte: today } }
        }),
        db.rechargeOrder.aggregate({ _sum: { amountFen: true }, where: { status: 'paid' } }),
        db.walletTxn.aggregate({ _sum: { deltaFen: true }, where: { deltaFen: { lt: 0 } } }),
        db.walletTxn.aggregate({
          _sum: { deltaFen: true },
          where: { deltaFen: { lt: 0 }, createdAt: { gte: today } }
        }),
        db.redeemCode.aggregate({
          _sum: { amountFen: true },
          _count: { _all: true },
          where: { usedBy: null }
        })
      ])

    const totalBalanceFen = balanceAgg._sum.balanceFen ?? 0
    const todayRechargeFen = todayRecharge._sum.amountFen ?? 0
    const totalRechargeFen = totalRecharge._sum.amountFen ?? 0
    // 消费流水为负数，取绝对值展示
    const totalConsumeFen = Math.abs(consumeAgg._sum.deltaFen ?? 0)
    const todayConsumeFen = Math.abs(todayConsume._sum.deltaFen ?? 0)
    const unusedCodeCount = unusedCodes._count._all ?? 0
    const unusedCodeValueFen = unusedCodes._sum.amountFen ?? 0

    res.json({
      totalBalanceFen,
      totalBalanceYuan: toYuan(totalBalanceFen),
      balanceUsers,
      todayRechargeFen,
      todayRechargeYuan: toYuan(todayRechargeFen),
      totalRechargeFen,
      totalRechargeYuan: toYuan(totalRechargeFen),
      totalConsumeFen,
      totalConsumeYuan: toYuan(totalConsumeFen),
      todayConsumeFen,
      todayConsumeYuan: toYuan(todayConsumeFen),
      unusedCodeCount,
      unusedCodeValueFen,
      unusedCodeValueYuan: toYuan(unusedCodeValueFen)
    })
  })
)

/* ===== 充值订单 ===== */

/** 订单列表：可按用户名/昵称搜索、按渠道筛选 */
router.get(
  '/wallet/orders',
  wrap(async (req, res) => {
    const { page, pageSize } = pageParams(req.query)
    const q = queryText(req.query.q)
    const channel = queryText(req.query.channel)
    const where = {
      ...(channel === 'redeem' || channel === 'manual' ? { channel } : {}),
      ...(q ? { user: { OR: [{ username: { contains: q } }, { nickname: { contains: q } }] } } : {})
    }

    const [total, rows] = await Promise.all([
      db.rechargeOrder.count({ where }),
      db.rechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          amountFen: true,
          channel: true,
          status: true,
          refCode: true,
          note: true,
          operator: true,
          createdAt: true,
          user: { select: { id: true, username: true, nickname: true } }
        }
      })
    ])

    res.json({
      items: rows.map((r) => ({ ...r, amountYuan: toYuan(r.amountFen) })),
      total,
      page,
      pageSize
    })
  })
)

/** 手动充值：按 userId 或用户名指定收款账户，即时到账 */
router.post(
  '/wallet/recharge',
  wrap(async (req, res) => {
    const body = req.body ?? {}
    const amountFen = Math.round(Number(body.amountFen))
    if (!Number.isInteger(amountFen) || amountFen <= 0) {
      res.status(400).json({ error: '充值金额必须为正整数（分）' })
      return
    }
    if (amountFen > MAX_RECHARGE_FEN) {
      res.status(400).json({ error: `单笔充值不能超过 ${MAX_RECHARGE_FEN / 100} 元` })
      return
    }

    let userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!userId) {
      const username = typeof body.username === 'string' ? body.username.trim() : ''
      if (!username) {
        res.status(400).json({ error: '请指定用户（userId 或用户名）' })
        return
      }
      const target = await db.user.findUnique({ where: { username }, select: { id: true } })
      if (!target) {
        res.status(404).json({ error: '用户不存在' })
        return
      }
      userId = target.id
    }

    const target = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, nickname: true }
    })
    if (!target) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : ''
    const result = await creditBalance(userId, amountFen, {
      channel: 'manual',
      type: 'recharge_manual',
      note: note || `后台手动充值 · ${req.admin?.username || 'admin'}`,
      operator: req.admin?.username || null
    })

    res.json({
      ok: true,
      orderId: result.orderId,
      amountFen,
      amountYuan: toYuan(amountFen),
      balanceFen: result.balanceFen,
      balanceYuan: toYuan(result.balanceFen),
      user: target
    })
  })
)

/* ===== 兑换码 ===== */

/** 兑换码列表：status=unused|used|all（默认 all） */
router.get(
  '/wallet/codes',
  wrap(async (req, res) => {
    const { page, pageSize } = pageParams(req.query)
    const status = queryText(req.query.status) || 'all'
    const where =
      status === 'unused' ? { usedBy: null } : status === 'used' ? { usedBy: { not: null } } : {}

    const [total, rows] = await Promise.all([
      db.redeemCode.count({ where }),
      db.redeemCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ])

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        codeText: formatCode(r.code),
        amountFen: r.amountFen,
        amountYuan: toYuan(r.amountFen),
        note: r.note,
        createdBy: r.createdBy,
        usedBy: r.usedBy,
        usedAt: r.usedAt,
        createdAt: r.createdAt
      })),
      total,
      page,
      pageSize
    })
  })
)

/** 批量生成兑换码：{ count, amountFen, note } */
router.post(
  '/wallet/codes',
  wrap(async (req, res) => {
    const body = req.body ?? {}
    const count = Math.round(Number(body.count))
    const amountFen = Math.round(Number(body.amountFen))
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 100) : ''

    try {
      const codes = await generateCodes({
        count,
        amountFen,
        note,
        createdBy: req.admin?.username || ''
      })
      res.json({
        ok: true,
        count: codes.length,
        amountFen,
        amountYuan: toYuan(amountFen),
        items: codes.map((code) => ({ code, codeText: formatCode(code) }))
      })
    } catch (e) {
      res.status(400).json({ error: e?.message || '生成失败' })
    }
  })
)

/** 作废未使用的兑换码（已使用的不可删除，保留凭证） */
router.delete(
  '/wallet/codes/:id',
  wrap(async (req, res) => {
    const result = await db.redeemCode.deleteMany({
      where: { id: req.params.id, usedBy: null }
    })
    if (result.count === 0) {
      res.status(400).json({ error: '兑换码不存在或已被使用，不能作废' })
      return
    }
    res.json({ ok: true })
  })
)

/* ===== 余额流水 ===== */

/** 流水列表：可按用户、类型筛选 */
router.get(
  '/wallet/txns',
  wrap(async (req, res) => {
    const { page, pageSize } = pageParams(req.query)
    const q = queryText(req.query.q)
    const type = queryText(req.query.type)
    const where = {
      ...(type ? { type } : {}),
      ...(q ? { user: { OR: [{ username: { contains: q } }, { nickname: { contains: q } }] } } : {})
    }

    const [total, rows] = await Promise.all([
      db.walletTxn.count({ where }),
      db.walletTxn.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          deltaFen: true,
          type: true,
          refId: true,
          balanceAfter: true,
          note: true,
          createdAt: true,
          user: { select: { id: true, username: true, nickname: true } }
        }
      })
    ])

    res.json({
      items: rows.map((r) => ({
        ...r,
        deltaYuan: toYuan(r.deltaFen),
        balanceAfterYuan: toYuan(r.balanceAfter)
      })),
      total,
      page,
      pageSize
    })
  })
)

export default router
