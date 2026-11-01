// 问星 — 平台 AI 密钥的运行时配置：AES-256-GCM 加密落盘，管理后台可热切换
// 优先级：用户自带 Key（X-User-Api-Key）> 本模块运行时 Key > DEEPSEEK_API_KEY > 空
// 主密钥来自 AI_KEY_ENC_SECRET（≥32 位）；缺失时仍可读环境变量，但禁止写入运行时 Key
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_ROOT } from './data-root.js'
import { createLogger } from './logger.js'

const log = createLogger('ai-key')

const KEY_FILE = path.join(DATA_ROOT, 'ai-provider-key.json')
const MASTER_SECRET = String(process.env.AI_KEY_ENC_SECRET || '')
const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/

let runtimeKey = ''
let updatedAt = ''
let updatedBy = ''

/** 主密钥（sha256 派生 32 字节）；未配置或过短返回 null */
function masterKey() {
  if (MASTER_SECRET.length < 32) return null
  return crypto.createHash('sha256').update(MASTER_SECRET, 'utf8').digest()
}

/** 启动时同步解密到内存；失败只告警并按未配置处理 */
function load() {
  if (!fs.existsSync(KEY_FILE)) return
  const master = masterKey()
  if (!master) {
    log.warn('已存在运行时 AI Key 配置，但 AI_KEY_ENC_SECRET 缺失或过短，已忽略')
    return
  }
  try {
    const raw = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'))
    const decipher = crypto.createDecipheriv('aes-256-gcm', master, Buffer.from(String(raw.iv), 'base64'))
    decipher.setAuthTag(Buffer.from(String(raw.tag), 'base64'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(String(raw.cipher), 'base64')),
      decipher.final()
    ]).toString('utf8')
    if (!KEY_PATTERN.test(plain)) throw new Error('密文解出的 Key 格式不合法')
    runtimeKey = plain
    updatedAt = String(raw.updatedAt || '')
    updatedBy = String(raw.updatedBy || '')
  } catch (e) {
    log.warn('运行时 AI Key 解密失败，按未配置处理：', String(e?.message || e).slice(0, 120))
    runtimeKey = ''
    updatedAt = ''
    updatedBy = ''
  }
}

load()

/** 掩码：仅保留末 4 位 */
function maskKey(key) {
  const v = String(key || '')
  return v ? `****${v.slice(-4)}` : ''
}

/** 当前生效的平台 Key（不含用户自带） */
export function getRuntimeKey() {
  return runtimeKey || String(process.env.DEEPSEEK_API_KEY || '').trim()
}

/** 密钥状态（永不返回明文） */
export function keyStatus() {
  const envKey = String(process.env.DEEPSEEK_API_KEY || '').trim()
  if (runtimeKey) {
    return { configured: true, source: 'runtime', masked: maskKey(runtimeKey), updatedAt, updatedBy }
  }
  if (envKey) {
    return { configured: true, source: 'env', masked: maskKey(envKey), updatedAt: '', updatedBy: '' }
  }
  return { configured: false, source: 'none', masked: '', updatedAt: '', updatedBy: '' }
}

/**
 * 保存运行时 Key（加密落盘并立即生效）
 * @param {string} plain 明文 Key
 * @param {string} [admin] 操作人
 */
export function setRuntimeKey(plain, admin = '') {
  const key = String(plain || '').trim()
  if (!KEY_PATTERN.test(key)) {
    const err = new Error('API Key 格式不合法（应以 sk- 开头，长度不少于 19 位）')
    err.status = 400
    throw err
  }
  const master = masterKey()
  if (!master) {
    const err = new Error('服务端未配置 AI_KEY_ENC_SECRET，无法保存运行时 Key')
    err.status = 503
    throw err
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', master, iv)
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()])
  const payload = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    cipher: encrypted.toString('base64'),
    updatedAt: new Date().toISOString(),
    updatedBy: String(admin || '')
  }
  fs.mkdirSync(DATA_ROOT, { recursive: true })
  fs.writeFileSync(KEY_FILE, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
  runtimeKey = key
  updatedAt = payload.updatedAt
  updatedBy = payload.updatedBy
  return keyStatus()
}

/** 清除运行时 Key（回退到环境变量 / 未配置） */
export function clearRuntimeKey() {
  try {
    if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE)
  } catch (e) {
    const err = new Error(`删除运行时 Key 失败：${e?.message || e}`)
    err.status = 500
    throw err
  }
  runtimeKey = ''
  updatedAt = ''
  updatedBy = ''
  return keyStatus()
}
