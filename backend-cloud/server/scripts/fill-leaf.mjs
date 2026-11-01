// 问星 v1.1 — 单叶子出题试跑（P3 验收用）
// 用法（在 server/）：
//   node --env-file=.env scripts/fill-leaf.mjs "Apache Kafka" [--no-web]
import { fillLeaf } from '../lib/question-pipeline.js'
import { corpusDb as db } from '../lib/corpus.js'

const nameArg = process.argv[2]
if (!nameArg) {
  console.error('用法：node scripts/fill-leaf.mjs "叶子名片段" [--no-web] [--reset]')
  process.exit(1)
}
const fetchWeb = !process.argv.includes('--no-web')
const reset = process.argv.includes('--reset')

async function main() {
  const leaf = await db.skillLeaf.findFirst({
    where: { name: { contains: nameArg } },
    orderBy: { industry: 'asc' }
  })
  if (!leaf) {
    console.error(`未找到含「${nameArg}」的叶子`)
    process.exit(1)
  }
  console.log('目标叶子：', leaf.pathText)
  console.log('leafKey：', leaf.leafKey, '| 联网补语料：', fetchWeb, '| 重置重建：', reset)
  if (reset) {
    const audits = await db.questionAudit.findMany({ where: { question: { leafId: leaf.id } }, select: { id: true } })
    await db.questionAudit.deleteMany({ where: { id: { in: audits.map((a) => a.id) } } })
    const removed = await db.question.deleteMany({ where: { leafId: leaf.id } })
    await db.fillJobItem.update({
      where: { leafKey: leaf.leafKey },
      data: { status: 'pending', verifiedCount: 0, attempts: 0, lastError: '' }
    })
    console.log(`已清空旧题 ${removed.count} 道与审计记录，任务重置为 pending`)
  }
  const t0 = Date.now()
  const r = await fillLeaf(leaf, { fetchWeb })
  console.log('\n=== 填充结果 ===')
  console.log(JSON.stringify(r, null, 2), `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const verified = await db.question.findMany({
    where: { leafId: leaf.id, status: 'verified' },
    orderBy: [{ type: 'asc' }, { difficulty: 'asc' }]
  })
  console.log(`\n=== verified 题目 ${verified.length} 道 ===`)
  for (const q of verified) {
    const src = JSON.parse(q.sources || '[]')
    console.log(`\n[${q.type}/${q.difficulty}] ${q.title}`)
    console.log(`题干：${q.body.slice(0, 200)}`)
    if (JSON.parse(q.options || '[]').length) console.log(`选项：${JSON.parse(q.options).join(' | ')}`)
    console.log(`答案：${q.answer}`)
    console.log(`解析：${q.explanation}`)
    console.log(`出处：${src.map((s) => s.url).join(' , ')}`)
  }
  const rejects = await db.questionAudit.findMany({
    where: { question: { leafId: leaf.id }, verdict: 'rejected' },
    select: { reason: true }
  })
  if (rejects.length) {
    console.log(`\n=== 驳回留痕 ${rejects.length} 条 ===`)
    for (const a of rejects.slice(0, 10)) console.log('-', a.reason)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
