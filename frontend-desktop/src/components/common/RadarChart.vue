<script setup lang="ts">
// 问星 v1.0 — 能力雷达图（纯 SVG，无第三方图表依赖）
// 入参 axes = 各维度（名称 + 0-100 数值）：等角顶点绘制 N 边形网格，再叠加数值多边形与顶点圆点
import { computed } from 'vue'

interface RadarAxis {
  label: string
  value: number
}

const props = withDefaults(
  defineProps<{
    axes: RadarAxis[]
    /** 渲染边长（px） */
    size?: number
    /** 网格圈数 */
    levels?: number
  }>(),
  { size: 320, levels: 4 }
)

// 每个实例使用独立渐变 id，避免同页多实例互相覆盖
const gradId = `wx-radar-${Math.random().toString(36).slice(2, 9)}`

const VB = 320
const CX = 160
const CY = 160
const R = 100

const clamp = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0))

interface Vertex {
  label: string
  value: number
  x: number
  y: number
  lx: number
  ly: number
  anchor: 'start' | 'middle' | 'end'
}

const count = computed(() => props.axes.length)

const vertices = computed<Vertex[]>(() =>
  props.axes.map((a, i) => {
    const ang = (-90 + (360 * i) / count.value) * (Math.PI / 180)
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const value = clamp(a.value)
    const rr = (value / 100) * R
    return {
      label: a.label,
      value,
      x: CX + rr * cos,
      y: CY + rr * sin,
      lx: CX + (R + 18) * cos,
      ly: CY + (R + 18) * sin,
      anchor: Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end'
    }
  })
)

const valuePoints = computed(() =>
  vertices.value.map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ')
)

function ringPoints(frac: number): string {
  const pts: string[] = []
  for (let i = 0; i < count.value; i += 1) {
    const ang = (-90 + (360 * i) / count.value) * (Math.PI / 180)
    pts.push(`${(CX + R * frac * Math.cos(ang)).toFixed(1)},${(CY + R * frac * Math.sin(ang)).toFixed(1)}`)
  }
  return pts.join(' ')
}

const rings = computed(() => Array.from({ length: props.levels }, (_, i) => (i + 1) / props.levels))

const spokes = computed(() =>
  Array.from({ length: count.value }, (_, i) => {
    const ang = (-90 + (360 * i) / count.value) * (Math.PI / 180)
    return { x: CX + R * Math.cos(ang), y: CY + R * Math.sin(ang) }
  })
)

/** 顶点标签过长时截断（完整名称在 <title> 中保留） */
const shortLabel = (s: string) => (s.length > 8 ? `${s.slice(0, 8)}…` : s)
</script>

<template>
  <svg
    class="wx-radar"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${VB} ${VB}`"
    role="img"
    aria-label="能力雷达图"
  >
    <defs>
      <linearGradient :id="gradId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#818cf8" stop-opacity="0.55" />
        <stop offset="100%" stop-color="#c084fc" stop-opacity="0.28" />
      </linearGradient>
    </defs>

    <polygon
      v-for="(f, i) in rings"
      :key="`ring-${i}`"
      :points="ringPoints(f)"
      class="wx-radar-ring"
    />
    <line
      v-for="(s, i) in spokes"
      :key="`spoke-${i}`"
      :x1="CX"
      :y1="CY"
      :x2="s.x"
      :y2="s.y"
      class="wx-radar-spoke"
    />

    <polygon :points="valuePoints" :fill="`url(#${gradId})`" class="wx-radar-area" />
    <circle v-for="(v, i) in vertices" :key="`dot-${i}`" :cx="v.x" :cy="v.y" r="3.6" class="wx-radar-dot">
      <title>{{ v.label }}：{{ v.value }}%</title>
    </circle>

    <g v-for="(v, i) in vertices" :key="`lab-${i}`" class="wx-radar-lab">
      <title>{{ v.label }}：{{ v.value }}%</title>
      <text :x="v.lx" :y="v.ly" :text-anchor="v.anchor">{{ shortLabel(v.label) }}</text>
      <text :x="v.lx" :y="v.ly + 13" :text-anchor="v.anchor" class="wx-radar-lab-pct">{{ v.value }}%</text>
    </g>
  </svg>
</template>

<style scoped>
.wx-radar {
  display: block;
  max-width: 100%;
  height: auto;
}
.wx-radar-ring {
  fill: none;
  stroke: color-mix(in srgb, var(--wx-ink) 8%, transparent);
  stroke-width: 1;
}
.wx-radar-spoke {
  stroke: color-mix(in srgb, var(--wx-ink) 10%, transparent);
  stroke-width: 1;
}
.wx-radar-area {
  stroke: var(--wx-color-primary-soft);
  stroke-width: 1.6;
  stroke-linejoin: round;
  transition: all var(--wx-duration-mid) var(--wx-ease-out-soft);
}
.wx-radar-dot {
  fill: #f5f7ff;
  stroke: var(--wx-color-primary);
  stroke-width: 1.5;
}
.wx-radar-lab text {
  font-size: 11px;
  fill: var(--wx-text-secondary);
  font-family: var(--wx-font-sans);
}
.wx-radar-lab .wx-radar-lab-pct {
  font-size: 10px;
  fill: var(--wx-text-muted);
  font-family: var(--wx-font-mono);
}
</style>
