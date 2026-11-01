// 问星 v1.7 — 教材服务：epub 上传解析 + 分节正文读取
// 注意：上传走原始二进制，不能用 http()（它会给字符串 body 补 application/json）
import { apiUrl } from './apiBase'
import { authHeaders, ApiError, http } from './http'
import type { TextbookImportResult, TextbookNode } from '@/types/textbook'

/** 上传并解析 epub（≤80MB）；超时 60s */
export async function importEpub(file: File, signal?: AbortSignal): Promise<TextbookImportResult> {
  let res: Response
  try {
    res = await fetch(apiUrl('/api/textbooks/import'), {
      method: 'POST',
      headers: authHeaders({
        'Content-Type': 'application/epub+zip',
        'X-File-Name': encodeURIComponent(file.name)
      }),
      body: file,
      signal: signal ?? AbortSignal.timeout(60000)
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new ApiError('解析超时，请重试或换用更小的 epub')
    }
    throw new ApiError('上传失败，请检查网络与后端服务')
  }
  if (!res.ok) {
    let msg = `后端错误 ${res.status}`
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      /* 保留默认信息 */
    }
    throw new ApiError(msg, res.status)
  }
  return (await res.json()) as TextbookImportResult
}

/** 批量读取章节正文（缺省 ids 时返回全部） */
export async function getSections(slug: string, ids?: string[]): Promise<Record<string, string>> {
  const query = ids && ids.length > 0 ? `?ids=${ids.join(',')}` : ''
  const res = await http<{ slug: string; sections: Record<string, string> }>(
    `/api/textbooks/${slug}/sections${query}`
  )
  return res.sections
}

/** 读取 EPUB 目录树（层级章/节，供阅读器左侧目录） */
export async function getTree(slug: string): Promise<TextbookNode[]> {
  const res = await http<{ slug: string; title: string; nodes: TextbookNode[] }>(
    `/api/textbooks/${slug}/tree`
  )
  return res.nodes ?? []
}
