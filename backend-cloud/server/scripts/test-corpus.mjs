// 问星 v1.1 — 语料链路联调脚本（发现→抓取→切块入库→向量检索）
// 用法（在 server/）：node --env-file=.env scripts/test-corpus.mjs "叶子名片段"
import { retrieveChunks, corpusStats, corpusDb as db } from '../lib/corpus.js'
import { materializeForLeaf } from '../lib/web-fetch.js'

const nameQ = process.argv[2] || '闭包'

async function main() {
  const leaf = await db.skillLeaf.findFirst({
    where: { industry: '信息技术与软件', name: { contains: nameQ } }
  })
  if (!leaf) {
    console.log(`未找到含「${nameQ}」的叶子`)
    return
  }
  console.log('叶子：', leaf.pathText)
  console.log('leafKey：', leaf.leafKey)

  console.log('抓取中…')
  const mat = await materializeForLeaf(leaf, { maxPages: 3 })
  console.log('抓取结果：', JSON.stringify(mat, null, 2))

  const hits = await retrieveChunks(`${leaf.stack} ${leaf.name}`, {
    industry: leaf.industry,
    topK: 5
  })
  console.log('\nTop5 相关切块：')
  for (const h of hits) {
    console.log(`- [${h.score.toFixed(3)}] ${h.title} <${h.url}>`)
    console.log(`  ${h.text.slice(0, 100).replace(/\n/g, ' ')}…`)
  }
  console.log('\n语料库规模：', await corpusStats())
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
