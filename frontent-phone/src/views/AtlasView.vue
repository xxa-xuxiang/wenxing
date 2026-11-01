<script setup lang="ts">
// 知识星图（移动端 v2.0 — Three.js 三维星图，对齐桌面端）
// 数据源：src/data/skillsAtlas.json（懒加载动态引入）+ 后端增量 /api/atlas/extra
// 层级：问星(中心) → 技能类(2) → 族(14) → 项(75) → 知识点(319) → 子知识点(1424) → 细目 → 条目（全量铺开）
// 布局：桌面端同款人脑形双半球三维布局（atlasModel）
// 渲染：useAtlas3D（Points 发光点云 + 贝塞尔连线，DPR 上限 1.5）
// 交互：
//   技能类 / 族 → 展开收起；项 → 打开目录抽屉定位；知识点 / 子知识点 → 弹层详情 + 聚焦；
//   细目 / 条目 → 聚焦 + 底部文档抽屉（子树聚合匹配）
// 顶部：目录 / 操作提示 / 聚焦全局；底部：三视角 + 自动旋转 + 重置
// 主题：跟随系统 / 极夜黑 / 曙光白（仅星图与桌面风面板使用主题令牌）
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMasteryStore } from '@/stores/masteryStore'
import { useAtlas3D, type AtlasFocusInset } from '@/composables/useAtlas3D'
import {
  buildAtlasModel,
  collectDocTargets,
  countLeaves,
  KIND_LABEL,
  ROOT_ID,
  type AtlasModel,
  type DocTarget,
  type SkillRef
} from '@/utils/atlasModel'
import type {
  SkillKp,
  SkillLeixing,
  SkillXiang,
  SkillZk,
  SkillZu,
  SkillsAtlas
} from '@/utils/skillsAtlas'
import type { SheetChild, SheetNode } from '@/utils/skillsAtlas'
import type { KpPath } from '@/types'
import { storage } from '@/utils/storage'
import { fetchAtlasExtra, type AtlasNewNode } from '@/services/atlasService'
import { explainCheck } from '@/services/aiService'
import type { ExplainResult } from '@/services/aiService'
import DocsTreeSheet from '@/components/atlas/DocsTreeSheet.vue'
import AtlasDocSheet from '@/components/atlas/AtlasDocSheet.vue'
import NodeSheet from '@/components/atlas/NodeSheet.vue'
import ExplainModal from '@/components/explain/ExplainModal.vue'
import ExplainResultView from '@/components/explain/ExplainResult.vue'

const masteryStore = useMasteryStore()
const router = useRouter()

const containerRef = ref<HTMLDivElement | null>(null)
/** 三维场景是否已初始化（避免重复建场景） */
let sceneReady = false

// 渲染状态 / 节点统计
const rendering = ref(true)
const nodeCount = ref(0)
const leafTotal = ref(0)

// ===== 数据（懒加载：JSON 由 gen-skills-atlas.mjs 预生成） =====
const atlas = ref<SkillsAtlas | null>(null)
const atlasLoading = ref(true)
const atlasError = ref(false)

const leixing = computed<SkillLeixing[]>(() => atlas.value?.leixing ?? [])

// ===== 展开模型：技能类 / 族两级可收起（与桌面端一致） =====
const closedLeixing = ref<Set<string>>(new Set())
const closedZu = ref<Set<string>>(new Set())

/** 当前可见模型（每次展开 / 收起 / 掌握度变化后重建） */
let model: AtlasModel | null = null
/** 元信息（重建时更新，供模板 / 点击逻辑读取） */
const metaById = ref(new Map<string, import('@/utils/atlasModel').AtlasNodeMeta>())
const modelVersion = ref(0)

// ===== 目录抽屉定位 =====
interface LocateRequest {
  nonce: number
  zu: string
  xiang?: string
  kp?: string
}
const locateRequest = ref<LocateRequest | null>(null)
let locateNonce = 0
const showTree = ref(false)

// ===== 节点弹层 =====
const showSheet = ref(false)
const sheetNode = ref<SheetNode | null>(null)

// ===== 文档抽屉 =====
const showDoc = ref(false)
const docTarget = ref<DocTarget | null>(null)
const docTargets = ref<DocTarget[]>([])
const docDetail = ref<SkillRef | null>(null)

// ===== 费曼讲解 =====
interface ExplainCache {
  result: ExplainResult
  transcript: string
  t: number
}
const explainCacheKey = (kpName: string) => `explainResult:${kpName}`
const explainCache = ref<ExplainCache | null>(null)
const showExplainInput = ref(false)
const showExplainResult = ref(false)
const explainLoading = ref(false)
const explainError = ref<string | null>(null)
const explainKp = ref<KpPath | null>(null)
const explainResult = ref<ExplainResult | null>(null)
const explainTranscript = ref('')

// ===== 界面状态 =====
const showHint = ref(false)
const legendOpen = ref(false)
const autoSpin = ref(
  !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
)

const KIND_TAG = KIND_LABEL

function pushLocate(loc: { zu: string; xiang?: string; kp?: string }) {
  locateNonce += 1
  locateRequest.value = { nonce: locateNonce, ...loc }
}

/** 重建可见模型并驱动三维场景（animate = 是否播放布局位移动画） */
function rebuild(animate = true): void {
  if (!atlas.value) return
  model = buildAtlasModel(atlas.value, closedLeixing.value, closedZu.value, masteryStore.getState)
  metaById.value = model.metaById
  nodeCount.value = model.nodeCount
  modelVersion.value += 1
  atlas3d.rebuild(animate)
}

const atlas3d = useAtlas3D(
  containerRef,
  () => model?.nodes ?? [],
  (id) => handleNodeClick(id),
  undefined,
  { maxDpr: 1.5 }
)

// ===== 点击分发（对齐桌面端行为，移动端用抽屉 / 弹层替代左右面板） =====
function handleNodeClick(id: string): void {
  if (!id || !model) return
  const meta = model.metaById.get(id)
  if (!meta) return

  if (meta.kind === 'lx' || meta.kind === 'zu') {
    const target = meta.kind === 'lx' ? closedLeixing : closedZu
    const next = new Set(target.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    target.value = next
    rebuild()
    return
  }

  if (meta.kind === 'root') {
    showSheet.value = false
    sheetNode.value = buildSheetNode(id)
    showSheet.value = true
    return
  }

  const loc = model.locateMap.get(id)
  if (loc) pushLocate(loc)

  // 项：打开目录抽屉并定位（桌面端为左栏定位，移动端等效）
  if (meta.kind === 'xiang') {
    showTree.value = true
    atlas3d.focusNode(id)
    stopSpin()
    return
  }

  // 细目 / 条目：底部文档抽屉（子树聚合）
  if (meta.kind === 'xm' || meta.kind === 'tm') {
    const ref = model.zkRefMap.get(id)
    docDetail.value = null
    docTarget.value = { title: meta.label, path: model.pathById.get(id) ?? [meta.label] }
    docTargets.value = collectDocTargets(model, id)
    showDoc.value = true
    loadSheetExplainCache(meta.label)
    atlas3d.focusNode(id, docFocusInset())
    stopSpin()
    return
  }

  // 知识点 / 子知识点：弹层详情 + 聚焦
  sheetNode.value = buildSheetNode(id)
  showSheet.value = true
  if (meta.kind === 'zk') loadSheetExplainCache(meta.label)
  atlas3d.focusNode(id, sheetFocusInset())
  stopSpin()
}

function stopSpin(): void {
  if (autoSpin.value) {
    autoSpin.value = false
    atlas3d.setAutoRotate(false)
  }
}

/** 底部文档抽屉（78vh）遮挡后，节点聚焦到上方可见区 */
function docFocusInset(): AtlasFocusInset | undefined {
  if (!showDoc.value) return undefined
  const el = containerRef.value
  if (!el) return undefined
  const rect = el.getBoundingClientRect()
  const sheetTop = window.innerHeight * 0.22
  return { left: 0, right: rect.width, top: 0, bottom: Math.max(0, rect.bottom - sheetTop) }
}

/** 节点弹层（约 72vh）遮挡后，节点聚焦到上方可见区 */
function sheetFocusInset(): AtlasFocusInset | undefined {
  if (!showSheet.value) return undefined
  const el = containerRef.value
  if (!el) return undefined
  const rect = el.getBoundingClientRect()
  const sheetTop = window.innerHeight * 0.28
  return { left: 0, right: rect.width, top: 0, bottom: Math.max(0, rect.bottom - sheetTop) }
}

/** 由三维模型构建 NodeSheet 数据 */
function buildSheetNode(id: string): SheetNode | null {
  if (!model) return null
  // 中心节点不在可见树里（vById 只收 depth ≥ 1），单独构造
  if (id === ROOT_ID) {
    return {
      id: ROOT_ID,
      kind: 'root',
      label: '问星',
      path: '',
      expandable: false,
      open: false,
      children: leixing.value.map((l, li) => ({
        id: `lx-${li}`,
        kind: 'lx',
        label: l.n
      }))
    }
  }
  const v = model.vById.get(id)
  const meta = model.metaById.get(id)
  if (!v || !meta) return null
  const children: SheetChild[] = v.kids.map((k) => {
    const km = model!.metaById.get(k.id)
    return {
      id: k.id,
      kind: k.kind as SheetChild['kind'],
      label: k.label,
      mastery: km?.mastery,
      masteryCount: km?.masteryCount
    }
  })
  return {
    id,
    kind: meta.kind as SheetNode['kind'],
    label: meta.label,
    path: (model.pathById.get(id) ?? []).slice(0, -1).join(' · '),
    mastery: meta.mastery,
    masteryCount: meta.masteryCount,
    expandable: meta.expandable,
    open: meta.open,
    childCount: meta.childCount,
    kp: v.kp,
    zk: v.zk,
    children
  }
}

/** 弹层内展开 / 收起（技能类 / 族） */
function toggleExpand(node: SheetNode): void {
  if (!node.expandable) return
  const target = node.kind === 'lx' ? closedLeixing : node.kind === 'zu' ? closedZu : null
  if (!target) return
  const next = new Set(target.value)
  if (next.has(node.id)) next.delete(node.id)
  else next.add(node.id)
  target.value = next
  rebuild(true)
  sheetNode.value = buildSheetNode(node.id)
}

/** 弹层条目下钻：确保祖先链展开，再定位 + 聚焦 + 打开子级 */
async function drillTo(child: SheetChild): Promise<void> {
  if (!model) return
  let changed = false
  const remove = (set: typeof closedLeixing, key: string) => {
    if (set.value.has(key)) {
      const next = new Set(set.value)
      next.delete(key)
      set.value = next
      changed = true
    }
  }
  if (child.kind === 'zu') {
    remove(closedLeixing, 'lx-' + child.id.split('-')[1])
    remove(closedZu, child.id)
  } else if (child.kind === 'xiang') {
    remove(closedZu, 'zu-' + child.id.split('-').slice(1, 3).join('-'))
  } else if (child.kind === 'kp' || child.kind === 'zk') {
    remove(closedZu, 'zu-' + child.id.split('-').slice(1, 3).join('-'))
  }
  if (changed) await nextTick()
  if (changed) rebuild(true)

  const meta = model.metaById.get(child.id)
  if (!meta) return
  const loc = model.locateMap.get(child.id)
  if (loc) pushLocate(loc)
  sheetNode.value = buildSheetNode(child.id)
  showSheet.value = true
  if (meta.kind === 'zk') loadSheetExplainCache(meta.label)
  atlas3d.focusNode(child.id, sheetFocusInset())
  stopSpin()
}

/** 目录抽屉里点击知识点 → 知识点详情 */
function onTreeOpenKp(payload: { zu: string; xiang: string; kp: SkillKp }): void {
  const zu = leixing.value.flatMap((l) => l.zu).find((z) => z.n === payload.zu)
  const xiang = zu?.xiang.find((x) => x.n === payload.xiang)
  if (!zu || !xiang) return
  const kpId = findKpId(zu, xiang, payload.kp)
  showTree.value = false
  if (!kpId) return
  sheetNode.value = buildSheetNode(kpId)
  showSheet.value = true
  atlas3d.focusNode(kpId, sheetFocusInset())
}

function findKpId(zu: SkillZu, xiang: SkillXiang, kp: SkillKp): string | null {
  for (const li of leixing.value.keys()) {
    const z = leixing.value[li].zu.find((x) => x.n === zu.n)
    if (!z) continue
    const zi = leixing.value[li].zu.indexOf(z)
    const xi = z.xiang.indexOf(xiang)
    const ki = xiang.kp.indexOf(kp)
    if (xi >= 0 && ki >= 0) return `kp-${li}-${zi}-${xi}-${ki}`
  }
  return null
}

/** 关闭文档抽屉：镜头平滑缩回全景 */
function closeDocs(): void {
  showDoc.value = false
  docDetail.value = null
  atlas3d.focusNode(null)
}

function focusGlobal(): void {
  showSheet.value = false
  showDoc.value = false
  docDetail.value = null
  atlas3d.focusNode(null)
}

function onDocDetail(): void {
  const r = docDetail.value
  if (!r) return
  closeDocs()
  showSheet.value = false
  openExplain(r)
}

// ===== 费曼讲解 =====
function loadSheetExplainCache(kpName: string): void {
  const raw = storage.get<ExplainCache | null>(explainCacheKey(kpName), null)
  explainCache.value = raw && raw.result && typeof raw.result.total === 'number' ? raw : null
}

const sheetExplainCache = computed(() => {
  if (!sheetNode.value || sheetNode.value.kind !== 'zk') return null
  const r = explainCache.value
  return r ? { total: r.result.total, passed: r.result.passed } : null
})

function toKpPath(r: SkillRef): KpPath {
  return { category: r.zu.n, domain: r.xiang.n, stack: r.kp.n, name: r.zk.n }
}

function currentZkRef(): SkillRef | null {
  const n = sheetNode.value
  if (!n || !model) return null
  return model.zkRefMap.get(n.id) ?? null
}

function openExplain(r: SkillRef): void {
  openExplainPath(toKpPath(r))
}

function openExplainPath(kp: KpPath): void {
  explainKp.value = kp
  explainResult.value = null
  explainError.value = null
  showSheet.value = false
  showExplainInput.value = true
}

function onSheetExplain(): void {
  const r = currentZkRef()
  if (r) openExplain(r)
}

function onSheetViewCache(): void {
  const r = currentZkRef()
  const cache = explainCache.value
  if (!r || !cache) return
  showSheet.value = false
  explainKp.value = toKpPath(r)
  explainResult.value = cache.result
  explainTranscript.value = cache.transcript
  showExplainResult.value = true
}

async function submitExplain(transcript: string): Promise<void> {
  if (!explainKp.value || explainLoading.value) return
  explainTranscript.value = transcript
  explainLoading.value = true
  explainError.value = null
  try {
    const kpPath = explainKp.value
    const context = [kpPath.category, kpPath.domain, kpPath.stack, kpPath.name]
      .filter(Boolean)
      .join(' / ')
    const result = await explainCheck(kpPath.name, transcript, context)
    explainResult.value = result
    showExplainInput.value = false
    showExplainResult.value = true
    const cache: ExplainCache = { result, transcript, t: Date.now() }
    storage.set(explainCacheKey(kpPath.name), cache)
    explainCache.value = cache
    if (result.passed) masteryStore.recordAnswer(kpPath.name, true)
  } catch (e) {
    explainError.value = e instanceof Error ? e.message : '评估失败，请重试'
  } finally {
    explainLoading.value = false
  }
}

function retryExplain(): void {
  showExplainResult.value = false
  showExplainInput.value = true
}

function closeExplain(): void {
  showExplainInput.value = false
  showExplainResult.value = false
  explainKp.value = null
  explainResult.value = null
  explainError.value = null
}

// ===== 关联文档（子知识点 / 知识点弹层入口） =====
function onSheetOpenDocs(kpName: string): void {
  if (!kpName.trim()) return
  showSheet.value = false
  docDetail.value = null
  docTarget.value = { title: kpName, path: [] }
  docTargets.value = []
  showDoc.value = true
  atlas3d.focusNode(null, docFocusInset())
  // 先回到全景机位后按抽屉遮挡偏移，避免聚焦空节点
}

function goLearn(): void {
  showSheet.value = false
  void router.push('/learn')
}

// ===== 三维视角 =====
function setView(preset: 'lateral' | 'medial' | 'ventral'): void {
  atlas3d.setView(preset)
}

function toggleAutoSpin(): void {
  autoSpin.value = !autoSpin.value
  atlas3d.setAutoRotate(autoSpin.value)
}

function resetView(): void {
  atlas3d.resetView()
  closeDocs()
}

// ===== 初始化 =====
async function initScene(): Promise<void> {
  if (sceneReady) return
  await nextTick()
  if (!containerRef.value) return
  sceneReady = true
  atlas3d.init()
  atlas3d.setAutoRotate(autoSpin.value)
  rebuild(false)
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
    statusWatchTimer = window.setTimeout(() => rebuild(false), 300)
  }
)

onMounted(async () => {
  await nextTick()
  try {
    const mod: any = await import('@/data/skillsAtlas.json')
    atlas.value = (mod?.default ?? mod) as SkillsAtlas
    leafTotal.value = countLeaves(atlas.value)
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
  const out: SkillLeixing[] = base.leixing.map((l) => ({
    n: l.n,
    zu: l.zu.map((z) => ({
      n: z.n,
      xiang: z.xiang.map((x) => ({
        n: x.n,
        kp: x.kp.map((k) => ({
          ...k,
          zk: k.zk.map((zk: SkillZk) => ({ n: zk.n, xm: zk.xm.map((xm) => ({ n: xm.n, tm: [...xm.tm] })) }))
        }))
      }))
    }))
  }))
  for (const n of nodes) {
    const lxName = n.leixing || '新增技能'
    let lx = out.find((l) => l.n === lxName)
    if (!lx) {
      lx = { n: lxName, zu: [] }
      out.push(lx)
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
  leafTotal.value = countLeaves({ ...base, leixing: out })
  return { ...base, leixing: out }
}

onBeforeUnmount(() => {
  if (statusWatchTimer) clearTimeout(statusWatchTimer)
  atlas3d.destroy()
  sceneReady = false
})
</script>

<template>
  <div class="page-with-tabbar atlas-page">
    <header class="atlas-head">
      <div class="atlas-head-info">
        <h1 class="atlas-title">知识星图</h1>
        <p class="atlas-sub">
          甲编 · 学科内技能 · {{ nodeCount }} 节点 · 已点亮 {{ masteryStore.stats.litCount }}/{{ leafTotal }}
        </p>
      </div>
      <div class="atlas-head-actions">
        <button class="atlas-icon-btn" title="技能目录" @click="showTree = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 4h14" />
            <path d="M7 4v6" />
            <path d="M7 10h9" />
            <path d="M12 10v5" />
            <path d="M12 15h8" />
          </svg>
        </button>
        <button class="atlas-icon-btn" :class="{ on: showHint }" title="操作提示" @click="showHint = !showHint">?</button>
        <button class="atlas-icon-btn wide" @click="focusGlobal">聚焦全局</button>
      </div>
    </header>

    <div class="atlas-canvas-wrap">
      <div v-if="rendering || atlasLoading" class="atlas-state">
        <div class="atlas-state-mark">✦</div>
        <div class="atlas-state-text">{{ atlasLoading ? '正在加载技能目录…' : '正在绘制星图…' }}</div>
      </div>

      <div v-else-if="atlasError" class="atlas-state">
        <div class="atlas-state-mark err">✧</div>
        <div class="atlas-state-text">技能数据加载失败</div>
      </div>

      <div
        ref="containerRef"
        class="atlas-canvas"
        :class="{ hidden: rendering || atlasLoading || atlasError }"
      ></div>

      <!-- 操作提示 -->
      <div v-if="showHint" class="atlas-hint" @click="showHint = false">
        <div class="atlas-hint-row"><span>单指拖拽</span>旋转 · <span>双指</span>缩放 / 平移</div>
        <div class="atlas-hint-row"><span>点按</span>技能类 / 族：展开或收起子树</div>
        <div class="atlas-hint-row"><span>点按</span>项：打开技能目录并定位</div>
        <div class="atlas-hint-row"><span>点按</span>知识点 / 子知识点：详情与费曼讲解</div>
        <div class="atlas-hint-row"><span>点按</span>细目 / 条目：聚焦 + 打开文档抽屉</div>
        <div class="atlas-hint-row"><span>聚焦全局</span>：镜头缩回全景</div>
      </div>

      <!-- 图例（默认折叠为胶囊） -->
      <div class="atlas-legend" :class="{ open: legendOpen }" @click="legendOpen = !legendOpen">
        <div class="atlas-legend-head">
          <i class="lg-dot d-lx"></i><i class="lg-dot d-zu"></i><i class="lg-dot d-xiang"></i>
          <span>图例</span>
          <span class="atlas-legend-toggle">{{ legendOpen ? '收起' : '展开' }}</span>
        </div>
        <div v-if="legendOpen" class="atlas-legend-body" @click.stop>
          <div class="atlas-legend-row"><i class="lg-dot d-lx"></i>技能类（研究 / 生产）· 点按展开收起</div>
          <div class="atlas-legend-row"><i class="lg-dot d-zu"></i>族（能力域）· 点按展开收起</div>
          <div class="atlas-legend-row"><i class="lg-dot d-xiang"></i>项（技能项）· 点按定位目录</div>
          <div class="atlas-legend-row"><i class="lg-dot d-kp"></i>知识点 · 点按查看适用专业 / 标签</div>
          <div class="atlas-legend-row"><i class="lg-dot d-zk"></i>子知识点 · 未学</div>
          <div class="atlas-legend-row"><i class="lg-dot d-learning"></i>子知识点 · 在学</div>
          <div class="atlas-legend-row"><i class="lg-dot d-mastered"></i>子知识点 · 已掌握 ✓</div>
          <div class="atlas-legend-row"><i class="lg-dot d-xm"></i>细目 · 点按看文档</div>
          <div class="atlas-legend-row"><i class="lg-dot d-tm"></i>条目（最小球）· 点按看文档</div>
          <div class="atlas-legend-row"><i class="lg-dot d-dashed"></i>暗色球 = 已收起（点按展开）</div>
        </div>
      </div>

      <!-- 底部工具条 -->
      <div class="atlas-tools">
        <button class="atlas-tool-btn" @click="setView('lateral')">外侧面</button>
        <button class="atlas-tool-btn" @click="setView('medial')">内侧面</button>
        <button class="atlas-tool-btn" @click="setView('ventral')">底面</button>
        <button class="atlas-tool-btn" :class="{ on: autoSpin }" @click="toggleAutoSpin">
          <span class="atlas-spin-dot"></span>{{ autoSpin ? '自动旋转' : '已静止' }}
        </button>
        <button class="atlas-tool-btn" @click="resetView">重置</button>
      </div>
    </div>

    <!-- 技能目录抽屉 -->
    <DocsTreeSheet
      v-model:show="showTree"
      :zu="leixing.flatMap((l) => l.zu)"
      :locate="locateRequest"
      @open-kp="onTreeOpenKp"
    />

    <!-- 节点详情弹层 -->
    <NodeSheet
      :show="showSheet"
      :node="sheetNode"
      :explain-cache="sheetExplainCache"
      @close="showSheet = false"
      @drill="drillTo"
      @toggle-expand="toggleExpand"
      @locate="atlas3d.focusNode($event, sheetFocusInset())"
      @open-docs="onSheetOpenDocs"
      @explain="onSheetExplain"
      @view-cache="onSheetViewCache"
      @learn="goLearn"
    />

    <!-- 文档抽屉 -->
    <AtlasDocSheet
      :open="showDoc"
      :target="docTarget"
      :targets="docTargets"
      :detail-label="docDetail ? '费曼讲解 · 技能详情' : ''"
      @detail="onDocDetail"
      @close="closeDocs"
    />

    <!-- 费曼讲解输入 / 评估中 / 失败 / 结果 -->
    <ExplainModal
      v-if="showExplainInput && explainKp"
      :kp="explainKp"
      @submit="submitExplain"
      @close="closeExplain"
    />
    <div v-if="explainLoading" class="atlas-modal-mask">
      <div class="atlas-modal">
        <div class="atlas-state-mark">✦</div>
        <div class="atlas-modal-title">问星正在听你的讲解…</div>
        <div class="atlas-modal-sub">从概念准确、结构条理、类比落地、盲区自知四个维度评估</div>
      </div>
    </div>
    <div v-if="explainError" class="atlas-modal-mask" @click.self="explainError = null">
      <div class="atlas-modal">
        <div class="atlas-modal-title">评估失败</div>
        <div class="atlas-modal-sub">{{ explainError }}</div>
        <button class="atlas-modal-btn" @click="explainError = null">知道了</button>
      </div>
    </div>
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
.atlas-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--wx-bg-deep);
  color: var(--wx-text-primary);
}
.atlas-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: calc(10px + env(safe-area-inset-top)) 14px 8px;
}
.atlas-head-info { min-width: 0; }
.atlas-title {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.atlas-sub {
  margin: 3px 0 0;
  font-size: 10.5px;
  color: var(--wx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.atlas-head-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.atlas-icon-btn {
  height: 32px;
  min-width: 32px;
  padding: 0 8px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-glow);
  background: var(--wx-glass-bg);
  color: var(--wx-text-secondary);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.atlas-icon-btn.wide { padding: 0 12px; font-size: 11.5px; }
.atlas-icon-btn.on {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
}
.atlas-icon-btn svg { width: 16px; height: 16px; }

.atlas-canvas-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  margin: 2px 0 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 45%, #0b1020 0%, #05060a 62%, #010207 100%);
}
.atlas-canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.atlas-canvas.hidden { visibility: hidden; }
.atlas-canvas :deep(canvas) { display: block; }

.atlas-state {
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
.atlas-state-mark {
  font-size: 38px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 14px var(--wx-color-primary));
}
.atlas-state-mark.err {
  color: var(--wx-text-muted);
  filter: none;
}
.atlas-state-text { font-size: 13px; font-weight: 600; color: var(--wx-text-secondary); }

/* 操作提示 */
.atlas-hint {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 6;
  width: min(320px, calc(100% - 20px));
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-glass-border);
  background: var(--wx-glass-bg-strong);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  box-shadow: var(--wx-shadow-md);
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  line-height: 1.9;
  animation: wx-hint-in 0.2s var(--wx-ease-out-soft);
}
@keyframes wx-hint-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.atlas-hint-row span { color: var(--wx-color-primary-soft); font-weight: 600; }

/* 图例 */
.atlas-legend {
  position: absolute;
  left: 10px;
  bottom: 54px;
  z-index: 4;
  max-width: calc(100% - 20px);
  padding: 7px 10px;
  border-radius: 12px;
  border: 1px solid var(--wx-border-soft);
  background: var(--wx-glass-bg-strong);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  font-size: 10.5px;
  color: var(--wx-text-secondary);
}
.atlas-legend-head {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.atlas-legend-toggle {
  margin-left: auto;
  padding-left: 10px;
  font-size: 10px;
  color: var(--wx-text-muted);
}
.atlas-legend-body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 42vh;
  overflow-y: auto;
}
.atlas-legend-row { display: flex; align-items: center; gap: 7px; }
.lg-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
  box-sizing: border-box;
  flex-shrink: 0;
}
.d-lx { background: #8b5cf6; border: 1px solid #c4b5fd; }
.d-zu { background: #6366f1; }
.d-xiang { background: #818cf8; }
.d-kp { background: #a5b4fc; }
.d-zk { background: #c7d2fe; }
.d-learning { background: rgba(129, 140, 248, 0.18); border: 2px solid #818cf8; }
.d-mastered { background: #4ade80; box-shadow: 0 0 6px rgba(74, 222, 128, 0.7); }
.d-xm { background: #dbe2ff; }
.d-tm { background: #eef1ff; box-shadow: 0 0 6px #eef1ff; }
.d-dashed { background: transparent; border: 1.5px dashed rgba(148, 163, 184, 0.8); }

/* 底部工具条 */
.atlas-tools {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: calc(10px + env(safe-area-inset-bottom));
  z-index: 5;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  white-space: nowrap;
  padding-bottom: 2px;
}
.atlas-tool-btn {
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: var(--wx-glass-bg-strong);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--wx-text-secondary);
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.atlas-tool-btn.on {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
}
.atlas-spin-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.8;
}

/* 3D 标签 / 聚焦标记（useAtlas3D 动态创建，需 :deep 穿透 scope） */
.atlas-canvas :deep(.wx-atlas-3d-labels),
.atlas-canvas :deep(.wx-atlas-3d-focus) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.atlas-canvas :deep(.wx-atlas-3d-label) {
  position: absolute;
  transform: translate(-50%, -140%);
  font-size: 11px;
  color: var(--wx-text-primary);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9), 0 0 14px rgba(0, 0, 0, 0.7);
  white-space: nowrap;
  transition: opacity var(--wx-duration-fast) linear;
}
.atlas-canvas :deep(.wx-atlas-3d-focus) {
  opacity: 0;
  transition: opacity var(--wx-duration-mid) var(--wx-ease-out-soft);
}
.atlas-canvas :deep(.wx-atlas-3d-focus.is-on) { opacity: 1; }
.atlas-canvas :deep(.wx-atlas-3d-focus-dot) {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: var(--wx-focus-color, var(--wx-color-primary));
  box-shadow: 0 0 18px var(--wx-focus-color, var(--wx-color-primary));
}
.atlas-canvas :deep(.wx-atlas-3d-focus-ring) {
  position: absolute;
  width: 34px;
  height: 34px;
  margin: -17px 0 0 -17px;
  border-radius: 50%;
  border: 1.5px solid var(--wx-focus-color, var(--wx-color-primary));
  opacity: 0.7;
  animation: wx-focus-pulse 1.8s var(--wx-ease-in-out-soft) infinite;
}
@keyframes wx-focus-pulse {
  0%, 100% { transform: scale(0.9); opacity: 0.45; }
  50% { transform: scale(1.15); opacity: 0.9; }
}
.atlas-canvas :deep(.wx-atlas-3d-focus-label) {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(12px, -50%);
  font-size: 12px;
  font-weight: 600;
  color: var(--wx-text-primary);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
}

/* 模态（评估中 / 失败） */
.atlas-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 230;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, var(--wx-bg-deep) 72%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.atlas-modal {
  width: 100%;
  max-width: 420px;
  padding: 20px 18px;
  border-radius: var(--wx-glass-radius);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-bg-deep) 94%, transparent);
  box-shadow: var(--wx-shadow-lg);
  text-align: center;
}
.atlas-modal-title { font-size: 15px; font-weight: 600; margin-top: 6px; }
.atlas-modal-sub { margin-top: 6px; font-size: 12px; color: var(--wx-text-tertiary); line-height: 1.6; }
.atlas-modal-btn {
  margin-top: 14px;
  width: 100%;
  padding: 10px 0;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  color: var(--wx-text-secondary);
  font-size: 13px;
}

/* 曙光白适配 */
:global(html[data-theme="dawn"] .atlas-canvas-wrap) {
  background: radial-gradient(circle at 50% 45%, #fdfaf4 0%, #f2ece1 62%, #e9e2d4 100%);
}
:global(html[data-theme="dawn"] .atlas-canvas .wx-atlas-3d-label) {
  color: #2a2333;
  text-shadow: 0 1px 6px rgba(255, 255, 255, 0.95), 0 0 14px rgba(255, 255, 255, 0.8);
}
:global(html[data-theme="dawn"] .atlas-canvas .wx-atlas-3d-focus-label) {
  color: #1a1523;
  text-shadow: 0 1px 8px rgba(255, 255, 255, 0.95);
}
:global(html[data-theme="dawn"] .atlas-canvas .wx-atlas-3d-focus-dot),
:global(html[data-theme="dawn"] .atlas-canvas .wx-atlas-3d-focus-ring) {
  filter: brightness(0.78) saturate(1.25);
}
</style>
