// 问星 — 文档向量库：Embedding 调用（OpenAI 兼容协议）+ Markdown 切块 + 余弦相似度
// 配置经环境变量：EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL
// 未配置 API_KEY 时检索端自动降级为标题/标签匹配，索引端返回 503

const EMBEDDING_BASE = () => process.env.EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1'

/** 当前使用的 embedding 模型名（入库 DocVector.model） */
export function embeddingModel() {
  return process.env.EMBEDDING_API_KEY
    ? process.env.EMBEDDING_MODEL || 'BAAI/bge-large-zh-v1.5'
    : 'local-hash-512'
}

/** 是否已配置远端 Embedding（有 API_KEY 即视为可用） */
export function isEmbeddingConfigured() {
  return Boolean(process.env.EMBEDDING_API_KEY)
}

/** 当前向量提供方：remote=远端 API，local=本地哈希嵌入（零成本兜底） */
export function embeddingProvider() {
  return isEmbeddingConfigured() ? 'remote' : 'local'
}

// ===== 本地哈希嵌入（无外部依赖）：中文一元+二元分词、英文数字按词，FNV 哈希到 512 维后 L2 归一化 =====
const LOCAL_DIM = 512

function localTokens(text) {
  const t = String(text).toLowerCase()
  const tokens = []
  for (const m of t.matchAll(/[a-z0-9_+#.]{2,}/g)) tokens.push(m[0])
  for (const seg of t.match(/[一-龥]+/g) ?? []) {
    for (let i = 0; i < seg.length; i++) {
      tokens.push(seg[i])
      if (i + 1 < seg.length) tokens.push(seg.slice(i, i + 2))
    }
  }
  return tokens
}

function fnv1a(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 本地嵌入：词频哈希向量（L2 归一化），余弦相似度可直接用 */
export function embedLocal(texts) {
  return texts.map((text) => {
    const v = new Array(LOCAL_DIM).fill(0)
    for (const tok of localTokens(text)) v[fnv1a(tok) % LOCAL_DIM] += 1
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  })
}

/**
 * 批量向量化文本：POST {base}/embeddings（OpenAI 兼容），Bearer 鉴权，30s 超时
 * @param {string[]} texts
 * @returns {Promise<number[][]>} 与输入等长、维度一致的向量数组
 */
export async function embed(texts) {
  const key = process.env.EMBEDDING_API_KEY
  // 未配置远端 API 时自动使用本地哈希嵌入（零成本兜底，离线可用）
  if (!key) return embedLocal(texts)
  const input = texts.map((t) => String(t))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(`${EMBEDDING_BASE()}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: embeddingModel(), input }),
      signal: controller.signal
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      throw new Error(`Embedding 接口错误 ${res.status}${detail ? `：${detail}` : ''}`)
    }
    const data = await res.json()
    const list = data?.data
    if (!Array.isArray(list) || list.length !== input.length) {
      throw new Error('Embedding 返回数量与输入不一致')
    }
    const vectors = list.map((d) => d?.embedding)
    const dim = vectors[0]?.length
    if (!dim) throw new Error('Embedding 返回为空')
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== dim) throw new Error('Embedding 返回维度不一致')
    }
    return vectors
  } finally {
    clearTimeout(timer)
  }
}

const CHUNK_MAX = 500 // 目标块长（字）
const CHUNK_MIN = 30 // 过短碎块丢弃

// 超长块硬切：优先按句号/换行，仍超长则按定长截断
function hardSplit(text) {
  const parts = []
  let buf = ''
  for (const seg of text.split(/(?<=[。！？；!?;])|\r?\n/)) {
    if (buf && buf.length + seg.length > CHUNK_MAX) {
      parts.push(buf)
      buf = seg
    } else {
      buf += seg
    }
  }
  if (buf) parts.push(buf)
  const out = []
  for (const p of parts) {
    if (p.length <= CHUNK_MAX) {
      out.push(p)
    } else {
      for (let i = 0; i < p.length; i += CHUNK_MAX) out.push(p.slice(i, i + CHUNK_MAX))
    }
  }
  return out.map((s) => s.trim()).filter(Boolean)
}

/**
 * Markdown 切块：去 frontmatter 后按标题（#{1,3}）与空行切段，
 * 贪心合并至 ≤500 字，超长块按句号/换行硬切，丢弃 <30 字碎块
 * @param {string} md
 * @returns {string[]}
 */
export function chunkMarkdown(md) {
  const text = String(md ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  // 1) 按标题与空行切成基础段
  const blocks = []
  let cur = []
  const flushBlock = () => {
    if (cur.length) {
      blocks.push(cur.join('\n'))
      cur = []
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,3}\s/.test(line)) {
      flushBlock()
      cur = [line]
    } else if (line.trim() === '') {
      flushBlock()
    } else {
      cur.push(line)
    }
  }
  flushBlock()
  // 2) 贪心合并 ≤500 字；单段超长则硬切
  const chunks = []
  let buf = ''
  const flushBuf = () => {
    if (buf.trim()) chunks.push(buf.trim())
    buf = ''
  }
  for (const b of blocks) {
    const t = b.trim()
    if (!t) continue
    if (t.length > CHUNK_MAX) {
      flushBuf()
      chunks.push(...hardSplit(t))
    } else if ((buf ? buf.length + t.length + 2 : t.length) > CHUNK_MAX) {
      flushBuf()
      buf = t
    } else {
      buf = buf ? `${buf}\n\n${t}` : t
    }
  }
  flushBuf()
  return chunks.filter((c) => c.length >= CHUNK_MIN)
}

/** 余弦相似度（任一零向量返回 0） */
export function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}
