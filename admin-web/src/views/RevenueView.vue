<script setup lang="ts">
// 问星管理后台 — API 盈利：计费标准编辑 + 收入看板（无轮询，手动刷新/切范围拉取）
import { computed, onMounted, ref } from 'vue'
import {
  clearAiKey,
  getAdminPricing,
  getAiKeyStatus,
  getRevenue,
  setAiKey,
  updateAdminPricing
} from '../services/adminApi'
import type {
  AdminPricing,
  AiKeyStatus,
  RevenueActionItem,
  RevenueRange,
  RevenueResult
} from '../services/types'
import { fmtNum } from '../utils/format'
import AppChart from '../components/AppChart.vue'
import type { EChartsOption } from 'echarts'
import { useToast } from '../stores/toast'
import { useConfirm } from '../stores/confirm'

const toast = useToast()
const { ask } = useConfirm()

/* ===== 计费标准 ===== */
const pricing = ref<AdminPricing | null>(null)
const pricingLoading = ref(false)
const saving = ref(false)
const priceInputs = ref<Record<string, string>>({})

const pricingRows = computed(() => {
  const items = pricing.value?.items ?? {}
  return Object.entries(items).map(([action, item]) => ({
    action,
    label: item.label
  }))
})

async function loadPricing() {
  if (pricingLoading.value) return
  pricingLoading.value = true
  try {
    const res = await getAdminPricing()
    const inputs: Record<string, string> = {}
    for (const [action, item] of Object.entries(res.items)) {
      inputs[action] = String(item.pricePerCall)
    }
    priceInputs.value = inputs
    pricing.value = res
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    pricingLoading.value = false
  }
}

async function savePricing() {
  if (saving.value) return
  const items: Record<string, number> = {}
  for (const [action, raw] of Object.entries(priceInputs.value)) {
    const price = Number(raw)
    if (!Number.isFinite(price) || price < 0) {
      toast.show(`「${action}」单价必须为非负数字`, 'error')
      return
    }
    items[action] = price
  }
  const ok = await ask({
    title: '保存计费标准',
    message: '确定保存新的计费标准吗？保存后版本号 +1，桌面端用户将收到计费变更提醒。',
    confirmText: '保存'
  })
  if (!ok) return
  saving.value = true
  try {
    const res = await updateAdminPricing(items)
    pricing.value = res.pricing
    toast.show(`计费标准已保存，当前版本 v${res.pricing.version}`, 'success')
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    saving.value = false
  }
}

/* ===== 平台 AI 密钥 ===== */
const aiKey = ref<AiKeyStatus | null>(null)
const keyInput = ref('')
const keyLoading = ref(false)
const keySaving = ref(false)

const keySourceLabel = computed(() => {
  const source = aiKey.value?.source
  if (source === 'runtime') return '后台配置'
  if (source === 'env') return '环境变量'
  return '未配置'
})

async function loadAiKey() {
  if (keyLoading.value) return
  keyLoading.value = true
  try {
    aiKey.value = await getAiKeyStatus()
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    keyLoading.value = false
  }
}

async function saveAiKey() {
  if (keySaving.value) return
  const key = keyInput.value.trim()
  if (!key) {
    toast.show('请先填写 API Key', 'error')
    return
  }
  const ok = await ask({
    title: '保存平台 AI 密钥',
    message: '保存后立即生效并覆盖当前后台配置，旧 Key 将被替换。确定保存吗？',
    confirmText: '保存'
  })
  if (!ok) return
  keySaving.value = true
  try {
    aiKey.value = await setAiKey(key)
    keyInput.value = ''
    toast.show('平台 AI 密钥已更新并生效', 'success')
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    keySaving.value = false
  }
}

async function removeAiKey() {
  if (keySaving.value) return
  const ok = await ask({
    title: '清除平台 AI 密钥',
    message: '清除后将回退到环境变量；若环境变量也未配置，AI 功能将不可用。确定清除吗？',
    confirmText: '清除'
  })
  if (!ok) return
  keySaving.value = true
  try {
    const res = await clearAiKey()
    aiKey.value = res.status
    toast.show('已清除后台配置的 AI 密钥', 'success')
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    keySaving.value = false
  }
}

/* ===== 收入看板 ===== */
const revenue = ref<RevenueResult | null>(null)
const revenueLoading = ref(false)
const range = ref<RevenueRange>('today')

const ranges: { key: RevenueRange; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近 7 日' },
  { key: '30d', label: '近 30 日' }
]

async function loadRevenue() {
  if (revenueLoading.value) return
  revenueLoading.value = true
  try {
    revenue.value = await getRevenue(range.value)
  } catch (e) {
    toast.show(e instanceof Error ? e.message : '操作失败', 'error')
  } finally {
    revenueLoading.value = false
  }
}

function switchRange(next: RevenueRange) {
  if (range.value === next) return
  range.value = next
  loadRevenue()
}

function reload() {
  loadPricing()
  loadAiKey()
  loadRevenue()
}

onMounted(reload)

/** 金额：保留 2 位小数加 ¥ */
function fmtMoney(n: number | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** x 轴标签：today 桶 key 为 'HH' 补 ':00'；7d 日期取 'MM-DD'；30d 月桶原样 */
function xLabelFormatter(value: string): string {
  if (range.value === 'today') return `${value}:00`
  if (range.value === '7d') return value.slice(5)
  return value
}

function nextHour(key: string): string {
  return String((Number(key) + 1) % 24).padStart(2, '0')
}

function revenueTip(params: unknown): string {
  const p = (Array.isArray(params) ? params[0] : params) as { name?: unknown; value?: unknown }
  const key = String(p?.name ?? '')
  const label =
    range.value === 'today' ? `${key}:00 ~ ${nextHour(key)}:00` : key
  return `${label}  ${fmtMoney(Number(p?.value) || 0)}`
}

const revenueChartOption = computed<EChartsOption | null>(() => {
  const buckets = revenue.value?.series.buckets
  if (!buckets) return null
  return {
    tooltip: { trigger: 'axis', formatter: revenueTip },
    grid: { left: 8, right: 16, top: 24, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: buckets.map((b) => b.key),
      axisLabel: { formatter: xLabelFormatter }
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: 'bar',
        name: '消费金额',
        barMaxWidth: 28,
        data: buckets.map((b) => b.revenue)
      }
    ]
  }
})

const actionChartGrid = { left: 8, right: 8, top: 16, bottom: 0, containLabel: true }

function actionCallsOption(act: RevenueActionItem): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    grid: actionChartGrid,
    xAxis: {
      type: 'category',
      data: act.buckets.map((b) => b.key),
      axisLabel: { formatter: xLabelFormatter }
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: 'line',
        name: '请求次数',
        smooth: true,
        showSymbol: false,
        areaStyle: {},
        data: act.buckets.map((b) => b.calls)
      }
    ]
  }
}

function actionTokensOption(act: RevenueActionItem): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    grid: actionChartGrid,
    xAxis: {
      type: 'category',
      data: act.buckets.map((b) => b.key),
      axisLabel: { formatter: xLabelFormatter }
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: 'bar',
        name: 'Tokens',
        barMaxWidth: 20,
        data: act.buckets.map((b) => b.tokens)
      }
    ]
  }
}
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">API 盈利</h1>
        <p class="muted page-sub">计费标准与收入看板</p>
      </div>
      <button
        type="button"
        class="btn"
        :disabled="pricingLoading || revenueLoading"
        @click="reload"
      >
        {{ pricingLoading || revenueLoading ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <div class="card card-pad">
      <div class="section-head">
        <h2 class="section-title">计费标准</h2>
        <span class="muted">当前版本 v{{ pricing?.version ?? '—' }}</span>
      </div>
      <p v-if="!pricing && pricingLoading" class="muted">加载中…</p>
      <p v-else-if="!pricing" class="muted">暂无数据</p>
      <template v-else>
        <div class="pricing-list">
          <div v-for="row in pricingRows" :key="row.action" class="pricing-row">
            <div class="pricing-info">
              <span class="pricing-label">{{ row.label }}</span>
              <span class="muted">{{ row.action }}</span>
            </div>
            <div class="pricing-input">
              <input
                v-model="priceInputs[row.action]"
                class="input"
                type="number"
                min="0"
                step="0.01"
              />
              <span class="muted">元/次</span>
            </div>
          </div>
        </div>
        <div class="pricing-foot">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="saving"
            @click="savePricing"
          >
            {{ saving ? '保存中…' : '保存计费标准' }}
          </button>
        </div>
      </template>
    </div>

    <div class="card card-pad ai-key-card">
      <div class="section-head">
        <h2 class="section-title">平台 AI 密钥</h2>
        <span class="muted">来源：{{ keySourceLabel }}</span>
      </div>
      <p v-if="keyLoading && !aiKey" class="muted">加载中…</p>
      <template v-else>
        <div class="key-status">
          <span>当前 Key</span>
          <span class="mono">{{ aiKey?.configured ? aiKey.masked : '未配置' }}</span>
        </div>
        <p v-if="aiKey?.source === 'env'" class="muted key-hint">
          当前使用 .env 的 DEEPSEEK_API_KEY，可在下方保存以改为后台配置。
        </p>
        <p v-if="aiKey?.updatedAt" class="muted key-hint">
          更新时间 {{ aiKey.updatedAt }}<template v-if="aiKey.updatedBy"> · 操作人 {{ aiKey.updatedBy }}</template>
        </p>
        <div class="key-input-row">
          <input
            v-model="keyInput"
            class="input"
            type="password"
            placeholder="sk-..."
            autocomplete="off"
          />
          <button type="button" class="btn btn-primary" :disabled="keySaving" @click="saveAiKey">
            {{ keySaving ? '保存中…' : '保存密钥' }}
          </button>
          <button
            type="button"
            class="btn"
            :disabled="keySaving || aiKey?.source !== 'runtime'"
            @click="removeAiKey"
          >
            清除
          </button>
        </div>
        <p class="muted key-hint">保存后立即生效，无需重启后端；密钥加密存储，页面只显示末 4 位。</p>
      </template>
    </div>

    <div class="stat-grid revenue-stats">
      <div class="stat-card">
        <div class="stat-label">今日收入</div>
        <div class="stat-value">
          {{ revenue ? fmtMoney(revenue.summary.todayRevenue) : '—' }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">本月收入</div>
        <div class="stat-value">
          {{ revenue ? fmtMoney(revenue.summary.monthRevenue) : '—' }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日调用次数</div>
        <div class="stat-value">
          {{ revenue ? fmtNum(revenue.summary.todayCalls) : '—' }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总调用次数</div>
        <div class="stat-value">
          {{ revenue ? fmtNum(revenue.summary.totalCalls) : '—' }}
        </div>
      </div>
    </div>

    <div class="card card-pad revenue-chart-card">
      <div class="section-head">
        <h2 class="section-title">消费金额（CNY）</h2>
        <div class="range-tabs">
          <button
            v-for="r in ranges"
            :key="r.key"
            type="button"
            :class="['page-btn', { active: range === r.key }]"
            :disabled="revenueLoading"
            @click="switchRange(r.key)"
          >
            {{ r.label }}
          </button>
        </div>
      </div>
      <AppChart :option="revenueChartOption" height="320px" :loading="revenueLoading" />
    </div>

    <div v-if="revenue?.series.byAction.length" class="grid-2 action-grid">
      <div v-for="act in revenue.series.byAction" :key="act.action" class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">{{ act.label }}</h2>
          <span class="muted">{{ fmtNum(act.calls) }} 次 · {{ fmtMoney(act.revenue) }}</span>
        </div>
        <div class="mini-chart">
          <div class="mini-label">
            <span>请求次数</span>
            <span class="muted">{{ fmtNum(act.calls) }}</span>
          </div>
          <AppChart :option="actionCallsOption(act)" height="200px" :loading="revenueLoading" />
        </div>
        <div class="mini-chart">
          <div class="mini-label">
            <span>Tokens</span>
            <span class="muted">{{ fmtNum(act.tokens) }}</span>
          </div>
          <AppChart :option="actionTokensOption(act)" height="200px" :loading="revenueLoading" />
        </div>
        <div class="muted pricing-note">单价 {{ fmtMoney(act.pricePerCall) }}/次</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page-sub {
  margin-top: 4px;
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

/* ===== 计费标准 ===== */
.pricing-list {
  display: flex;
  flex-direction: column;
}

.pricing-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wx-space-md);
  padding: 10px 0;
  border-bottom: 1px solid var(--wx-border-soft);
}

.pricing-row:last-child {
  border-bottom: none;
}

.pricing-info {
  display: flex;
  align-items: baseline;
  gap: var(--wx-space-sm);
  min-width: 0;
}

.pricing-label {
  color: var(--wx-text-primary);
  font-size: 14px;
  font-weight: 500;
}

.pricing-input {
  display: flex;
  align-items: center;
  gap: var(--wx-space-sm);
  flex-shrink: 0;
}

.pricing-input .input {
  width: 120px;
  text-align: right;
}

.pricing-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--wx-space-md);
}

/* ===== 收入看板 ===== */
.revenue-stats {
  margin-top: var(--wx-space-md);
}

/* ===== 平台 AI 密钥 ===== */
.ai-key-card {
  margin-top: var(--wx-space-md);
}

.key-status {
  display: flex;
  align-items: center;
  gap: var(--wx-space-sm);
  color: var(--wx-text-secondary);
  font-size: 14px;
}

.key-status .mono {
  font-family: var(--wx-font-mono, ui-monospace, monospace);
  color: var(--wx-text-primary);
}

.key-hint {
  margin-top: var(--wx-space-xs);
  font-size: 13px;
}

.key-input-row {
  display: flex;
  align-items: center;
  gap: var(--wx-space-sm);
  margin-top: var(--wx-space-md);
}

.key-input-row .input {
  flex: 1;
  min-width: 220px;
}

.revenue-chart-card {
  margin-top: var(--wx-space-md);
}

.range-tabs {
  display: flex;
  gap: var(--wx-space-xs);
}

.action-grid {
  margin-top: var(--wx-space-md);
}

.mini-chart + .mini-chart {
  margin-top: var(--wx-space-sm);
}

.mini-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  color: var(--wx-text-secondary);
  font-size: 13px;
}

.pricing-note {
  margin-top: var(--wx-space-sm);
}
</style>
