// 问星 v1.5 — 翻译服务：直连后端翻译接口（不经聊天链路）
import { http } from './http'

export interface TranslateTerm {
  zh: string
  en: string
  note?: string
}

export interface TranslateResult {
  source: string
  translation: string
  fromLang: 'zh' | 'en'
  toLang: 'zh' | 'en'
  terms: TranslateTerm[]
  cached: boolean
  elapsedMs: number
}

export interface TermEntry {
  id: string
  zh: string
  en: string
  domain: string
  note: string
}

/** 翻译（to=auto 时后端按原文自动判定并反向） */
export async function translate(
  text: string,
  to: 'auto' | 'zh' | 'en' = 'auto',
  domain = 'general'
): Promise<TranslateResult> {
  return http<TranslateResult>('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, to, domain }),
    timeout: 60000
  })
}

/** 术语库检索 */
export async function searchTerms(
  q = '',
  domain = '',
  limit = 100
): Promise<{ items: TermEntry[]; total: number }> {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (domain) params.set('domain', domain)
  params.set('limit', String(limit))
  return http<{ items: TermEntry[]; total: number }>(`/api/translate/terms?${params.toString()}`)
}
