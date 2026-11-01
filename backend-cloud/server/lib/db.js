// 问星 v1.1 — Prisma 客户端单例 + SQLite 并发写入治理
// 铺题 worker 会让 LLM 调用高度并行（实测接口可承受 60 并发），但 SQLite 同一时刻只允许一个写事务：
// 未治理时高并发会撞上 "Socket timeout / database is locked"。
// 这里做两件事：
//   1) 连接后开启 WAL（读多写一，读不被写阻塞）并放宽 busy_timeout
//   2) 导出 serializeWrite()：把写操作串成队列，保证进程内永不争用写锁
import { PrismaClient } from '@prisma/client'
import { createLogger } from './logger.js'

const log = createLogger('db')

export const db = new PrismaClient()

// 初始化 PRAGMA（失败不阻断启动，仅告警）
;(async () => {
  try {
    // PRAGMA 语句可能返回结果行，统一用 $queryRawUnsafe；$executeRawUnsafe 在 Prisma 6 会因「Execute returned results」抛错
    await db.$queryRawUnsafe('PRAGMA journal_mode=WAL')
    await db.$queryRawUnsafe('PRAGMA busy_timeout=15000')
    await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL')
  } catch (e) {
    log.warn('SQLite PRAGMA 初始化失败：', String(e?.message || e).slice(0, 120))
  }
})()

/** 串行化的写队列：所有写操作排成一条链，避免 SQLite 写锁争用 */
let writeQueue = Promise.resolve()

/**
 * 把一个写操作排入串行队列
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function serializeWrite(fn) {
  const run = writeQueue.then(() => fn())
  // 队列自身吞掉异常，避免一次失败卡死后续所有写入
  writeQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
