// 问星 — 文件写盘兜底：原子写 + 删除降级
// 裸 fs.writeFileSync 写一半崩溃会损坏 JSON/MD 数据文件；裸 rmSync 在 Windows 被 Defender 占用时抛 EBUSY/EPERM
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from './logger.js'

const log = createLogger('fs')

/**
 * 原子写：先写同目录临时文件再 rename 覆盖，避免中途失败留下半截文件
 * @param {string} file 目标文件绝对路径
 * @param {string|Buffer} data 内容
 * @returns {boolean}
 */
export function safeWriteFile(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, data, typeof data === 'string' ? 'utf-8' : undefined)
    fs.renameSync(tmp, file)
    return true
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 临时文件清理失败不掩盖原始错误 */
    }
    log.error(`写入失败 ${file}:`, e?.message || e)
    const err = new Error(`文件写入失败：${path.basename(file)}`)
    err.status = 500
    err.code = 'FS_WRITE_FAILED'
    throw err
  }
}

/** 原子写 JSON（自动缩进） */
export function safeWriteJson(file, data) {
  return safeWriteFile(file, JSON.stringify(data, null, 2))
}

/**
 * 追加一行（审计日志用）：失败只告警不阻塞业务
 * @param {string} file 目标文件绝对路径
 * @param {string} line 单行内容（自动补换行）
 * @returns {boolean}
 */
export function safeAppendLine(file, line) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${line}\n`, 'utf-8')
    return true
  } catch (e) {
    log.warn(`追加写入失败 ${file}:`, e?.message || e)
    return false
  }
}

/**
 * 删除文件：不存在视为成功；被占用/无权限时只记录告警并返回 false，不拖垮进程
 * @returns {boolean} 是否已确认删除
 */
export function safeRemove(file) {
  try {
    fs.rmSync(file, { force: true })
    return true
  } catch (e) {
    log.warn(`删除失败 ${file}:`, e?.message || e)
    return false
  }
}
