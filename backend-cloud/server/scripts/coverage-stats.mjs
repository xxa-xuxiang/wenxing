// 问星 v1.1 — 题库覆盖度对账：按行业统计叶子/任务/题目数
// 用法（在 server/）：node --env-file=.env scripts/coverage-stats.mjs
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const TARGET = Number(process.env.QUESTION_TARGET_PER_LEAF || 20)

async function main() {
  const industries = await db.skillLeaf.findMany({
    select: { industry: true },
    distinct: ['industry'],
    orderBy: { industry: 'asc' }
  })
  let gLeaves = 0
  let gFilled = 0
  let gBlocked = 0
  let gQ = 0
  console.log('行业 | 叶子 | 已填满 | blocked | pending/其他 | verified题数 | 覆盖率')
  console.log('-'.repeat(90))
  for (const { industry } of industries) {
    const leaves = await db.skillLeaf.count({ where: { industry } })
    const filled = await db.fillJobItem.count({ where: { leaf: { industry }, status: 'filled' } })
    const blocked = await db.fillJobItem.count({ where: { leaf: { industry }, status: 'blocked' } })
    const questions = await db.question.count({ where: { leaf: { industry }, status: 'verified' } })
    const other = leaves - filled - blocked
    const cover = Math.round((questions / (leaves * TARGET)) * 1000) / 10
    gLeaves += leaves
    gFilled += filled
    gBlocked += blocked
    gQ += questions
    console.log(`${industry} | ${leaves} | ${filled} | ${blocked} | ${other} | ${questions} | ${cover}%`)
  }
  console.log('-'.repeat(90))
  const gCover = Math.round((gQ / (gLeaves * TARGET)) * 1000) / 10
  console.log(`合计 | ${gLeaves} | ${gFilled} | ${gBlocked} | ${gLeaves - gFilled - gBlocked} | ${gQ} | ${gCover}%（目标 ${gLeaves * TARGET} 题）`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
