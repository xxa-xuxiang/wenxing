// 术语库种子导入：seed/terms.zh-en.json → TermEntry（按 zh+en+domain 幂等 upsert）
// 用法：node scripts/seed-terms.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_FILE = path.join(__dirname, '..', 'seed', 'terms.zh-en.json')

const db = new PrismaClient()

async function main() {
  const raw = fs.readFileSync(SEED_FILE, 'utf8')
  const groups = JSON.parse(raw)
  let total = 0
  for (const [domain, items] of Object.entries(groups)) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const zh = String(item?.zh ?? '').trim()
      const en = String(item?.en ?? '').trim()
      if (!zh || !en) continue
      await db.termEntry.upsert({
        where: { zh_en_domain: { zh, en, domain } },
        update: { note: String(item?.note ?? ''), status: 'active' },
        create: { zh, en, domain, note: String(item?.note ?? ''), status: 'active' }
      })
      total += 1
    }
    console.log(`[seed] ${domain}: ${items.length} 条`)
  }
  const count = await db.termEntry.count()
  console.log(`[seed] 写入 ${total} 条，术语库现有 ${count} 条`)
}

main()
  .catch((e) => {
    console.error('[seed] 失败：', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
