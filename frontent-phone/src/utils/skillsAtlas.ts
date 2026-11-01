// 问星 — 星图数据与布局工具〔自桌面端 AtlasView 移植，移动端裁剪〕
// 数据源：src/data/skillsAtlas.json（与桌面端同构；层级 问星→技能类→族→项→知识点→子知识点）
// 布局（纯坐标 O(n)）：叶槽均分整圆 + 环半径 = 深度 × 单位半径；叶子确定性伪随机半径交错，
//   标签沿径向自然错成多排；内部节点取后代叶子偏移均值再叠加同层三档扰动
// 移动端差异：技能类/族/项三级均可展开收起（桌面仅前两级），默认仅展开技能类——
//   手机初始只渲染 17 个节点，逐级下钻控制节点规模，保证拖拽 60fps
import type { MasteryState } from '@/stores/masteryStore'

// ===== 类型（与桌面端 types/skills.ts 同构） =====
export interface SkillTags {
  /** 迁移性：高 / 中 / 低 */
  qy?: string
  /** AI 风险：高 / 中 / 低 */
  ai?: string
  /** 半衰期：长 / 中 / 短 */
  hb?: string
  /** 是否执照门槛 */
  zz?: boolean
}

/** 细目（第五级） */
export interface SkillXm {
  n: string
  /** 条目（第六级，纯名称） */
  tm: string[]
}

/** 子知识点（第四级；星图叶子层） */
export interface SkillZk {
  n: string
  xm: SkillXm[]
}

/** 知识点（第三级；附适用专业 / 证据载体 / 标签） */
export interface SkillKp {
  n: string
  /** 适用专业 */
  zy: string[]
  /** 证据载体 */
  zj: string[]
  tags?: SkillTags
  zk: SkillZk[]
}

/** 项（第二级；一个 md 文件） */
export interface SkillXiang {
  n: string
  kp: SkillKp[]
}

/** 族（能力域，A–N） */
export interface SkillZu {
  n: string
  xiang: SkillXiang[]
}

/** 技能类（研究技能类 / 生产技能类） */
export interface SkillLeixing {
  n: string
  zu: SkillZu[]
}

/** 甲编 · 学科内技能结构树 */
export interface SkillsAtlas {
  bian: string
  generatedAt: string
  leixing: SkillLeixing[]
}

export type AtlasKind = 'root' | 'lx' | 'zu' | 'xiang' | 'kp' | 'zk'

/** 节点种类中文名（弹层徽标用） */
export const kindName: Record<AtlasKind, string> = {
  root: '中心',
  lx: '技能类',
  zu: '能力域',
  xiang: '技能项',
  kp: '知识点',
  zk: '子知识点'
}

export const ROOT_ID = 'center-wenxing'

// ===== 节点 id 规则（与桌面端一致，由索引拼装，不含名称） =====
export const lxId = (li: number) => `lx-${li}`
export const zuId = (li: number, zi: number) => `zu-${li}-${zi}`
export const xiangId = (li: number, zi: number, xi: number) => `xiang-${li}-${zi}-${xi}`
export const kpId = (li: number, zi: number, xi: number, ki: number) => `kp-${li}-${zi}-${xi}-${ki}`
export const zkId = (li: number, zi: number, xi: number, ki: number, si: number) =>
  `zk-${li}-${zi}-${xi}-${ki}-${si}`

/** 从 id 反解层级索引（下钻定位祖先链用） */
export function parseAtlasId(id: string): {
  kind: AtlasKind
  li: number
  zi: number
  xi: number
  ki: number
  si: number
} {
  const p = id.split('-')
  const n = (i: number) => (p.length > i ? Number(p[i]) : -1)
  switch (p[0]) {
    case 'lx':
      return { kind: 'lx', li: n(1), zi: -1, xi: -1, ki: -1, si: -1 }
    case 'zu':
      return { kind: 'zu', li: n(1), zi: n(2), xi: -1, ki: -1, si: -1 }
    case 'xiang':
      return { kind: 'xiang', li: n(1), zi: n(2), xi: n(3), ki: -1, si: -1 }
    case 'kp':
      return { kind: 'kp', li: n(1), zi: n(2), xi: n(3), ki: n(4), si: -1 }
    case 'zk':
      return { kind: 'zk', li: n(1), zi: n(2), xi: n(3), ki: n(4), si: n(5) }
    default:
      return { kind: 'root', li: -1, zi: -1, xi: -1, ki: -1, si: -1 }
  }
}

// ===== 掌握度统计：叶子 = 子知识点；父级聚合子级「已掌握 / 总数」 =====
export function zkStats(zk: SkillZk, getState: (kp: string) => MasteryState) {
  return { total: 1, mastered: getState(zk.n) === 'mastered' ? 1 : 0 }
}

export function kpStats(kp: SkillKp, getState: (kp: string) => MasteryState) {
  let total = 0
  let mastered = 0
  for (const zk of kp.zk) {
    const s = zkStats(zk, getState)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

export function xiangStats(x: SkillXiang, getState: (kp: string) => MasteryState) {
  let total = 0
  let mastered = 0
  for (const kp of x.kp) {
    const s = kpStats(kp, getState)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

export function zuStats(z: SkillZu, getState: (kp: string) => MasteryState) {
  let total = 0
  let mastered = 0
  for (const x of z.xiang) {
    const s = xiangStats(x, getState)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

export function leixingStats(l: SkillLeixing, getState: (kp: string) => MasteryState) {
  let total = 0
  let mastered = 0
  for (const z of l.zu) {
    const s = zuStats(z, getState)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

// ===== 图数据构建 =====
export interface AtlasNodeMeta {
  kind: AtlasKind
  label: string
  level: number
  expandable: boolean
  open: boolean
  /** 收起时显示的子级数 */
  childCount?: number
  /** 叶子（子知识点）的掌握度三态 */
  mastery?: MasteryState
  /** 内部节点子级「已掌握/总数」计数（有进度时存在） */
  masteryCount?: string
  angle: number
  x: number
  y: number
  [key: string]: unknown
}

/** 节点源对象引用（弹层详情 / 下钻用，每次 buildGraphData 重建） */
export interface AtlasNodeRef {
  id: string
  kind: AtlasKind
  label: string
  /** 父级链路（族 · 项 · 知识点） */
  path: string
  li: number
  zi: number
  xi: number
  ki: number
  si: number
  lx?: SkillLeixing
  zu?: SkillZu
  xiang?: SkillXiang
  kp?: SkillKp
  zk?: SkillZk
}

export interface G6NodeInput {
  id: string
  data: AtlasNodeMeta
  style: { x: number; y: number }
  /** 兼容 G6 NodeData 的索引签名要求 */
  [key: string]: unknown
}

export interface GraphBuildResult {
  nodes: G6NodeInput[]
  edges: Array<{ source: string; target: string }>
  nodeCount: number
  /** 叶子（子知识点）总数 */
  leafTotal: number
  refs: Map<string, AtlasNodeRef>
}

export interface GraphBuildInput {
  atlas: SkillsAtlas
  getState: (kp: string) => MasteryState
  closedLx: Set<string>
  closedZu: Set<string>
  closedXiang: Set<string>
}

// ===== 可见节点树（技能类 / 族 / 项三级可收起，项以下随其父整体铺开） =====
interface VNode {
  id: string
  depth: number
  kind: AtlasKind
  li: number
  zi: number
  xi: number
  ki: number
  si: number
  label: string
  lx?: SkillLeixing
  zu?: SkillZu
  xiang?: SkillXiang
  kp?: SkillKp
  zk?: SkillZk
  angle: number
  /** 半径交错偏移（让每条连线长度不同，散开标签） */
  off: number
  kids: VNode[]
}

function buildZkV(zk: SkillZk, li: number, zi: number, xi: number, ki: number, si: number, depth: number): VNode {
  return { id: zkId(li, zi, xi, ki, si), depth, kind: 'zk', li, zi, xi, ki, si, label: zk.n, zk, angle: 0, off: 0, kids: [] }
}

function buildKpV(kp: SkillKp, li: number, zi: number, xi: number, ki: number, depth: number): VNode {
  const v: VNode = { id: kpId(li, zi, xi, ki), depth, kind: 'kp', li, zi, xi, ki, si: -1, label: kp.n, kp, angle: 0, off: 0, kids: [] }
  kp.zk.forEach((zk, si) => v.kids.push(buildZkV(zk, li, zi, xi, ki, si, depth + 1)))
  return v
}

function buildXiangV(xiang: SkillXiang, li: number, zi: number, xi: number, depth: number, closedXiang: Set<string>): VNode {
  const v: VNode = { id: xiangId(li, zi, xi), depth, kind: 'xiang', li, zi, xi, ki: -1, si: -1, label: xiang.n, xiang, angle: 0, off: 0, kids: [] }
  if (!closedXiang.has(v.id)) {
    xiang.kp.forEach((kp, ki) => v.kids.push(buildKpV(kp, li, zi, xi, ki, depth + 1)))
  }
  return v
}

function buildZuV(zu: SkillZu, li: number, zi: number, depth: number, closedZu: Set<string>, closedXiang: Set<string>): VNode {
  const v: VNode = { id: zuId(li, zi), depth, kind: 'zu', li, zi, xi: -1, ki: -1, si: -1, label: zu.n, zu, angle: 0, off: 0, kids: [] }
  if (!closedZu.has(v.id)) {
    zu.xiang.forEach((xiang, xi) => v.kids.push(buildXiangV(xiang, li, zi, xi, depth + 1, closedXiang)))
  }
  return v
}

function buildVTree(atlas: SkillsAtlas, closedLx: Set<string>, closedZu: Set<string>, closedXiang: Set<string>): VNode[] {
  return atlas.leixing.map((lx, li) => {
    const v: VNode = { id: lxId(li), depth: 1, kind: 'lx', li, zi: -1, xi: -1, ki: -1, si: -1, label: lx.n, lx, angle: 0, off: 0, kids: [] }
    if (!closedLx.has(v.id)) {
      lx.zu.forEach((zu, zi) => v.kids.push(buildZuV(zu, li, zi, 2, closedZu, closedXiang)))
    }
    return v
  })
}

// ===== 树状视图布局（叶槽均分整圆 + 半径交错） =====
// 环半径 = 深度 × 单位半径（单位半径按叶子总数反推，同环节点弧间距恒定不重叠）
const TREE_ARC: Record<number, number> = { 3: 22, 4: 18, 5: 22 }
// 各层半径扰动幅度（叶子最大：散布带需容下整排标签高度）
const LEAF_JITTER = 130
const INNER_JITTER: Record<number, number> = { 4: 30, 3: 36, 2: 40 }
/** 三档循环交错：-1 / 0 / +1，避免相邻节点恒为两档造成的规律重叠 */
const tri = (i: number) => (i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : 0)
/** 槽位确定性伪随机 [0,1)：同槽位每次布局结果稳定，不随重绘跳动 */
const slotRand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

interface Position {
  x: number
  y: number
  angle: number
}

function computeTreePositions(roots: VNode[]): Map<string, Position> {
  const pos = new Map<string, Position>()
  pos.set(ROOT_ID, { x: 0, y: 0, angle: -Math.PI / 2 })

  // 可见叶子总数 + 最大深度（收起的分支自身占一个叶槽）
  let totalLeaves = 0
  let maxDepth = 1
  const countLeaves = (v: VNode) => {
    if (v.kids.length === 0) {
      totalLeaves += 1
      if (v.depth > maxDepth) maxDepth = v.depth
    } else v.kids.forEach(countLeaves)
  }
  roots.forEach(countLeaves)

  const L = Math.max(1, totalLeaves)
  const arc = TREE_ARC[maxDepth] ?? 22
  const unit = Math.max(120, (L * arc) / (2 * Math.PI * Math.max(1, maxDepth)))

  /** 槽位 → 角度：叶子取槽中点，内部节点取首末槽中点 */
  const angleAt = (first: number, end: number, leaf: boolean) => {
    const mid = leaf ? first + 0.5 : (first + end) / 2
    return -Math.PI / 2 + (mid / L) * 2 * Math.PI
  }
  const put = (id: string, depth: number, angle: number, off: number) => {
    const r = depth * unit + off
    pos.set(id, { x: r * Math.cos(angle), y: r * Math.sin(angle), angle })
  }

  let slot = 0
  const assignAngle = (v: VNode) => {
    const first = slot
    if (v.kids.length === 0) {
      // 连续散布（非奇偶两档）：相邻叶子半径差足够大，标签沿径向错成多排
      v.off = (slotRand(slot) * 2 - 1) * LEAF_JITTER
      slot += 1
      v.angle = angleAt(first, first + 1, true)
    } else {
      v.kids.forEach(assignAngle)
      v.angle = angleAt(first, slot, false)
      // 内部节点：后代叶子偏移均值 + 同层三档扰动（兄弟之间连线长度也不同）
      let sum = 0
      let cnt = 0
      const avg = (node: VNode) => {
        if (node.kids.length === 0) {
          sum += node.off
          cnt += 1
        } else node.kids.forEach(avg)
      }
      avg(v)
      const idxInLevel = Math.round((first + slot) / 2)
      v.off = (cnt ? sum / cnt : 0) + tri(idxInLevel) * (INNER_JITTER[v.depth] ?? 10)
    }
    put(v.id, v.depth, v.angle, v.off)
  }

  // 技能类环：不复用等角均分（那会让 2 个技能类的连线横穿圆心）——
  // 取本组叶子槽位区间中点定位，两组分别落在对侧半圈中心
  roots.forEach((v) => {
    const first = slot
    if (v.kids.length === 0) {
      slot += 1
      put(v.id, 1, angleAt(first, first + 1, true), 0)
    } else {
      v.kids.forEach(assignAngle)
      put(v.id, 1, angleAt(first, slot, false), 0)
    }
  })
  return pos
}

/** 角度归一到 [-π, π] */
function normAngle(a: number): number {
  const TWO = Math.PI * 2
  let x = a % TWO
  if (x > Math.PI) x -= TWO
  if (x < -Math.PI) x += TWO
  return x
}

/** 标签沿径向朝外放置：右/左/上/下四向（G6 v5 支持的枚举） */
function labelPosOf(angle: number): 'right' | 'left' | 'top' | 'bottom' {
  const a = normAngle(angle)
  if (a >= -Math.PI / 4 && a < Math.PI / 4) return 'right'
  if (a >= Math.PI / 4 && a < (3 * Math.PI) / 4) return 'bottom'
  if (a >= (-3 * Math.PI) / 4 && a < -Math.PI / 4) return 'top'
  return 'left'
}

/** 构建带布局坐标的 G6 图数据（每次展开/收起/掌握度变化后重建） */
export function buildGraphData(input: GraphBuildInput): GraphBuildResult {
  const { atlas, getState, closedLx, closedZu, closedXiang } = input
  const roots = buildVTree(atlas, closedLx, closedZu, closedXiang)
  const positions = computeTreePositions(roots)
  const centerPos = positions.get(ROOT_ID)!

  const nodes: G6NodeInput[] = [
    {
      id: ROOT_ID,
      data: {
        kind: 'root', label: '问星', level: 0, expandable: false, open: false,
        angle: centerPos.angle, x: centerPos.x, y: centerPos.y
      },
      style: { x: centerPos.x, y: centerPos.y }
    }
  ]
  const edges: Array<{ source: string; target: string }> = []
  let nodeCount = 1
  const refs = new Map<string, AtlasNodeRef>()

  /** 递归铺设可见节点（depth 1~5）；ancestors 为祖先源对象（引用与路径用） */
  const walk = (
    v: VNode,
    parentId: string,
    ancestors: { zu: SkillZu | null; xiang: SkillXiang | null; kp: SkillKp | null }
  ) => {
    const p = positions.get(v.id)
    if (!p) return
    const curZu = v.zu ?? ancestors.zu
    const curXiang = v.xiang ?? ancestors.xiang
    const curKp = v.kp ?? ancestors.kp
    const isLeaf = v.kids.length === 0

    // 掌握度：叶子三态；内部节点聚合子级计数
    let mastery: AtlasNodeMeta['mastery']
    let masteryCount: string | undefined
    if (isLeaf) {
      mastery = v.kind === 'zk' ? getState(v.label) : undefined
    } else {
      let s = { total: 0, mastered: 0 }
      if (v.kind === 'lx' && v.lx) s = leixingStats(v.lx, getState)
      else if (v.zu) s = zuStats(v.zu, getState)
      else if (v.xiang) s = xiangStats(v.xiang, getState)
      else if (v.kp) s = kpStats(v.kp, getState)
      if (s.mastered > 0) masteryCount = `${s.mastered}/${s.total}`
    }

    nodes.push({
      id: v.id,
      data: {
        kind: v.kind,
        label: v.label,
        level: v.depth,
        expandable: v.kind === 'lx' || v.kind === 'zu' || v.kind === 'xiang',
        open:
          v.kind === 'lx' ? !closedLx.has(v.id)
          : v.kind === 'zu' ? !closedZu.has(v.id)
          : v.kind === 'xiang' ? !closedXiang.has(v.id)
          : true,
        childCount: isLeaf ? undefined : v.kids.length,
        mastery,
        masteryCount,
        angle: p.angle,
        x: p.x,
        y: p.y
      },
      style: { x: p.x, y: p.y }
    })
    edges.push({ source: parentId, target: v.id })
    nodeCount += 1

    // 引用（弹层 / 下钻）
    if (v.kind !== 'root') {
      refs.set(v.id, {
        id: v.id,
        kind: v.kind,
        label: v.label,
        path: [curZu?.n, curXiang?.n, curKp?.n].filter(Boolean).join(' · '),
        li: v.li, zi: v.zi, xi: v.xi, ki: v.ki, si: v.si,
        lx: v.lx,
        zu: curZu ?? undefined,
        xiang: curXiang ?? undefined,
        kp: curKp ?? undefined,
        zk: v.zk
      })
    }

    for (const k of v.kids) walk(k, v.id, { zu: curZu, xiang: curXiang, kp: curKp })
  }

  roots.forEach((v) => walk(v, ROOT_ID, { zu: null, xiang: null, kp: null }))

  // 叶子总数（含收起分支占位）
  let leafTotal = 0
  atlas.leixing.forEach((lx) => lx.zu.forEach((z) => z.xiang.forEach((x) => x.kp.forEach((kp) => (leafTotal += kp.zk.length)))))

  return { nodes, edges, nodeCount, leafTotal, refs }
}

// ===== 收起态节点标签追加成员数；有掌握进度时追加计数 =====
function nodeLabel(meta: AtlasNodeMeta): string {
  const parts = [meta.label]
  if (meta.expandable && !meta.open && meta.childCount) parts.push(`(${meta.childCount})`)
  if (meta.masteryCount) parts.push(meta.masteryCount)
  return parts.join(' ')
}

// 层级色阶
const levelColor: Record<string, string> = {
  root: '#818cf8',
  l1: '#8b5cf6',
  l2: '#6366f1',
  l3: '#818cf8',
  l4: '#a5b4fc',
  l5: '#c7d2fe'
}

// 掌握度三态配色（未学沿用层级默认样式）
const masteryColor = {
  learning: '#818cf8', // 在学：品牌色描边半亮
  mastered: '#4ade80' // 已掌握：实心点亮 + ✓
}

/**
 * 树状视图节点样式（小圆点 + 标签沿径向四向放置）。
 * 叶子（子知识点）按掌握度三态渲染；内部节点有进度时标签追加「已掌握/总数」计数。
 */
export function nodeStyle(d: { data: AtlasNodeMeta }): Record<string, unknown> {
  const meta = d.data
  if (meta.kind === 'root') {
    return {
      size: [56, 56],
      radius: 28,
      fill: levelColor.root,
      stroke: '#a5b4fc',
      lineWidth: 2,
      labelText: meta.label,
      labelFill: '#ffffff',
      labelFontSize: 14,
      labelFontWeight: 700,
      labelPlacement: 'center',
      shadowColor: 'rgba(129,140,248,0.5)',
      shadowBlur: 16,
      cursor: 'pointer'
    }
  }
  if (meta.kind === 'lx') {
    return {
      size: [32, 32],
      radius: 16,
      fill: levelColor.l1,
      stroke: '#c4b5fd',
      lineWidth: 2,
      lineDash: !meta.open ? [3, 3] : [],
      opacity: meta.open ? 1 : 0.85,
      cursor: 'pointer',
      labelText: nodeLabel(meta),
      labelFill: '#f5f3ff',
      labelFontSize: 12,
      labelFontWeight: 700,
      labelPlacement: labelPosOf(meta.angle),
      labelOffset: 8
    }
  }
  if (meta.kind === 'zu') {
    return {
      size: [24, 24],
      radius: 12,
      fill: levelColor.l2,
      stroke: '#a5b4fc',
      lineWidth: 1.5,
      lineDash: !meta.open ? [3, 3] : [],
      opacity: meta.open ? 1 : 0.85,
      cursor: 'pointer',
      labelText: nodeLabel(meta),
      labelFill: '#eef2ff',
      labelFontSize: 11,
      labelFontWeight: 600,
      labelPlacement: labelPosOf(meta.angle),
      labelOffset: 6
    }
  }
  if (meta.kind === 'xiang') {
    return {
      size: [14, 14],
      radius: 7,
      fill: levelColor.l3,
      stroke: 'rgba(255,255,255,0.16)',
      lineWidth: 1,
      lineDash: !meta.open ? [3, 3] : [],
      opacity: meta.open ? 1 : 0.85,
      cursor: 'pointer',
      labelText: nodeLabel(meta),
      labelFill: meta.masteryCount ? '#e7ecff' : '#dbe4ff',
      labelFontSize: 10,
      labelFontWeight: 500,
      labelPlacement: labelPosOf(meta.angle),
      labelOffset: 4
    }
  }
  if (meta.kind === 'kp') {
    return {
      size: [12, 12],
      radius: 6,
      fill: levelColor.l4,
      stroke: 'rgba(255,255,255,0.12)',
      lineWidth: 1,
      cursor: 'pointer',
      labelText: nodeLabel(meta),
      labelFill: meta.masteryCount ? '#e7ecff' : '#dbe4ff',
      labelFontSize: 9,
      labelPlacement: labelPosOf(meta.angle),
      labelOffset: 3
    }
  }
  // 叶子：子知识点（掌握度三态）
  if (meta.mastery === 'mastered') {
    return {
      size: [10, 10],
      radius: 5,
      fill: masteryColor.mastered,
      stroke: '#bbf7d0',
      lineWidth: 1.5,
      shadowColor: 'rgba(74,222,128,0.6)',
      shadowBlur: 8,
      cursor: 'pointer',
      labelText: `${meta.label} ✓`,
      labelFill: masteryColor.mastered,
      labelFontSize: 9,
      labelFontWeight: 600,
      labelPlacement: labelPosOf(meta.angle),
      labelOffset: 3
    }
  }
  if (meta.mastery === 'learning') {
    return {
      size: [10, 10],
      radius: 5,
      fill: 'rgba(129,140,248,0.18)',
      stroke: masteryColor.learning,
      lineWidth: 2,
      cursor: 'pointer',
      labelText: meta.label,
      labelFill: masteryColor.learning,
      labelFontSize: 9,
      labelPlacement: labelPosOf(meta.angle),
      labelOffset: 3
    }
  }
  return {
    size: [10, 10],
    radius: 5,
    fill: levelColor.l5,
    stroke: 'rgba(255,255,255,0.12)',
    lineWidth: 1,
    cursor: 'pointer',
    labelText: meta.label,
    labelFill: '#dbe4ff',
    labelFontSize: 9,
    labelPlacement: labelPosOf(meta.angle),
    labelOffset: 3
  }
}

// ===== 弹层数据模型 =====
/** 弹层内可下钻的子级条目 */
export interface SheetChild {
  id: string
  kind: AtlasKind
  label: string
  /** 叶子三态掌握度 */
  mastery?: MasteryState
  /** 父级「已掌握/总数」计数（有进度时存在） */
  masteryCount?: string
}

/** 底部弹层展示的节点详情 */
export interface SheetNode {
  id: string
  kind: AtlasKind
  label: string
  path: string
  mastery?: MasteryState
  masteryCount?: string
  expandable: boolean
  open: boolean
  childCount?: number
  /** kind = kp / zk 时存在（适用专业 / 证据载体 / 标签、细目） */
  kp?: SkillKp
  zk?: SkillZk
  children: SheetChild[]
}

/** 由节点引用构建弹层数据（children 为浅层列表，点击后经 drillTo 逐层展开） */
export function buildSheetNode(
  ref: AtlasNodeRef,
  getState: (kp: string) => MasteryState,
  closedLx: Set<string>,
  closedZu: Set<string>,
  closedXiang: Set<string>
): SheetNode {
  const children: SheetChild[] = []
  const open =
    ref.kind === 'lx' ? !closedLx.has(ref.id)
    : ref.kind === 'zu' ? !closedZu.has(ref.id)
    : ref.kind === 'xiang' ? !closedXiang.has(ref.id)
    : true

  if (ref.kind === 'lx' && ref.lx) {
    ref.lx.zu.forEach((z, zi) => {
      const s = zuStats(z, getState)
      children.push({
        id: zuId(ref.li, zi), kind: 'zu', label: z.n,
        masteryCount: s.mastered > 0 ? `${s.mastered}/${s.total}` : undefined
      })
    })
  } else if (ref.kind === 'zu' && ref.zu) {
    ref.zu.xiang.forEach((x, xi) => {
      const s = xiangStats(x, getState)
      children.push({
        id: xiangId(ref.li, ref.zi, xi), kind: 'xiang', label: x.n,
        masteryCount: s.mastered > 0 ? `${s.mastered}/${s.total}` : undefined
      })
    })
  } else if (ref.kind === 'xiang' && ref.xiang) {
    ref.xiang.kp.forEach((kp, ki) => {
      const s = kpStats(kp, getState)
      children.push({
        id: kpId(ref.li, ref.zi, ref.xi, ki), kind: 'kp', label: kp.n,
        masteryCount: s.mastered > 0 ? `${s.mastered}/${s.total}` : undefined
      })
    })
  } else if (ref.kind === 'kp' && ref.kp) {
    ref.kp.zk.forEach((zk, si) => {
      children.push({
        id: zkId(ref.li, ref.zi, ref.xi, ref.ki, si), kind: 'zk', label: zk.n,
        mastery: getState(zk.n)
      })
    })
  }

  const s = { total: 0, mastered: 0 }
  if (ref.kind === 'lx' && ref.lx) Object.assign(s, leixingStats(ref.lx, getState))
  else if (ref.kind === 'zu' && ref.zu) Object.assign(s, zuStats(ref.zu, getState))
  else if (ref.kind === 'xiang' && ref.xiang) Object.assign(s, xiangStats(ref.xiang, getState))
  else if (ref.kind === 'kp' && ref.kp) Object.assign(s, kpStats(ref.kp, getState))

  return {
    id: ref.id,
    kind: ref.kind,
    label: ref.label,
    path: ref.path,
    mastery: ref.kind === 'zk' && ref.zk ? getState(ref.zk.n) : undefined,
    masteryCount: s.mastered > 0 ? `${s.mastered}/${s.total}` : undefined,
    expandable: ref.kind === 'lx' || ref.kind === 'zu' || ref.kind === 'xiang',
    open,
    childCount: children.length,
    kp: ref.kp,
    zk: ref.zk,
    children
  }
}
