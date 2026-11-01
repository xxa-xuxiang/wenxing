<script setup lang="ts">
// 问星管理后台 — 用户管理：用户分析（增长/日活/行为/邀请）+ 用户列表（无轮询，手动刷新/切尺度拉取）
import { computed, onMounted, ref } from 'vue'
import {
  deleteUser,
  getBehaviorAnalytics,
  getUser,
  getUserAnalytics,
  getInvitationAnalytics,
  getUsers,
  resetUserPassword,
  updateUser
} from '../services/adminApi'
import type {
  AdminUserDetail,
  AdminUserListItem,
  AnalyticsScale,
  AnalyticsSeriesPoint,
  BehaviorAnalyticsResult,
  InvitationAnalyticsResult,
  UserAnalyticsResult
} from '../services/types'
import { fmtDate, fmtNum } from '../utils/format'
import AppChart from '../components/AppChart.vue'
import AppModal from '../components/AppModal.vue'
import AppPagination from '../components/AppPagination.vue'
import EmptyState from '../components/EmptyState.vue'
import StatusPill from '../components/StatusPill.vue'
import type { EChartsOption } from 'echarts'
import { useConfirm } from '../stores/confirm'
import { useToast } from '../stores/toast'

const toast = useToast()
const { ask } = useConfirm()

const PAGE_SIZE = 20

const keyword = ref('')
const appliedKeyword = ref('')
const page = ref(1)
const total = ref(0)
const items = ref<AdminUserListItem[]>([])
const loading = ref(false)
const busy = ref(false)

const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<AdminUserDetail | null>(null)

const resetOpen = ref(false)
const resetTarget = ref<AdminUserListItem | null>(null)
const newPassword = ref('')

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

function userLabel(user: { nickname: string; username: string }): string {
  const nickname = user.nickname?.trim()
  return nickname ? `${nickname} @${user.username}` : `@${user.username}`
}

async function load() {
  loading.value = true
  try {
    const result = await getUsers({
      page: page.value,
      pageSize: PAGE_SIZE,
      q: appliedKeyword.value || undefined
    })
    items.value = result.items
    total.value = result.total
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    loading.value = false
  }
}

function search() {
  appliedKeyword.value = keyword.value.trim()
  page.value = 1
  load()
}

function reset() {
  keyword.value = ''
  appliedKeyword.value = ''
  page.value = 1
  load()
}

function changePage(target: number) {
  page.value = target
  load()
}

/* ===== 用户分析 ===== */
const userStats = ref<UserAnalyticsResult | null>(null)
const coreLoading = ref(false)

const growthScales: { key: AnalyticsScale; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' }
]
const growthScale = ref<AnalyticsScale>('day')
const growthSeries = ref<AnalyticsSeriesPoint[] | null>(null)
const growthLoading = ref(false)

const behavior = ref<BehaviorAnalyticsResult | null>(null)
const behaviorLoading = ref(false)

const invitation = ref<InvitationAnalyticsResult | null>(null)
const inviteLoading = ref(false)

const analyticsLoading = computed(
  () => coreLoading.value || growthLoading.value || behaviorLoading.value || inviteLoading.value
)

async function loadUserCore() {
  coreLoading.value = true
  try {
    userStats.value = await getUserAnalytics('day')
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    coreLoading.value = false
  }
}

async function loadGrowth() {
  growthLoading.value = true
  try {
    growthSeries.value = (await getUserAnalytics(growthScale.value)).series
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    growthLoading.value = false
  }
}

async function loadBehavior() {
  behaviorLoading.value = true
  try {
    behavior.value = await getBehaviorAnalytics()
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    behaviorLoading.value = false
  }
}

async function loadInvitation() {
  inviteLoading.value = true
  try {
    invitation.value = await getInvitationAnalytics()
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    inviteLoading.value = false
  }
}

function refreshAnalytics() {
  loadUserCore()
  loadGrowth()
  loadBehavior()
  loadInvitation()
}

function switchGrowthScale(next: AnalyticsScale) {
  if (growthScale.value === next) return
  growthScale.value = next
  loadGrowth()
}

/** 平均停留：>=60s 显示「x分x秒」，否则「x.x 秒」 */
function fmtStay(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(1)} 秒`
  const min = Math.floor(totalSec / 60)
  const sec = Math.round(totalSec - min * 60)
  return `${min}分${sec}秒`
}

function fmtCtr(ctr: number): string {
  if (!Number.isFinite(ctr)) return '—'
  return `${(ctr * 100).toFixed(1)}%`
}

/** 近 7 天平均日活（dau.series 升序取最后 7 桶平均） */
const avg7dDau = computed<number>(() => {
  const stats = userStats.value
  if (!stats) return 0
  const last7 = stats.dau.series.slice(-7)
  if (!last7.length) return 0
  return last7.reduce((sum, p) => sum + p.count, 0) / last7.length
})

const avg7dDauText = computed(() => fmtNum(Math.round(avg7dDau.value)))

function rateOption(rate: number): EChartsOption {
  const value = Math.max(0, Math.min(100, rate))
  return {
    series: [
      {
        type: 'gauge',
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        radius: '95%',
        center: ['50%', '58%'],
        progress: { show: true, width: 14 },
        axisLine: { lineStyle: { width: 14 } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, 0],
          formatter: '{value}%',
          fontSize: 24,
          color: 'inherit'
        },
        data: [{ value: Number(value.toFixed(1)) }]
      }
    ]
  }
}

const todayRateOption = computed<EChartsOption | null>(() => {
  const stats = userStats.value
  if (!stats) return null
  const rate = stats.summary.total > 0 ? (stats.dau.today / stats.summary.total) * 100 : 0
  return rateOption(rate)
})

const weekRateOption = computed<EChartsOption | null>(() => {
  const stats = userStats.value
  if (!stats) return null
  const rate = stats.summary.total > 0 ? (avg7dDau.value / stats.summary.total) * 100 : 0
  return rateOption(rate)
})

function growthXFormatter(value: string): string {
  if (growthScale.value === 'day') return value.slice(5)
  return value
}

const growthChartOption = computed<EChartsOption | null>(() => {
  const data = growthSeries.value
  if (!data) return null
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 16, top: 24, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: data.map((p) => p.bucket),
      axisLabel: { formatter: growthXFormatter }
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        type: 'line',
        name: '新增用户',
        smooth: true,
        showSymbol: false,
        areaStyle: {},
        data: data.map((p) => p.count)
      }
    ]
  }
})

function stayTip(params: unknown): string {
  const p = (Array.isArray(params) ? params[0] : params) as { name?: unknown; value?: unknown }
  return `${String(p?.name ?? '')}  ${fmtStay(Number(p?.value) * 1000)}`
}

const stayChartOption = computed<EChartsOption | null>(() => {
  const rows = behavior.value
  if (!rows || !rows.length) return null
  return {
    tooltip: { trigger: 'axis', formatter: stayTip },
    grid: { left: 8, right: 24, top: 16, bottom: 0, containLabel: true },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: rows.map((r) => r.screen), inverse: true },
    series: [
      {
        type: 'bar',
        name: '平均停留（秒）',
        barMaxWidth: 16,
        data: rows.map((r) => Number((r.avgStayMs / 1000).toFixed(1)))
      }
    ]
  }
})

const inviteTrendOption = computed<EChartsOption | null>(() => {
  const data = invitation.value?.series
  if (!data) return null
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 16, top: 24, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: data.map((p) => p.bucket),
      axisLabel: { formatter: (v: string) => v.slice(5) }
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        type: 'line',
        name: '邀请注册',
        smooth: true,
        showSymbol: false,
        areaStyle: {},
        data: data.map((p) => p.count)
      }
    ]
  }
})

/* ===== 用户详情 / 重置密码 ===== */
async function openDetail(item: AdminUserListItem) {
  detailOpen.value = true
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await getUser(item.id)
  } catch (e) {
    toast.show(errorMessage(e), 'error')
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

function profileValue(key: string): string {
  const profile = detail.value?.profile
  if (!profile) return '—'
  const value = profile[key]
  if (typeof value === 'string') return value.trim() || '—'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length ? value.map(String).join('、') : '—'
  return '—'
}

function openReset(item: AdminUserListItem) {
  resetTarget.value = item
  newPassword.value = ''
  resetOpen.value = true
}

function closeReset() {
  resetOpen.value = false
  resetTarget.value = null
  newPassword.value = ''
}

async function submitReset() {
  const target = resetTarget.value
  if (!target || busy.value) return
  if (newPassword.value.length < 6) {
    toast.show('密码至少 6 位', 'error')
    return
  }
  const ok = await ask({
    title: '重置密码',
    message: `确定要重置用户 ${userLabel(target)} 的登录密码吗？重置后该用户需使用新密码登录。`,
    confirmText: '重置密码',
    danger: true
  })
  if (!ok) return

  busy.value = true
  try {
    await resetUserPassword(target.id, newPassword.value)
    toast.show('密码已重置', 'success')
    closeReset()
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    busy.value = false
  }
}

async function toggleDisabled(item: AdminUserListItem) {
  if (busy.value) return
  const action = item.disabled ? '启用' : '禁用'
  const ok = await ask({
    title: `${action}用户`,
    message: item.disabled
      ? `确定要启用用户 ${userLabel(item)} 吗？启用后该用户可以重新登录并正常使用社区功能。`
      : `确定要禁用用户 ${userLabel(item)} 吗？禁用后该用户将无法登录，也不能发帖或评论。`,
    confirmText: action,
    danger: !item.disabled
  })
  if (!ok) return

  busy.value = true
  try {
    await updateUser(item.id, { disabled: !item.disabled })
    toast.show(`已${action}用户`, 'success')
    await load()
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    busy.value = false
  }
}

async function removeUser(item: AdminUserListItem) {
  if (busy.value) return
  const ok = await ask({
    title: '删除用户',
    message: `确定要删除用户 ${userLabel(item)} 吗？该用户的发帖、评论、打卡等关联数据会一并删除。`,
    confirmText: '继续',
    danger: true
  })
  if (!ok) return

  const confirmed = await ask({
    title: '再次确认删除',
    message: `删除后不可恢复！确定要永久删除用户 ${userLabel(item)} 吗？`,
    confirmText: '确认删除',
    danger: true
  })
  if (!confirmed) return

  busy.value = true
  try {
    await deleteUser(item.id)
    toast.show('用户已删除', 'success')
    await load()
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  load()
  refreshAnalytics()
})
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">用户管理</h1>
    </header>

    <!-- ===== 用户分析区 ===== -->
    <div class="section-head">
      <h2 class="section-title">用户分析</h2>
      <button type="button" class="btn" :disabled="analyticsLoading" @click="refreshAnalytics">
        {{ analyticsLoading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">总用户</div>
        <div class="stat-value">{{ userStats ? fmtNum(userStats.summary.total) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日新增</div>
        <div class="stat-value">{{ userStats ? fmtNum(userStats.summary.today) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">本周新增</div>
        <div class="stat-value">{{ userStats ? fmtNum(userStats.summary.week) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">本月新增</div>
        <div class="stat-value">{{ userStats ? fmtNum(userStats.summary.month) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日 DAU</div>
        <div class="stat-value">{{ userStats ? fmtNum(userStats.dau.today) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">邀请注册总数</div>
        <div class="stat-value">{{ invitation ? fmtNum(invitation.totalInvited) : '—' }}</div>
      </div>
    </div>

    <div class="grid-2 gauge-grid">
      <div class="card card-pad">
        <div class="gauge-title">
          今日活跃率 <span class="muted">（口径：今日 DAU / 总用户）</span>
        </div>
        <AppChart
          v-if="userStats"
          :option="todayRateOption"
          height="200px"
          :loading="coreLoading"
        />
        <p v-else class="muted">{{ coreLoading ? '加载中…' : '暂无数据' }}</p>
      </div>
      <div class="card card-pad">
        <div class="gauge-title">
          近 7 日平均日活 / 总用户 <span class="muted">（平均日活 {{ avg7dDauText }}）</span>
        </div>
        <AppChart
          v-if="userStats"
          :option="weekRateOption"
          height="200px"
          :loading="coreLoading"
        />
        <p v-else class="muted">{{ coreLoading ? '加载中…' : '暂无数据' }}</p>
      </div>
    </div>

    <div class="card card-pad block-gap">
      <div class="section-head">
        <h2 class="section-title">用户增长</h2>
        <div class="scale-tabs">
          <button
            v-for="s in growthScales"
            :key="s.key"
            type="button"
            :class="['page-btn', { active: growthScale === s.key }]"
            :disabled="growthLoading"
            @click="switchGrowthScale(s.key)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>
      <AppChart
        v-if="growthSeries"
        :option="growthChartOption"
        height="280px"
        :loading="growthLoading"
      />
      <p v-else class="muted">{{ growthLoading ? '加载中…' : '暂无数据' }}</p>
    </div>

    <div class="grid-2 block-gap">
      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">行为分析（近 7 天）</h2>
        </div>
        <div class="table-wrap">
          <table class="ad-table">
            <thead>
              <tr>
                <th>界面</th>
                <th>PV</th>
                <th>UV</th>
                <th>点击率</th>
                <th>平均停留</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="behaviorLoading && !behavior">
                <td colspan="5" class="muted">加载中…</td>
              </tr>
              <tr v-else-if="!behavior || !behavior.length">
                <td colspan="5"><EmptyState text="暂无行为数据" /></td>
              </tr>
              <template v-else>
                <tr v-for="row in behavior" :key="row.screen">
                  <td class="cell-strong">{{ row.screen }}</td>
                  <td>{{ fmtNum(row.pv) }}</td>
                  <td>{{ fmtNum(row.uv) }}</td>
                  <td>{{ fmtCtr(row.ctr) }}</td>
                  <td>{{ fmtStay(row.avgStayMs) }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">平均停留时长（秒）</h2>
        </div>
        <AppChart
          v-if="behavior && behavior.length"
          :option="stayChartOption"
          height="260px"
          :loading="behaviorLoading"
        />
        <p v-else-if="behaviorLoading" class="muted">加载中…</p>
        <EmptyState v-else text="暂无行为数据" />
      </div>
    </div>

    <div class="card card-pad block-gap">
      <div class="section-head">
        <h2 class="section-title">邀请趋势（近 30 天）</h2>
      </div>
      <AppChart
        v-if="invitation && invitation.totalInvited > 0"
        :option="inviteTrendOption"
        height="260px"
        :loading="inviteLoading"
      />
      <p v-else-if="inviteLoading" class="muted">加载中…</p>
      <EmptyState v-else text="暂无邀请数据" />
    </div>

    <div class="card card-pad block-gap">
      <div class="section-head">
        <h2 class="section-title">邀请排行榜 Top 20</h2>
      </div>
      <div class="table-wrap">
        <table class="ad-table">
          <thead>
            <tr>
              <th>名次</th>
              <th>昵称</th>
              <th>用户名</th>
              <th>邀请人数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="inviteLoading && !invitation">
              <td colspan="4" class="muted">加载中…</td>
            </tr>
            <tr v-else-if="!invitation || !invitation.ranking.length">
              <td colspan="4"><EmptyState text="暂无邀请数据" /></td>
            </tr>
            <template v-else>
              <tr v-for="(row, idx) in invitation.ranking" :key="`${row.userId}-${idx}`">
                <td>{{ idx + 1 }}</td>
                <td class="cell-strong">{{ row.nickname || '—' }}</td>
                <td>{{ row.username || '—' }}</td>
                <td>{{ fmtNum(row.invitedCount) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ===== 用户列表 ===== -->
    <div class="list-head section-head">
      <h2 class="section-title">用户列表</h2>
    </div>

    <div class="toolbar toolbar-gap">
      <input
        v-model="keyword"
        class="input search-input"
        type="text"
        placeholder="用户名 / 昵称"
        @keyup.enter="search"
      />
      <button type="button" class="btn btn-primary" :disabled="loading" @click="search">
        查询
      </button>
      <button type="button" class="btn" :disabled="loading" @click="reset">重置</button>
    </div>

    <div class="table-wrap">
      <table class="ad-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>昵称</th>
            <th>状态</th>
            <th>发帖数</th>
            <th>注册时间</th>
            <th>最后登录</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" class="muted">加载中…</td>
          </tr>
          <tr v-else-if="!items.length">
            <td colspan="7"><EmptyState text="暂无用户" /></td>
          </tr>
          <template v-else>
            <tr v-for="item in items" :key="item.id">
              <td class="cell-strong">{{ item.username }}</td>
              <td>{{ item.nickname || '—' }}</td>
              <td>
                <StatusPill :value="item.disabled ? 'disabled' : 'active'" />
              </td>
              <td>{{ item.postCount }}</td>
              <td>{{ fmtDate(item.createdAt) }}</td>
              <td>{{ fmtDate(item.lastLoginAt) }}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="btn btn-sm" @click="openDetail(item)">
                    详情
                  </button>
                  <button type="button" class="btn btn-sm" @click="openReset(item)">
                    重置密码
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm"
                    :disabled="busy"
                    @click="toggleDisabled(item)"
                  >
                    {{ item.disabled ? '启用' : '禁用' }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-danger"
                    :disabled="busy"
                    @click="removeUser(item)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <AppPagination
      :page="page"
      :page-size="PAGE_SIZE"
      :total="total"
      @update:page="changePage"
    />

    <AppModal :open="detailOpen" title="用户详情" width="640px" @close="detailOpen = false">
      <p v-if="detailLoading" class="muted">加载中…</p>
      <template v-else-if="detail">
        <div class="grid-2 detail-grid">
          <div class="detail-item">
            <span class="muted">用户名</span>
            <span class="detail-value">{{ detail.user.username }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">昵称</span>
            <span class="detail-value">{{ detail.user.nickname || '—' }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">状态</span>
            <span class="detail-value">
              <StatusPill :value="detail.user.disabled ? 'disabled' : 'active'" />
            </span>
          </div>
          <div class="detail-item">
            <span class="muted">注册时间</span>
            <span class="detail-value">{{ fmtDate(detail.user.createdAt) }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">最后登录</span>
            <span class="detail-value">{{ fmtDate(detail.user.lastLoginAt) }}</span>
          </div>
        </div>

        <h3 class="detail-subtitle">学习档案</h3>
        <div class="grid-2 detail-grid">
          <div class="detail-item">
            <span class="muted">identity</span>
            <span class="detail-value">{{ profileValue('identity') }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">stage</span>
            <span class="detail-value">{{ profileValue('stage') }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">school</span>
            <span class="detail-value">{{ profileValue('school') }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">major</span>
            <span class="detail-value">{{ profileValue('major') }}</span>
          </div>
        </div>

        <h3 class="detail-subtitle">活跃统计</h3>
        <div class="grid-2 detail-grid">
          <div class="detail-item">
            <span class="muted">掌握度记录数</span>
            <span class="detail-value">{{ detail.stats.mastery }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">发帖</span>
            <span class="detail-value">{{ detail.stats.posts }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">评论</span>
            <span class="detail-value">{{ detail.stats.comments }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">打卡</span>
            <span class="detail-value">{{ detail.stats.checkins }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">学习计划</span>
            <span class="detail-value">{{ detail.stats.plans }}</span>
          </div>
          <div class="detail-item">
            <span class="muted">最近活跃</span>
            <span class="detail-value">{{ fmtDate(detail.stats.lastActiveAt) }}</span>
          </div>
        </div>
      </template>
      <p v-else class="muted">暂无数据</p>

      <template #footer>
        <button type="button" class="btn" @click="detailOpen = false">关闭</button>
      </template>
    </AppModal>

    <AppModal :open="resetOpen" title="重置密码" width="440px" @close="closeReset">
      <div class="field">
        <label class="field-label" for="reset-password">新密码</label>
        <input
          id="reset-password"
          v-model="newPassword"
          class="input"
          type="password"
          autocomplete="new-password"
          placeholder="请输入新密码（至少 6 位）"
        />
        <p class="muted">
          {{ resetTarget ? `为 ${userLabel(resetTarget)} 设置新密码` : '设置新密码' }}，至少 6 位。
        </p>
      </div>
      <template #footer>
        <button type="button" class="btn" @click="closeReset">取消</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="submitReset">
          确认重置
        </button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
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

.gauge-grid {
  margin-top: var(--wx-space-md);
}

.gauge-title {
  margin-bottom: var(--wx-space-sm);
  color: var(--wx-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.gauge-title .muted {
  font-size: 12px;
  font-weight: 400;
}

.block-gap {
  margin-top: var(--wx-space-md);
}

.scale-tabs {
  display: flex;
  gap: var(--wx-space-xs);
}

.list-head {
  margin-top: 32px;
}

.toolbar-gap {
  margin-bottom: var(--wx-space-md);
}

.search-input {
  width: 240px;
}

.detail-grid {
  gap: var(--wx-space-sm) var(--wx-space-md);
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.detail-value {
  color: var(--wx-text-primary);
  font-size: 13px;
  word-break: break-all;
}

.detail-subtitle {
  margin: var(--wx-space-md) 0 var(--wx-space-sm);
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
</style>
