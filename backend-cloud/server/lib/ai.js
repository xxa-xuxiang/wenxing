// 问星 — DeepSeek 统一调用（OpenAI 兼容协议）+ 通用错误包装
// 从 index.js 抽取，供 plan 等新路由复用；Key 只存在服务端（.env 或后台加密配置），不经浏览器
// 用户可在个人中心填写自己的 API Key，通过 X-User-Api-Key 头传入，优先于平台 Key
import { getRuntimeKey } from './ai-key-store.js'
import { AsyncLocalStorage } from 'node:async_hooks'

/** 解析最终使用的 API Key：用户自带 > 后台运行时配置 > 环境变量；全部缺失时抛 503 */
function resolveKey(userApiKey) {
  const key = String(userApiKey || '').trim() || getRuntimeKey()
  if (!key) {
    const err = new Error('平台 AI 密钥未配置，请在管理后台配置或设置 DEEPSEEK_API_KEY')
    err.status = 503
    throw err
  }
  return key
}

// ===== tokens 采集（计费台账用）=====
// 不改 deepseek/deepseekStream 返回结构（大量调用点依赖纯字符串/generator），
// usage 记录在请求级 AsyncLocalStorage 上下文中，调用点在同请求内用 takeLastUsage() 取用。
// 此前用模块级全局变量，并发请求会互相覆盖导致计费串号。
const emptyUsage = () => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
const usageContext = new AsyncLocalStorage()
// 无请求上下文的调用（后台任务/脚本）仍走模块级兜底
let lastUsage = emptyUsage()

/** 在请求级上下文中执行后续中间件/处理逻辑，隔离并发请求的 tokens 记录 */
export function runInUsageContext(fn) {
  return usageContext.run({ lastUsage: emptyUsage() }, fn)
}

/** 取出「当前请求」最近一次 AI 调用的 usage 并清零 */
export function takeLastUsage() {
  const store = usageContext.getStore()
  if (!store) {
    const usage = lastUsage
    lastUsage = emptyUsage()
    return usage
  }
  const usage = store.lastUsage
  store.lastUsage = emptyUsage()
  return usage
}

/** 从响应 usage 对象提取并记录 tokens（拿不到记 0，不影响收入计算） */
function recordUsage(usage) {
  const prompt = Math.max(0, Math.round(Number(usage?.prompt_tokens) || 0))
  const completion = Math.max(0, Math.round(Number(usage?.completion_tokens) || 0))
  const total = Math.max(0, Math.round(Number(usage?.total_tokens) || 0)) || prompt + completion
  const next = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total }
  const store = usageContext.getStore()
  if (store) store.lastUsage = next
  else lastUsage = next
}

// ===== DeepSeek 非流式调用 =====
export async function deepseek(messages, jsonMode = false, userApiKey = '') {
  const key = resolveKey(userApiKey)
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const body = { model, messages, temperature: 0.7, stream: false }
  if (jsonMode) body.response_format = { type: 'json_object' }
  const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 120000

  // 计划 Agent 单阶段（尤其「计划制定」）输出较长，容易触顶 60s：
  // 超时/网络/429/5xx 时自动重试一次，避免整条计划链因一次抖动失败
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200)
        const err = new Error(`DeepSeek 接口错误 ${res.status}${detail ? `：${detail}` : ''}`)
        err.status = res.status
        throw err
      }
      const data = await res.json()
      // 记录本次调用 tokens（计费台账用，拿不到记 0）
      recordUsage(data.usage)
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('DeepSeek 返回为空')
      return content
    } catch (e) {
      const retryable =
        e?.name === 'AbortError' ||
        e?.status === 429 ||
        (typeof e?.status === 'number' && e.status >= 500) ||
        e?.message === 'DeepSeek 返回为空' ||
        /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(String(e?.message || ''))
      if (attempt === 1 || !retryable) throw e
      await new Promise((r) => setTimeout(r, 1200))
    } finally {
      clearTimeout(timer)
    }
  }
}

// ===== DeepSeek 流式调用：返回 async generator，逐个 yield 文本片段 =====
export async function* deepseekStream(messages, userApiKey = '') {
  const key = resolveKey(userApiKey)
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.7, stream: true }),
      signal: controller.signal
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      throw new Error(`DeepSeek 接口错误 ${res.status}${detail ? `：${detail}` : ''}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t || !t.startsWith('data: ')) continue
        const payload = t.slice(6)
        if (payload === '[DONE]') return
        try {
          const obj = JSON.parse(payload)
          // SSE 末 chunk 可能带 usage（计费台账用，拿到即覆盖，最后一次为准）
          if (obj.usage) recordUsage(obj.usage)
          const delta = obj.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch {
          /* 忽略非 JSON 行 */
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

// 统一错误包装：AI/文件错误返回 502 + error 信息；密钥未配置等 503 原样透出
export const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res)
  } catch (e) {
    res.status(e?.status === 503 ? 503 : 502).json({ error: e?.message || 'AI 调用失败' })
  }
}
