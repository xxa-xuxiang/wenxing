// 问星 v1.1 — 用户侧钱包接口：余额与流水查询 / 兑换码核销
import express from 'express'
import { auth } from './auth.js'
import { wrap } from './ai.js'
import { createRateLimit } from './rate-limit.js'
import { getWallet, redeemCode, yuanOf } from './wallet.js'

const router = express.Router()

// 兑换码防爆破：10 次 / 10 分钟 / 用户
const redeemLimiter = createRateLimit({
  windowMs: 10 * 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip || 'unknown',
  message: '兑换尝试过于频繁，请稍后再试'
})

// 我的钱包：余额 + 最近流水
router.get(
  '/',
  auth,
  wrap(async (req, res) => {
    const wallet = await getWallet(req.user.id, req.query.limit)
    if (!wallet) {
      res.status(404).json({ error: '用户不存在' })
      return
    }
    res.json(wallet)
  })
)

// 兑换码核销：成功后立即入账
router.post(
  '/redeem',
  auth,
  redeemLimiter,
  wrap(async (req, res) => {
    const code = req.body?.code
    if (typeof code !== 'string' || !code.trim()) {
      res.status(400).json({ error: '请输入兑换码', code: 'REDEEM_FAILED' })
      return
    }
    const result = await redeemCode(req.user.id, code)
    if (!result.ok) {
      res.status(400).json({ error: result.error, code: 'REDEEM_FAILED' })
      return
    }
    res.json({
      ok: true,
      amountFen: result.amountFen,
      amountYuan: yuanOf(result.amountFen),
      balanceFen: result.balanceFen,
      balanceYuan: yuanOf(result.balanceFen)
    })
  })
)

export default router
