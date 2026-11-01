<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getActivityHeatmap, getCheckinCalendar, getComposition, getOverview, getPlatformSplit } from '../services/adminApi'
import type {
  ActivityHeatmapResult,
  AdminOverview,
  CheckinCalendarResult,
  CompositionResult,
  PlatformSplitResult
} from '../services/types'
import { fmtNum } from '../utils/format'
import AppChart from '../components/AppChart.vue'
import EmptyState from '../components/EmptyState.vue'
import { useToast } from '../stores/toast'
import type { EChartsOption } from 'echarts'

const toast = useToast()

const overview = ref<AdminOverview | null>(null)
const loading = ref(false)

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    overview.value = await getOverview()
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    loading.value = false
  }
}

/* ===== 活跃热力图（星期 × 小时） ===== */
const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i))

const heatmap = ref<ActivityHeatmapResult | null>(null)
const heatmapLoading = ref(false)

async function loadHeatmap() {
  if (heatmapLoading.value) return
  heatmapLoading.value = true
  try {
    heatmap.value = await getActivityHeatmap(30)
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    heatmapLoading.value = false
  }
}

const heatmapOption = computed<EChartsOption | null>(() => {
  const data = heatmap.value
  if (!data || !data.cells.length) return null
  return {
    tooltip: {
      position: 'top',
      formatter: (p: unknown) => {
        const v = (p as { value: [number, number, number] }).value
        return `${WEEK_LABELS[v[1]]} ${String(v[0]).padStart(2, '0')}:00 · ${fmtNum(v[2])} 次`
      }
    },
    grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
    xAxis: { type: 'category', data: HOUR_LABELS, name: '时', splitArea: { show: true } },
    yAxis: { type: 'category', data: WEEK_LABELS },
    visualMap: {
      min: 0,
      max: data.max || 1,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      // 主题无关的靛蓝渐变：低值近透明，双主题下均可读
      inRange: { color: ['rgba(129, 140, 248, 0.08)', 'rgba(129, 140, 248, 0.45)', '#818cf8'] }
    },
    series: [
      {
        type: 'heatmap',
        data: data.cells,
        label: { show: false },
        itemStyle: { borderColor: 'rgba(128, 128, 128, 0.2)', borderWidth: 1 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0, 0, 0, 0.4)' } }
      }
    ]
  }
})

onMounted(() => {
  load()
  loadHeatmap()
  loadComposition()
  loadCalendar()
  loadPlatform()
})

/* ===== 打卡年历热力 ===== */
const calendar = ref<CheckinCalendarResult | null>(null)
const calendarLoading = ref(false)

async function loadCalendar() {
  if (calendarLoading.value) return
  calendarLoading.value = true
  try {
    calendar.value = await getCheckinCalendar()
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    calendarLoading.value = false
  }
}

const calendarOption = computed<EChartsOption | null>(() => {
  const data = calendar.value
  if (!data || !data.days.length) return null
  return {
    tooltip: {
      formatter: (p: unknown) => {
        const v = (p as { value: [string, number, number] }).value
        return `${v[0]} · ${v[1]} 人打卡 · ${fmtNum(v[2])} 分钟`
      }
    },
    visualMap: {
      min: 0,
      max: data.maxUsers || 1,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: ['rgba(129, 140, 248, 0.08)', 'rgba(129, 140, 248, 0.45)', '#818cf8'] }
    },
    calendar: {
      top: 24,
      left: 48,
      right: 24,
      bottom: 48,
      range: data.year,
      cellSize: ['auto', 14],
      splitLine: { lineStyle: { color: 'rgba(128, 128, 128, 0.35)', width: 1 } },
      itemStyle: { borderColor: 'rgba(128, 128, 128, 0.2)', borderWidth: 1 },
      dayLabel: { firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六'], color: '#8b91b8' },
      monthLabel: {
        nameMap: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
        color: '#8b91b8'
      },
      yearLabel: { show: false }
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: data.days.map((d) => [d.date, d.users, d.minutes])
      }
    ]
  }
})

/* ===== 平台构成（按日活跃拆分） ===== */
const platform = ref<PlatformSplitResult | null>(null)
const platformLoading = ref(false)

async function loadPlatform() {
  if (platformLoading.value) return
  platformLoading.value = true
  try {
    platform.value = await getPlatformSplit(30)
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    platformLoading.value = false
  }
}

const platformOption = computed<EChartsOption | null>(() => {
  const rows = platform.value?.series
  if (!rows?.length) return null
  const area = { opacity: 0.5 }
  const mk = (name: string, pick: (r: PlatformSplitResult['series'][number]) => number) => ({
    name,
    type: 'line' as const,
    stack: 'platform',
    smooth: true,
    symbol: 'none' as const,
    areaStyle: area,
    data: rows.map(pick)
  })
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['桌面端', '移动端', '未标记'] },
    grid: { left: 8, right: 16, top: 32, bottom: 0, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: rows.map((r) => r.bucket.slice(5)) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      mk('桌面端', (r) => r.desktop),
      mk('移动端', (r) => r.phone),
      mk('未标记', (r) => r.other)
    ]
  }
})

/* ===== 题目构成演变（周累计） ===== */
const composition = ref<CompositionResult | null>(null)
const compositionLoading = ref(false)

async function loadComposition() {
  if (compositionLoading.value) return
  compositionLoading.value = true
  try {
    composition.value = await getComposition('week')
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    compositionLoading.value = false
  }
}

const compositionOption = computed<EChartsOption | null>(() => {
  const rows = composition.value?.questions
  if (!rows?.length) return null
  const area = { opacity: 0.5 }
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['已通过', '已驳回', '待审核'] },
    grid: { left: 8, right: 16, top: 32, bottom: 0, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: rows.map((r) => r.bucket) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '已通过',
        type: 'line',
        stack: 'questions',
        smooth: true,
        symbol: 'none',
        areaStyle: area,
        data: rows.map((r) => r.verified)
      },
      {
        name: '已驳回',
        type: 'line',
        stack: 'questions',
        smooth: true,
        symbol: 'none',
        areaStyle: area,
        data: rows.map((r) => r.rejected)
      },
      {
        name: '待审核',
        type: 'line',
        stack: 'questions',
        smooth: true,
        symbol: 'none',
        areaStyle: area,
        data: rows.map((r) => Math.max(0, r.created - r.verified - r.rejected))
      }
    ]
  }
})

const questionBars = computed(() => {
  const byStatus = overview.value?.questions.byStatus
  if (!byStatus) return []
  const rows = [
    { key: 'draft', label: '草稿', value: byStatus.draft },
    { key: 'verified', label: '已通过', value: byStatus.verified },
    { key: 'rejected', label: '已驳回', value: byStatus.rejected }
  ]
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return rows.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0
  }))
})

const aiActions = computed(() => {
  const usage = overview.value?.aiUsage
  if (!usage) return []
  const today = usage.today.byAction ?? {}
  const last7d = usage.last7d.byAction ?? {}
  const keys = Array.from(new Set([...Object.keys(today), ...Object.keys(last7d)]))
  return keys
    .map((key) => ({
      key,
      today: today[key] ?? 0,
      last7d: last7d[key] ?? 0
    }))
    .sort((a, b) => b.last7d - a.last7d || a.key.localeCompare(b.key))
})
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">数据看板</h1>
        <p class="muted page-sub">平台运营概览</p>
      </div>
      <button type="button" class="btn" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <p v-if="!overview && loading" class="muted">加载中…</p>
    <p v-else-if="!overview" class="muted">暂无数据</p>

    <template v-if="overview">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">用户总数</div>
          <div class="stat-value">{{ fmtNum(overview.users.total) }}</div>
          <div class="stat-sub">
            今日新增 {{ fmtNum(overview.users.newToday) }} · 近 7 日新增
            {{ fmtNum(overview.users.new7d) }} · 禁用 {{ fmtNum(overview.users.disabled) }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">题目总数</div>
          <div class="stat-value">{{ fmtNum(overview.questions.total) }}</div>
          <div class="stat-sub">
            草稿 {{ fmtNum(overview.questions.byStatus.draft) }} · 已通过
            {{ fmtNum(overview.questions.byStatus.verified) }} · 已驳回
            {{ fmtNum(overview.questions.byStatus.rejected) }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">社区帖子</div>
          <div class="stat-value">{{ fmtNum(overview.community.posts) }}</div>
          <div class="stat-sub">
            评论 {{ fmtNum(overview.community.comments) }} · 近 7 日帖子
            {{ fmtNum(overview.community.posts7d) }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">学习计划</div>
          <div class="stat-value">{{ fmtNum(overview.plans.total) }}</div>
          <div class="stat-sub">进行中 {{ fmtNum(overview.plans.active) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">打卡记录</div>
          <div class="stat-value">{{ fmtNum(overview.checkins.total) }}</div>
          <div class="stat-sub">近 7 日 {{ fmtNum(overview.checkins.last7d) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">练习会话</div>
          <div class="stat-value">{{ fmtNum(overview.quizSessions.total) }}</div>
          <div class="stat-sub">今日 {{ fmtNum(overview.quizSessions.today) }}</div>
        </div>
      </div>

      <div class="grid-2 panel-grid">
        <div class="card card-pad">
          <div class="section-head">
            <h2 class="section-title">题目状态分布</h2>
            <span class="muted">共 {{ fmtNum(overview.questions.total) }}</span>
          </div>
          <div v-for="seg in questionBars" :key="seg.key" class="dist-row">
            <div class="dist-meta">
              <span>{{ seg.label }}</span>
              <span class="muted">{{ fmtNum(seg.value) }} · {{ seg.percent }}%</span>
            </div>
            <div class="bar-track">
              <div
                :class="['bar-fill', `bar-${seg.key}`]"
                :style="{ width: `${seg.percent}%` }"
              />
            </div>
          </div>
        </div>

        <div class="card card-pad">
          <div class="section-head">
            <h2 class="section-title">AI 用量</h2>
          </div>
          <div class="ai-head">
            <div>
              <div class="stat-label">今日</div>
              <div class="ai-total">{{ fmtNum(overview.aiUsage.today.total) }}</div>
            </div>
            <div>
              <div class="stat-label">近 7 日</div>
              <div class="ai-total">{{ fmtNum(overview.aiUsage.last7d.total) }}</div>
            </div>
          </div>
          <table v-if="aiActions.length" class="mini-table">
            <thead>
              <tr>
                <th>action</th>
                <th>今日</th>
                <th>近 7 日</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in aiActions" :key="row.key">
                <td>{{ row.key }}</td>
                <td>{{ fmtNum(row.today) }}</td>
                <td>{{ fmtNum(row.last7d) }}</td>
              </tr>
            </tbody>
          </table>
          <EmptyState v-else text="暂无 AI 调用记录" />
        </div>
      </div>

      <div class="card card-pad coverage-card">
        <div class="section-head">
          <h2 class="section-title">行业覆盖度</h2>
          <span class="muted">目标题量 {{ fmtNum(overview.targetPerLeaf) }}/叶子</span>
        </div>
        <div v-if="overview.coverage.length" class="table-wrap">
          <table class="ad-table">
            <thead>
              <tr>
                <th>行业</th>
                <th>叶子数</th>
                <th>待处理</th>
                <th>生成中</th>
                <th>已铺满</th>
                <th>阻塞</th>
                <th>失败</th>
                <th>题目数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in overview.coverage" :key="row.industry">
                <td class="cell-strong">{{ row.industry }}</td>
                <td>{{ fmtNum(row.leaves) }}</td>
                <td>{{ fmtNum(row.pending) }}</td>
                <td>{{ fmtNum(row.materializing) }}</td>
                <td>{{ fmtNum(row.filled) }}</td>
                <td>{{ fmtNum(row.blocked) }}</td>
                <td>{{ fmtNum(row.failed) }}</td>
                <td>{{ fmtNum(row.questions) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <EmptyState v-else text="暂无行业数据" />
      </div>

      <div class="card card-pad heatmap-card">
        <div class="section-head">
          <h2 class="section-title">活跃热力图</h2>
          <span class="muted">近 {{ heatmap?.days ?? 30 }} 天 · 星期 × 小时</span>
        </div>
        <AppChart
          v-if="heatmapOption"
          :option="heatmapOption"
          height="300px"
          :loading="heatmapLoading"
        />
        <EmptyState v-else-if="!heatmapLoading" text="暂无活跃数据" />
        <p v-else class="muted">加载中…</p>
      </div>

      <div class="card card-pad heatmap-card">
        <div class="section-head">
          <h2 class="section-title">题目构成演变</h2>
          <span class="muted">近 12 周累计 · 通过/驳回取首次审核时间近似</span>
        </div>
        <AppChart
          v-if="compositionOption"
          :option="compositionOption"
          height="280px"
          :loading="compositionLoading"
        />
        <EmptyState v-else-if="!compositionLoading" text="暂无题目数据" />
        <p v-else class="muted">加载中…</p>
      </div>

      <div class="card card-pad heatmap-card">
        <div class="section-head">
          <h2 class="section-title">打卡年历</h2>
          <span class="muted">{{ calendar?.year ?? '今年' }} · 颜色深浅为当日打卡人数</span>
        </div>
        <AppChart
          v-if="calendarOption"
          :option="calendarOption"
          height="220px"
          :loading="calendarLoading"
        />
        <EmptyState v-else-if="!calendarLoading" text="今年暂无打卡数据" />
        <p v-else class="muted">加载中…</p>
      </div>

      <div class="card card-pad heatmap-card">
        <div class="section-head">
          <h2 class="section-title">平台构成</h2>
          <span class="muted">
            近 {{ platform?.days ?? 30 }} 天日活按平台拆分 · 埋点升级前的历史事件归「未标记」
          </span>
        </div>
        <AppChart
          v-if="platformOption"
          :option="platformOption"
          height="260px"
          :loading="platformLoading"
        />
        <EmptyState v-else-if="!platformLoading" text="暂无平台数据" />
        <p v-else class="muted">加载中…</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.page-sub {
  margin-top: 4px;
}

.panel-grid {
  margin-top: var(--wx-space-md);
}

.coverage-card {
  margin-top: var(--wx-space-md);
}

.heatmap-card {
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

.dist-row + .dist-row {
  margin-top: var(--wx-space-md);
}

.dist-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 13px;
}

.bar-track {
  height: 8px;
  overflow: hidden;
  background: var(--wx-glass-bg-strong);
  border-radius: var(--wx-radius-pill);
}

.bar-fill {
  height: 100%;
  border-radius: var(--wx-radius-pill);
  transition: width 0.3s var(--wx-ease-out-soft);
}

.bar-draft {
  background: var(--wx-state-light);
}

.bar-verified {
  background: var(--wx-state-deep);
}

.bar-rejected {
  background: var(--wx-color-vermilion);
}

.ai-head {
  display: flex;
  gap: var(--wx-space-xl);
  margin-bottom: var(--wx-space-sm);
}

.ai-total {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.mini-table th,
.mini-table td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid var(--wx-border-soft);
}

.mini-table th {
  color: var(--wx-text-tertiary);
  font-size: 12px;
  font-weight: 600;
}

.mini-table td {
  color: var(--wx-text-secondary);
}

.mini-table tbody tr:last-child td {
  border-bottom: none;
}
</style>
