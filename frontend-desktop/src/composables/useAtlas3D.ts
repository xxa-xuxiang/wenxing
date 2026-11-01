// 三维星图渲染核心（Three.js）
// 视觉参照 motion-map-3d 原型：深色空场 + 发光圆点 + 二次贝塞尔曲线连线 + 悬停聚焦压暗
//   + 浅层常驻中文标签 + 自动旋转；结合星图 4000+ 节点量级，节点/连线仍走 WebGL 批量绘制
// 节点：单块 Points（自定义 shader，一次 draw call 画全部发光点，颜色/尺寸/透明度/呼吸均在 GPU 侧）
// 连线：单块 LineSegments（每条边采样二次贝塞尔，按层级与聚焦状态调透明度）
// 文本：仅根 / 技能类 / 族（depth ≤ 2）常驻 HTML 标签；更深层由悬停标签 + 左下信息面板呈现
// 拾取：屏幕空间最近投影（不做全量 Raycaster），仅在指针事件中计算
// 动画：布局变化时 420ms easeOutCubic 插值；自动旋转期间持续渲染
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Ref } from 'vue'

export interface Atlas3DNode {
  id: string
  parentId: string | null
  depth: number
  /** 标签文本（悬停提示 / 浅层常驻标签用） */
  label: string
  /** 世界半径 */
  radius: number
  color: string
  x: number
  y: number
  z: number
  /** 收起态：压暗显示 */
  faded?: boolean
}

/** 三视图相机预设（对齐人脑三视图：外侧面 / 内侧面 / 底面） */
export type AtlasViewPreset = 'lateral' | 'medial' | 'ventral'

interface SceneNode extends Atlas3DNode {
  idx: number
  target: THREE.Vector3
  from: THREE.Vector3
  pos: THREE.Vector3
  colorObj: THREE.Color
}

const ANIM_DURATION = 420
/** 常驻标签只给中心节点；其余层级靠悬停标签 + 信息面板（万级星图铺满标签会互相压字） */
const LABEL_DEPTH = 0
/** 单条连线的贝塞尔采样段数 */
const EDGE_SEGMENTS = 10
/** 深层节点数量大，压暗基础亮度，避免加色混合整体泛白 */
const DEEP_ALPHA = 0.6
const DEEP_FROM = 3

const POINT_VS = `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aHot;
attribute float aSeed;
attribute float aBreath;
uniform float uTime;
uniform float uScale;
uniform float uFocal;
varying vec3 vColor;
varying float vAlpha;
void main() {
  // 呼吸扰动：GPU 侧做，避免每帧回写 4000+ 节点坐标
  vec3 p = position + vec3(
    sin(aSeed * 6.2832),
    cos(aSeed * 4.7124),
    sin(aSeed * 2.3999)
  ) * (sin(uTime * 0.55 + aSeed * 6.2832) * aBreath);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // 景深缩放：近大远小，夹在 0.28~1.15 避免极端透视
  float persp = clamp(uFocal / max(60.0, -mv.z), 0.28, 1.15);
  gl_PointSize = max(4.0, aSize * 1.79 * persp * (1.0 + aHot * 0.7)) * uScale;
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAlpha = aAlpha;
}
`

const POINT_FS = `
uniform float uDark;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  // 实心小圆 + 收得很紧的外发光（对应原型 dot 的 box-shadow 光晕）
  float core = smoothstep(0.56, 0.30, r);
  float glow = pow(max(0.0, 1.0 - r), 3.0) * 0.32;
  float a = (core + glow) * vAlpha;
  if (a < 0.004) discard;
  vec3 col = mix(vColor, vec3(1.0), core * 0.18);
  // 曙光白：光点改为墨色实心点（加色混合换成普通混合后需压深）
  col *= mix(1.0, 0.34, uDark);
  gl_FragColor = vec4(pow(col, vec3(0.4545)), a);
}
`

const LINE_VS = `
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const LINE_FS = `
uniform float uDark;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 col = pow(vColor, vec3(0.4545));
  col *= mix(1.0, 0.5, uDark);
  gl_FragColor = vec4(col, vAlpha * mix(1.0, 1.7, uDark));
}
`

/** 稳定哈希 → [0,1)，给呼吸相位一个不随重建跳动的种子 */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  return (h >>> 0) / 4294967296
}

function quadPoint(
  out: THREE.Vector3,
  a: THREE.Vector3,
  c: THREE.Vector3,
  b: THREE.Vector3,
  t: number
): void {
  const mt = 1 - t
  out.set(
    mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
    mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
    mt * mt * a.z + 2 * mt * t * c.z + t * t * b.z
  )
}

export function useAtlas3D(
  container: Ref<HTMLElement | null>,
  getNodes: () => Atlas3DNode[],
  onPick: (id: string) => void,
  onHover?: (id: string | null) => void
) {
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null

  let points: THREE.Points | null = null
  let pointGeo: THREE.BufferGeometry | null = null
  let pointMat: THREE.ShaderMaterial | null = null
  let posAttr: THREE.BufferAttribute | null = null
  let colorAttr: THREE.BufferAttribute | null = null
  let alphaAttr: THREE.BufferAttribute | null = null
  let hotAttr: THREE.BufferAttribute | null = null
  let nodePositions: Float32Array | null = null
  let nodeAlphas: Float32Array | null = null
  let nodeHots: Float32Array | null = null

  let edgeLine: THREE.LineSegments | null = null
  let edgeGeo: THREE.BufferGeometry | null = null
  let edgeAlphaArr: Float32Array | null = null
  let edgeAlphaBase: Float32Array | null = null
  let edgeAlphaAttr: THREE.BufferAttribute | null = null
  let edgeIndices: Array<{ a: number; b: number }> = []

  let labelLayer: HTMLDivElement | null = null
  let labels: Array<{ id: string; el: HTMLDivElement; node: SceneNode }> = []
  let hoverLabelEl: HTMLDivElement | null = null
  /** 选中节点标记（浮在虚化星图之上，保持清晰并放大） */
  let focusLayer: HTMLDivElement | null = null
  let focusLabelEl: HTMLSpanElement | null = null
  let focusNodeId: string | null = null

  let nodes: SceneNode[] = []
  let nodeById = new Map<string, SceneNode>()
  let prevPositions = new Map<string, THREE.Vector3>()
  let focusChain: Set<string> | null = null

  let hovered: SceneNode | null = null
  let rafId = 0
  let animStart = 0
  let animating = false
  let dirty = true
  /** 聚焦缓动：目标观察点 + 相机落点（每帧插值，null 表示无动画） */
  let camFocus: { target: THREE.Vector3; pos: THREE.Vector3 } | null = null
  /** 视图水平偏移（像素）：把聚焦节点摆到左右两个面板之间的空白区中心 */
  let viewOffsetX = 0
  /** 偏移目标值：与相机同步缓动，避免打开/关闭时画面跳变 */
  let targetViewOffsetX = 0
  let lastFrame = 0
  let pointerDown = { x: 0, y: 0 }
  let hoverScheduled = false
  let hoverPoint: { x: number; y: number } | null = null
  let resizeObserver: ResizeObserver | null = null
  let themeObserver: MutationObserver | null = null

  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const tmpVec = new THREE.Vector3()
  const targetVec = new THREE.Vector3()

  function init(): void {
    const el = container.value
    if (!el || renderer) return
    const w = Math.max(1, el.clientWidth)
    const h = Math.max(1, el.clientHeight)

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.setSize(w, h)
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.cursor = 'grab'
    el.appendChild(renderer.domElement)

    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 4000)
    // 侧前 3/4 视角：能同时看到前后拉长的脑轮廓、左右半球与中线纵裂
    camera.position.set(215, 90, 150)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.6
    controls.zoomSpeed = 0.8
    // 自由移动：左键旋转 / 右键（或双指）平移 / 滚轮缩放，平移沿屏幕平面
    controls.enablePan = true
    controls.screenSpacePanning = true
    controls.panSpeed = 0.9
    controls.minDistance = 12
    controls.maxDistance = 1600
    // 原型默认缓慢自转，让整片星图保持「活着」的呼吸感
    controls.autoRotate = false
    controls.autoRotateSpeed = 0.35

    labelLayer = document.createElement('div')
    labelLayer.className = 'wx-atlas-3d-labels'
    el.appendChild(labelLayer)

    focusLayer = document.createElement('div')
    focusLayer.className = 'wx-atlas-3d-focus'
    focusLayer.innerHTML =
      '<span class="wx-atlas-3d-focus-ring"></span>' +
      '<span class="wx-atlas-3d-focus-dot"></span>' +
      '<span class="wx-atlas-3d-focus-label"></span>'
    focusLabelEl = focusLayer.querySelector<HTMLSpanElement>('.wx-atlas-3d-focus-label')
    el.appendChild(focusLayer)

    bindEvents()

    resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(el)

    // 主题切换（极夜黑 ↔ 曙光白）时立即重配混合模式
    themeObserver = new MutationObserver(() => applyTheme())
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    rafId = requestAnimationFrame(animate)
    dirty = true
  }

  function setAutoRotate(enabled: boolean): void {
    if (!controls) return
    controls.autoRotate = enabled
    dirty = true
  }

  /** 主题适配：曙光白下改用普通混合 + 压深的墨色点/线（加色混合在浅底上会看不见） */
  function applyTheme(): void {
    if (typeof document === 'undefined') return
    const light = document.documentElement.getAttribute('data-theme') === 'dawn'
    const blending = light ? THREE.NormalBlending : THREE.AdditiveBlending
    if (pointMat) {
      pointMat.uniforms.uDark.value = light ? 1 : 0
      pointMat.blending = blending
      pointMat.needsUpdate = true
    }
    const edgeMat = edgeLine?.material as THREE.ShaderMaterial | undefined
    if (edgeMat && edgeMat.uniforms) {
      edgeMat.uniforms.uDark.value = light ? 1 : 0
      edgeMat.blending = blending
      edgeMat.needsUpdate = true
    }
    dirty = true
  }

  function rebuild(animateChange = true): void {
    if (!scene) return
    const prev = prevPositions
    clearNodes()

    const data = getNodes()
    nodes = data.map((d, idx) => {
      const target = new THREE.Vector3(d.x, d.y, d.z)
      const from = prev.get(d.id)?.clone() ?? target.clone()
      return {
        ...d,
        idx,
        target,
        from,
        pos: from.clone(),
        colorObj: new THREE.Color(d.color)
      }
    })
    nodeById = new Map(nodes.map((n) => [n.id, n]))
    prevPositions = new Map(nodes.map((n) => [n.id, n.target.clone()]))

    buildPoints()
    buildEdges()
    buildLabels()

    const changed = nodes.some((n) => !n.from.equals(n.target))
    if (animateChange && changed) {
      animStart = performance.now()
      animating = true
    } else {
      animating = false
      for (const n of nodes) {
        n.from.copy(n.target)
        n.pos.copy(n.target)
        writePos(n)
      }
      markPositions()
      updateEdgeShape()
    }
    applyFocus()
    applyTheme()
    dirty = true
  }

  function clearNodes(): void {
    if (points) {
      scene?.remove(points)
      points = null
    }
    pointGeo?.dispose()
    pointGeo = null
    pointMat?.dispose()
    pointMat = null
    posAttr = null
    colorAttr = null
    alphaAttr = null
    hotAttr = null
    nodePositions = null
    nodeAlphas = null
    nodeHots = null

    if (edgeLine) {
      scene?.remove(edgeLine)
      ;(edgeLine.material as THREE.Material).dispose()
      edgeLine = null
    }
    edgeGeo?.dispose()
    edgeGeo = null
    edgeAlphaArr = null
    edgeAlphaBase = null
    edgeAlphaAttr = null
    edgeIndices = []

    if (labelLayer) labelLayer.textContent = ''
    labels = []
    hoverLabelEl = null

    if (hovered) {
      hovered = null
      onHover?.(null)
    }
    focusChain = null
    nodes = []
    nodeById.clear()
  }

  // ===== 节点（发光点云） =====
  /** 节点基础亮度：收起态压暗；深层节点数量大，整体调低避免加色叠加泛白 */
  function baseAlpha(n: SceneNode): number {
    return (n.faded ? 0.3 : 1) * (n.depth >= DEEP_FROM ? DEEP_ALPHA : 1)
  }

  function buildPoints(): void {
    if (!scene || nodes.length === 0) return
    const count = nodes.length
    nodePositions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const seeds = new Float32Array(count)
    const breaths = new Float32Array(count)
    nodeAlphas = new Float32Array(count)
    nodeHots = new Float32Array(count)

    nodes.forEach((n, i) => {
      const o = i * 3
      nodePositions![o] = n.pos.x
      nodePositions![o + 1] = n.pos.y
      nodePositions![o + 2] = n.pos.z
      colors[o] = n.colorObj.r
      colors[o + 1] = n.colorObj.g
      colors[o + 2] = n.colorObj.b
      // 原型圆点：l1 14px / l2 10px / 深层 3~5px（核心径）
      sizes[i] = 2.4 + n.radius * 2.6
      nodeAlphas![i] = baseAlpha(n)
      seeds[i] = hash01(n.id)
      breaths[i] = n.depth <= 2 ? 1.15 : 0.55
    })

    pointGeo = new THREE.BufferGeometry()
    posAttr = new THREE.BufferAttribute(nodePositions, 3)
    posAttr.setUsage(THREE.DynamicDrawUsage)
    colorAttr = new THREE.BufferAttribute(colors, 3)
    alphaAttr = new THREE.BufferAttribute(nodeAlphas, 1)
    hotAttr = new THREE.BufferAttribute(nodeHots, 1)
    pointGeo.setAttribute('position', posAttr)
    pointGeo.setAttribute('aColor', colorAttr)
    pointGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    pointGeo.setAttribute('aAlpha', alphaAttr)
    pointGeo.setAttribute('aHot', hotAttr)
    pointGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    pointGeo.setAttribute('aBreath', new THREE.BufferAttribute(breaths, 1))

    pointMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: renderer?.getPixelRatio() ?? 1 },
        uFocal: { value: 300 },
        uDark: { value: 0 }
      },
      vertexShader: POINT_VS,
      fragmentShader: POINT_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })

    points = new THREE.Points(pointGeo, pointMat)
    points.frustumCulled = false
    scene.add(points)
  }

  // ===== 连线（二次贝塞尔） =====
  function buildEdges(): void {
    if (!scene) return
    edgeIndices = []
    nodes.forEach((n, i) => {
      if (!n.parentId) return
      const parent = nodeById.get(n.parentId)
      if (parent) edgeIndices.push({ a: parent.idx, b: i })
    })
    const count = edgeIndices.length
    if (count === 0) return

    const vertsPerEdge = EDGE_SEGMENTS * 2
    const total = count * vertsPerEdge
    const positions = new Float32Array(total * 3)
    const colors = new Float32Array(total * 3)
    const alphaArr = new Float32Array(total)
    const alphaBase = new Float32Array(total)

    const ca = new THREE.Color()
    const cb = new THREE.Color()
    const ctrl = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const side = new THREE.Vector3()
    const radial = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const p0 = new THREE.Vector3()
    const p1 = new THREE.Vector3()

    edgeIndices.forEach((e, ei) => {
      const pn = nodes[e.a]
      const cn = nodes[e.b]
      ca.copy(pn.colorObj)
      cb.copy(cn.colorObj)
      if (pn.faded) ca.multiplyScalar(0.45)
      if (cn.faded) cb.multiplyScalar(0.45)

      // 控制点沿切向偏移，连线在 3D 里也带一点弧度（对应原型的二次曲线）
      dir.subVectors(cn.pos, pn.pos)
      const len = dir.length()
      radial.copy(pn.pos).add(cn.pos).multiplyScalar(0.5)
      if (radial.lengthSq() < 1e-4) radial.copy(up)
      radial.normalize()
      side.crossVectors(dir, radial)
      if (side.lengthSq() < 1e-6) side.crossVectors(dir, up)
      side.normalize().multiplyScalar(len * 0.16)
      ctrl.copy(pn.pos).add(cn.pos).multiplyScalar(0.5).add(side)

      // 越深越淡（原型：远/深层连线近乎隐去）
      const base = 0.14 + 0.3 * (1 - Math.min(1, cn.depth / 7))
      const local = ei * vertsPerEdge
      for (let k = 0; k < EDGE_SEGMENTS; k += 1) {
        const t0 = k / EDGE_SEGMENTS
        const t1 = (k + 1) / EDGE_SEGMENTS
        quadPoint(p0, pn.pos, ctrl, cn.pos, t0)
        quadPoint(p1, pn.pos, ctrl, cn.pos, t1)
        const o0 = (local + k * 2) * 3
        const o1 = o0 + 3
        positions[o0] = p0.x
        positions[o0 + 1] = p0.y
        positions[o0 + 2] = p0.z
        positions[o1] = p1.x
        positions[o1 + 1] = p1.y
        positions[o1 + 2] = p1.z
        colors[o0] = ca.r + (cb.r - ca.r) * t0
        colors[o0 + 1] = ca.g + (cb.g - ca.g) * t0
        colors[o0 + 2] = ca.b + (cb.b - ca.b) * t0
        colors[o1] = ca.r + (cb.r - ca.r) * t1
        colors[o1 + 1] = ca.g + (cb.g - ca.g) * t1
        colors[o1 + 2] = ca.b + (cb.b - ca.b) * t1
        alphaArr[local + k * 2] = base
        alphaArr[local + k * 2 + 1] = base
      }
      for (let k = 0; k < vertsPerEdge; k += 1) alphaBase[local + k] = base
    })

    edgeAlphaArr = alphaArr
    edgeAlphaBase = alphaBase

    edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    edgeGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    edgeAlphaAttr = new THREE.BufferAttribute(edgeAlphaArr, 1)
    edgeAlphaAttr.setUsage(THREE.DynamicDrawUsage)
    edgeGeo.setAttribute('aAlpha', edgeAlphaAttr)

    edgeLine = new THREE.LineSegments(
      edgeGeo,
      new THREE.ShaderMaterial({
        uniforms: { uDark: { value: 0 } },
        vertexShader: LINE_VS,
        fragmentShader: LINE_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    edgeLine.frustumCulled = false
    scene.add(edgeLine)
  }

  /** 动画收尾时按节点当前位置重采样曲线（动画期间冻结连线，避免每帧重算 4 万段） */
  function updateEdgeShape(): void {
    if (!edgeGeo || !edgeAlphaBase || edgeIndices.length === 0) return
    const pos = edgeGeo.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const ctrl = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const side = new THREE.Vector3()
    const radial = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const p = new THREE.Vector3()
    const vertsPerEdge = EDGE_SEGMENTS * 2

    edgeIndices.forEach((e, ei) => {
      const pn = nodes[e.a]
      const cn = nodes[e.b]
      dir.subVectors(cn.pos, pn.pos)
      const len = dir.length()
      radial.copy(pn.pos).add(cn.pos).multiplyScalar(0.5)
      if (radial.lengthSq() < 1e-4) radial.copy(up)
      radial.normalize()
      side.crossVectors(dir, radial)
      if (side.lengthSq() < 1e-6) side.crossVectors(dir, up)
      side.normalize().multiplyScalar(len * 0.16)
      ctrl.copy(pn.pos).add(cn.pos).multiplyScalar(0.5).add(side)

      const local = ei * vertsPerEdge
      for (let k = 0; k < vertsPerEdge; k += 1) {
        quadPoint(p, pn.pos, ctrl, cn.pos, k / (vertsPerEdge - 1))
        const o = (local + k) * 3
        arr[o] = p.x
        arr[o + 1] = p.y
        arr[o + 2] = p.z
      }
    })
    pos.needsUpdate = true
  }

  // ===== 标签（浅层常驻 + 悬停单条） =====
  function buildLabels(): void {
    if (!labelLayer) return
    labelLayer.textContent = ''
    labels = []
    for (const n of nodes) {
      if (n.depth > LABEL_DEPTH) continue
      const el = document.createElement('div')
      el.className = `wx-atlas-3d-label lvl-${Math.min(n.depth, 2)}`
      el.textContent = n.label
      el.style.display = 'none'
      labelLayer.appendChild(el)
      labels.push({ id: n.id, el, node: n })
    }
    hoverLabelEl = document.createElement('div')
    hoverLabelEl.className = 'wx-atlas-3d-label lvl-hover'
    hoverLabelEl.style.display = 'none'
    labelLayer.appendChild(hoverLabelEl)
  }

  function labelOpacity(n: SceneNode): number {
    let a = n.faded ? 0.35 : 1
    if (focusChain && !focusChain.has(n.id)) a *= 0.14
    return a
  }

  function placeLabel(el: HTMLDivElement, n: SceneNode): void {
    if (!camera || !container.value) return
    tmpVec.copy(n.pos).project(camera)
    if (tmpVec.z < -1 || tmpVec.z > 1) {
      el.style.display = 'none'
      return
    }
    const w = container.value.clientWidth
    const h = container.value.clientHeight
    el.style.display = 'block'
    el.style.left = `${(tmpVec.x * 0.5 + 0.5) * w}px`
    el.style.top = `${(-tmpVec.y * 0.5 + 0.5) * h}px`
    el.style.opacity = String(labelOpacity(n))
    el.style.zIndex = String(Math.round((1 - tmpVec.z) * 500) + 2)
  }

  function syncFocusMarker(): void {
    if (!focusLayer || !camera || !container.value) return
    const node = focusNodeId ? nodeById.get(focusNodeId) : null
    if (!node) {
      focusLayer.classList.remove('is-on')
      return
    }
    tmpVec.copy(node.pos).project(camera)
    const w = container.value.clientWidth
    const h = container.value.clientHeight
    focusLayer.classList.add('is-on')
    focusLayer.style.left = `${(tmpVec.x * 0.5 + 0.5) * w}px`
    focusLayer.style.top = `${(-tmpVec.y * 0.5 + 0.5) * h}px`
    focusLayer.style.setProperty('--wx-focus-color', node.color)
    if (focusLabelEl && focusLabelEl.textContent !== node.label) {
      focusLabelEl.textContent = node.label
    }
  }

  function syncLabels(): void {
    if (!camera) return
    for (const item of labels) {
      placeLabel(item.el, item.node)
    }
    if (hoverLabelEl) {
      if (hovered && hovered.depth > LABEL_DEPTH) {
        hoverLabelEl.textContent = hovered.label
        placeLabel(hoverLabelEl, hovered)
        hoverLabelEl.style.opacity = '1'
      } else {
        hoverLabelEl.style.display = 'none'
      }
    }
    syncFocusMarker()
  }

  // ===== 聚焦（悬停时压暗非祖先链） =====
  function chainOf(n: SceneNode): Set<string> {
    const set = new Set<string>()
    let cur: SceneNode | null = n
    while (cur) {
      set.add(cur.id)
      cur = cur.parentId ? nodeById.get(cur.parentId) ?? null : null
    }
    return set
  }

  function applyFocus(): void {
    if (!nodes.length || !nodeAlphas || !nodeHots) return
    const chain = hovered ? chainOf(hovered) : null
    focusChain = chain
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i]
      let a = baseAlpha(n)
      if (chain && !chain.has(n.id)) a *= 0.14
      nodeAlphas[i] = a
      nodeHots[i] = n === hovered ? 1 : 0
    }
    if (alphaAttr) alphaAttr.needsUpdate = true
    if (hotAttr) hotAttr.needsUpdate = true

    if (edgeAlphaArr && edgeAlphaBase && edgeAlphaAttr) {
      edgeAlphaArr.set(edgeAlphaBase)
      if (chain) {
        const vertsPerEdge = EDGE_SEGMENTS * 2
        for (let ei = 0; ei < edgeIndices.length; ei += 1) {
          const e = edgeIndices[ei]
          const inChain = chain.has(nodes[e.a].id) && chain.has(nodes[e.b].id)
          const v = inChain ? 0.8 : edgeAlphaBase[ei * vertsPerEdge] * 0.35
          const local = ei * vertsPerEdge
          for (let k = 0; k < vertsPerEdge; k += 1) edgeAlphaArr[local + k] = v
        }
      }
      edgeAlphaAttr.needsUpdate = true
    }
    syncLabels()
  }

  // ===== 坐标写入 =====
  function writePos(n: SceneNode): void {
    if (!nodePositions) return
    const o = n.idx * 3
    nodePositions[o] = n.pos.x
    nodePositions[o + 1] = n.pos.y
    nodePositions[o + 2] = n.pos.z
  }

  function markPositions(): void {
    if (posAttr) posAttr.needsUpdate = true
  }

  function stepAnimation(now: number): void {
    const t = Math.min(1, (now - animStart) / ANIM_DURATION)
    const e = 1 - Math.pow(1 - t, 3)
    for (const n of nodes) {
      n.pos.lerpVectors(n.from, n.target, e)
      writePos(n)
    }
    markPositions()
    if (t >= 1) {
      for (const n of nodes) {
        n.pos.copy(n.target)
        writePos(n)
      }
      markPositions()
      updateEdgeShape()
      animating = false
    }
  }

  function animate(now: number): void {
    rafId = requestAnimationFrame(animate)
    const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0.016)
    lastFrame = now
    if (camFocus && camera && controls) {
      const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6.5)
      controls.target.lerp(camFocus.target, k)
      camera.position.lerp(camFocus.pos, k)
      dirty = true
      if (
        controls.target.distanceToSquared(camFocus.target) < 0.06 &&
        camera.position.distanceToSquared(camFocus.pos) < 0.06
      ) {
        controls.target.copy(camFocus.target)
        camera.position.copy(camFocus.pos)
        camFocus = null
      }
    }
    // 水平视图偏移与相机同步缓动（聚焦节点滑到两框之间 / 关闭时滑回中央）
    const cw = container.value?.clientWidth ?? 0
    const ch = container.value?.clientHeight ?? 0
    if (cw > 0 && Math.abs(viewOffsetX - targetViewOffsetX) > 0.5) {
      const ko = reducedMotion ? 1 : 1 - Math.exp(-dt * 6.5)
      viewOffsetX += (targetViewOffsetX - viewOffsetX) * ko
      if (Math.abs(viewOffsetX - targetViewOffsetX) < 0.5) viewOffsetX = targetViewOffsetX
      applyViewOffset(cw, ch)
      dirty = true
    }
    const moved = controls?.update() ?? false
    if (animating) stepAnimation(now)
    if (!renderer || !scene || !camera) return
    if (pointMat) {
      pointMat.uniforms.uTime.value = reducedMotion ? 0 : now / 1000
      pointMat.uniforms.uFocal.value = camera.position.distanceTo(controls ? controls.target : targetVec)
    }
    if (moved || dirty || animating) {
      renderer.render(scene, camera)
      syncLabels()
      dirty = false
    }
  }

  /** 应用水平视图偏移：正数把画面内容整体左移（用于把节点摆到两框之间） */
  function applyViewOffset(w: number, h: number): void {
    if (!camera) return
    if (viewOffsetX === 0) camera.clearViewOffset()
    else camera.setViewOffset(w, h, viewOffsetX, 0, w, h)
    camera.updateProjectionMatrix()
  }

  function resize(): void {
    const el = container.value
    if (!el || !renderer || !camera) return
    const w = Math.max(1, el.clientWidth)
    const h = Math.max(1, el.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.setSize(w, h)
    camera.aspect = w / h
    applyViewOffset(w, h)
    if (pointMat) pointMat.uniforms.uScale.value = renderer.getPixelRatio()
    dirty = true
  }

  const VIEW_POSITIONS: Record<AtlasViewPreset, [number, number, number]> = {
    lateral: [215, 90, 150],
    medial: [0, 40, 330],
    ventral: [0, -320, 40]
  }

  function setView(preset: AtlasViewPreset): void {
    if (!camera || !controls) return
    const [x, y, z] = VIEW_POSITIONS[preset] ?? VIEW_POSITIONS.lateral
    const el = container.value
    camFocus = null
    viewOffsetX = 0
    targetViewOffsetX = 0
    focusNodeId = null
    if (el) applyViewOffset(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight))
    camera.position.set(x, y, z)
    controls.target.set(0, 0, 0)
    controls.update()
    dirty = true
  }

  /** 各层级的聚焦距离：越深越近，让选中节点在中间空白区明显放大 */
  const FOCUS_DIST = [210, 165, 135, 112, 92, 78, 64, 52]
  /** 全景机位（与 lateral 预设一致）：缩焦时不用当前朝向，避免落在中心球上 */
  const HOME_POS = new THREE.Vector3(215, 90, 150)

  /**
   * 聚焦 / 取消聚焦（原型 select → 相机 zoom in 的同款行为）
   * 保持当前观察方向，只把观察点平移到节点、并拉近相机距离；
   * inset 为左右面板占据的像素边界（相对画布），用于把节点摆到两框之间的中心
   */
  function focusNode(id: string | null, inset?: { left: number; right: number }): void {
    if (!camera || !controls) return
    const node = id ? nodeById.get(id) ?? null : null
    const dir = tmpVec.copy(camera.position).sub(controls.target).normalize()
    const el = container.value
    const w = el ? Math.max(1, el.clientWidth) : 1
    if (!node) {
      focusNodeId = null
      targetViewOffsetX = 0
      camFocus = {
        target: new THREE.Vector3(0, 0, 0),
        pos: HOME_POS.clone()
      }
    } else {
      focusNodeId = node.id
      const gapCenter = inset ? (inset.left + inset.right) / 2 : w / 2
      targetViewOffsetX = Math.max(-w / 4, Math.min(w / 4, w / 2 - gapCenter))
      const dist = FOCUS_DIST[Math.min(node.depth, FOCUS_DIST.length - 1)]
      const target = node.target.clone()
      camFocus = { target, pos: target.clone().add(dir.multiplyScalar(dist)) }
    }
    controls.autoRotate = false
    dirty = true
  }

  function resetView(): void {
    setView('lateral')
  }

  /** 屏幕空间最近投影拾取：比 Raycaster 全量实例扫描便宜得多 */
  function pick(clientX: number, clientY: number): SceneNode | null {
    if (!camera || !renderer || nodes.length === 0) return null
    const rect = renderer.domElement.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    const px = clientX - rect.left
    const py = clientY - rect.top
    if (px < 0 || py < 0 || px > w || py > h) return null

    camera.updateMatrixWorld()
    const fov = (camera.fov * Math.PI) / 180
    let best: SceneNode | null = null
    let bestScore = Infinity
    for (const n of nodes) {
      tmpVec.copy(n.pos).project(camera)
      if (tmpVec.z < -1 || tmpVec.z > 1) continue
      const sx = (tmpVec.x * 0.5 + 0.5) * w
      const sy = (-tmpVec.y * 0.5 + 0.5) * h
      const dist = camera.position.distanceTo(n.pos)
      const projected = (n.radius * h) / (2 * Math.tan(fov / 2) * Math.max(1, dist))
      const hitR = Math.max(9, projected * 1.8)
      const dx = sx - px
      const dy = sy - py
      const d2 = dx * dx + dy * dy
      if (d2 <= hitR * hitR && d2 < bestScore) {
        bestScore = d2
        best = n
      }
    }
    return best
  }

  function updateHover(clientX: number, clientY: number): void {
    const hit = pick(clientX, clientY)
    if (hit === hovered) return
    hovered = hit
    if (renderer) renderer.domElement.style.cursor = hit ? 'pointer' : 'grab'
    applyFocus()
    onHover?.(hit ? hit.id : null)
    dirty = true
  }

  function clearHover(): void {
    if (!hovered) {
      onHover?.(null)
      return
    }
    hovered = null
    if (renderer) renderer.domElement.style.cursor = 'grab'
    applyFocus()
    onHover?.(null)
    dirty = true
  }

  function onPointerDown(e: PointerEvent): void {
    pointerDown = { x: e.clientX, y: e.clientY }
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.button !== 0) return
    const dx = e.clientX - pointerDown.x
    const dy = e.clientY - pointerDown.y
    if (dx * dx + dy * dy > 25) return
    const hit = pick(e.clientX, e.clientY)
    if (hit) onPick(hit.id)
  }

  function onPointerMove(e: PointerEvent): void {
    // 按住拖动是旋转视角，不做 hover 拾取
    if (e.buttons !== 0) return
    hoverPoint = { x: e.clientX, y: e.clientY }
    if (hoverScheduled) return
    hoverScheduled = true
    requestAnimationFrame(() => {
      hoverScheduled = false
      if (hoverPoint) updateHover(hoverPoint.x, hoverPoint.y)
    })
  }

  function onPointerLeave(): void {
    hoverPoint = null
    clearHover()
  }

  function bindEvents(): void {
    const el = renderer?.domElement
    if (!el) return
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerleave', onPointerLeave)
  }

  function unbindEvents(): void {
    const el = renderer?.domElement
    if (!el) return
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerleave', onPointerLeave)
  }

  function destroy(): void {
    cancelAnimationFrame(rafId)
    resizeObserver?.disconnect()
    resizeObserver = null
    themeObserver?.disconnect()
    themeObserver = null
    unbindEvents()
    clearNodes()
    labelLayer?.remove()
    labelLayer = null
    focusLayer?.remove()
    focusLayer = null
    focusLabelEl = null
    focusNodeId = null
    controls?.dispose()
    controls = null
    if (renderer) {
      renderer.dispose()
      renderer.domElement.remove()
      renderer = null
    }
    scene = null
    camera = null
    prevPositions.clear()
  }

  return { init, rebuild, resize, resetView, setView, setAutoRotate, focusNode, destroy }
}
