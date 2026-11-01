#!/usr/bin/env node
// 问星 · 星图数据生成器（甲编 · 学科内技能）
//
// 读取 `技能分类/甲编 · 学科内技能/{研究技能类,生产技能类}/<族>/<项>.md`，
// 每个 md 正文是单个 ```yaml 围栏块，六级目录树：族 → 项 → 知识点 → 子知识点 → 细目 → 条目。
// 解析为紧凑五级结构树写入 src/data/skillsAtlas.json（星图懒加载路由按需引入）。
//
// 项目内无任何 YAML 库，故用行级解析（缩进 + 键名锚定）；格式高度规整：
// 顶层 `编/族/项`、`知识点:` 列表（缩进 2）、元数据（缩进 4）、`子知识点:`（缩进 6 的 `- 名称:`）、
// `细目:`（缩进 10 的 `- 名称:`）、`条目: [a, b]`（缩进 12 行内数组）。
// 解析结果用实测规模做断言（项/知识点/子知识点/细目/条目行数），任何不符即非零退出，防止静默错解析。
//
// 用法：npm run gen:skills
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SRC_DIR = path.join(REPO_ROOT, '技能分类', '甲编 · 学科内技能')
const OUT_FILE = path.resolve(__dirname, '..', 'src', 'data', 'skillsAtlas.json')
const PATCH_FILE = path.join(__dirname, 'skills-atlas-patch.json')

/** 技能类展示顺序（对齐 00-总览.md 的甲编读法） */
const LEIXING_ORDER = ['研究技能类', '生产技能类']

/** 期望规模（仅 md 解析基线；不符即判定解析异常；补丁增量另行统计） */
const EXPECT_MD = { xiang: 75, kp: 319, zk: 1424, xm: 2863, tm: 2863 }

/** 标签键 → 紧凑键 */
const TAG_KEYS = { 迁移性: 'qy', AI风险: 'ai', 半衰期: 'hb', 执照门槛: 'zz' }

const RE_TOP = /^(编|族|项): (.+)$/
const RE_KP_HEAD = /^知识点:$/
const RE_KP = /^ {2}- 名称: (.+)$/
const RE_META = /^ {4}(适用专业|证据载体): \[(.*)\]$/
const RE_TAGS_HEAD = /^ {4}标签:$/
const RE_TAGS_INLINE = /^ {4}标签: \{(.*)\}$/
const RE_TAG = /^ {6}(迁移性|AI风险|半衰期|执照门槛): (.+)$/
const RE_SUB_HEAD = /^ {4}子知识点:$/
const RE_ZK = /^ {6}- 名称: (.+)$/
const RE_XM_HEAD = /^ {8}细目:$/
const RE_XM = /^ {10}- 名称: (.+)$/
const RE_TM = /^ {12}条目: \[(.*)\]$/

const splitFlow = (s) => s.split(',').map((x) => x.trim()).filter((x) => x.length > 0)

/** 提取 ```yaml 围栏块正文 */
function extractYaml(text, file) {
  const m = text.match(/```yaml[ \t]*\r?\n([\s\S]*?)\r?\n```/)
  if (!m) throw new Error(`${file}: 未找到 \`\`\`yaml 围栏块`)
  return m[1]
}

/** 解析单个技能项 md → { bian, zu, xiang, kp[] } */
function parseSkill(text, file) {
  const out = { bian: '', zu: '', xiang: '', kp: [] }
  let kp = null
  let zk = null
  let xm = null
  let tmLines = 0
  const unmatched = []

  for (const raw of extractYaml(text, file).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (!line || line.startsWith('#')) continue
    let m

    if ((m = line.match(RE_TOP))) {
      out[m[1] === '编' ? 'bian' : m[1] === '族' ? 'zu' : 'xiang'] = m[2].trim()
      continue
    }
    if (RE_KP_HEAD.test(line)) { kp = null; zk = null; xm = null; continue }
    if (RE_SUB_HEAD.test(line) || RE_XM_HEAD.test(line)) continue

    if ((m = line.match(RE_KP))) {
      kp = { n: m[1].trim(), zy: [], zj: [], tags: {}, zk: [] }
      out.kp.push(kp)
      zk = null
      xm = null
      continue
    }
    if (kp) {
      if ((m = line.match(RE_META))) {
        if (m[1] === '适用专业') kp.zy = splitFlow(m[2])
        else kp.zj = splitFlow(m[2])
        continue
      }
      if (RE_TAGS_HEAD.test(line)) continue
      if ((m = line.match(RE_TAGS_INLINE))) {
        for (const pair of splitFlow(m[1])) {
          const [k, v] = pair.split(':').map((x) => (x ?? '').trim())
          if (k && v && TAG_KEYS[k]) kp.tags[TAG_KEYS[k]] = v
        }
        continue
      }
      if ((m = line.match(RE_TAG))) {
        kp.tags[TAG_KEYS[m[1]]] = m[1] === '执照门槛' ? m[2].trim() === 'true' : m[2].trim()
        continue
      }
      if ((m = line.match(RE_ZK))) {
        zk = { n: m[1].trim(), xm: [] }
        kp.zk.push(zk)
        xm = null
        continue
      }
      if (zk && (m = line.match(RE_XM))) {
        xm = { n: m[1].trim(), tm: [] }
        zk.xm.push(xm)
        continue
      }
      if (xm && (m = line.match(RE_TM))) {
        xm.tm = splitFlow(m[1])
        tmLines += 1
        continue
      }
    }
    unmatched.push(line)
  }

  if (unmatched.length) {
    throw new Error(`${file}: 有 ${unmatched.length} 行无法解析，首行 → ${JSON.stringify(unmatched[0])}`)
  }
  if (!out.bian || !out.zu || !out.xiang) throw new Error(`${file}: 缺少 编/族/项 字段`)
  if (!out.kp.length) throw new Error(`${file}: 知识点为空`)
  for (const k of out.kp) {
    if (!k.zy.length) throw new Error(`${file}: 知识点「${k.n}」缺少 适用专业`)
    if (!k.zj.length) throw new Error(`${file}: 知识点「${k.n}」缺少 证据载体`)
    if (!k.zk.length) throw new Error(`${file}: 知识点「${k.n}」缺少 子知识点`)
    for (const z of k.zk) {
      if (!z.xm.length) throw new Error(`${file}: 子知识点「${z.n}」缺少 细目`)
      for (const x of z.xm) {
        if (!x.tm.length) throw new Error(`${file}: 细目「${x.n}」的条目为空`)
        if (!Object.keys(k.tags).length) throw new Error(`${file}: 知识点「${k.n}」缺少 标签`)
      }
    }
  }
  return { data: out, tmLines }
}

/** 紧凑化：省略空标签键，避免冗余字段 */
function compactTags(tags) {
  const out = {}
  for (const [k, v] of Object.entries(tags)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

const natural = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })

/** 读取增量细化补丁（按 项 → 知识点 → 子知识点 路径追加细目 / 条目，只增不删） */
function loadPatch() {
  if (!fs.existsSync(PATCH_FILE)) return { items: {} }
  return JSON.parse(fs.readFileSync(PATCH_FILE, 'utf-8'))
}

/** 补丁声明的增量（用于和实际合并结果对账） */
function patchDeclared(patch) {
  let xm = 0
  let tm = 0
  for (const item of Object.values(patch.items ?? {})) {
    for (const kp of Object.values(item.kp ?? {})) {
      for (const zk of Object.values(kp.zk ?? {})) {
        for (const add of zk.addXm ?? []) {
          xm += 1
          tm += Array.isArray(add.tm) ? add.tm.length : 0
        }
      }
    }
  }
  return { xm, tm }
}

/** 把某个项（md 解析结果）按补丁路径合并；未命中路径记入 misses */
function applyPatch(data, patch, acc) {
  const item = patch.items?.[data.xiang]
  if (!item) return false
  for (const [kpName, kpPatch] of Object.entries(item.kp ?? {})) {
    const kp = data.kp.find((k) => k.n === kpName)
    if (!kp) {
      acc.misses.push(`${data.xiang}/${kpName}`)
      continue
    }
    for (const [zkName, zkPatch] of Object.entries(kpPatch.zk ?? {})) {
      const zk = kp.zk.find((z) => z.n === zkName)
      if (!zk) {
        acc.misses.push(`${data.xiang}/${kpName}/${zkName}`)
        continue
      }
      for (const add of zkPatch.addXm ?? []) {
        const name = String(add.n ?? '').trim()
        if (!name) continue
        const tm = (Array.isArray(add.tm) ? add.tm : []).map((t) => String(t).trim()).filter(Boolean)
        const exist = zk.xm.find((x) => x.n === name)
        if (exist) {
          for (const t of tm) if (!exist.tm.includes(t)) exist.tm.push(t)
        } else {
          zk.xm.push({ n: name, tm })
        }
        acc.addedXm += 1
        acc.addedTm += tm.length
      }
    }
  }
  return true
}

function main() {
  if (!fs.existsSync(SRC_DIR)) throw new Error(`源目录不存在：${SRC_DIR}`)

  const patch = loadPatch()
  const declared = patchDeclared(patch)
  const acc = { addedXm: 0, addedTm: 0, misses: [], hitItems: new Set() }

  const leixing = []
  const stat = { xiang: 0, kp: 0, zk: 0, xm: 0, tm: 0, tmItems: 0, files: 0 }

  for (const lxName of LEIXING_ORDER) {
    const lxDir = path.join(SRC_DIR, lxName)
    if (!fs.existsSync(lxDir)) throw new Error(`技能类目录不存在：${lxDir}`)
    const zuList = []
    for (const zuDir of fs.readdirSync(lxDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort(natural)) {
      const xiangList = []
      const mdFiles = fs.readdirSync(path.join(lxDir, zuDir))
        .filter((f) => f.endsWith('.md')).sort(natural)
      for (const md of mdFiles) {
        const rel = `${lxName}/${zuDir}/${md}`
        const { data, tmLines } = parseSkill(fs.readFileSync(path.join(lxDir, zuDir, md), 'utf-8'), rel)
        stat.files += 1
        stat.xiang += 1
        stat.tm += tmLines
        // md 基线只统计原始文件内容（补丁增量单独记入 acc，避免污染基线断言）
        stat.xm += data.kp.reduce((s, k) => s + k.zk.reduce((a, z) => a + z.xm.length, 0), 0)
        if (applyPatch(data, patch, acc)) acc.hitItems.add(data.xiang)
        const kp = data.kp.map((k) => {
          stat.kp += 1
          const kpItem = { n: k.n, zy: k.zy, zj: k.zj, zk: [] }
          const tags = compactTags(k.tags)
          if (Object.keys(tags).length) kpItem.tags = tags
          for (const z of k.zk) {
            stat.zk += 1
            const zkItem = { n: z.n, xm: [] }
            for (const x of z.xm) {
              stat.tmItems += x.tm.length
              zkItem.xm.push({ n: x.n, tm: x.tm })
            }
            kpItem.zk.push(zkItem)
          }
          return kpItem
        })
        xiangList.push({ n: data.xiang, kp })
        if (data.zu !== zuDir) {
          console.warn(`[warn] 族名与目录名不一致：${rel} → 族「${data.zu}」/ 目录「${zuDir}」`)
        }
      }
      if (xiangList.length) zuList.push({ n: zuDir, xiang: xiangList })
    }
    if (zuList.length) leixing.push({ n: lxName, zu: zuList })
  }

  const payload = {
    bian: '甲编 · 学科内技能',
    generatedAt: new Date().toISOString().slice(0, 10),
    leixing
  }

  // ===== 断言 1：md 解析规模与基线一致 =====
  const mismatch = Object.entries(EXPECT_MD)
    .filter(([k, v]) => stat[k] !== v)
    .map(([k, v]) => `${k}: 期望 ${v} / 实际 ${stat[k]}`)
  if (mismatch.length) {
    throw new Error(`解析规模与基线不符（已中止，未写盘）：\n  - ${mismatch.join('\n  - ')}`)
  }
  // ===== 断言 2：补丁全部命中且增量与声明一致 =====
  if (acc.misses.length) {
    throw new Error(`补丁路径未命中 ${acc.misses.length} 处（已中止，未写盘）：\n  - ${acc.misses.join('\n  - ')}`)
  }
  if (acc.addedXm !== declared.xm || acc.addedTm !== declared.tm) {
    throw new Error(`补丁增量与声明不一致（已中止，未写盘）：细目 ${acc.addedXm}/${declared.xm}，条目 ${acc.addedTm}/${declared.tm}`)
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload), 'utf-8')
  const kb = Math.round(fs.statSync(OUT_FILE).size / 1024)
  console.log(`✓ 已生成 ${path.relative(REPO_ROOT, OUT_FILE)}（${kb} KB）`)
  console.log(`  技能类 ${leixing.length} · 族 ${leixing.reduce((s, l) => s + l.zu.length, 0)} · ` +
    `项 ${stat.xiang} · 知识点 ${stat.kp} · 子知识点 ${stat.zk} · 细目 ${stat.xm + acc.addedXm} · 条目 ${stat.tmItems}`)
  console.log(`  md 基线：细目 ${stat.xm} · 条目行 ${stat.tm}；补丁：命中项 ${acc.hitItems.size} · 新增细目 ${acc.addedXm} · 新增条目 ${acc.addedTm}`)
}

main()
