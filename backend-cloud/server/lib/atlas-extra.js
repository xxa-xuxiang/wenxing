// 知识星图运行时增量：AI 精细大纲发现的新学科/能力
// 存储：data/atlas/extra-nodes.json（只增不删）；同时把叶子写入 SkillLeaf，保证后续可按新知识点出题
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_ROOT } from './docs-store.js'
import { db, serializeWrite } from './db.js'
import { leafKeyOf } from './skill-leaves.js'
import { safeWriteJson } from './fs-safe.js'

const DIR = path.join(DATA_ROOT, 'atlas')
const FILE = path.join(DIR, 'extra-nodes.json')

// 字段统一截断，防止客户端提交超长字符串污染全局星图数据与 SQL
const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : '')
// 单次最多接收 20 个增量节点（AI 补充大纲的量级），超出丢弃
const MAX_NODES = 20

function readAll() {
  try {
    if (!fs.existsSync(FILE)) return []
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'))
    return Array.isArray(data?.nodes) ? data.nodes : []
  } catch {
    return []
  }
}

function writeAll(nodes) {
  safeWriteJson(FILE, { nodes })
}

const nodeKey = (n) =>
  [str(n.leixing), str(n.zu), str(n.xiang), ...(Array.isArray(n.kp) ? n.kp.map(str) : [])].join('|')

export function listExtraNodes() {
  return readAll()
}

/** 合并新节点（按 技能类/族/项/知识点 去重），返回新增条数与总条数 */
export function appendExtraNodes(nodes, industry = '') {
  const list = (Array.isArray(nodes) ? nodes : []).slice(0, MAX_NODES)
  const all = readAll()
  const seen = new Set(all.map(nodeKey))
  let added = 0
  for (const raw of list) {
    const n = {
      leixing: str(raw?.leixing),
      zu: str(raw?.zu),
      xiang: str(raw?.xiang),
      kp: Array.isArray(raw?.kp) ? raw.kp.map(str).filter(Boolean).slice(0, 30) : [],
      industry: str(raw?.industry) || str(industry),
      reason: str(raw?.reason),
      addedAt: new Date().toISOString()
    }
    if (!n.xiang || n.kp.length === 0) continue
    const k = nodeKey(n)
    if (seen.has(k)) continue
    seen.add(k)
    all.push(n)
    added += 1
  }
  if (added > 0) writeAll(all)
  return { added, total: all.length, nodes: all }
}

/** 把增量节点同步进 SkillLeaf 注册表（INSERT OR IGNORE，幂等） */
export async function syncSkillLeaves(nodes, industry = '') {
  const rows = []
  for (const n of (Array.isArray(nodes) ? nodes : []).slice(0, MAX_NODES)) {
    const ind = str(n?.industry) || str(industry)
    if (!ind) continue
    for (const name of (Array.isArray(n?.kp) ? n.kp : []).slice(0, 30)) {
      const kpName = str(name)
      if (!kpName) continue
      const category = str(n?.leixing)
      const domain = str(n?.zu)
      const stack = str(n?.xiang)
      rows.push({
        leafKey: leafKeyOf({ industry: ind, category, domain, stack, name: kpName }),
        industry: ind,
        category,
        domain,
        stack,
        name: kpName,
        pathText: [ind, category, domain, stack, kpName].filter(Boolean).join(' / ')
      })
    }
  }
  if (rows.length === 0) return 0
  // 走 Prisma 参数化写入（不用手工拼接 SQL），skipDuplicates 等价于 INSERT OR IGNORE
  const data = rows.map((r) => ({ id: crypto.randomUUID(), ...r }))
  const res = await serializeWrite(() => db.skillLeaf.createMany({ data, skipDuplicates: true }))
  return Number(res?.count) || 0
}
