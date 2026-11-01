// 问星 — 后端 API 基地址管理（云端交付版）
// Web 模式：基地址为空串，/api 走 Vite 代理（开发）或同源部署（生产 Web）
// 桌面模式（Tauri）：后端已上云，基地址解析优先级：
//   1. 设备级 localStorage 自定义（server:apiBase，换服务器无需重新打包）
//   2. 构建时注入的 VITE_API_BASE（打包时的默认云端地址）
//   3. 本地 127.0.0.1:3001-3003 探测（开发兜底：桌面壳直连本机后端）
import { storage } from '../utils/storage'

const TAURI_DETECTED = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const LOCAL_PORTS = [3001, 3002, 3003]
const PROBE_TIMEOUT = 1500
/** 打包时注入的默认云端地址（无协议/路径尾斜杠会被规整） */
const ENV_BASE = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '')
const CUSTOM_KEY = 'server:apiBase'

let base = ''
let ready = !TAURI_DETECTED // Web 模式即刻就绪
let failed = false

export function isTauri(): boolean {
  return TAURI_DETECTED
}

export function apiReady(): boolean {
  return ready
}

export function apiFailed(): boolean {
  return failed
}

/** 请求路径拼接：service 层统一用 apiUrl('/api/...') */
export function apiUrl(path: string): string {
  return base + path
}

/** 当前生效的基地址（失败页/设置页展示用） */
export function currentApiBase(): string {
  return base
}

/** 用户自定义云端地址（设备级存储，不随账号切换） */
export function getCustomApiBase(): string {
  return storage.getGlobal<string>(CUSTOM_KEY, '')
}

/** 设置/清除自定义云端地址：传空串恢复默认（构建注入值 → 本地探测） */
export function setCustomApiBase(url: string): void {
  const v = String(url || '').trim().replace(/\/+$/, '')
  if (v) storage.setGlobal(CUSTOM_KEY, v)
  else storage.removeGlobal(CUSTOM_KEY)
}

async function probe(url: string): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT)
  try {
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 桌面模式按优先级探测基地址；Web 模式直接返回 */
export async function initApiBase(): Promise<void> {
  if (!TAURI_DETECTED) return
  const candidates = [
    getCustomApiBase(),
    ENV_BASE,
    ...LOCAL_PORTS.map((p) => `http://127.0.0.1:${p}`)
  ].filter(Boolean)
  for (const url of candidates) {
    if (await probe(url)) {
      base = url
      ready = true
      failed = false
      return
    }
  }
  failed = true
}

/** 重试页点击后重新探测；成功后整页刷新走完整启动流程 */
export async function retryInitApiBase(): Promise<boolean> {
  await initApiBase()
  return ready
}
