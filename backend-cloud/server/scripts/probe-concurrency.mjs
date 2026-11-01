// 并发容忍度探测：同时发 N 个最小 chat 请求，测延迟与失败率（决定能否靠提高并发把 9 天压到 1-2 天）
const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const KEY = process.env.DEEPSEEK_API_KEY
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

async function one(i) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: `回复一个字：好（第${i}次）` }],
        max_tokens: 8,
        temperature: 0
      }),
      signal: AbortSignal.timeout(60000)
    })
    const txt = await res.text()
    return { i, ms: Date.now() - t0, status: res.status, err: res.ok ? '' : txt.slice(0, 120) }
  } catch (e) {
    return { i, ms: Date.now() - t0, status: 0, err: String(e.message).slice(0, 120) }
  }
}

const N = Number(process.argv[2] || 12)
const t0 = Date.now()
const results = await Promise.all(Array.from({ length: N }, (_, i) => one(i + 1)))
const wall = Date.now() - t0
const ok = results.filter((r) => r.status === 200)
const lat = ok.map((r) => r.ms).sort((a, b) => a - b)
console.log(`并发 ${N}：成功 ${ok.length}/${N}，墙钟 ${(wall / 1000).toFixed(1)}s`)
if (lat.length) {
  console.log(`  单请求延迟 p50=${lat[Math.floor(lat.length / 2)]}ms p95=${lat[Math.floor(lat.length * 0.95)] || lat[lat.length - 1]}ms`)
}
const bad = results.filter((r) => r.status !== 200)
if (bad.length) {
  console.log('  失败样本:')
  for (const b of bad.slice(0, 5)) console.log(`   #${b.i} status=${b.status} ${b.err}`)
} else {
  console.log('  无失败（未触发 429/限流）')
}
