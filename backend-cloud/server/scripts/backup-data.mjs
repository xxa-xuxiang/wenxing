// 问星 — 数据库备份：WAL checkpoint 后复制 SQLite 到 DATA_ROOT/backups，保留最近 7 份
// 用法（在 server/）：npm run db:backup
// 说明：仅备份数据库（文档/上传/语料为磁盘文件，按需另行打包）；建议停服后再备份以保证一致性。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_ROOT } from '../lib/data-root.js'
import { db } from '../lib/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKUP_DIR = path.join(DATA_ROOT, 'backups')
const KEEP = 7

/** 本地时间戳：YYYYMMDD-HHmm */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function resolveDbFile() {
  const url = String(process.env.DATABASE_URL || '')
  if (!url.startsWith('file:')) return ''
  const rel = url.slice('file:'.length)
  // Prisma 的 SQLite 相对路径以 schema.prisma 所在目录为基准（server/prisma）
  return path.resolve(__dirname, '..', 'prisma', rel)
}

function prune() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => /^wenxing-.*\.db$/.test(n))
    .sort()
  for (const name of files.slice(0, Math.max(0, files.length - KEEP))) {
    fs.unlinkSync(path.join(BACKUP_DIR, name))
  }
}

async function main() {
  // 把 WAL 落回主库，避免复制到只含部分事务的 db 文件
  await db.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
  const src = resolveDbFile()
  if (!src || !fs.existsSync(src)) {
    console.error(`数据库文件不存在：${src || '(DATABASE_URL 未配置 file: 路径)'}`)
    process.exitCode = 1
    return
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const target = path.join(BACKUP_DIR, `wenxing-${stamp()}.db`)
  fs.copyFileSync(src, target)
  prune()
  const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1)
  console.log(`✓ 已备份 ${src}`)
  console.log(`→ ${target}（${mb} MB，保留最近 ${KEEP} 份）`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
