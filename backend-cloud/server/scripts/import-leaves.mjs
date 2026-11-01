// 问星 v1.1 — 导入 20 个行业分类 md → SkillLeaf 注册表 + FillJobItem 任务账本
// 幂等：重复运行只 upsert 叶子元数据；已存在的 FillJobItem 状态/计数不会被重置
// 用法（在 server/ 目录）：node --env-file=.env scripts/import-leaves.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { parseLeaves } from './lib/industry-leaves.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MD_DIR = path.resolve(__dirname, '../../web/src/data')

// 文件名 → 行业名（与 web/src/data/industriesLazy.ts 注册名一致）
const INDUSTRY_BY_FILE = {
  'industry-classification.md': '信息技术与软件',
  'medical-classification.md': '医疗卫生与生命科学',
  'finance-classification.md': '金融',
  'manufacturing-classification.md': '制造业与工业工程',
  'construction-classification.md': '建筑业与工程建设',
  'transport-classification.md': '交通运输仓储与物流',
  'gov-classification.md': '政府公共治理与国防安全',
  'agriculture-classification.md': '农业林业渔业与食品',
  'education-classification.md': '教育培训研究与知识服务',
  'marketing-classification.md': '营销传媒与创意产业',
  'retail-classification.md': '零售电商与消费品',
  'automotive-classification.md': '汽车出行与智能交通',
  'chemical-classification.md': '化工材料与生物技术',
  'consumer-classification.md': '消费品与服务业',
  'culture-classification.md': '文化体育与娱乐产业',
  'environment-classification.md': '环境水务与城市治理',
  'electronics-classification.md': '通信电子与半导体',
  'aerospace-classification.md': '航空航天与国防工业',
  'mining-classification.md': '矿业冶金与原材料',
  'textile-classification.md': '纺织服装与轻工制造'
}

const db = new PrismaClient()

async function main() {
  let totalLeaves = 0
  let totalUpserted = 0
  let totalJobs = 0
  for (const [file, industry] of Object.entries(INDUSTRY_BY_FILE)) {
    const full = path.join(MD_DIR, file)
    if (!fs.existsSync(full)) {
      console.warn(`[跳过] 文件不存在：${file}`)
      continue
    }
    const leaves = parseLeaves(fs.readFileSync(full, 'utf8'), industry)
    totalLeaves += leaves.length
    let jobs = 0
    // SQLite 原生 INSERT OR IGNORE：首跑批量插入；重跑已存在的 leafKey 跳过，任务状态不重置
    const esc = (v) => String(v ?? '').replace(/'/g, "''")
    for (let i = 0; i < leaves.length; i += 400) {
      const chunk = leaves.slice(i, i + 400)
      const leafRows = chunk
        .map(
          (l) =>
            `('${crypto.randomUUID()}','${esc(l.leafKey)}','${esc(l.industry)}','${esc(l.category)}','${esc(l.domain)}','${esc(l.stack)}','${esc(l.name)}','${esc(l.pathText)}')`
        )
        .join(',')
      await db.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "SkillLeaf" ("id","leafKey","industry","category","domain","stack","name","pathText") VALUES ${leafRows}`
      )
      const jobRows = chunk
        .map(
          (l) => `('${crypto.randomUUID()}','${esc(l.leafKey)}','pending',0,0,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
        )
        .join(',')
      const r = await db.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "FillJobItem" ("id","leafKey","status","verifiedCount","attempts","lastError","createdAt","updatedAt") VALUES ${jobRows}`
      )
      jobs += r
    }
    totalUpserted += leaves.length
    totalJobs += jobs
    console.log(`${industry}：叶子 ${leaves.length}（新任务 ${jobs}）`)
  }
  const [dbLeaves, dbJobs, pending, blocked, filled] = await Promise.all([
    db.skillLeaf.count(),
    db.fillJobItem.count(),
    db.fillJobItem.count({ where: { status: 'pending' } }),
    db.fillJobItem.count({ where: { status: 'blocked' } }),
    db.fillJobItem.count({ where: { status: 'filled' } })
  ])
  console.log('---')
  console.log(`本次解析叶子 ${totalLeaves}，upsert ${totalUpserted}，新建任务 ${totalJobs}`)
  console.log(`库内现状：SkillLeaf ${dbLeaves} / FillJobItem ${dbJobs}（pending ${pending} · filled ${filled} · blocked ${blocked}）`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
