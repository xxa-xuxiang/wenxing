// 教科书级目录树生成：按学习模块产出「卷/章/节」三层结构（仅返回 JSON，不落盘）
import { deepseek, takeLastUsage } from './ai.js'

function parseJson(raw) {
  let text = String(raw || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  return JSON.parse(text)
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
const arr = (v) => (Array.isArray(v) ? v : [])

function normalizeNode(raw, level) {
  const title = str(raw?.title)
  if (!title) return null
  const node = {
    title,
    level,
    pages: Math.max(1, Math.round(num(raw?.pages, level === 'volume' ? 120 : level === 'chapter' ? 30 : 8))),
    hours: Math.max(0.5, Number(num(raw?.hours, level === 'volume' ? 12 : level === 'chapter' ? 3 : 0.8).toFixed(1)))
  }
  if (level !== 'section') {
    const children = arr(raw?.children)
      .map((c) => normalizeNode(c, level === 'volume' ? 'chapter' : 'section'))
      .filter(Boolean)
    if (children.length) node.children = children
  }
  return node
}

/**
 * @param {object} input { domain, modules: [{name, goal, items}], timeBudget, goal30 }
 * @param {{ userApiKey?: string }} opts
 */
export async function buildTextbookOutline(input = {}, { userApiKey = '' } = {}) {
  const domain = str(input.domain) || '未指定'
  const modules = arr(input.modules)
  const moduleText = modules
    .map((m, i) => {
      const items = arr(m?.items).map(str).filter(Boolean).join('、')
      return `${i + 1}. ${str(m?.name)}：${str(m?.goal) || '无目标'}${items ? `（知识点：${items}）` : ''}`
    })
    .join('\n')

  const messages = [
    {
      role: 'system',
      content: `你是「问星」的教材结构设计师。为每个学习模块生成教科书级的目录树。

硬规则：
1. 只返回 JSON，不要解释，不要 Markdown 围栏。
2. 每个模块一棵树，三层：volume（卷）/ chapter（章）/ section（节），section 为叶子。
3. 卷 1-2 个，每卷 2-4 章，每章 2-5 节；标题要像正式教材（如「第 1 章 环境与工具链」），不要空泛。
4. 每层给 pages（预计页数）与 hours（预计学时），数值按用户时间预算合理估。
5. 目录必须覆盖模块内的知识点，不引入无关学科。
6. 返回结构：
{"modules":[{"module":"模块名","goal":"","tree":[{"title":"第一卷 ...","level":"volume","pages":120,"hours":12,"children":[{"title":"第 1 章 ...","level":"chapter","pages":30,"hours":3,"children":[{"title":"1.1 ...","level":"section","pages":8,"hours":0.8}]}]}]}],
"summary":"一句话总览（总页数/总学时/建议使用方式）"}`
    },
    {
      role: 'user',
      content: `行业：${domain}
30 天目标：${str(input.goal30) || '未指定'}
时间预算：${str(input.timeBudget) || '未指定'}

学习模块：
${moduleText || '（无，请按行业给 3 个通用模块）'}`
    }
  ]

  const raw = await deepseek(messages, true, userApiKey)
  const tokens = takeLastUsage().total_tokens
  const data = parseJson(raw)

  const out = arr(data?.modules)
    .map((m, i) => {
      const tree = arr(m?.tree)
        .map((v) => normalizeNode(v, 'volume'))
        .filter(Boolean)
      if (!tree.length) return null
      return {
        module: str(m?.module) || str(modules[i]?.name) || `模块 ${i + 1}`,
        goal: str(m?.goal) || str(modules[i]?.goal) || '',
        tree
      }
    })
    .filter(Boolean)

  if (out.length === 0) throw new Error('目录树未返回有效结构')
  return { modules: out, summary: str(data?.summary), tokens }
}
