// 问星 v1.1 — 公开语料网页采集器（出题 grounding 的「网上公开文本」入口）
// 合规口径：
//   1) 仅发现/抓取 CORPUS_ALLOWED_DOMAINS 白名单内的内容页（搜索引擎只作为发现通道）
//   2) 遵守 robots.txt（User-agent:* 的 Disallow/Allow 前缀规则，最长匹配）
//   3) 礼貌限速：同域请求间隔 ≥1.2s；超时由 CORPUS_FETCH_TIMEOUT_MS 控制
//   4) 只抽取正文文本与标题，不存整页 HTML；出处 URL 随题保留
import { ingestText, isAllowedUrl, corpusDb as db } from './corpus.js'

const UA = 'WenxingQuizBot/1.0 (+local learning app; respects robots.txt)'
// Bing 对机器人 UA 返回降级页（无自然结果），发现请求需用浏览器 UA
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const FETCH_TIMEOUT = Number(process.env.CORPUS_FETCH_TIMEOUT_MS || 15000)
const POLITE_GAP_MS = 1200

// ===== robots.txt（每域内存缓存一次） =====
const robotsCache = new Map() // domain -> {rules:[{allow,pathLen,path}], ts}

async function robotsRules(domain) {
  if (robotsCache.has(domain)) return robotsCache.get(domain)
  let rules = []
  try {
    const res = await fetch(`https://${domain}/robots.txt`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000)
    })
    if (res.ok) {
      const txt = await res.text()
      let applies = false
      const collected = []
      for (const line of txt.split(/\r?\n/)) {
        const m = /^\s*(User-agent|Allow|Disallow)\s*:\s*(.*)$/i.exec(line)
        if (!m) continue
        const k = m[1].toLowerCase()
        const v = m[2].trim()
        if (k === 'user-agent') {
          applies = v === '*'
        } else if (applies && v) {
          collected.push({ allow: k === 'allow', path: v })
        }
      }
      // 最长前缀优先
      rules = collected.map((r) => ({ ...r, pathLen: r.path.length })).sort((a, b) => b.pathLen - a.pathLen)
    }
  } catch {
    rules = [] // 取不到 robots 时不阻断（白名单本身已收口）
  }
  robotsCache.set(domain, rules)
  return rules
}

async function robotsAllowed(urlStr) {
  const u = new URL(urlStr)
  const rules = await robotsRules(u.hostname)
  if (!rules.length) return true
  for (const r of rules) {
    const prefix = r.path.replace(/\*+/g, '').replace(/\$$/, '')
    if (u.pathname.startsWith(prefix)) return r.allow
  }
  return true
}

// ===== 发现通道（按当前网络实测：MDN / Microsoft Learn API 直连可用；
//       Bing 作为白名单域的通用发现入口（site: 限定）；维基百科当前网络不可达，百科有反爬暂不接） =====
const BING_ENDPOINT = 'https://cn.bing.com'

async function searchMdn(query, limit) {
  const out = []
  for (const locale of ['zh-CN', 'en-US']) {
    try {
      const res = await fetch(
        `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=${locale}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT) }
      )
      if (!res.ok) continue
      const data = await res.json()
      for (const d of (data.documents || []).slice(0, limit)) {
        if (d.mdn_url) out.push(`https://developer.mozilla.org${d.md_url}`)
      }
    } catch {
      /* 单通道失败不影响其他通道 */
    }
    if (out.length >= limit) break
  }
  return out
}

async function searchMsLearn(query, limit) {
  const out = []
  try {
    const res = await fetch(
      `https://learn.microsoft.com/api/search?search=${encodeURIComponent(query)}&locale=zh-cn`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT) }
    )
    if (res.ok) {
      const data = await res.json()
      for (const d of (data.results || []).slice(0, limit)) {
        if (d.url) out.push(d.url)
      }
    }
  } catch {
    /* ignore */
  }
  return out
}

/**
 * Bing 通用发现：实测 cn.bing 会忽略 site: 操作符，改为通用检索后在客户端按白名单过滤。
 * 用 2 组查询（术语原名 / 中文教程向）扩大召回，只解析 b_algo 自然结果。
 */
async function searchBingGeneric(query, altQuery = '') {
  const variants = [query, altQuery, `${query} 教程 文档`].filter(Boolean)
  const out = []
  for (const q of variants) {
    try {
      const res = await politeFetch(
        `${BING_ENDPOINT}/search?q=${encodeURIComponent(q)}&count=15&setlang=zh-CN`,
        { ua: UA_BROWSER }
      )
      if (!res.ok) continue
      const html = await res.text()
      const re = /<li[^>]*class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"/gi
      let m
      while ((m = re.exec(html)) && out.length < 12) {
        out.push(m[1].replace(/&amp;/g, '&'))
      }
    } catch {
      /* ignore */
    }
  }
  return out
}

function discoveryProviders() {
  const list = []
  if (isAllowedUrl('https://developer.mozilla.org/docs/Web')) list.push(searchMdn)
  if (isAllowedUrl('https://learn.microsoft.com/')) list.push(searchMsLearn)
  return list
}

function isDiscoveryRedirect(urlStr) {
  try {
    const u = new URL(urlStr)
    return /(^|\.)bing\.com$/.test(u.hostname)
  } catch {
    return false
  }
}

/** 为一个查询发现候选内容页 URL（去重，直链必须在白名单；bing 跳转链延迟到落地时校验）
 *  名额：官方 API 通道各最多 4 条；Bing 通用检索结果按白名单客户端过滤补足，避免来源被单家占满 */
export async function searchCandidates(query, { limit = 10, industry = '', altQuery = '' } = {}) {
  void industry
  const urls = []
  const push = (u) => {
    if (!u || urls.includes(u)) return
    if (isAllowedUrl(u) || isDiscoveryRedirect(u)) urls.push(u)
  }
  const perProvider = Math.min(4, limit)
  for (const provider of discoveryProviders()) {
    try {
      ;(await provider(query, perProvider)).slice(0, perProvider).forEach(push)
    } catch {
      /* ignore */
    }
  }
  for (const u of await searchBingGeneric(query, altQuery)) {
    if (urls.length >= limit) break
    push(u) // 白名单过滤在 push 内完成
  }
  return urls.slice(0, limit)
}

// ===== 正文抽取（零依赖启发式：优先 article/main/百科正文容器） =====
const BLOCK_TAGS = /<(script|style|noscript|iframe|svg|form|nav|header|footer)\b[\s\S]*?<\/\1>/gi
const PREF_CONTAINERS = [
  /<div[^>]+id=["']mw-content-text["'][^>]*>([\s\S]*?)<\/div>\s*<(?:div|noscript|printfooter|catlinks)/i,
  /<article[^>]*>([\s\S]*?)<\/article>/i,
  /<main[^>]*>([\s\S]*?)<\/main>/i
]

function htmlToText(html) {
  let inner = html
  for (const re of PREF_CONTAINERS) {
    const m = re.exec(html)
    if (m) {
      inner = m[1]
      break
    }
  }
  inner = inner.replace(BLOCK_TAGS, ' ')
  inner = inner.replace(/<\/(h[1-6]|p|li|div|tr|br|section)>/gi, '\n')
  inner = inner.replace(/<li[^>]*>/gi, '• ')
  inner = inner.replace(/<[^>]+>/g, '')
  inner = inner
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  return inner
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 2)
    .join('\n')
    .trim()
}

function extractTitle(html, url) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (m) return m[1].replace(/\s+/g, ' ').replace(/[|_].*$/, '').trim().slice(0, 120)
  return url
}

const lastHitAt = new Map() // domain -> ts（礼貌限速）
async function politeFetch(url, { ua = UA_BROWSER, accept = 'text/html,application/xhtml+xml' } = {}) {
  const u = new URL(url)
  const wait = POLITE_GAP_MS - (Date.now() - (lastHitAt.get(u.hostname) || 0))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastHitAt.set(u.hostname, Date.now())
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: accept, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT)
  })
  return res
}

/** 抓取并入库单页；已存在则跳过（除非 force）。允许 Bing 发现跳转链，但落地 URL 必须在白名单 */
export async function fetchAndIngest(url, { industry = '', force = false } = {}) {
  const redirectEntry = isDiscoveryRedirect(url)
  if (!isAllowedUrl(url) && !redirectEntry) throw new Error(`域名不在白名单：${url}`)
  if (!redirectEntry && !(await robotsAllowed(url))) throw new Error(`robots 禁止：${url}`)
  if (!force) {
    const existed = await db.sourceDoc.findUnique({ where: { url }, select: { id: true } })
    if (existed) return { skipped: true, url }
  }
  const res = await politeFetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const finalUrl = res.url || url
  // 发现跳转落地后再校验：非白名单内容域一律丢弃
  if (!isAllowedUrl(finalUrl)) throw new Error(`落地域名不在白名单：${finalUrl}`)
  // 栏目首页/频道页（路径深度 <2）通常与具体技能点无关，丢弃（如 www.stats.gov.cn/sj/）
  const depth = new URL(finalUrl).pathname.split('/').filter(Boolean).length
  if (depth < 2) throw new Error('页面层级过浅，疑似栏目首页，跳过')
  const html = await res.text()
  const text = htmlToText(html)
  if (text.length < 300) throw new Error('正文过短，疑似非内容页')
  const u2 = new URL(finalUrl)
  const r = await ingestText({
    url: finalUrl,
    title: extractTitle(html, finalUrl),
    siteDomain: u2.hostname,
    industry,
    text
  })
  return { skipped: false, url: finalUrl, ...r }
}

/**
 * 为一个技能叶子补齐语料：发现 → 白名单/robots → 抓取前 N 页 → 切块入库
 * @returns {Promise<{found:number,fetched:number,chunks:number,results:Array}>}
 */
export async function materializeForLeaf(leaf, { maxPages = Number(process.env.CORPUS_FETCH_PER_LEAF || 3) } = {}) {
  // 主查询用「技术栈 + 叶子名」提高召回精度（如「Java 多线程与并发」远好于泛词「多线程与并发」）；
  // 备选为叶子名本身，避免技术栈为泛词时反而收窄
  const query = [leaf.stack, leaf.name].filter(Boolean).join(' ') || leaf.name
  const queryAlt = leaf.name
  // 发现多一些候选；只有「新抓取成功入库」才占用名额（已在库的跳过页继续往后找，保证语料来源覆盖面）
  const candidates = await searchCandidates(query, { limit: 8, industry: leaf.industry, altQuery: queryAlt })
  // 独立参考文档优先于平台厂商文档（避免话题被 Azure/AWS 一类厂商资料带偏）
  const rank = (u) => {
    try {
      const h = new URL(u).hostname
      if (/developer\.mozilla\.org|docs\.python\.org|nodejs\.org|cppreference\.com/.test(h)) return 0
      if (/runoob\.com|w3cschool\.cn|w3school\.com\.cn/.test(h)) return 1
      if (/learn\.microsoft\.com/.test(h)) return 3
      return 2
    } catch {
      return 9
    }
  }
  candidates.sort((a, b) => rank(a) - rank(b))
  const results = []
  let chunks = 0
  let fetched = 0
  let skipped = 0
  for (const url of candidates) {
    if (fetched >= maxPages) break
    try {
      const r = await fetchAndIngest(url, { industry: leaf.industry })
      if (r.skipped) {
        skipped += 1
        results.push({ url, ok: true, skipped: true, chunks: r.chunks || 0 })
      } else {
        fetched += 1
        chunks += r.chunks
        results.push({ url, ok: true, skipped: false, chunks: r.chunks })
      }
    } catch (e) {
      results.push({ url, ok: false, error: String(e.message || e).slice(0, 120) })
    }
  }
  return { found: candidates.length, fetched, skipped, chunks, results }
}
