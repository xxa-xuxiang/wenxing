<script setup lang="ts">
// 知识星图（v2.0 — 三维星图，Three.js 渲染）
// 数据源：scripts/gen-skills-atlas.mjs 预生成的 src/data/skillsAtlas.json（懒加载动态引入）
// 层级：问星(中心) → 技能类(2) → 族(14) → 项(75) → 知识点(319) → 子知识点(1424) → 细目 → 条目（全量铺开）
// 布局（自写纯坐标 O(n)）：人脑形双半球，研究居左、生产居右；
//   深度 → 半球内由脑室到皮层的径向层次，叶槽 → 方位角，面积均匀极角 → 立体铺开，
//   叠加脑回褶皱扰动；技能类与族可点击展开/收起（默认全展开）
// 渲染（useAtlas3D）：Points 发光点云 + 贝塞尔曲线连线（单次 draw call），DPR 上限 1.75
// 视觉：深色空场 + 浅层常驻标签 + 悬停聚焦（高亮祖先链、压暗其余）+ 自动旋转 + 左下信息面板
// 文本：根 / 技能类 / 族常驻标签，更深层由悬停标签与信息面板显示，点击弹详情
// 叶子（子知识点）按掌握度三态着色：未学 / 在学品牌色 / 已掌握绿色点亮
// 父级节点显示子级「已掌握/总数」计数（数据来自 masteryStore 答题回流）
// 点击行为：技能类/族 → 展开收起；项 → 左侧技能目录定位；知识点 → 定位 + 知识点详情；
//   子知识点 → 技能详情（细目 → 条目）；细目 / 条目 → 文档面板（左目录 + 右正文）
// 左侧：技能目录面板（DocsTreePanel，族 → 项 → 知识点）
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMasteryStore } from '@/stores/masteryStore'
import { useAtlas3D, type Atlas3DNode } from '@/composables/useAtlas3D'
import type { SkillsAtlas, SkillKp, SkillLeixing, SkillXiang, SkillXm, SkillZk, SkillZu } from '@/types/skills'
import type { KpPath } from '@/types'
import { http } from '@/services/http'
import { fetchAtlasExtra, type AtlasNewNode } from '@/services/atlasService'
import ExplainModal from '@/components/explain/ExplainModal.vue'
import ExplainResultView from '@/components/explain/ExplainResult.vue'
import AtlasDocPanel from '@/components/atlas/AtlasDocPanel.vue'
import DocsTreePanel from '@/components/atlas/DocsTreePanel.vue'
import { explainCheck } from '@/services/aiService'
import type { ExplainResult } from '@/services/aiService'
import { storage } from '@/utils/storage'

const masteryStore = useMasteryStore()

const containerRef = ref<HTMLDivElement | null>(null)
/** 三维场景是否已初始化（避免重复建场景） */
let sceneReady = false

// 渲染状态 / 节点统计
const rendering = ref(true)
const nodeCount = ref(0)

// ===== 数据（懒加载：JSON 由 gen-skills-atlas.mjs 预生成） =====
const atlas = ref<SkillsAtlas | null>(null)
const atlasLoading = ref(true)
const atlasError = ref(false)

const leixing = computed<SkillLeixing[]>(() => atlas.value?.leixing ?? [])
/** 族名清单（反馈弹窗下拉用） */
const zuNames = computed(() => leixing.value.flatMap((l) => l.zu.map((z) => z.n)))

// ===== 展开模型：技能类 / 族两级可收起（默认全展开） =====
const closedLeixing = ref<Set<string>>(new Set())
const closedZu = ref<Set<string>>(new Set())

const lxId = (li: number) => `lx-${li}`
const zuId = (li: number, zi: number) => `zu-${li}-${zi}`
const xiangId = (li: number, zi: number, xi: number) => `xiang-${li}-${zi}-${xi}`
const kpId = (li: number, zi: number, xi: number, ki: number) => `kp-${li}-${zi}-${xi}-${ki}`
const zkId = (li: number, zi: number, xi: number, ki: number, si: number) =>
  `zk-${li}-${zi}-${xi}-${ki}-${si}`
const xmId = (li: number, zi: number, xi: number, ki: number, si: number, mi: number) =>
  `xm-${li}-${zi}-${xi}-${ki}-${si}-${mi}`
const tmId = (li: number, zi: number, xi: number, ki: number, si: number, mi: number, ti: number) =>
  `tm-${li}-${zi}-${xi}-${ki}-${si}-${mi}-${ti}`

// ===== 反馈入口 =====
const showFeedback = ref(false)
const feedbackText = ref('')
const feedbackZu = ref('')
const feedbackSending = ref(false)
const feedbackSent = ref(false)
const feedbackFail = ref(false)

// ===== 知识点详情弹窗（点击知识点节点） =====
interface KpRef {
  zu: SkillZu
  xiang: SkillXiang
  kp: SkillKp
}
const showKpInfo = ref(false)
const kpInfo = ref<KpRef | null>(null)

// ===== 技能详情弹窗（点击子知识点叶子）：细目 → 条目 + 费曼讲解 / 关联文档 =====
interface SkillRef {
  zu: SkillZu
  xiang: SkillXiang
  kp: SkillKp
  zk: SkillZk
}
const showSkillDetail = ref(false)
const skillDetail = ref<SkillRef | null>(null)

// ===== v0.9 费曼讲解检测 =====
// v0.9 方案 A+：每个知识点的最近一次评估结果缓存（localStorage，随用户隔离）
interface ExplainCache {
  result: ExplainResult
  transcript: string
  t: number
}
const explainCacheKey = (kpName: string) => `explainResult:${kpName}`

function saveExplainCache(kpName: string, result: ExplainResult, transcript: string) {
  const cache: ExplainCache = { result, transcript, t: Date.now() }
  storage.set(explainCacheKey(kpName), cache)
}

function loadExplainCache(kpName: string): ExplainCache | null {
  const cache = storage.get<ExplainCache | null>(explainCacheKey(kpName), null)
  if (!cache || !cache.result || typeof cache.result.total !== 'number') return null
  return cache
}

const skillDetailCache = ref<ExplainCache | null>(null)

// 文档面板（左侧抽屉：该节点子树的文档目录 + 正文）
interface DocTarget {
  title: string
  path: string[]
}
const showDocPanel = ref(false)
const docTarget = ref<DocTarget | null>(null)
/** 聚合候选：点击节点时其子树下的细目 / 条目 */
const docTargets = ref<DocTarget[]>([])
/** 子知识点节点：抽屉内保留「技能详情（费曼讲解）」入口 */
const docDetailRef = ref<SkillRef | null>(null)

function openDocs(header: DocTarget, targets: DocTarget[]) {
  docTarget.value = header
  docTargets.value = targets
  showDocPanel.value = true
}

function openDocPanel(header: DocTarget) {
  docDetailRef.value = null
  openDocs(header, [header])
}

/** 关闭文档小窗：相机镜头动画平滑缩回全景 */
function closeDocs() {
  showDocPanel.value = false
  atlas3d.focusNode(null)
}

function onDocPanelDetail() {
  const r = docDetailRef.value
  if (!r) return
  closeDocs()
  openSkillDetail(r)
}

const showExplainInput = ref(false)
const showExplainResult = ref(false)
const explainLoading = ref(false)
const explainError = ref<string | null>(null)
const explainKp = ref<KpPath | null>(null)
const explainResult = ref<ExplainResult | null>(null)
const explainTranscript = ref('')

/** 子知识点 → 知识点路径（复用 KpPath：category=族 / domain=项 / stack=知识点 / name=子知识点） */
function toKpPath(r: SkillRef): KpPath {
  return { category: r.zu.n, domain: r.xiang.n, stack: r.kp.n, name: r.zk.n }
}

function openSkillDetail(r: SkillRef) {
  skillDetail.value = r
  skillDetailCache.value = loadExplainCache(r.zk.n)
  showSkillDetail.value = true
}

// 查看缓存的上次评估结果（不调 AI，零成本）
function skillDetailViewCache() {
  const cache = skillDetailCache.value
  const r = skillDetail.value
  if (!cache || !r) return
  showSkillDetail.value = false
  explainKp.value = toKpPath(r)
  explainResult.value = cache.result
  explainTranscript.value = cache.transcript
  showExplainResult.value = true
}

function skillDetailExplain() {
  const r = skillDetail.value
  if (!r) return
  showSkillDetail.value = false
  explainKp.value = toKpPath(r)
  explainResult.value = null
  explainError.value = null
  showExplainInput.value = true
}

// 技能详情：跳转文档面板（该子知识点的细目 / 条目都可作为文档主题）
function skillDetailOpenDocs() {
  const r = skillDetail.value
  if (!r) return
  showSkillDetail.value = false
  openDocPanel({ title: r.zk.n, path: [r.zu.n, r.xiang.n, r.kp.n, r.zk.n] })
}

async function submitExplain(transcript: string) {
  if (!explainKp.value || explainLoading.value) return
  explainTranscript.value = transcript
  explainLoading.value = true
  explainError.value = null
  try {
    const kpPath = explainKp.value
    // 上下文：族 / 项 / 知识点 / 子知识点 完整路径
    const context = [kpPath.category, kpPath.domain, kpPath.stack, kpPath.name]
      .filter(Boolean)
      .join(' / ')
    const result = await explainCheck(kpPath.name, transcript, context)
    explainResult.value = result
    showExplainInput.value = false
    showExplainResult.value = true
    // 方案 A+：缓存最近一次评估结果（供「查看上次结果」入口）
    saveExplainCache(kpPath.name, result, transcript)
    // 掌握度回流：讲解通过即视为一次正确回答
    if (result.passed) {
      masteryStore.recordAnswer(kpPath.name, true)
    }
  } catch (e) {
    explainError.value = e instanceof Error ? e.message : '评估失败，请重试'
  } finally {
    explainLoading.value = false
  }
}

function retryExplain() {
  showExplainResult.value = false
  showExplainInput.value = true
}

function closeExplain() {
  showExplainInput.value = false
  showExplainResult.value = false
  explainKp.value = null
  explainResult.value = null
  explainError.value = null
}

// ===== 可见节点树（技能类 / 族可收起，项以下整体铺开） =====
interface VNode {
  id: string
  depth: number
  kind: 'lx' | 'zu' | 'xiang' | 'kp' | 'zk' | 'xm' | 'tm'
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
  off: number // 半径交错偏移（让每条连线长度不同，散开标签）
  kids: VNode[]
}

function buildTmV(tm: string, li: number, zi: number, xi: number, ki: number, si: number, mi: number, ti: number, depth: number): VNode {
  return {
    id: tmId(li, zi, xi, ki, si, mi, ti), depth, kind: 'tm', li, zi, xi, ki, si, mi, ti, label: tm,
    angle: 0, off: 0, kids: []
  }
}

function buildXmV(xm: SkillXm, li: number, zi: number, xi: number, ki: number, si: number, mi: number, depth: number): VNode {
  const v: VNode = {
    id: xmId(li, zi, xi, ki, si, mi), depth, kind: 'xm', li, zi, xi, ki, si, mi, ti: -1, label: xm.n,
    angle: 0, off: 0, kids: []
  }
  xm.tm.forEach((tm, ti) => v.kids.push(buildTmV(tm, li, zi, xi, ki, si, mi, ti, depth + 1)))
  return v
}

function buildZkV(zk: SkillZk, li: number, zi: number, xi: number, ki: number, si: number, depth: number): VNode {
  const v: VNode = {
    id: zkId(li, zi, xi, ki, si), depth, kind: 'zk', li, zi, xi, ki, si, mi: -1, ti: -1, label: zk.n, zk,
    angle: 0, off: 0, kids: []
  }
  zk.xm.forEach((xm, mi) => v.kids.push(buildXmV(xm, li, zi, xi, ki, si, mi, depth + 1)))
  return v
}

function buildKpV(kp: SkillKp, li: number, zi: number, xi: number, ki: number, depth: number): VNode {
  const v: VNode = {
    id: kpId(li, zi, xi, ki), depth, kind: 'kp', li, zi, xi, ki, si: -1, mi: -1, ti: -1, label: kp.n, kp,
    angle: 0, off: 0, kids: []
  }
  kp.zk.forEach((zk, si) => v.kids.push(buildZkV(zk, li, zi, xi, ki, si, depth + 1)))
  return v
}

function buildXiangV(xiang: SkillXiang, li: number, zi: number, xi: number, depth: number): VNode {
  const v: VNode = {
    id: xiangId(li, zi, xi), depth, kind: 'xiang', li, zi, xi, ki: -1, si: -1, mi: -1, ti: -1, label: xiang.n, xiang,
    angle: 0, off: 0, kids: []
  }
  xiang.kp.forEach((kp, ki) => v.kids.push(buildKpV(kp, li, zi, xi, ki, depth + 1)))
  return v
}

function buildZuV(zu: SkillZu, li: number, zi: number, depth: number): VNode {
  const v: VNode = {
    id: zuId(li, zi), depth, kind: 'zu', li, zi, xi: -1, ki: -1, si: -1, mi: -1, ti: -1, label: zu.n, zu,
    angle: 0, off: 0, kids: []
  }
  if (!closedZu.value.has(v.id)) {
    zu.xiang.forEach((xiang, xi) => v.kids.push(buildXiangV(xiang, li, zi, xi, depth + 1)))
  }
  return v
}

function buildVTree(): VNode[] {
  return leixing.value.map((lx, li) => {
    const v: VNode = {
      id: lxId(li), depth: 1, kind: 'lx', li, zi: -1, xi: -1, ki: -1, si: -1, mi: -1, ti: -1, label: lx.n, lx,
      angle: 0, off: 0, kids: []
    }
    if (!closedLeixing.value.has(v.id)) {
      lx.zu.forEach((zu, zi) => v.kids.push(buildZuV(zu, li, zi, 2)))
    }
    return v
  })
}

// ===== 人脑形三维布局 =====
// 研究技能类（li=0）占左半球，生产技能类（li=1）占右半球；两侧共用同一个脑椭球，仅按 x 符号分居
// 深度 1→5 由脑室（中线附近）向外铺到皮层，中线保留极窄纵裂
// 层内极角采用面积均匀分布，保证第三层「项」在高度与纵深上立体散开
// 底部压平 + 额极收窄 + 颞叶外凸 + 外侧裂 / 小脑横沟 + 脑回褶皱，组合出人脑的侧面 / 顶面轮廓
const BRAIN_HALF_W = 58 // 单侧半球横向半轴（含中线间距，整体宽约 120）
const BRAIN_HALF_H = 62 // 上半球高度（底部另按 0.66 压平，正视高宽比约 0.77）
const BRAIN_HALF_L = 82 // 前后半轴（人脑前后最长）
const MEDIAL_GAP = 2.6 // 中线纵裂半宽（顶部再放宽，纵裂更明显）

/** 槽位确定性伪随机 [0,1)：同槽位每次布局结果稳定，不随重绘跳动 */
const slotRand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
/** 字符串哈希 → [0,1)：给内部节点一个稳定的独立极角种子 */
function hashRand(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  return (h >>> 0) / 4294967296
}
/** 面积均匀的球面极角（避开两极堆积，保证各层都是立体的） */
const polarOf = (u: number) => Math.acos(1 - 2 * (0.04 + u * 0.92))

interface Position3 {
  x: number
  y: number
  z: number
}

function compute3DPositions(roots: VNode[]): Map<string, Position3> {
  const pos = new Map<string, Position3>()
  pos.set('center-wenxing', { x: 0, y: 0, z: 0 })

  // 可见最大深度（收起的分支自身算作叶）——仅用于统计展示，布局用固定 7 级分母

  /** 槽位 → 方位角：叶子取槽中点，内部节点取首末槽中点（按单侧半球归一化，两半球各绕满一圈） */
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
        if (p !== undefined) { sum += p; cnt += 1 }
      })
      const mean = cnt ? sum / cnt : Math.PI / 2
      // 自身随机极角占主导：避免父节点（尤其第三层「项」）被均值拉回同一赤道平面
      polarMap.set(v.id, mean * 0.4 + polarOf(hashRand(v.id)) * 0.6)
    }

    // 深度 → 半球内的径向比例：技能类靠近脑室，条目（最深一级）铺在皮层
    // 7 级固定分母 + ^0.85：深层层（细目 / 条目）间距不至于被压得过薄
    const f = 0.16 + 0.84 * Math.pow(Math.min(1, (v.depth - 1) / 6), 0.85)
    // 叶子壳层厚度微扰，避免同一层薄得像一张球壳
    const shell = v.kids.length === 0 ? 1 + (slotRand(slot * 0.73 + 21) * 2 - 1) * 0.06 : 1
    const rr = f * shell
    const p = polarMap.get(v.id) ?? Math.PI / 2
    const theta = v.angle + v.depth * 0.1
    const dx = Math.sin(p) * Math.cos(theta)
    const dy = Math.cos(p)
    const dz = Math.sin(p) * Math.sin(theta)
    // 脑回褶皱：两方向高频起伏 + 三次谐波，外轮廓呈不规则沟回而非光滑椭球
    const gyri = 1 + Math.sin(theta * 7 + 1.2) * 0.09 + Math.sin(p * 11 + 0.7) * 0.055
      + Math.sin(theta * 17 + p * 5 + 2.1) * 0.018
    // 底部压平（颅底），顶部保持圆隆
    let ny = dy < 0 ? dy * 0.6 : dy
    let nz = dz
    // 前后收窄：额极（+z）更窄、枕极（-z）略窄，顶视呈前窄后圆的卵形
    const frontTaper = 1 - 0.14 * Math.max(0, nz)
    const backTaper = 1 - 0.08 * Math.max(0, -nz)
    // 颞叶外凸：侧下方（中段、非前后极）横向鼓出，形成人脑侧面下半的鼓包
    const temporalBand = Math.max(0, 1 - Math.abs(nz) / 0.85) * Math.max(0, -ny)
    let lateralScale = (1 + 0.22 * Math.pow(temporalBand, 0.8)) * frontTaper * backTaper
    // 小脑：后下方（枕下）再向后下方鼓出一块，侧面轮廓出现第二个鼓包；按 |dx| 分左右两叶
    const cbBand = (Math.max(0, -nz - 0.3) / 0.7) * Math.max(0, -ny)
    nz -= 0.12 * cbBand
    ny -= 0.07 * cbBand
    lateralScale *= 1 + 0.06 * cbBand
    // 脑沟：外侧裂（颞叶上缘横向凹槽）+ 中央沟（顶部前后分界）+ 小脑横沟 + 小脑蚓部纵沟
    const sylvian = Math.exp(-Math.pow((ny + 0.18) / 0.07, 2)) * Math.max(0, 1 - Math.abs(nz - 0.3) / 0.75)
    const central = Math.exp(-Math.pow((nz - 0.12) / 0.06, 2)) * Math.max(0, ny)
    const cbSulcus = Math.exp(-Math.pow((nz + 0.62) / 0.07, 2)) * (Math.max(0, -ny - 0.2) / 0.8)
    const cbVermis = Math.exp(-Math.pow(dx / 0.07, 2)) * Math.max(0, -ny - 0.2) * Math.max(0, -nz - 0.3)
    const carve = 1 - 0.22 * Math.min(1, sylvian) - 0.1 * Math.min(1, central)
      - 0.16 * Math.min(1, cbSulcus) - 0.12 * Math.min(1, cbVermis)
    // 脑干：底部中央（中线、前后居中）向上凹，正视能看到颅底中央缺口
    const stem = Math.exp(-Math.pow((nz + 0.05) / 0.18, 2)) * Math.exp(-Math.pow(dx / 0.12, 2)) * Math.max(0, -ny)
    ny += 0.1 * stem

    // 左右半球：x 取 |dx| 折叠，两侧共用同一脑椭球；纵裂在顶部更宽
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

  // 每个半球（技能类）单独归一化方位角，使左右两叶各绕自身一圈
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

// ===== 层级色阶 =====
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

// v0.5 掌握度三态配色（未学沿用层级默认样式，不在此列）
const masteryColor = {
  learning: '#818cf8', // 在学：品牌色
  mastered: '#4ade80' // 已掌握：绿色点亮
}

// 三维节点世界半径（星图外圈半径为 100）
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

// ===== 掌握度统计：叶子 = 子知识点；父级聚合子级「已掌握 / 总数」 =====
function zkStats(zk: SkillZk) {
  return { total: 1, mastered: masteryStore.getState(zk.n) === 'mastered' ? 1 : 0 }
}
function kpStats(kp: SkillKp) {
  let total = 0
  let mastered = 0
  for (const zk of kp.zk) {
    const s = zkStats(zk)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}
function xiangStats(x: SkillXiang) {
  let total = 0
  let mastered = 0
  for (const kp of x.kp) {
    const s = kpStats(kp)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}
function zuStats(z: SkillZu) {
  let total = 0
  let mastered = 0
  for (const x of z.xiang) {
    const s = xiangStats(x)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}
function leixingStats(l: SkillLeixing) {
  let total = 0
  let mastered = 0
  for (const z of l.zu) {
    const s = zuStats(z)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}

interface AtlasNodeMeta {
  kind: 'root' | 'lx' | 'zu' | 'xiang' | 'kp' | 'zk' | 'xm' | 'tm'
  label: string
  level: number
  expandable: boolean
  open: boolean
  /** 收起时显示的子级数 */
  childCount?: number
  /** v0.5：叶子（子知识点）的掌握度三态 */
  mastery?: 'unlearned' | 'learning' | 'mastered'
  /** v0.5：内部节点子级「已掌握/总数」计数（有进度时存在） */
  masteryCount?: string
  [key: string]: unknown
}

// ===== 构建三维场景数据 =====
// 节点 id → 目录定位路径（每次重建刷新）
const locateMap = new Map<string, { zu: string; xiang?: string; kp?: string }>()
// 节点 id → 源对象（点击弹详情用，每次重建刷新）
const zkRefMap = new Map<string, SkillRef>()
// 节点 id → 可见树节点 / 完整路径（点击后收集子树文档用）
const vById = new Map<string, VNode>()
const pathById = new Map<string, string[]>()
const metaById = new Map<string, AtlasNodeMeta>()

/** 单次点击最多收集多少条细目 / 条目作为文档候选 */
const DOC_TARGET_LIMIT = 80

/** 收集某节点子树下的细目 / 条目（含自身），用于聚合文档目录 */
function collectDocTargets(id: string): DocTarget[] {
  const root = vById.get(id)
  if (!root) return []
  const full = pathById.get(id) ?? [root.label]
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

function buildSceneNodes(): Atlas3DNode[] {
  const roots = buildVTree()
  const positions = compute3DPositions(roots)
  const out: Atlas3DNode[] = []
  locateMap.clear()
  zkRefMap.clear()
  vById.clear()
  pathById.clear()
  metaById.clear()

  const rootMeta: AtlasNodeMeta = {
    kind: 'root', label: '问星', level: 0, expandable: false, open: false
  }
  metaById.set('center-wenxing', rootMeta)
  out.push({
    id: 'center-wenxing', parentId: null, depth: 0, label: '问星',
    radius: NODE_RADIUS.root, color: levelColor.root, x: 0, y: 0, z: 0
  })

  /** 递归铺设可见节点（depth 1~7）；祖先前缀用于定位与详情 */
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

    // 掌握度：只有子知识点参与三态着色；其余节点只聚合子级计数
    let mastery: AtlasNodeMeta['mastery']
    let masteryCount: string | undefined
    if (v.kind === 'zk') {
      mastery = masteryStore.getState(v.label)
    } else if (v.kind === 'lx' || v.kind === 'zu' || v.kind === 'xiang' || v.kind === 'kp') {
      let s = { total: 0, mastered: 0 }
      if (v.kind === 'lx' && v.lx) s = leixingStats(v.lx)
      else if (v.zu) s = zuStats(v.zu)
      else if (v.xiang) s = xiangStats(v.xiang)
      else if (v.kp) s = kpStats(v.kp)
      if (s.mastered > 0) masteryCount = `${s.mastered}/${s.total}`
    }

    const open =
      v.kind === 'lx' ? !closedLeixing.value.has(v.id)
        : v.kind === 'zu' ? !closedZu.value.has(v.id)
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

    // 着色：层级色阶；子知识点按掌握度三态；收起态统一压暗
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
    if (curZu && (v.kind === 'xiang' || v.kind === 'kp' || v.kind === 'zk'
      || v.kind === 'xm' || v.kind === 'tm')) {
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

  roots.forEach((v) => walk(v, 'center-wenxing', null, null, null, []))
  nodeCount.value = out.length
  return out
}

// ===== 左侧技能目录定位 =====
interface LocateRequest {
  nonce: number
  zu: string
  xiang?: string
  kp?: string
}
const locateRequest = ref<LocateRequest | null>(null)
let locateNonce = 0

function pushLocate(loc: { zu: string; xiang?: string; kp?: string }) {
  locateNonce += 1
  locateRequest.value = { nonce: locateNonce, ...loc }
}

/** 左栏目录点击知识点 → 弹出知识点详情 */
function onTreeOpenKp(payload: { zu: string; xiang: string; kp: SkillKp }) {
  const zu = leixing.value.flatMap((l) => l.zu).find((z) => z.n === payload.zu)
  const xiang = zu?.xiang.find((x) => x.n === payload.xiang)
  if (!zu || !xiang) return
  kpInfo.value = { zu, xiang, kp: payload.kp }
  showKpInfo.value = true
  // 文档弹窗会盖住详情弹窗，先收起
  closeDocs()
}

/** 文档小窗占据右侧 2/3、左侧目录树占 100vw/7；算出两者之间的空白区（相对星图画布） */
function docFocusInset(): { left: number; right: number } | undefined {
  const el = containerRef.value
  if (!el) return undefined
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const treeRight = 16 + Math.max(184, vw / 7)
  const docLeft = vw - 16 - Math.min(960, Math.max(480, vw * 0.66))
  return { left: treeRight - rect.left, right: docLeft - rect.left }
}

// ===== 三维星图 =====
// 节点点击：
// - 技能类 / 族：展开 / 收起其可见子树
// - 项 / 知识点 / 子知识点 / 细目 / 条目：左侧目录树定位到该节点 +
//   相机拉近聚焦该节点 + 右侧弹出文档模态框（背景虚化），
//   文档为节点子树下的细目 / 条目聚合匹配结果
function handleNodeClick(id: string) {
  if (!id || id === 'center-wenxing') return
  const meta = metaById.get(id)
  if (!meta) return

  if (meta.kind === 'lx' || meta.kind === 'zu') {
    const target = meta.kind === 'lx' ? closedLeixing : closedZu
    const next = new Set(target.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    target.value = next
    atlas3d.rebuild()
    return
  }

  const loc = locateMap.get(id)
  if (loc) pushLocate(loc)

  // 原型 select：相机拉近到该节点（摆到左右两框之间），并停掉自转
  atlas3d.focusNode(id, docFocusInset())
  if (autoSpin.value) {
    autoSpin.value = false
    atlas3d.setAutoRotate(false)
  }

  // 子知识点：抽屉内保留「技能详情（费曼讲解）」入口
  docDetailRef.value = meta.kind === 'zk' ? zkRefMap.get(id) ?? null : null
  const path = pathById.get(id) ?? [meta.label]
  openDocs({ title: meta.label, path }, collectDocTargets(id))
}

/** 层级中文名（左下信息面板的 tag） */
const KIND_LABEL: Record<AtlasNodeMeta['kind'], string> = {
  root: '中心',
  lx: '技能类',
  zu: '族',
  xiang: '项',
  kp: '知识点',
  zk: '子知识点',
  xm: '细目',
  tm: '条目'
}

/** 悬停信息（信息面板数据源；空 = 未悬停） */
const hoverInfo = ref<{ id: string; meta: AtlasNodeMeta } | null>(null)

function handleNodeHover(id: string | null) {
  if (!id) {
    hoverInfo.value = null
    return
  }
  const meta = metaById.get(id)
  hoverInfo.value = meta ? { id, meta } : null
}

const atlas3d = useAtlas3D(containerRef, buildSceneNodes, handleNodeClick, handleNodeHover)

// 自动旋转：跟随原型默认开启，系统开启「减少动态效果」时默认关闭
const autoSpin = ref(
  !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
)

/** 右上操作提示展开状态 */
const showHint = ref(false)

function toggleAutoSpin() {
  autoSpin.value = !autoSpin.value
  atlas3d.setAutoRotate(autoSpin.value)
}

/** 收起态节点标签追加成员数；有掌握进度时追加计数 */
function nodeLabel(meta: AtlasNodeMeta): string {
  const parts = [meta.label]
  if (meta.expandable && !meta.open && meta.childCount) parts.push(`(${meta.childCount})`)
  if (meta.masteryCount) parts.push(meta.masteryCount)
  return parts.join(' ')
}



async function initScene() {
  if (sceneReady) return
  await nextTick()
  if (!containerRef.value) return
  sceneReady = true
  atlas3d.init()
  atlas3d.setAutoRotate(autoSpin.value)
  atlas3d.rebuild(false)
  atlas3d.resetView()
  rendering.value = false
}

// 掌握度变化 → 节流重绘（叶子三态实时点亮）
let statusWatchTimer: number | null = null
watch(
  () => masteryStore.version,
  () => {
    if (!sceneReady) return
    if (statusWatchTimer) clearTimeout(statusWatchTimer)
    statusWatchTimer = window.setTimeout(() => {
      // 掌握度变化只改配色，不需要 420ms 全量位移动画（万级节点会明显掉帧）
      atlas3d.rebuild(false)
    }, 300)
  }
)

function setView(preset: 'lateral' | 'medial' | 'ventral') {
  atlas3d.setView(preset)
}

// ===== 反馈：缺少的能力 =====
function openFeedback() {
  feedbackZu.value = zuNames.value[0] ?? '通用'
  feedbackText.value = ''
  feedbackSent.value = false
  showFeedback.value = true
}

async function submitFeedback() {
  const content = feedbackText.value.trim()
  if (!content || feedbackSending.value) return
  feedbackSending.value = true
  feedbackFail.value = false
  try {
    await http<{ ok?: boolean }>('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        industry: feedbackZu.value || '通用',
        content,
        source: 'atlas'
      })
    })
    feedbackSent.value = true
    feedbackText.value = ''
    window.setTimeout(() => { showFeedback.value = false; feedbackSent.value = false }, 1600)
  } catch {
    feedbackFail.value = true
    window.setTimeout(() => { feedbackFail.value = false }, 2500)
  } finally {
    feedbackSending.value = false
  }
}

onMounted(async () => {
  await nextTick()
  // 数据懒加载：JSON 由 gen-skills-atlas.mjs 预生成（不进首屏 chunk）
  try {
    const mod: any = await import('@/data/skillsAtlas.json')
    atlas.value = (mod?.default ?? mod) as SkillsAtlas
    // 运行时增量：AI 精细大纲补充的新学科/能力（失败只用基础数据）
    const extra = await fetchAtlasExtra()
    if (extra.length > 0) atlas.value = mergeAtlasExtra(atlas.value, extra)
  } catch {
    atlasError.value = true
  }
  atlasLoading.value = false
  await initScene()
})

/** 把后端增量节点合并进星图（只加不改；同名节点复用，不覆盖原有知识点） */
function mergeAtlasExtra(base: SkillsAtlas, nodes: AtlasNewNode[]): SkillsAtlas {
  const leixing: SkillLeixing[] = base.leixing.map((l) => ({
    n: l.n,
    zu: l.zu.map((z) => ({
      n: z.n,
      xiang: z.xiang.map((x) => ({
        n: x.n,
        kp: x.kp.map((k) => ({
          ...k,
          zk: k.zk.map((zk) => ({ n: zk.n, xm: zk.xm.map((xm) => ({ n: xm.n, tm: [...xm.tm] })) }))
        }))
      }))
    }))
  }))
  for (const n of nodes) {
    const lxName = n.leixing || '新增技能'
    let lx = leixing.find((l) => l.n === lxName)
    if (!lx) {
      lx = { n: lxName, zu: [] }
      leixing.push(lx)
    }
    const zuName = n.zu || '通用'
    let zu = lx.zu.find((z) => z.n === zuName)
    if (!zu) {
      zu = { n: zuName, xiang: [] }
      lx.zu.push(zu)
    }
    const xiangName = n.xiang
    let xiang = zu.xiang.find((x) => x.n === xiangName)
    if (!xiang) {
      xiang = { n: xiangName, kp: [] }
      zu.xiang.push(xiang)
    }
    for (const kpName of n.kp) {
      if (!kpName) continue
      if (!xiang.kp.some((k) => k.n === kpName)) {
        xiang.kp.push({ n: kpName, zy: [], zj: [], zk: [{ n: '基础', xm: [] }] })
      }
    }
  }
  return { ...base, leixing }
}

onBeforeUnmount(() => {
  if (statusWatchTimer) clearTimeout(statusWatchTimer)
  atlas3d.destroy()
  sceneReady = false
})
</script>

<template>
  <div class="wx-atlas">
    <div class="wx-atlas-head">
      <h1 class="wx-atlas-title">知识星图</h1>
      <p class="wx-atlas-sub">
        中心「问星」· 甲编 · 学科内技能 · 左研究 / 右生产 · 共 {{ nodeCount }} 个节点 · 悬停聚焦 / 拖拽旋转 / 滚轮缩放
      </p>
    </div>

    <div class="wx-atlas-canvas-wrap">
      <div v-if="rendering || atlasLoading" class="wx-atlas-empty">
        <div class="wx-atlas-empty-mark">✦</div>
        <div class="wx-atlas-empty-text">{{ atlasLoading ? '正在加载技能目录…' : '正在绘制星图…' }}</div>
      </div>

      <div v-else-if="atlasError" class="wx-atlas-empty">
        <div class="wx-atlas-empty-mark">✧</div>
        <div class="wx-atlas-empty-text">技能数据加载失败</div>
        <div class="wx-atlas-empty-tip">请先运行 npm run gen:skills 生成 src/data/skillsAtlas.json</div>
      </div>

      <div ref="containerRef" class="wx-atlas-canvas" :class="{ hidden: rendering || atlasLoading || atlasError }"></div>

      <!-- 左侧：技能目录面板（固定，毛玻璃，可折叠；点击节点可定位） -->
      <DocsTreePanel :zu="leixing.flatMap((l) => l.zu)" :locate="locateRequest" @open-kp="onTreeOpenKp" />

      <!-- 反馈入口 -->
      <button class="wx-atlas-feedback-btn wx-pressable" @click="openFeedback">
        ✧ 缺少能力？
      </button>

      <!-- 三维视角：外侧面 / 内侧面 / 底面（对齐人脑三视图） -->
      <div class="wx-atlas-view-group">
        <button class="wx-atlas-view-btn wx-pressable" @click="setView('lateral')">外侧面</button>
        <button class="wx-atlas-view-btn wx-pressable" @click="setView('medial')">内侧面</button>
        <button class="wx-atlas-view-btn wx-pressable" @click="setView('ventral')">底面</button>
        <button
          class="wx-atlas-view-btn wx-atlas-spin-btn wx-pressable"
          :class="{ on: autoSpin }"
          @click="toggleAutoSpin"
        >
          <span class="wx-atlas-spin-dot"></span>{{ autoSpin ? '自动旋转' : '已静止' }}
        </button>
      </div>

      <!-- 右上：操作提示 + 聚焦全局 -->
      <div class="wx-atlas-topright">
        <button
          class="wx-atlas-view-btn wx-atlas-hint-btn wx-pressable"
          :class="{ on: showHint }"
          @click="showHint = !showHint"
        >操作提示</button>
        <button class="wx-atlas-view-btn wx-pressable" @click="closeDocs">聚焦全局</button>
      </div>

      <div v-if="showHint" class="wx-atlas-hint" @click="showHint = false">
        <div class="wx-atlas-hint-row"><span>拖拽</span>旋转视角 · <span>滚轮</span>缩放 · <span>右键</span>平移</div>
        <div class="wx-atlas-hint-row"><span>悬停</span>节点：高亮祖先链，左下显示节点信息</div>
        <div class="wx-atlas-hint-row"><span>点击</span>节点：目录树定位 + 镜头聚焦 + 右侧打开文档</div>
        <div class="wx-atlas-hint-row"><span>叉掉</span>文档或「聚焦全局」：镜头缩回全景</div>
        <div class="wx-atlas-hint-row"><span>技能类 / 族</span>：点击展开或收起子树</div>
      </div>

      <!-- 悬停信息面板（左下，避开技能目录） -->
      <div v-if="hoverInfo" class="wx-atlas-panel">
        <div class="wx-atlas-panel-tag">{{ KIND_LABEL[hoverInfo.meta.kind] }}</div>
        <div class="wx-atlas-panel-title">{{ hoverInfo.meta.label }}</div>
        <div class="wx-atlas-panel-meta">
          <span>{{ hoverInfo.meta.level }} 级</span>
          <span v-if="hoverInfo.meta.childCount">{{ hoverInfo.meta.childCount }} 个子节点</span>
          <span v-if="hoverInfo.meta.masteryCount">掌握 {{ hoverInfo.meta.masteryCount }}</span>
          <span v-else-if="hoverInfo.meta.mastery === 'mastered'" class="lit">已掌握</span>
          <span v-else-if="hoverInfo.meta.mastery === 'learning'">在学</span>
        </div>
      </div>

      <!-- 图例 -->
      <div class="wx-atlas-legend">
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot" style="background:var(--wx-color-zixia);border:1.5px solid var(--wx-color-zixia)"></span>
          <span>技能类（研究 / 生产）· 点击展开收起</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot" style="background:var(--wx-color-primary-strong)"></span>
          <span>族（能力域）· 点击展开收起</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot" style="background:var(--wx-color-primary)"></span>
          <span>项（技能项）· 点击定位目录</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot" style="background:var(--wx-color-primary-soft)"></span>
          <span>知识点 · 点击查看适用专业 / 标签</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot" style="background:color-mix(in srgb, var(--wx-color-primary-soft) 55%, transparent)"></span>
          <span>子知识点 · 未学</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot wx-atlas-legend-ring"></span>
          <span>子知识点 · 在学</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot wx-atlas-legend-lit"></span>
          <span>子知识点 · 已掌握 ✓</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot" style="background:#dbe2ff"></span>
          <span>细目（语言 / 框架）· 点击看文档</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot" style="background:#eef1ff;box-shadow:0 0 6px #eef1ff"></span>
          <span>条目（最小球）· 点击看文档</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-count">3/12</span>
          <span>父级计数 = 已掌握 / 子知识点总数</span>
        </div>
        <div class="wx-atlas-legend-row">
          <span class="wx-atlas-legend-dot wx-atlas-legend-dim"></span>
          <span>暗色球 = 已收起（点击展开）</span>
        </div>
        <div class="wx-atlas-legend-row wx-atlas-legend-hint">
          <span>左键旋转 · 右键拖拽平移 · 滚轮缩放 · 点击节点</span>
        </div>
      </div>
    </div>

    <!-- 反馈弹窗 -->
    <div v-if="showFeedback" class="wx-modal-mask" @click.self="showFeedback = false">
      <div class="wx-modal">
        <div class="wx-modal-title">补充缺失能力</div>
        <div class="wx-modal-sub">告诉问星还缺什么，我们会持续完善星图</div>
        <div class="wx-modal-field">
          <label>所属族</label>
          <select v-model="feedbackZu">
            <option v-for="n in zuNames" :key="n" :value="n">{{ n }}</option>
            <option value="通用">通用</option>
          </select>
        </div>
        <div class="wx-modal-field">
          <label>缺少的能力描述</label>
          <textarea
            v-model="feedbackText"
            rows="4"
            placeholder="例如：在「D. 技术与工程实现」下缺少「鸿蒙 ArkTS」能力项…"
          ></textarea>
        </div>
        <div class="wx-modal-actions">
          <button class="wx-btn-ghost" @click="showFeedback = false">取消</button>
          <button
            class="wx-btn-gradient wx-pressable"
            :disabled="feedbackSending || !feedbackText.trim()"
            @click="submitFeedback"
          >
            <span v-if="feedbackSending">提交中…</span>
            <span v-else-if="feedbackSent">已收到 ✓</span>
            <span v-else>提交反馈</span>
          </button>
        </div>
        <div v-if="feedbackFail" class="wx-modal-fail">提交失败，请确认后端已启动（server 目录运行 npm run dev）</div>
      </div>
    </div>

    <!-- 知识点详情（点击知识点节点 / 左栏知识点） -->
    <div v-if="showKpInfo && kpInfo" class="wx-modal-mask" @click.self="showKpInfo = false">
      <div class="wx-modal wx-kp-modal">
        <div class="wx-modal-title">{{ kpInfo.kp.n }}</div>
        <div class="wx-modal-sub">{{ kpInfo.zu.n }} · {{ kpInfo.xiang.n }}</div>
        <div class="wx-kp-meta">
          <div class="wx-kp-row">
            <span class="wx-kp-label">适用专业</span>
            <span class="wx-kp-chips">
              <span v-for="t in kpInfo.kp.zy" :key="`zy-${t}`" class="wx-kp-chip">{{ t }}</span>
              <span v-if="!kpInfo.kp.zy.length" class="wx-kp-chip empty">未标注</span>
            </span>
          </div>
          <div class="wx-kp-row">
            <span class="wx-kp-label">证据载体</span>
            <span class="wx-kp-chips">
              <span v-for="t in kpInfo.kp.zj" :key="`zj-${t}`" class="wx-kp-chip">{{ t }}</span>
              <span v-if="!kpInfo.kp.zj.length" class="wx-kp-chip empty">未标注</span>
            </span>
          </div>
          <div class="wx-kp-row">
            <span class="wx-kp-label">标签</span>
            <span class="wx-kp-chips">
              <span v-if="kpInfo.kp.tags?.qy" class="wx-kp-chip tag">迁移性 · {{ kpInfo.kp.tags.qy }}</span>
              <span v-if="kpInfo.kp.tags?.ai" class="wx-kp-chip tag">AI 风险 · {{ kpInfo.kp.tags.ai }}</span>
              <span v-if="kpInfo.kp.tags?.hb" class="wx-kp-chip tag">半衰期 · {{ kpInfo.kp.tags.hb }}</span>
              <span v-if="kpInfo.kp.tags?.zz" class="wx-kp-chip tag zz">执照门槛</span>
              <span v-if="!kpInfo.kp.tags" class="wx-kp-chip empty">未标注</span>
            </span>
          </div>
          <div class="wx-kp-row">
            <span class="wx-kp-label">子知识点</span>
            <span class="wx-kp-count">{{ kpInfo.kp.zk.length }} 个</span>
          </div>
        </div>
        <div class="wx-modal-actions">
          <button class="wx-btn-ghost" @click="showKpInfo = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 技能详情（点击子知识点叶子）：细目 → 条目 + 费曼讲解 / 关联文档 -->
    <div v-if="showSkillDetail && skillDetail" class="wx-modal-mask" @click.self="showSkillDetail = false">
      <div class="wx-modal wx-skill-modal">
        <div class="wx-modal-title">{{ skillDetail.zk.n }}</div>
        <div class="wx-modal-sub">
          {{ skillDetail.zu.n }} · {{ skillDetail.xiang.n }} · {{ skillDetail.kp.n }}
        </div>

        <div class="wx-leaf-action-list">
          <button class="wx-leaf-action-item wx-pressable" @click="skillDetailExplain">
            <span class="wx-leaf-action-icon">✦</span>
            <span class="wx-leaf-action-text">
              <span class="wx-leaf-action-label">费曼讲解</span>
              <span class="wx-leaf-action-desc">用自己的话讲一遍，AI 帮你找出盲区</span>
            </span>
          </button>
          <button
            v-if="skillDetailCache"
            class="wx-leaf-action-item wx-pressable"
            @click="skillDetailViewCache"
          >
            <span class="wx-leaf-action-icon">◷</span>
            <span class="wx-leaf-action-text">
              <span class="wx-leaf-action-label">
                上次评估 {{ skillDetailCache.result.total }} 分
                <span
                  class="wx-leaf-action-cache-tag"
                  :class="{ pass: skillDetailCache.result.passed }"
                >{{ skillDetailCache.result.passed ? '已通过' : '未通过' }}</span>
              </span>
              <span class="wx-leaf-action-desc">查看上次讲解的评估结果（不消耗 AI）</span>
            </span>
          </button>
          <button class="wx-leaf-action-item wx-pressable" @click="skillDetailOpenDocs">
            <span class="wx-leaf-action-icon">❋</span>
            <span class="wx-leaf-action-text">
              <span class="wx-leaf-action-label">关联文档</span>
              <span class="wx-leaf-action-desc">按标题 / 标签匹配已存档文档，未命中可一键生成</span>
            </span>
          </button>
        </div>

        <div class="wx-skill-body">
          <div class="wx-skill-body-title">细目 · 条目（{{ skillDetail.zk.xm.length }} 个细目）</div>
          <div v-for="(xm, i) in skillDetail.zk.xm" :key="xm.n" class="wx-skill-xm">
            <div class="wx-skill-xm-head">
              <span class="wx-skill-xm-idx">{{ i + 1 }}</span>
              <span class="wx-skill-xm-name">{{ xm.n }}</span>
              <span class="wx-skill-xm-count">{{ xm.tm.length }}</span>
            </div>
            <ul class="wx-skill-tm-list">
              <li v-for="t in xm.tm" :key="t" class="wx-skill-tm">{{ t }}</li>
            </ul>
          </div>
        </div>

        <div class="wx-modal-actions">
          <button class="wx-btn-ghost" @click="showSkillDetail = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 文档模态框：右侧弹出，目录为该节点子树聚合出的文档 -->
    <AtlasDocPanel
      :open="showDocPanel"
      :target="docTarget"
      :targets="docTargets"
      :detail-label="docDetailRef ? '费曼讲解 · 技能详情' : ''"
      @detail="onDocPanelDetail"
      @close="closeDocs"
    />

    <!-- v0.9：讲解输入弹窗 -->
    <ExplainModal
      v-if="showExplainInput && explainKp"
      :kp="explainKp"
      @submit="submitExplain"
      @close="closeExplain"
    />

    <!-- v0.9：评估中 loading -->
    <div v-if="explainLoading" class="wx-modal-mask">
      <div class="wx-modal wx-explain-loading">
        <div class="wx-atlas-empty-mark">✦</div>
        <div class="wx-modal-title">问星正在听你的讲解…</div>
        <div class="wx-modal-sub">从概念准确、结构条理、类比落地、盲区自知四个维度评估</div>
      </div>
    </div>

    <!-- v0.9：评估失败提示 -->
    <div v-if="explainError && !showExplainResult" class="wx-modal-mask" @click.self="explainError = null">
      <div class="wx-modal">
        <div class="wx-modal-title">评估失败</div>
        <div class="wx-modal-sub">{{ explainError }}</div>
        <div class="wx-modal-actions">
          <button class="wx-btn-ghost" @click="explainError = null">知道了</button>
        </div>
      </div>
    </div>

    <!-- v0.9：讲解结果展示 -->
    <ExplainResultView
      v-if="showExplainResult && explainResult && explainKp"
      :result="explainResult"
      :kp="explainKp"
      :transcript="explainTranscript"
      :strengthenable="false"
      @retry="retryExplain"
      @close="closeExplain"
    />
  </div>
</template>

<style scoped>
/* 画布铺满整个窗口：标题、图例、按钮均为浮层 */
.wx-atlas {
  position: relative;
  height: 100%;
  width: 100%;
  padding: 0;
  overflow: hidden;
}
.wx-atlas-head {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  text-align: center;
  pointer-events: none;
  max-width: min(720px, 60vw);
}
.wx-atlas-title {
  font-family: var(--wx-font-serif);
  font-size: 26px;
  font-weight: 600;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-atlas-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

.wx-atlas-canvas-wrap {
  position: absolute;
  inset: 0;
  border-radius: 0;
  /* 原型同款深色空场：中心微亮、边缘压黑，让发光点与标签有足够对比 */
  background: radial-gradient(circle at 50% 45%, #0b1020 0%, #05060a 62%, #010207 100%);
  overflow: hidden;
}
.wx-atlas-canvas {
  position: relative;
  width: 100%;
  height: 100%;
}
.wx-atlas-canvas canvas { display: block; }

/* 聚焦节点标记：浮在星图之上，放大显示选中点与名称（不虚化背景） */
:deep(.wx-atlas-3d-focus) {
  position: absolute;
  display: none;
  pointer-events: none;
  z-index: 3;
}
:deep(.wx-atlas-3d-focus.is-on) { display: block; }
:deep(.wx-atlas-3d-focus-dot) {
  position: absolute;
  left: 0;
  top: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--wx-focus-color, #7dd3fc);
  box-shadow:
    0 0 16px var(--wx-focus-color, #7dd3fc),
    0 0 44px color-mix(in srgb, var(--wx-focus-color, #7dd3fc) 55%, transparent);
}
:deep(.wx-atlas-3d-focus-ring) {
  position: absolute;
  left: 0;
  top: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  border: 1px solid color-mix(in srgb, var(--wx-focus-color, #7dd3fc) 55%, transparent);
  animation: wx-focus-pulse 2.4s var(--wx-ease-out-soft) infinite;
}
@keyframes wx-focus-pulse {
  0%, 100% { opacity: .55; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: .18; transform: translate(-50%, -50%) scale(1.35); }
}
:deep(.wx-atlas-3d-focus-label) {
  position: absolute;
  left: 0;
  top: 22px;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--wx-font-serif);
  font-size: 13px;
  letter-spacing: .06em;
  color: var(--wx-text-primary);
  text-shadow: 0 2px 12px rgba(0, 0, 0, .8);
}

/* 场景内标签层：只有根 / 技能类 / 族常驻，其余靠悬停 */
:deep(.wx-atlas-3d-labels) {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}
:deep(.wx-atlas-3d-label) {
  position: absolute;
  transform: translate(-50%, 9px);
  white-space: nowrap;
  font-size: 13px;
  line-height: 1;
  color: #eef3fb;
  text-shadow: 0 1px 8px #000, 0 0 20px #000;
  transition: opacity 0.18s var(--wx-ease-out-soft);
}
:deep(.wx-atlas-3d-label.lvl-0) {
  font-size: 19px;
  font-weight: 700;
}
:deep(.wx-atlas-3d-label.lvl-hover) {
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
}
.wx-atlas-canvas.hidden { visibility: hidden; }

.wx-atlas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  z-index: 2;
}
.wx-atlas-empty-mark {
  font-size: 48px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 14px var(--wx-color-primary));
  animation: wx-breathe 4s var(--wx-ease-in-out-soft) infinite alternate;
}
.wx-atlas-empty-text {
  font-size: 18px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
}
.wx-atlas-empty-tip {
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

/* 图例（右下，位于 AI 悬浮球上方；左侧让位给技能目录面板） */
.wx-atlas-legend {
  position: absolute;
  bottom: 100px;
  right: 16px;
  padding: 12px 16px;
  border-radius: var(--wx-glass-radius);
  background: var(--wx-glass-bg);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  border: 1px solid var(--wx-glass-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 11px;
  color: var(--wx-text-secondary);
  z-index: 3;
}
.wx-atlas-legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-atlas-legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.wx-atlas-legend-dim {
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent) !important;
  border: 1px dashed color-mix(in srgb, var(--wx-ink) 55%, transparent);
}
.wx-atlas-legend-hint {
  padding-top: 6px;
  margin-top: 2px;
  border-top: 1px solid var(--wx-border-soft);
  color: var(--wx-text-tertiary);
  font-size: 10.5px;
}
/* v0.5：掌握度三态图例 */
.wx-atlas-legend-ring {
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent) !important;
  border: 2px solid var(--wx-color-primary);
  box-sizing: border-box;
}
.wx-atlas-legend-lit {
  background: var(--wx-state-deep) !important;
  box-shadow: 0 0 8px color-mix(in srgb, var(--wx-state-deep) 70%, transparent);
}
.wx-atlas-legend-count {
  min-width: 24px;
  padding: 0 4px;
  text-align: center;
  font-size: 10px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  border-radius: 999px;
}

/* 反馈入口按钮（左上，原胶囊导航位；右上让位给技能目录面板） */
.wx-atlas-feedback-btn {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 3;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-glow);
  background: var(--wx-glass-bg);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-atlas-view-group {
  position: absolute;
  top: 16px;
  left: 132px;
  z-index: 3;
  display: flex;
  gap: 6px;
}
.wx-atlas-view-btn {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-glow);
  background: var(--wx-glass-bg);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-atlas-view-btn:hover {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--wx-color-primary) 25%, transparent);
}

/* 自动旋转开关（原型右上 AUTO SPIN 位） */
.wx-atlas-spin-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wx-atlas-spin-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8a97ad;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-atlas-spin-btn.on {
  color: #c7d2fe;
  border-color: color-mix(in srgb, #6366f1 60%, transparent);
}
.wx-atlas-spin-btn.on .wx-atlas-spin-dot {
  background: #a5b4fc;
  box-shadow: 0 0 8px #818cf8;
}

/* 右上：操作提示 + 聚焦全局 */
.wx-atlas-topright {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
  display: flex;
  gap: 6px;
}
.wx-atlas-hint-btn.on {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
}
.wx-atlas-hint {
  position: absolute;
  top: 54px;
  right: 16px;
  z-index: 5;
  width: 300px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  border-radius: var(--wx-glass-radius);
  border: 1px solid var(--wx-glass-border);
  background: var(--wx-glass-bg-strong);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  box-shadow: var(--wx-shadow-md);
  font-size: 12px;
  line-height: 1.55;
  color: var(--wx-text-secondary);
  cursor: pointer;
  animation: wx-hint-in var(--wx-duration-fast) var(--wx-ease-out-soft);
}
@keyframes wx-hint-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.wx-atlas-hint-row span {
  color: var(--wx-color-primary-soft);
  font-weight: 600;
}

/* 曙光白：星图浅底 + 深色标签（着色器内已切普通混合与墨色点） */
html[data-theme="dawn"] .wx-atlas-canvas-wrap {
  background: radial-gradient(circle at 50% 45%, #fdfaf4 0%, #f2ece1 62%, #e9e2d4 100%);
}
:global(html[data-theme="dawn"] .wx-atlas-3d-label) {
  color: #2a2333;
  text-shadow: 0 1px 6px rgba(255, 255, 255, 0.95), 0 0 14px rgba(255, 255, 255, 0.8);
}
:global(html[data-theme="dawn"] .wx-atlas-3d-label.lvl-hover) {
  color: #1a1523;
}
:global(html[data-theme="dawn"] .wx-atlas-3d-focus-label) {
  color: #1a1523;
  text-shadow: 0 1px 8px rgba(255, 255, 255, 0.95);
}
:global(html[data-theme="dawn"] .wx-atlas-3d-focus-dot),
:global(html[data-theme="dawn"] .wx-atlas-3d-focus-ring) {
  filter: brightness(.78) saturate(1.25);
}

/* 悬停信息面板（原型左下信息面板：深色毛玻璃 + 层级 tag） */
.wx-atlas-panel {
  position: absolute;
  bottom: 24px;
  left: calc(100vw / 7 + 32px);
  z-index: 3;
  width: 248px;
  padding: 14px 16px 13px;
  border-radius: 14px;
  color: #eef3fb;
  background: rgba(12, 15, 24, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  pointer-events: none;
}
.wx-atlas-panel-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: #a5b4fc;
  background: rgba(129, 140, 248, 0.14);
}
.wx-atlas-panel-title {
  margin-top: 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}
.wx-atlas-panel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 8px;
  font-size: 11px;
  color: #8a97ad;
}
.wx-atlas-panel-meta .lit {
  color: #4ade80;
}

.wx-atlas-feedback-btn:hover {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--wx-color-primary) 25%, transparent);
}

/* 弹窗 */
.wx-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--wx-bg-deep) 70%, transparent);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-modal {
  width: 420px;
  max-width: 90vw;
  padding: 24px;
  border-radius: var(--wx-glass-radius);
  background: color-mix(in srgb, var(--wx-bg-deep) 95%, transparent);
  border: 1px solid var(--wx-glass-border);
  backdrop-filter: blur(var(--wx-glass-blur));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.wx-modal-title {
  font-size: 18px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
  margin-bottom: 4px;
}
.wx-modal-sub {
  font-size: 12px;
  color: var(--wx-text-tertiary);
  margin-bottom: 18px;
}
.wx-modal-field {
  margin-bottom: 14px;
}
.wx-modal-field label {
  display: block;
  font-size: 12px;
  color: var(--wx-text-secondary);
  margin-bottom: 6px;
}
.wx-modal-field select,
.wx-modal-field textarea {
  width: 100%;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-primary);
  font-size: 13px;
  font-family: var(--wx-font-sans);
  outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-modal-field select:focus,
.wx-modal-field textarea:focus { border-color: var(--wx-border-glow); }
.wx-modal-field textarea { resize: vertical; min-height: 80px; }
.wx-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.wx-modal-fail {
  margin-top: 10px;
  font-size: 12px;
  color: var(--wx-color-vermilion);
  text-align: right;
}
.wx-btn-ghost {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--wx-text-secondary);
  background: transparent;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-btn-ghost:hover {
  color: var(--wx-text-primary);
  border-color: var(--wx-border-glow);
}

/* 知识点详情：适用专业 / 证据载体 / 标签 */
.wx-kp-meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wx-kp-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.wx-kp-label {
  flex-shrink: 0;
  width: 64px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
  padding-top: 2px;
}
.wx-kp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wx-kp-chip {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-kp-chip.tag {
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border-color: color-mix(in srgb, var(--wx-color-primary) 25%, transparent);
}
.wx-kp-chip.zz {
  color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 25%, transparent);
}
.wx-kp-chip.empty {
  color: var(--wx-text-muted);
  border-style: dashed;
}
.wx-kp-count { font-size: 12.5px; color: var(--wx-text-primary); }

/* 技能详情：细目 → 条目 */
.wx-skill-modal {
  width: 540px;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
}
.wx-skill-modal .wx-leaf-action-list { flex-shrink: 0; }
.wx-skill-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 45%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-skill-body-title {
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
  margin-bottom: 10px;
}
.wx-skill-xm { margin-bottom: 12px; }
.wx-skill-xm:last-child { margin-bottom: 0; }
.wx-skill-xm-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-skill-xm-idx {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
}
.wx-skill-xm-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-skill-xm-count {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  color: var(--wx-text-tertiary);
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
}
.wx-skill-tm-list {
  margin: 6px 0 0 26px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wx-skill-tm {
  font-size: 12px;
  color: var(--wx-text-secondary);
  line-height: 1.5;
}
.wx-skill-tm::before {
  content: '·';
  margin-right: 6px;
  color: var(--wx-color-primary-soft);
}

/* v0.9：动作选择条目 */
.wx-leaf-action-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.wx-leaf-action-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
  text-align: left;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-leaf-action-item:hover {
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-leaf-action-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  color: var(--wx-color-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  flex-shrink: 0;
}
.wx-leaf-action-text { display: flex; flex-direction: column; gap: 2px; }
.wx-leaf-action-label { font-size: 13.5px; font-weight: 600; color: var(--wx-text-primary); }
.wx-leaf-action-desc { font-size: 11.5px; color: var(--wx-text-tertiary); }
.wx-leaf-action-cache-tag {
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  background: color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent);
  color: var(--wx-color-vermilion);
}
.wx-leaf-action-cache-tag.pass {
  background: color-mix(in srgb, var(--wx-state-deep) 15%, transparent);
  color: var(--wx-state-deep);
}

.wx-explain-loading { text-align: center; padding: 36px 28px; }
.wx-explain-loading .wx-atlas-empty-mark { font-size: 40px; margin-bottom: 8px; }
</style>
