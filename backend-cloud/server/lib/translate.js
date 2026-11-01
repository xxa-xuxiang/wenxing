// 问星 v1.5 — 划词翻译基础能力：语言识别 / 文本归一化 / 术语匹配 / 提示词拼装 / 缓存键
import crypto from 'node:crypto'
import { db } from './db.js'

/** 纯文本归一化：去首尾空白、全角空格转半角、压缩连续空白 */
export function normalize(text) {
  return String(text ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 语言识别：中文字符占比 > 30% 视为中文，否则英文 */
export function detectLang(text) {
  const s = String(text ?? '')
  const cjk = (s.match(/[\u4e00-\u9fff]/g) ?? []).length
  const letters = (s.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length
  if (!letters) return 'en'
  return cjk / letters > 0.3 ? 'zh' : 'en'
}

/** 缓存键：目标语言 + 归一化原文（内容寻址，同文本同语言永远命中同一键） */
export function hashOf(toLang, normalized) {
  return crypto.createHash('sha1').update(`${toLang}|${normalized}`).digest('hex')
}

/**
 * 术语匹配：取 active 且属于当前域或 general 的词条，按文本包含关系命中
 * 中文侧 includes；英文侧大小写不敏感 + 词边界，避免 "cat" 命中 "category"
 * 长词优先，去重后截断 limit 条
 */
export async function matchTerms(text, fromLang, domain = 'general', limit = 12) {
  const domains = domain && domain !== 'general' ? [domain, 'general'] : ['general']
  const all = await db.termEntry.findMany({
    where: { status: 'active', domain: { in: domains } },
    select: { zh: true, en: true, note: true }
  })
  const lower = String(text ?? '').toLowerCase()
  const hits = []
  for (const t of all) {
    const term = fromLang === 'zh' ? t.zh : t.en
    if (!term) continue
    const matched =
      fromLang === 'zh'
        ? String(text).includes(term)
        : new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)
    if (matched) hits.push({ zh: t.zh, en: t.en, note: t.note, len: term.length })
  }
  hits.sort((a, b) => b.len - a.len)
  const seen = new Set()
  const out = []
  for (const h of hits) {
    const key = `${h.zh}|${h.en}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ zh: h.zh, en: h.en })
    if (out.length >= limit) break
  }
  return out
}

/** 翻译提示词：术语表非空时强制使用给定译法 */
export function buildPrompt(text, fromLang, toLang, terms = []) {
  const srcName = fromLang === 'zh' ? '中文' : '英文'
  const dstName = toLang === 'zh' ? '中文' : '英文'
  const termBlock = terms.length
    ? `\n\n必须使用的术语（原文 => 译文）：\n${terms.map((t) => `${fromLang === 'zh' ? t.zh : t.en} => ${fromLang === 'zh' ? t.en : t.zh}`).join('\n')}`
    : ''
  const system = `你是问星的专业${srcName}到${dstName}翻译引擎，面向技术学习者。要求：
1. 只输出译文本体，不要解释、不要加引号、不要重复原文
2. 保持原文的段落与换行结构；代码、变量名、命令、URL 原样保留
3. 术语必须与给定术语表一致；没有术语表时使用技术领域通用译法
4. 语气自然，符合${dstName}表达习惯，不逐字硬译${termBlock}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: String(text ?? '') }
  ]
}
