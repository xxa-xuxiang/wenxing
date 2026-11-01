// 问星 v1.4 — 星图反馈存储：读取 / 删除 data/feedback/<行业>.md 中的条目
// v1.8：反馈处理状态存于 sidecar _status.json（键 = `${industry}|${time}`），不改动 MD 正文格式
import fs from 'node:fs'
import path from 'node:path'
import { DATA_ROOT, safeName } from './docs-store.js'
import { safeWriteFile, safeRemove } from './fs-safe.js'

const FEEDBACK_DIR = path.join(DATA_ROOT, 'feedback')
const STATUS_FILE = path.join(FEEDBACK_DIR, '_status.json')
// 每条反馈以「## 时间（来源：xxx）」开头
const ITEM_RE = /^##\s+(.+?)（来源：(.+?)）\s*\n+([\s\S]*)$/

export const FEEDBACK_STATUS = ['pending', 'processing', 'done']

function statusKey(industry, time) {
  return `${industry}|${time}`
}

/** 读取状态表（文件缺失/损坏时返回空表） */
function readStatusMap() {
  try {
    if (!fs.existsSync(STATUS_FILE)) return {}
    const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function writeStatusMap(map) {
  if (!fs.existsSync(FEEDBACK_DIR)) fs.mkdirSync(FEEDBACK_DIR, { recursive: true })
  safeWriteFile(STATUS_FILE, JSON.stringify(map, null, 2))
}

/**
 * 设置反馈处理状态
 * @returns {boolean} 状态值是否合法并已写入
 */
export function setFeedbackStatus({ industry, time, status }) {
  if (!FEEDBACK_STATUS.includes(status)) return false
  const map = readStatusMap()
  map[statusKey(industry, time)] = { status, updatedAt: new Date().toISOString() }
  writeStatusMap(map)
  return true
}

/** 读取全部反馈，按时间倒序；合并处理状态（默认 pending） */
export function readFeedback() {
  if (!fs.existsSync(FEEDBACK_DIR)) return []
  const statusMap = readStatusMap()
  const items = []
  for (const f of fs.readdirSync(FEEDBACK_DIR).filter((x) => x.endsWith('.md'))) {
    const industry = f.replace(/\.md$/, '')
    const text = fs.readFileSync(path.join(FEEDBACK_DIR, f), 'utf-8')
    const blocks = text.split(/\n(?=## )/).filter((b) => b.trim().startsWith('## '))
    for (const b of blocks) {
      const m = b.match(ITEM_RE)
      if (!m) continue
      const time = m[1].trim()
      const st = statusMap[statusKey(industry, time)]
      items.push({
        industry,
        time,
        source: m[2].trim(),
        content: m[3].trim(),
        status: st?.status || 'pending',
        statusUpdatedAt: st?.updatedAt || null
      })
    }
  }
  items.sort((a, b) => (new Date(b.time).getTime() || 0) - (new Date(a.time).getTime() || 0))
  return items
}

/** 反馈总条数 */
export function feedbackCount() {
  return readFeedback().length
}

/**
 * 删除反馈：time 为空时清空该行业全部反馈，否则只删除该时间的条目
 * 同步清理对应的状态记录
 * @returns {number} 被删除条数
 */
export function deleteFeedback({ industry, time }) {
  const name = safeName(String(industry || ''))
  if (!industry) return 0
  const full = path.join(FEEDBACK_DIR, `${name}.md`)
  if (!fs.existsSync(full)) return 0

  const text = fs.readFileSync(full, 'utf-8')
  const target = String(time || '').trim()

  if (!target) {
    const removed = readFeedback().filter((i) => i.industry === name).length
    if (removed > 0) {
      safeRemove(full)
      const map = readStatusMap()
      let dirty = false
      for (const k of Object.keys(map)) {
        if (k.startsWith(`${name}|`)) {
          delete map[k]
          dirty = true
        }
      }
      if (dirty) writeStatusMap(map)
    }
    return removed
  }

  let removed = 0
  const kept = []
  for (const part of text.split(/\n(?=## )/)) {
    const m = part.match(ITEM_RE)
    if (m && m[1].trim() === target) {
      removed += 1
      continue
    }
    kept.push(part)
  }
  if (removed > 0) {
    const next = kept.join('\n').trim()
    if (next) {
      safeWriteFile(full, `${next}\n`)
    } else {
      safeRemove(full)
    }
    const map = readStatusMap()
    if (map[statusKey(name, target)]) {
      delete map[statusKey(name, target)]
      writeStatusMap(map)
    }
  }
  return removed
}
