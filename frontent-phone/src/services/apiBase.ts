// 问星移动端 — API 基地址管理（纯 Web 模式）
// 解析优先级：
//   1. 设备级 localStorage 自定义（server:apiBase，手机端指向任意可达后端，如云端或 PC 局域网 IP）
//   2. 构建时注入的 VITE_API_BASE（打包时指定云端地址）
//   3. 空串 = 走 Vite 代理（开发：手机经 PC 侧代理转发，无跨域）或同源部署（生产）
// 后端 cors 全开，自定义基址直连跨域可用
import { storage } from '@/utils/storage'

const ENV_BASE = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '')
const CUSTOM_KEY = 'server:apiBase'

function resolveBase(): string {
  const custom = storage.getGlobal<string>(CUSTOM_KEY, '').trim().replace(/\/+$/, '')
  if (custom) return custom
  return ENV_BASE
}

/** 当前生效基地址（模块加载时解析；设置页修改后整页刷新生效） */
let base = resolveBase()

/** 请求路径拼接：service 层统一用 apiUrl('/api/...') */
export function apiUrl(path: string): string {
  return base + path
}

/** 当前生效的基地址（设置页展示用） */
export function currentApiBase(): string {
  return base
}

/** 用户自定义云端地址（设备级存储，不随账号切换） */
export function getCustomApiBase(): string {
  return storage.getGlobal<string>(CUSTOM_KEY, '')
}

/** 设置/清除自定义云端地址：传空串恢复默认（构建注入值 → 代理/同源） */
export function setCustomApiBase(url: string): void {
  const v = String(url || '').trim().replace(/\/+$/, '')
  if (v) storage.setGlobal(CUSTOM_KEY, v)
  else storage.removeGlobal(CUSTOM_KEY)
  base = resolveBase()
}
