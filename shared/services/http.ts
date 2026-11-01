// 问星 — 统一 HTTP 出口（桌面端与手机端共用，唯一实现）
// 所有 service 的底层请求收敛于此：自动注入 Bearer token、统一错误、统一基地址拼接。
// 仅 chatStream 这类需要读取流式响应（res.body.getReader()）的场景保留独立实现，
// 通过 authHeaders() 复用 token 注入逻辑，避免各处重复拼 header。
// 基地址 / 鉴权 / storage 由各端通过 `@` 别名提供（apiBase、authService、utils/storage）。
import { apiUrl } from '@/services/apiBase'
import { getToken } from '@/services/authService'
import { storage } from '@/utils/storage'

/** 用户自定义 API Key 在 global 命名空间的存储键 */
const USER_API_KEY = 'wx:userApiKey'

/** 统一请求错误：携带 HTTP 状态码与后端业务错误码，便于调用方区分 401 / 404 / 429 等 */
export class ApiError extends Error {
  /** HTTP 状态码（网络层失败时为空） */
  status?: number
  /** 后端业务错误码（如 ACCOUNT_DISABLED / AI_QUOTA；响应体未提供时为空） */
  code?: string

  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** 统一请求选项：在 fetch 的 RequestInit 基础上增加 timeout */
export interface HttpInit extends RequestInit {
  /** 超时毫秒；仅在未传入自定义 signal 时生效（AbortSignal.timeout） */
  timeout?: number
}

/**
 * 注入 Bearer token：有 token 才附加 Authorization（保留现有行为）
 * extra 中显式传入的同名头会被这里的 Authorization 覆盖，与旧实现一致。
 */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken()
  const headers: Record<string, string> = { ...extra }
  if (token) headers.Authorization = `Bearer ${token}`
  // 用户自定义 API Key：后端优先使用，留空则后端走默认 Key
  const userKey = storage.getGlobal<string>(USER_API_KEY, '').trim()
  if (userKey) headers['X-User-Api-Key'] = userKey
  return headers
}

/**
 * 统一请求出口：path 为 `/api/...` 形式，内部经 apiUrl 拼接基地址。
 * - 自动注入 Authorization（authHeaders），调用方无需再手动拼 token
 * - body 为字符串且调用方未指定 Content-Type 时，统一补 application/json
 *   （浏览器对字符串 body 的默认是 text/plain，会让后端 express.json() 解析不到请求体）
 * - !res.ok 时先取后端 { error } 字段，失败回落「后端错误 <status>」，抛出 ApiError
 * - 成功返回 res.json() as T
 * - 自定义 signal 优先；否则在有 timeout 时使用 AbortSignal.timeout
 */
export async function http<T>(path: string, init: HttpInit = {}): Promise<T> {
  const { timeout, headers, signal, ...rest } = init
  const finalHeaders: Record<string, string> = { ...((headers as Record<string, string>) ?? {}) }
  if (typeof rest.body === 'string' && !Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    finalHeaders['Content-Type'] = 'application/json'
  }
  const finalSignal = signal ?? (timeout != null ? AbortSignal.timeout(timeout) : undefined)
  const res = await fetch(apiUrl(path), {
    ...rest,
    headers: authHeaders(finalHeaders),
    signal: finalSignal
  })
  if (!res.ok) {
    let msg = `后端错误 ${res.status}`
    let code: string | undefined
    try {
      const data = (await res.json()) as { error?: string; code?: string }
      msg = data.error ?? msg
      code = typeof data.code === 'string' ? data.code : undefined
    } catch {
      /* 保留默认信息 */
    }
    // 账号被禁用：广播全局事件，由各端根组件统一退出并跳转登录页
    if (code === 'ACCOUNT_DISABLED' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wx:account-disabled'))
    }
    throw new ApiError(msg, res.status, code)
  }
  return (await res.json()) as T
}
