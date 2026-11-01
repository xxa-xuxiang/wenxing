<script setup lang="ts">
// 问星管理后台 — ECharts 封装：按需引入、主题（midnight/dawn）自适应、尺寸自适应
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, SankeyChart } from 'echarts/charts'
import { CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

echarts.use([
  LineChart,
  BarChart,
  GaugeChart,
  HeatmapChart,
  FunnelChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  UniversalTransition,
  CanvasRenderer
])

const props = withDefaults(
  defineProps<{
    option: EChartsOption | null
    height?: string
    loading?: boolean
  }>(),
  { height: '320px', loading: false }
)

type Dict = Record<string, unknown>

const el = ref<HTMLDivElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 深合并：对象递归合并，数组与原始值直接覆盖（后者优先） */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isDict(base) || !isDict(override)) return base
  const out: Dict = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const prev = out[key]
    out[key] = isDict(prev) && isDict(value) ? deepMerge(prev, value) : value
  }
  return out as unknown as T
}

/** 从 CSS 变量读取当前主题色（仅 midnight / dawn 两主题，切主题时变量随之变化） */
function themeBaseOption(): EChartsOption {
  const style = getComputedStyle(document.documentElement)
  const cssVar = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback
  const textPrimary = cssVar('--wx-text-primary', '#f5f7ff')
  const textSecondary = cssVar('--wx-text-secondary', '#c5cae8')
  const textTertiary = cssVar('--wx-text-tertiary', '#8b91b8')
  const borderSoft = cssVar('--wx-border-soft', 'rgba(255, 255, 255, 0.08)')
  const bgDeep2 = cssVar('--wx-bg-deep-2', '#111733')
  const borderGlow = cssVar('--wx-border-glow', 'rgba(129, 140, 248, 0.35)')

  return {
    color: [
      cssVar('--wx-color-primary', '#818cf8'),
      cssVar('--wx-color-yanqing', '#2dd4bf'),
      cssVar('--wx-color-amber', '#fbbf24'),
      cssVar('--wx-color-vermilion', '#f87171'),
      cssVar('--wx-color-zixia', '#c084fc'),
      cssVar('--wx-state-deep', '#4ade80'),
      cssVar('--wx-state-light', '#fbbf24')
    ],
    textStyle: {
      fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    },
    legend: { textStyle: { color: textSecondary } },
    tooltip: {
      backgroundColor: bgDeep2,
      borderColor: borderGlow,
      textStyle: { color: textPrimary },
      axisPointer: {
        lineStyle: { color: borderGlow },
        crossStyle: { color: borderGlow }
      }
    },
    xAxis: {
      axisLine: { lineStyle: { color: borderSoft } },
      axisTick: { lineStyle: { color: borderSoft } },
      axisLabel: { color: textTertiary },
      splitLine: { lineStyle: { color: borderSoft } }
    },
    yAxis: {
      axisLine: { lineStyle: { color: borderSoft } },
      axisTick: { lineStyle: { color: borderSoft } },
      axisLabel: { color: textTertiary },
      splitLine: { lineStyle: { color: borderSoft } }
    }
  }
}

function applyOption() {
  if (!chart) return
  if (!props.option) {
    chart.clear()
    return
  }
  chart.setOption(deepMerge(themeBaseOption(), props.option), { notMerge: true })
}

onMounted(() => {
  if (!el.value) return
  chart = echarts.init(el.value)
  applyOption()

  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(el.value)

  // 主题切换走 <html data-theme>（midnight/dawn），监听属性变化后按新 CSS 变量重绘
  themeObserver = new MutationObserver(applyOption)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })
})

watch(
  () => props.option,
  () => applyOption(),
  { deep: true }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  themeObserver?.disconnect()
  themeObserver = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="app-chart" :style="{ height: props.height }">
    <div ref="el" class="app-chart-canvas" />
    <div v-if="loading" class="app-chart-mask">加载中…</div>
  </div>
</template>

<style scoped>
.app-chart {
  position: relative;
  width: 100%;
}

.app-chart-canvas {
  width: 100%;
  height: 100%;
}

.app-chart-mask {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wx-text-tertiary);
  font-size: 13px;
  background: var(--wx-glass-bg-strong);
  border-radius: var(--wx-radius-sm);
}
</style>
