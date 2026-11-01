// 星图三维数据模型〔自桌面端 views/AtlasView.vue 抽取，移动端复用〕
// 层级：问星(中心) → 技能类(1) → 族(2) → 项(3) → 知识点(4) → 子知识点(5) → 细目(6) → 条目(7)
// 布局（纯坐标 O(n)）：人脑形双半球，研究居左 / 生产居右；深度 → 半球内径向层次，
//   叶槽 → 方位角，面积均匀极角 → 立体铺开，叠加脑回褶皱 / 外侧裂 / 小脑扰动。
// 本模块只做纯数据与布局，不依赖 Vue / Pinia / DOM，便于复用与测试。
import type { MasteryState } from '@/stores/masteryStore'
import type {
  AtlasKind,
  SkillKp,
  SkillLeixing,
  SkillXiang,
  SkillXm,
  SkillZk,
  SkillZu,
  SkillsAtlas
} from '@/utils/skillsAtlas'
import type { Atlas3DNode } from '@/composables/useAtlas3D'

/** 中心节点 id（与桌面端 / G6 版本保持一致） */
export const ROOT_ID = 'center-wenxing'

// ===== id 规则 =====
export const lxId = (li: number) => `lx-${li}`
export const zuId = (li: number, zi: number) => `zu-${li}-${zi}`
export const xiangId = (li: number, zi: number, xi: number) => `xiang-${li}-${zi}-${xi}`
export const kpId = (li: number, zi: number, xi: number, ki: number) =>
  `kp-${li}-${zi}-${xi}-${ki}`
export const zkId = (li: number, zi: number, xi: number, ki: number, si: number) =>
  `zk-${li}-${zi}-${xi}-${ki}-${si}`
export const xmId = (li: number, zi: number, xi: number, ki: number, si: number, mi: number) =>
  `xm-${li}-${zi}-${xi}-${ki}-${si}-${mi}`
export const tmId = (
  li: number,
  zi: number,
  xi: number,
  ki: number,
  si: number,
  mi: number,
  ti: number
) => `tm-${li}-${zi}-${xi}-${ki}-${si}-${mi}-${ti}`

/** 星图节点种类（含细目 / 条目） */
export type Atlas3DKind = AtlasKind | 'xm' | 'tm'

export interface AtlasNodeMeta {
  kind: Atlas3DKind
  label: string
  level: number
  expandable: boolean
  open: boolean
  childCount?: number
  mastery?: MasteryState
  masteryCount?: string
}

/** 子知识点 → 源对象引用（费曼讲解 / 技能详情用） */
export interface SkillRef {
  zu: SkillZu
  xiang: SkillXiang
  kp: SkillKp
  zk: SkillZk
}

export interface DocTarget {
  title: string
  path: string[]
}

export interface LocateTarget {
  zu: string
  xiang?: string
  kp?: string
}

interface VNode {
  id: string
  depth: number
  kind: Atlas3DKind
  li: number
  zi: number
  xi: number
  ki: number
  si: number
  mi: number
  ti: number
  label: string
  lx?: SkillLeixing
  zu?: SkillZu
  xiang?: SkillXiang
  kp?: SkillKp
  zk?: SkillZk
  angle: number
  off: number
  kids: VNode[]
}

// ===== 可见节点树（技能类 / 族可收起；项以下随父整体铺开） =====
function buildTmV(
  tm: string,
  li: number,
  zi: number,
  xi: number,
  ki: number,
  si: number,
  mi: number,
  ti: number,
  depth: number
): VNode {
  return {
    id: tmId(li, zi, xi, ki, si, mi, ti),
    depth,
    kind: 'tm',
    li,
    zi,
    xi,
    ki,
    si,
    mi,
    ti,
    label: tm,
    angle: 0,
    off: 0,
    kids: []
  }
}

function buildXmV(
  xm: SkillXm,
  li: number,
  zi: number,
  xi: number,
  ki: number,
  si: number,
  mi: number,
  depth: number
): VNode {
  const v: VNode = {
    id: xmId(li, zi, xi, ki, si, mi),
    depth,
    kind: 'xm',
    li,
    zi,
    xi,
    ki,
    si,
    mi,
    ti: -1,
    label: xm.n,
    angle: 0,
    off: 0,
    kids: []
  }
  xm.tm.forEach((tm, ti) => v.kids.push(buildTmV(tm, li, zi, xi, ki, si, mi, ti, depth + 1)))
  return v
}

function buildZkV(
  zk: SkillZk,
  li: number,
  zi: number,
  xi: number,
  ki: number,
  si: number,
  depth: number
): VNode {
  const v: VNode = {
    id: zkId(li, zi, xi, ki, si),
    depth,
    kind: 'zk',
    li,
    zi,
    xi,
    ki,
    si,
    mi: -1,
    ti: -1,
    label: zk.n,
    zk,
    angle: 0,
    off: 0,
    kids: []
  }
  zk.xm.forEach((xm, mi) => v.kids.push(buildXmV(xm, li, zi, xi, ki, si, mi, depth + 1)))
  return v
}

function buildKpV(
  kp: SkillKp,
  li: number,
  zi: number,
  xi: number,
  ki: number,
  depth: number
): VNode {
  const v: VNode = {
    id: kpId(li, zi, xi, ki),
    depth,
    kind: 'kp',
    li,
    zi,
    xi,
    ki,
    si: -1,
    mi: -1,
    ti: -1,
    label: kp.n,
    kp,
    angle: 0,
    off: 0,
    kids: []
  }
  kp.zk.forEach((zk, si) => v.kids.push(buildZkV(zk, li, zi, xi, ki, si, depth + 1)))
  return v
}

function buildXiangV(
  xiang: SkillXiang,
  li: number,
  zi: number,
  xi: number,
  depth: number
): VNode {
  const v: VNode = {
    id: xiangId(li, zi, xi),
    depth,
    kind: 'xiang',
    li,
    zi,
    xi,
    ki: -1,
    si: -1,
    mi: -1,
    ti: -1,
    label: xiang.n,
    xiang,
    angle: 0,
    off: 0,
    kids: []
  }
  xiang.kp.forEach((kp, ki) => v.kids.push(buildKpV(kp, li, zi, xi, ki, depth + 1)))
  return v
}

function buildZuV(
  zu: SkillZu,
  li: number,
  zi: number,
  depth: number,
  closedZu: Set<string>
): VNode {
  const v: VNode = {
    id: zuId(li, zi),
    depth,
    kind: 'zu',
    li,
    zi,
    xi: -1,
    ki: -1,
    si: -1,
    mi: -1,
    ti: -1,
    label: zu.n,
    zu,
    angle: 0,
    off: 0,
    kids: []
  }
  if (!closedZu.has(v.id)) {
    zu.xiang.forEach((xiang, xi) => v.kids.push(buildXiangV(xiang, li, zi, xi, depth + 1)))
  }
  return v
}

function buildVTree(
  atlas: SkillsAtlas,
  closedLx: Set<string>,
  closedZu: Set<string>
): VNode[] {
  return atlas.leixing.map((lx, li) => {
    const v: VNode = {
      id: lxId(li),
      depth: 1,
      kind: 'lx',
      li,
      zi: -1,
      xi: -1,
      ki: -1,
      si: -1,
      mi: -1,
      ti: -1,
      label: lx.n,
      lx,
      angle: 0,
      off: 0,
      kids: []
    }
    if (!closedLx.has(v.id)) {
      lx.zu.forEach((zu, zi) => v.kids.push(buildZuV(zu, li, zi, 2, closedZu)))
    }
    return v
  })
}

// ===== 人脑形三维布局 =====
const BRAIN_HALF_W = 58
const BRAIN_HALF_H = 62
const BRAIN_HALF_L = 82
const MEDIAL_GAP = 2.6

const slotRand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function hashRand(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  return (h >>> 0) / 4294967296
}

const polarOf = (u: number) => Math.acos(1 - 2 * (0.04 + u * 0.92))

interface Position3 {
  x: number
  y: number
  z: number
}

function compute3DPositions(roots: VNode[]): Map<string, Position3> {
  const pos = new Map<string, Position3>()
  pos.set(ROOT_ID, { x: 0, y: 0, z: 0 })

  const angleAt = (first: number, end: number, leaf: boolean, base: number, span: number) => {
    const mid = leaf ? first + 0.5 : (first + end) / 2
    return -Math.PI / 2 + ((mid - base) / Math.max(1, span)) * 2 * Math.PI
  }

  const polarMap = new Map<string, number>()
  let slot = 0

  const place = (v: VNode, base: number, span: number) => {
    const first = slot
    if (v.kids.length === 0) {
      polarMap.set(v.id, polarOf(slotRand(slot * 2.17 + 11)))
      slot += 1
      v.angle = angleAt(first, first + 1, true, base, span)
    } else {
      v.kids.forEach((k) => place(k, base, span))
      v.angle = angleAt(first, slot, false, base, span)
      let sum = 0
      let cnt = 0
      v.kids.forEach((k) => {
        const p = polarMap.get(k.id)
        if (p !== undefined) {
          sum += p
          cnt += 1
        }
      })
      const mean = cnt ? sum / cnt : Math.PI / 2
      polarMap.set(v.id, mean * 0.4 + polarOf(hashRand(v.id)) * 0.6)
    }

    const f = 0.16 + 0.84 * Math.pow(Math.min(1, (v.depth - 1) / 6), 0.85)
    const shell = v.kids.length === 0 ? 1 + (slotRand(slot * 0.73 + 21) * 2 - 1) * 0.06 : 1
    const rr = f * shell
    const p = polarMap.get(v.id) ?? Math.PI / 2
    const theta = v.angle + v.depth * 0.1
    const dx = Math.sin(p) * Math.cos(theta)
    const dy = Math.cos(p)
    const dz = Math.sin(p) * Math.sin(theta)
    const gyri =
      1 +
      Math.sin(theta * 7 + 1.2) * 0.09 +
      Math.sin(p * 11 + 0.7) * 0.055 +
      Math.sin(theta * 17 + p * 5 + 2.1) * 0.018
    let ny = dy < 0 ? dy * 0.6 : dy
    let nz = dz
    const frontTaper = 1 - 0.14 * Math.max(0, nz)
    const backTaper = 1 - 0.08 * Math.max(0, -nz)
    const temporalBand = Math.max(0, 1 - Math.abs(nz) / 0.85) * Math.max(0, -ny)
    let lateralScale = (1 + 0.22 * Math.pow(temporalBand, 0.8)) * frontTaper * backTaper
    const cbBand = (Math.max(0, -nz - 0.3) / 0.7) * Math.max(0, -ny)
    nz -= 0.12 * cbBand
    ny -= 0.07 * cbBand
    lateralScale *= 1 + 0.06 * cbBand
    const sylvian =
      Math.exp(-Math.pow((ny + 0.18) / 0.07, 2)) * Math.max(0, 1 - Math.abs(nz - 0.3) / 0.75)
    const central = Math.exp(-Math.pow((nz - 0.12) / 0.06, 2)) * Math.max(0, ny)
    const cbSulcus = Math.exp(-Math.pow((nz + 0.62) / 0.07, 2)) * (Math.max(0, -ny - 0.2) / 0.8)
    const cbVermis =
      Math.exp(-Math.pow(dx / 0.07, 2)) * Math.max(0, -ny - 0.2) * Math.max(0, -nz - 0.3)
    const carve =
      1 -
      0.22 * Math.min(1, sylvian) -
      0.1 * Math.min(1, central) -
      0.16 * Math.min(1, cbSulcus) -
      0.12 * Math.min(1, cbVermis)
    const stem =
      Math.exp(-Math.pow((nz + 0.05) / 0.18, 2)) *
      Math.exp(-Math.pow(dx / 0.12, 2)) *
      Math.max(0, -ny)
    ny += 0.1 * stem

    const side = v.li === 0 ? -1 : 1
    const gap = MEDIAL_GAP * (1 + 0.65 * Math.max(0, ny))
    const rEff = rr * carve
    const lateral = gap + BRAIN_HALF_W * rEff * Math.abs(dx) * lateralScale * gyri

    pos.set(v.id, {
      x: side * lateral,
      y: BRAIN_HALF_H * rEff * ny * gyri,
      z: BRAIN_HALF_L * rEff * nz * gyri
    })
  }

  const leavesOf = (v: VNode): number =>
    v.kids.length === 0 ? 1 : v.kids.reduce((n, k) => n + leavesOf(k), 0)
  let rootBase = 0
  roots.forEach((r) => {
    const span = leavesOf(r)
    place(r, rootBase, span)
    rootBase += span
  })
  return pos
}

// ===== 层级色阶 / 半径 =====
const levelColor: Record<string, string> = {
  root: '#818cf8',
  l1: '#8b5cf6',
  l2: '#6366f1',
  l3: '#818cf8',
  l4: '#a5b4fc',
  l5: '#c7d2fe',
  l6: '#dbe2ff',
  l7: '#eef1ff'
}

const masteryColor = {
  learning: '#818cf8',
  mastered: '#4ade80'
}

const NODE_RADIUS: Record<string, number> = {
  root: 6,
  lx: 4.2,
  zu: 3.1,
  xiang: 2.1,
  kp: 1.45,
  zk: 1.0,
  xm: 0.62,
  tm: 0.34
}

// ===== 掌握度统计（叶子 = 子知识点；父级聚合计数） =====
type StateGetter = (kp: string) => MasteryState

function zkStats(zk: SkillZk, getState: StateGetter) {
  return { total: 1, mastered: getState(zk.n) === 'mastered' ? 1 : 0 }
}

function kpStats(kp: SkillKp, getState: StateGetter) {
  let total = 0
  let mastered = 0
  for (const zk of kp.zk) {
    const s = zkStats(zk, getState)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

function xiangStats(x: SkillXiang, getState: StateGetter) {
  let total = 0
  let mastered = 0
  for (const kp of x.kp) {
    const s = kpStats(kp, getState)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

function zuStats(z: SkillZu, getState: StateGetter) {
  let total = 0
  let mastered = 0
  for (const x of z.xiang) {
    const s = xiangStats(x, getState)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

function leixingStats(l: SkillLeixing, getState: StateGetter) {
  let total = 0
  let mastered = 0
  for (const z of l.zu) {
    const s = zuStats(z, getState)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

/** 单次点击最多收集多少条细目 / 条目作为文档候选 */
const DOC_TARGET_LIMIT = 80

export interface AtlasModel {
  nodes: Atlas3DNode[]
  metaById: Map<string, AtlasNodeMeta>
  locateMap: Map<string, LocateTarget>
  zkRefMap: Map<string, SkillRef>
  vById: Map<string, VNode>
  pathById: Map<string, string[]>
  nodeCount: number
}

/** 构建三维场景数据（每次展开 / 收起 / 掌握度变化后重建） */
export function buildAtlasModel(
  atlas: SkillsAtlas,
  closedLx: Set<string>,
  closedZu: Set<string>,
  getState: StateGetter
): AtlasModel {
  const roots = buildVTree(atlas, closedLx, closedZu)
  const positions = compute3DPositions(roots)
  const out: Atlas3DNode[] = []
  const metaById = new Map<string, AtlasNodeMeta>()
  const locateMap = new Map<string, LocateTarget>()
  const zkRefMap = new Map<string, SkillRef>()
  const vById = new Map<string, VNode>()
  const pathById = new Map<string, string[]>()

  const rootMeta: AtlasNodeMeta = {
    kind: 'root',
    label: '问星',
    level: 0,
    expandable: false,
    open: false
  }
  metaById.set(ROOT_ID, rootMeta)
  out.push({
    id: ROOT_ID,
    parentId: null,
    depth: 0,
    label: '问星',
    radius: NODE_RADIUS.root,
    color: levelColor.root,
    x: 0,
    y: 0,
    z: 0
  })

  const walk = (
    v: VNode,
    parentId: string,
    zu: SkillZu | null,
    xiang: SkillXiang | null,
    kp: SkillKp | null,
    chain: string[]
  ) => {
    const p = positions.get(v.id)
    if (!p) return
    const curZu = v.zu ?? zu
    const curXiang = v.xiang ?? xiang
    const curKp = v.kp ?? kp
    const isLeaf = v.kids.length === 0

    let mastery: MasteryState | undefined
    let masteryCount: string | undefined
    if (v.kind === 'zk') {
      mastery = getState(v.label)
    } else if (
      v.kind === 'lx' ||
      v.kind === 'zu' ||
      v.kind === 'xiang' ||
      v.kind === 'kp'
    ) {
      let s = { total: 0, mastered: 0 }
      if (v.kind === 'lx' && v.lx) s = leixingStats(v.lx, getState)
      else if (v.zu) s = zuStats(v.zu, getState)
      else if (v.xiang) s = xiangStats(v.xiang, getState)
      else if (v.kp) s = kpStats(v.kp, getState)
      if (s.mastered > 0) masteryCount = `${s.mastered}/${s.total}`
    }

    const open =
      v.kind === 'lx'
        ? !closedLx.has(v.id)
        : v.kind === 'zu'
          ? !closedZu.has(v.id)
          : true
    const meta: AtlasNodeMeta = {
      kind: v.kind,
      label: v.label,
      level: v.depth,
      expandable: v.kind === 'lx' || v.kind === 'zu',
      open,
      childCount: isLeaf ? undefined : v.kids.length,
      mastery,
      masteryCount
    }
    metaById.set(v.id, meta)

    let color: string
    if (v.kind === 'lx') color = levelColor.l1
    else if (v.kind === 'zu') color = levelColor.l2
    else if (v.kind === 'xiang') color = levelColor.l3
    else if (v.kind === 'kp') color = levelColor.l4
    else if (v.kind === 'xm') color = levelColor.l6
    else if (v.kind === 'tm') color = levelColor.l7
    else if (mastery === 'mastered') color = masteryColor.mastered
    else if (mastery === 'learning') color = masteryColor.learning
    else color = levelColor.l5

    out.push({
      id: v.id,
      parentId,
      depth: v.depth,
      label: nodeLabel(meta),
      radius: NODE_RADIUS[v.kind] * (mastery === 'mastered' ? 1.18 : 1),
      color,
      faded: !open,
      x: p.x,
      y: p.y,
      z: p.z
    })

    // 定位 / 详情引用（细目 / 条目也定位到所属知识点，目录树只到 kp 这一级）
    if (
      curZu &&
      (v.kind === 'xiang' ||
        v.kind === 'kp' ||
        v.kind === 'zk' ||
        v.kind === 'xm' ||
        v.kind === 'tm')
    ) {
      locateMap.set(v.id, {
        zu: curZu.n,
        xiang: curXiang?.n,
        kp: curKp?.n
      })
    }
    if (v.kind === 'zk' && curZu && curXiang && curKp && v.zk) {
      zkRefMap.set(v.id, { zu: curZu, xiang: curXiang, kp: curKp, zk: v.zk })
    }
    vById.set(v.id, v)
    pathById.set(v.id, [...chain, v.label])

    const nextChain = [...chain, v.label]
    for (const k of v.kids) walk(k, v.id, curZu ?? null, curXiang ?? null, curKp ?? null, nextChain)
  }

  roots.forEach((v) => walk(v, ROOT_ID, null, null, null, []))

  return {
    nodes: out,
    metaById,
    locateMap,
    zkRefMap,
    vById,
    pathById,
    nodeCount: out.length
  }
}

/** 节点标签：收起态追加成员数；有掌握进度时追加计数 */
function nodeLabel(meta: AtlasNodeMeta): string {
  const parts = [meta.label]
  if (meta.expandable && !meta.open && meta.childCount) parts.push(`(${meta.childCount})`)
  if (meta.masteryCount) parts.push(meta.masteryCount)
  return parts.join(' ')
}

/** 收集某节点子树下的细目 / 条目（含自身），用于聚合文档目录 */
export function collectDocTargets(model: AtlasModel, id: string): DocTarget[] {
  const root = model.vById.get(id)
  if (!root) return []
  const full = model.pathById.get(id) ?? [root.label]
  const chain = full.slice(0, -1)
  const out: DocTarget[] = []
  const dfs = (v: VNode, prefix: string[]) => {
    if (out.length >= DOC_TARGET_LIMIT) return
    if (v.kind === 'xm' || v.kind === 'tm') {
      out.push({ title: v.label, path: [...prefix, v.label] })
      return
    }
    const next = [...prefix, v.label]
    for (const k of v.kids) {
      if (out.length >= DOC_TARGET_LIMIT) break
      dfs(k, next)
    }
  }
  dfs(root, chain)
  return out
}

/** 层级中文名（节点弹层 tag） */
export const KIND_LABEL: Record<Atlas3DKind, string> = {
  root: '中心',
  lx: '技能类',
  zu: '族',
  xiang: '项',
  kp: '知识点',
  zk: '子知识点',
  xm: '细目',
  tm: '条目'
}

/** 可见叶子（子知识点）总数，用于「已点亮 / 总数」展示 */
export function countLeaves(atlas: SkillsAtlas): number {
  let n = 0
  atlas.leixing.forEach((lx) =>
    lx.zu.forEach((z) => z.xiang.forEach((x) => x.kp.forEach((kp) => (n += kp.zk.length))))
  )
  return n
}
