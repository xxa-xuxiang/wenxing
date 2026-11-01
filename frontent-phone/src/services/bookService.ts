// 社区书籍书架：检索 / 下载入库 / 上传 / 列表 / 删除〔自桌面端移植〕
import { apiUrl } from './apiBase'
import { http } from './http'
import type { BookItem } from '@/types'

export interface BookCandidate {
  title: string
  author?: string
  url: string
  format: 'pdf' | 'epub' | 'txt' | 'md' | 'mobi' | 'azw3' | 'html'
  license?: string
  note?: string
  domain: string
}

export function listBooks(
  params: { industry?: string; q?: string } = {}
): Promise<{ items: BookItem[] }> {
  const usp = new URLSearchParams()
  if (params.industry) usp.set('industry', params.industry)
  if (params.q) usp.set('q', params.q)
  const qs = usp.toString()
  return http<{ items: BookItem[] }>(`/api/books${qs ? `?${qs}` : ''}`, { timeout: 10000 })
}

export function searchBooks(input: {
  query?: string
  module?: string
  industry?: string
}): Promise<{ items: BookCandidate[] }> {
  return http<{ items: BookCandidate[] }>('/api/books/search', {
    method: 'POST',
    body: JSON.stringify(input),
    timeout: 60000
  })
}

export function importBookByUrl(input: {
  url: string
  license: string
  title?: string
  author?: string
  industry?: string
  tags?: string
}): Promise<{ ok: boolean; item: BookItem }> {
  return http<{ ok: boolean; item: BookItem }>('/api/books/import-url', {
    method: 'POST',
    body: JSON.stringify(input),
    timeout: 120000
  })
}

export function uploadBook(input: {
  file: File
  cover?: File | null
  title?: string
  author?: string
  license?: string
  industry?: string
  tags?: string
}): Promise<{ ok: boolean; item: BookItem }> {
  const form = new FormData()
  form.append('file', input.file)
  if (input.cover) form.append('cover', input.cover)
  for (const key of ['title', 'author', 'license', 'industry', 'tags'] as const) {
    const v = input[key]
    if (v) form.append(key, v)
  }
  // 不手动设 Content-Type：浏览器需自行补 multipart boundary
  return http<{ ok: boolean; item: BookItem }>('/api/books/upload', {
    method: 'POST',
    body: form,
    timeout: 120000
  })
}

export function deleteBook(id: string): Promise<{ ok: boolean }> {
  return http<{ ok: boolean }>(`/api/books/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getBook(id: string): Promise<{ item: BookItem }> {
  return http<{ item: BookItem }>(`/api/books/${encodeURIComponent(id)}`, { timeout: 10000 })
}

export function bookFileUrl(id: string): string {
  return apiUrl(`/api/books/${encodeURIComponent(id)}/file`)
}
export function bookCoverUrl(item: BookItem): string {
  if (!item.coverUrl) return ''
  return apiUrl(item.coverUrl)
}
