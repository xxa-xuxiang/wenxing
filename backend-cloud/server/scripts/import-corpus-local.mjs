// 问星 v1.1 — 本地授权语料导入：扫描 backend-cloud/data/corpus/<行业>/*.md|txt
// 用于白名单抓不到的小众叶子（人工兜底通道）；frontmatter 支持 title/license
// 用法（在 server/）：node --env-file=.env scripts/import-corpus-local.mjs [行业名]
import fs from 'node:fs'
import path from 'node:path'
import { ingestText, parseFrontmatter, corpusStats, corpusDb as db } from '../lib/corpus.js'
import { DATA_ROOT } from '../lib/data-root.js'

const CORPUS_ROOT = path.join(DATA_ROOT, 'corpus')
const onlyIndustry = process.argv[2] || ''

async function main() {
  if (!fs.existsSync(CORPUS_ROOT)) {
    console.log(`语料目录不存在：${CORPUS_ROOT}（按 <行业>/xxx.md 放置后再跑）`)
    return
  }
  let ingested = 0
  for (const industry of fs.readdirSync(CORPUS_ROOT)) {
    if (onlyIndustry && industry !== onlyIndustry) continue
    const dir = path.join(CORPUS_ROOT, industry)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(md|txt)$/i.test(name)) continue
      const raw = fs.readFileSync(path.join(dir, name), 'utf8')
      const { meta, body } = parseFrontmatter(raw)
      const url = `local://${industry}/${name}`
      try {
        const r = await ingestText({
          url,
          title: String(meta.title || name.replace(/\.(md|txt)$/i, '')),
          siteDomain: 'local',
          industry,
          license: String(meta.license || ''),
          text: body
        })
        ingested += 1
        console.log(`✓ ${industry}/${name} → ${r.chunks} 块（${r.provider}）`)
      } catch (e) {
        console.warn(`✗ ${industry}/${name}: ${e.message}`)
      }
    }
  }
  console.log('---')
  console.log(`本次导入 ${ingested} 篇；语料库现状`, await corpusStats())
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
