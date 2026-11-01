// 问星 v1.5 — 划词翻译路由：/api/translate
// 设计：术语前置匹配 → 缓存命中直接返回 → 未命中才调模型并写缓存（保证重复请求毫秒级）
import { Router } from 'express'
import { db } from './db.js'
import { deepseek, wrap } from './ai.js'
import { takeAiQuota } from './ai-guard.js'
import { adminAuth } from './admin-auth.js'
import { buildPrompt, detectLang, hashOf, matchTerms, normalize } from './translate.js'
import { createLogger } from './logger.js'

const log = createLogger('translate')

const MAX_TEXT = 4000

const router = Router()

// 翻译：{ text, to: 'auto'|'zh'|'en', domain }
router.post('/', wrap(async (req, res) => {
  const raw = req.body?.text
  const text = normalize(raw)
  if (!text) {
    res.status(400).json({ error: '文本为空' })
    return
  }
  if (text.length > MAX_TEXT) {
    res.status(400).json({ error: `文本过长（上限 ${MAX_TEXT} 字）` })
    return
  }

  const started = Date.now()
  const fromLang = detectLang(text)
  const to = String(req.body?.to ?? 'auto')
  const toLang = to === 'zh' || to === 'en' ? to : fromLang === 'zh' ? 'en' : 'zh'
  if (toLang === fromLang) {
    res.status(400).json({ error: '源语言与目标语言相同' })
    return
  }
  const domain = String(req.body?.domain ?? 'general') || 'general'
  const hash = hashOf(toLang, text)

  // 1) 缓存命中：同文本同目标语言直接复用
  const cached = await db.translationCache.findUnique({ where: { hash } })
  if (cached) {
    res.json({
      source: text,
      translation: cached.result,
      fromLang,
      toLang,
      terms: JSON.parse(cached.terms || '[]'),
      cached: true,
      elapsedMs: Date.now() - started
    })
    return
  }

  // 2) 术语匹配 → 3) 模型翻译（缓存未命中才走平台 AI，先占额度再调用）
  if (!(await takeAiQuota(req, res, 'translate'))) return
  const terms = await matchTerms(text, fromLang, domain)
  const translation = (await deepseek(buildPrompt(text, fromLang, toLang, terms), false, req.headers['x-user-api-key'])).trim()

  // 4) 写缓存（失败不阻断响应）
  try {
    await db.translationCache.create({
      data: { hash, source: text, result: translation, fromLang, toLang, terms: JSON.stringify(terms) }
    })
  } catch (e) {
    log.warn('译文缓存写入失败：', String(e?.message || e).slice(0, 120))
  }

  res.json({
    source: text,
    translation,
    fromLang,
    toLang,
    terms,
    cached: false,
    elapsedMs: Date.now() - started
  })
}))

// 术语查询：q 同时匹配中英两侧
router.get('/terms', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  const domain = String(req.query.domain ?? '').trim()
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
  const where = { status: 'active' }
  if (domain) where.domain = domain
  if (q) where.OR = [{ zh: { contains: q } }, { en: { contains: q.toLowerCase() } }]
  const items = await db.termEntry.findMany({
    where,
    orderBy: [{ domain: 'asc' }, { zh: 'asc' }],
    take: limit,
    select: { id: true, zh: true, en: true, domain: true, note: true }
  })
  res.json({ items, total: items.length })
}))

// 批量写入（幂等 upsert）：{ items: [{ zh, en, domain?, note? }] }；术语库为全局共享数据，仅管理员可写
router.post('/terms', adminAuth, wrap(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  if (!items.length) {
    res.status(400).json({ error: 'items 不能为空' })
    return
  }
  if (items.length > 500) {
    res.status(400).json({ error: '单批最多 500 条' })
    return
  }
  let saved = 0
  for (const it of items) {
    const zh = String(it?.zh ?? '').trim()
    const en = String(it?.en ?? '').trim()
    if (!zh || !en) continue
    const domain = String(it?.domain ?? 'general') || 'general'
    const note = String(it?.note ?? '')
    await db.termEntry.upsert({
      where: { zh_en_domain: { zh, en, domain } },
      create: { zh, en, domain, note },
      update: { note, status: 'active' }
    })
    saved += 1
  }
  res.json({ saved })
}))

// 删除（幂等）；术语库为全局共享数据，仅管理员可写
router.delete('/terms/:id', adminAuth, wrap(async (req, res) => {
  await db.termEntry.deleteMany({ where: { id: String(req.params.id) } })
  res.json({ ok: true })
}))

export default router
