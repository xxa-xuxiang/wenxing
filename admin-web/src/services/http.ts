// 问星管理后台 — 统一 HTTP 请求层

const TOKEN_KEY = 'wenxing:admin:token'

export class ApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 忽略 */
  }
}

function timeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(20000)
  }
  return undefined
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')
  const url = /^https?:\/\//i.test(path) ? path : `${base}${path}`

  const headers = new Headers(init.headers)
  const token = getToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const options: RequestInit = { ...init, headers }
  if (!options.signal) {
    options.signal = timeoutSignal()
  }

  let res: Response
  try {
    res = await fetch(url, options)
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === 'TimeoutError') {
        throw new ApiError('请求超时，请稍后重试')
      }
      if (err.name === 'AbortError') {
        throw new ApiError('请求已取消')
      }
    }
    throw new ApiError(err instanceof Error ? err.message : '网络请求失败')
  }

  if (!res.ok) {
    let message = `请求失败（${res.status}）`
    try {
      const data: unknown = await res.json()
      if (data && typeof data === 'object' && 'error' in data) {
        const error = (data as { error?: unknown }).error
        if (typeof error === 'string' && error) {
          message = error
        }
      }
    } catch {
      /* 响应体不是 JSON 时使用默认文案 */
    }

    if (res.status === 401) {
      clearToken()
      if (!window.location.hash.startsWith('#/login')) {
        window.location.hash = '#/login'
      }
    }
    throw new ApiError(message, res.status)
  }

  if (res.status === 204) {
    return undefined as T
  }

  const text = await res.text()
  if (!text) {
    return undefined as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}
