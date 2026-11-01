// 问星 — 管理后台：平台 AI 密钥配置（读写均不回传明文，全部依赖外层 adminAuth）
import express from 'express'
import { keyStatus, setRuntimeKey, clearRuntimeKey } from '../ai-key-store.js'

const router = express.Router()

// 当前密钥状态
router.get('/ai-key', (req, res) => {
  res.json(keyStatus())
})

// 保存 / 更新运行时 Key
router.put('/ai-key', (req, res) => {
  try {
    const key = String(req.body?.key || '')
    res.json(setRuntimeKey(key, req.admin?.username || ''))
  } catch (e) {
    res.status(e?.status === 503 ? 503 : 400).json({ error: e?.message || '保存失败' })
  }
})

// 清除运行时 Key（回退到环境变量）
router.delete('/ai-key', (req, res) => {
  try {
    res.json({ ok: true, status: clearRuntimeKey() })
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || '清除失败' })
  }
})

export default router
