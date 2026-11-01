<script setup lang="ts">
// 问星管理后台 — 数据洞察：转化漏斗 / 路径桑基 / 分布直方图 / 社区构成演变
import { computed, onMounted, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import AppChart from '../components/AppChart.vue'
import EmptyState from '../components/EmptyState.vue'
import { getComposition, getFlowSankey, getFunnel, getScoreHistogram } from '../services/adminApi'
import type {
  CompositionResult,
  FlowSankeyResult,
  FunnelResult,
  FunnelSegment,
  ScoreHistogramResult
} from '../services/types'
import { fmtNum } from '../utils/format'
import { useToast } from '../stores/toast'

const toast = useToast()

const funnel = ref<FunnelResult | null>(null)
const sankey = ref<FlowSankeyResult | null>(null)
const hist = ref<ScoreHistogramResult | null>(null)
const composition = ref<CompositionResult | null>(null)
const loading = ref(false)
const funnelLoading = ref(false)

/* 邀请归因细分：切换只重查漏斗，不影响本页其他图 */
const segment = ref<FunnelSegment>('all')
const SEGMENTS: { key: FunnelSegment; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'invited', label: '邀请注册' },
  { key: 'organic', label: '自然注册' }
]

async function loadFunnel() {
  if (funnelLoading.value) return
  funnelLoading.value = true
  try {
    funnel.value = await getFunnel(90, segment.value === 'all' ? undefined : segment.value)
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    funnelLoading.value = false
  }
}

watch(segment, loadFunnel)

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    const [s, h, c] = await Promise.all([
      getFlowSankey(7),
      getScoreHistogram(),
      getComposition('week')
    ])
    sankey.value = s
    hist.value = h
    composition.value = c
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  refresh()
})

function refresh() {
  load()
  loadFunnel()
}

/* ===== 新用户转化漏斗 ===== */
const steps = computed(() => funnel.value?.steps ?? [])

const funnelOption = computed<EChartsOption | null>(() => {
  const data = funnel.value
  if (!data || !data.cohort || !data.steps.length) return null
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const params = p as { name: string; value: number; dataIndex: number }
        const step = data.steps[params.dataIndex]
        const rate = params.dataIndex > 0 && step ? ` · 转化率 ${(step.rate * 100).toFixed(1)}%` : ''
        return `${params.name}：${fmtNum(params.value)} 人${rate}`
      }
    },
    series: [
      {
        type: 'funnel',
        left: '6%',
        width: '88%',
        top: 8,
        bottom: 8,
        sort: 'descending',
        minSize: '26%',
        maxSize: '100%',
        gap: 4,
        // 标签内置白色：调色板各色均为饱和色，双主题下均可读
        label: { show: true, position: 'inside', color: '#fff', formatter: '{b}：{c}' },
        itemStyle: { borderColor: 'transparent', borderWidth: 0 },
        emphasis: { label: { fontSize: 14, fontWeight: 600 } },
        data: data.steps.map((s) => ({ name: s.label, value: s.count }))
      }
    ]
  }
})

/* ===== 页面路径桑基 ===== */
// 埋点 screen 标识 → 中文名（未收录的保留原名）
const SCREEN_LABELS: Record<string, string> = {
  atlas: '知识星图',
  learn: '学习',
  questions: '题库',
  papers: '试卷',
  quiz: '答题',
  community: '社区',
  me: '个人中心',
  feedback: '反馈',
  auth: '登录/注册'
}
const labelOf = (s: string) => SCREEN_LABELS[s] || s

const sankeyOption = computed<EChartsOption | null>(() => {
  const data = sankey.value
  if (!data || !data.links.length) return null
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const params = p as {
          dataType: string
          name: string
          data?: { source?: string; target?: string; value?: number }
        }
        if (params.dataType === 'edge' && params.data) {
          return `${params.data.source} → ${params.data.target}：${fmtNum(params.data.value ?? 0)} 次`
        }
        return params.name
      }
    },
    series: [
      {
        type: 'sankey',
        left: 24,
        right: 96,
        top: 16,
        bottom: 16,
        nodeWidth: 14,
        nodeGap: 12,
        emphasis: { focus: 'adjacency' },
        // 中性灰蓝：双主题下均可读（桑基标签不走坐标轴主题令牌）
        label: { color: '#8b91b8', fontSize: 12 },
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.35 },
        data: data.nodes.map((n) => ({ name: labelOf(n.name) })),
        links: data.links.map((l) => ({
          source: labelOf(l.source),
          target: labelOf(l.target),
          value: l.value
        }))
      }
    ]
  }
})

/* ===== 分布直方图 ===== */
const scoreHistOption = computed<EChartsOption | null>(() => {
  const rows = hist.value?.score
  if (!rows?.length) return null
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 16, top: 16, bottom: 0, containLabel: true },
    xAxis: { type: 'category', data: rows.map((r) => r.bucket), name: '分' },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', name: '会话数', barMaxWidth: 32, data: rows.map((r) => r.count) }]
  }
})

const stayHistOption = computed<EChartsOption | null>(() => {
  const rows = hist.value?.stay
  if (!rows?.length) return null
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 16, top: 16, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: rows.map((r) => r.bucket),
      name: '停留',
      axisLabel: { interval: 9 }
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', name: '次数', barMaxWidth: 14, data: rows.map((r) => r.count) }]
  }
})

/* ===== 社区构成演变 ===== */
const communityOption = computed<EChartsOption | null>(() => {
  const rows = composition.value?.community
  if (!rows?.length) return null
  const area = { opacity: 0.5 }
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['帖子', '评论', '书籍'] },
    grid: { left: 8, right: 16, top: 32, bottom: 0, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: rows.map((r) => r.bucket) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      { name: '帖子', type: 'line', stack: 'community', smooth: true, symbol: 'none', areaStyle: area, data: rows.map((r) => r.posts) },
      { name: '评论', type: 'line', stack: 'community', smooth: true, symbol: 'none', areaStyle: area, data: rows.map((r) => r.comments) },
      { name: '书籍', type: 'line', stack: 'community', smooth: true, symbol: 'none', areaStyle: area, data: rows.map((r) => r.books) }
    ]
  }
})
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">数据洞察</h1>
        <p class="muted page-sub">转化与流转深度分析</p>
      </div>
      <button type="button" class="btn" :disabled="loading || funnelLoading" @click="refresh">
        {{ loading || funnelLoading ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <div class="grid-2 panel-grid">
      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">新用户转化漏斗</h2>
          <div class="seg-group">
            <button
              v-for="s in SEGMENTS"
              :key="s.key"
              type="button"
              class="seg-btn"
              :class="{ active: segment === s.key }"
              @click="segment = s.key"
            >
              {{ s.label }}
            </button>
          </div>
        </div>
        <p class="muted funnel-sub">
          近 {{ funnel?.days ?? 90 }} 天注册队列 · 共 {{ fmtNum(funnel?.cohort ?? 0) }} 人
        </p>
        <AppChart
          v-if="funnelOption"
          :option="funnelOption"
          height="340px"
          :loading="funnelLoading"
        />
        <EmptyState v-else-if="!funnelLoading" text="暂无转化数据" />
        <p v-else class="muted">加载中…</p>
      </div>

      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">分步转化率</h2>
        </div>
        <table v-if="steps.length" class="rate-table">
          <thead>
            <tr>
              <th>环节</th>
              <th>人数</th>
              <th>相对上一步</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(step, i) in steps" :key="step.key">
              <td class="cell-strong">{{ step.label }}</td>
              <td>{{ fmtNum(step.count) }}</td>
              <td>{{ i === 0 ? '—' : `${(step.rate * 100).toFixed(1)}%` }}</td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else-if="!loading" text="暂无转化数据" />
        <p v-else class="muted">加载中…</p>
        <p class="muted rate-note">
          口径：顺序漏斗，用户需按顺序依次到达各环节；「7 日留存」要求注册满 7 天后仍有活跃。
        </p>
      </div>
    </div>

    <div class="card card-pad block-card">
      <div class="section-head">
        <h2 class="section-title">页面路径桑基</h2>
        <span class="muted">
          近 {{ sankey?.days ?? 7 }} 天 · Top {{ sankey?.links.length ?? 0 }} 条跳转路径{{
            sankey?.truncated ? `（另有 ${sankey.truncated} 条长尾未展示）` : ''
          }}
        </span>
      </div>
      <AppChart
        v-if="sankeyOption"
        :option="sankeyOption"
        height="360px"
        :loading="loading"
      />
      <EmptyState v-else-if="!loading" text="暂无路径数据" />
      <p v-else class="muted">加载中…</p>
    </div>

    <div class="grid-2 panel-grid block-card">
      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">答题得分分布</h2>
          <span class="muted">百分制 · 10 分桶</span>
        </div>
        <AppChart
          v-if="scoreHistOption"
          :option="scoreHistOption"
          height="260px"
          :loading="loading"
        />
        <EmptyState v-else-if="!loading" text="暂无答题数据" />
        <p v-else class="muted">加载中…</p>
      </div>
      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">界面停留时长分布</h2>
          <span class="muted">30 秒桶 · 超过 30 分钟计入末桶</span>
        </div>
        <AppChart
          v-if="stayHistOption"
          :option="stayHistOption"
          height="260px"
          :loading="loading"
        />
        <EmptyState v-else-if="!loading" text="暂无停留数据" />
        <p v-else class="muted">加载中…</p>
      </div>
    </div>

    <div class="card card-pad block-card">
      <div class="section-head">
        <h2 class="section-title">社区构成演变</h2>
        <span class="muted">近 12 周累计 · 帖子 / 评论 / 书籍</span>
      </div>
      <AppChart
        v-if="communityOption"
        :option="communityOption"
        height="280px"
        :loading="loading"
      />
      <EmptyState v-else-if="!loading" text="暂无社区数据" />
      <p v-else class="muted">加载中…</p>
    </div>
  </section>
</template>

<style scoped>
.page-sub {
  margin-top: 4px;
}

.panel-grid {
  margin-top: var(--wx-space-md);
}

.block-card {
  margin-top: var(--wx-space-md);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--wx-space-sm);
  margin-bottom: var(--wx-space-md);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}

.rate-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.rate-table th,
.rate-table td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid var(--wx-border-soft);
}

.rate-table th {
  color: var(--wx-text-tertiary);
  font-size: 12px;
  font-weight: 600;
}

.rate-table td {
  color: var(--wx-text-secondary);
}

.rate-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-strong {
  color: var(--wx-text-primary) !important;
  font-weight: 600;
}

.rate-note {
  margin-top: var(--wx-space-md);
  font-size: 12px;
}

.seg-group {
  display: inline-flex;
  gap: 4px;
}

.seg-btn {
  padding: 3px 10px;
  font-size: 12px;
  border: 1px solid var(--wx-border-soft);
  border-radius: 999px;
  background: transparent;
  color: var(--wx-text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.seg-btn:hover {
  color: var(--wx-text-primary);
}

.seg-btn.active {
  background: var(--wx-color-primary, #818cf8);
  border-color: transparent;
  color: #fff;
}

.funnel-sub {
  margin: -8px 0 var(--wx-space-sm);
  font-size: 12px;
}
</style>
