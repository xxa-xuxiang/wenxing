<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppChart from '../components/AppChart.vue'
import AppPagination from '../components/AppPagination.vue'
import EmptyState from '../components/EmptyState.vue'
import StatusPill from '../components/StatusPill.vue'
import { useConfirm } from '../stores/confirm'
import { useToast } from '../stores/toast'
import { fmtDate } from '../utils/format'
import {
  deleteCorpusDoc,
  getCorpusDocs,
  getFillCfd,
  getFillJobs,
  getLeaves,
  resetFillJobs,
  runFillJob,
  updateCorpusDoc
} from '../services/adminApi'
import type {
  CorpusDocItem,
  CorpusDocStatus,
  FillCfdResult,
  FillJobItem,
  LeafItem
} from '../services/types'
import type { EChartsOption } from 'echarts'

const { ask } = useConfirm()
const toast = useToast()

const pageSize = 20

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

/* ===== 铺题 CFD 累计流 ===== */
const cfd = ref<FillCfdResult | null>(null)
const cfdLoading = ref(false)

async function loadCfd() {
  if (cfdLoading.value) return
  cfdLoading.value = true
  try {
    cfd.value = await getFillCfd(12)
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    cfdLoading.value = false
  }
}

const cfdOption = computed<EChartsOption | null>(() => {
  const buckets = cfd.value?.buckets
  if (!buckets?.length) return null
  const area = { opacity: 0.5 }
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['已铺满', '阻塞/失败', '积压中'] },
    grid: { left: 8, right: 16, top: 32, bottom: 0, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: buckets.map((b) => b.bucket) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '已铺满',
        type: 'line',
        stack: 'cfd',
        smooth: true,
        symbol: 'none',
        areaStyle: area,
        data: buckets.map((b) => b.filled)
      },
      {
        name: '阻塞/失败',
        type: 'line',
        stack: 'cfd',
        smooth: true,
        symbol: 'none',
        areaStyle: area,
        data: buckets.map((b) => b.blockedFailed)
      },
      {
        name: '积压中',
        type: 'line',
        stack: 'cfd',
        smooth: true,
        symbol: 'none',
        areaStyle: area,
        data: buckets.map((b) => Math.max(0, b.created - b.filled - b.blockedFailed))
      }
    ]
  }
})

/* ===== 区块一：铺题账本 ===== */
const fillFilters = reactive({ status: '', industry: '' })
const fillQuery = reactive({ status: '', industry: '' })
const jobs = ref<FillJobItem[]>([])
const jobsTotal = ref(0)
const jobsPage = ref(1)
const jobsLoading = ref(false)

async function loadJobs() {
  jobsLoading.value = true
  try {
    const res = await getFillJobs({ ...fillQuery, page: jobsPage.value, pageSize })
    jobs.value = res.items
    jobsTotal.value = res.total
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    jobsLoading.value = false
  }
}

function searchJobs() {
  Object.assign(fillQuery, fillFilters)
  jobsPage.value = 1
  loadJobs()
}

function changeJobsPage(next: number) {
  jobsPage.value = next
  loadJobs()
}

async function resetOne(item: FillJobItem) {
  const ok = await ask({
    title: '重新排队',
    message: `确认将「${item.pathText || item.leafKey}」的铺题任务重新排队？状态将重置为待处理。`,
    confirmText: '重新排队'
  })
  if (!ok) return
  try {
    const res = await resetFillJobs({ leafKeys: [item.leafKey] })
    toast.show(`已重新排队（${res.count} 条）`, 'success')
    await loadJobs()
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

async function resetBatch() {
  if (!fillFilters.status && !fillFilters.industry) {
    toast.show('请先选择状态或行业筛选条件', 'error')
    return
  }
  const statusText = fillFilters.status || '全部状态'
  const industryText = fillFilters.industry || '全部行业'
  const ok = await ask({
    title: '批量重置',
    message: `确认按当前筛选批量重置铺题任务？\n状态：${statusText}\n行业：${industryText}`,
    confirmText: '批量重置',
    danger: true
  })
  if (!ok) return
  try {
    const res = await resetFillJobs({
      status: fillFilters.status || undefined,
      industry: fillFilters.industry || undefined
    })
    toast.show(`已重置 ${res.count} 条任务`, 'success')
    await loadJobs()
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

async function runOne(leafKey: string, label: string) {
  const ok = await ask({
    title: '立即出题',
    message: `确认立即为「${label || leafKey}」触发铺题？任务将进入后台队列执行。`,
    confirmText: '立即出题'
  })
  if (!ok) return
  try {
    await runFillJob(leafKey)
    toast.show('已开始出题，请手动刷新查看进度', 'success')
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

/* ===== 区块二：技能叶子检索 ===== */
const leafFilters = reactive({ q: '', industry: '' })
const leafQuery = reactive({ q: '', industry: '' })
const leaves = ref<LeafItem[]>([])
const leavesTotal = ref(0)
const leavesPage = ref(1)
const leavesLoading = ref(false)

async function loadLeaves() {
  leavesLoading.value = true
  try {
    const res = await getLeaves({ ...leafQuery, page: leavesPage.value, pageSize })
    leaves.value = res.items
    leavesTotal.value = res.total
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    leavesLoading.value = false
  }
}

function searchLeaves() {
  Object.assign(leafQuery, leafFilters)
  leavesPage.value = 1
  loadLeaves()
}

function changeLeavesPage(next: number) {
  leavesPage.value = next
  loadLeaves()
}

/* ===== 区块三：语料文档 ===== */
const corpusFilters = reactive({ q: '', industry: '' })
const corpusQuery = reactive({ q: '', industry: '' })
const corpusDocs = ref<CorpusDocItem[]>([])
const corpusTotal = ref(0)
const corpusPage = ref(1)
const corpusLoading = ref(false)

async function loadCorpus() {
  corpusLoading.value = true
  try {
    const res = await getCorpusDocs({ ...corpusQuery, page: corpusPage.value, pageSize })
    corpusDocs.value = res.items
    corpusTotal.value = res.total
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    corpusLoading.value = false
  }
}

function searchCorpus() {
  Object.assign(corpusQuery, corpusFilters)
  corpusPage.value = 1
  loadCorpus()
}

function changeCorpusPage(next: number) {
  corpusPage.value = next
  loadCorpus()
}

async function toggleCorpus(item: CorpusDocItem) {
  const enable = item.status !== 'active'
  const ok = await ask({
    title: enable ? '启用语料文档' : '停用语料文档',
    message: `确认${enable ? '启用' : '停用'}语料文档「${item.title}」？`,
    confirmText: enable ? '启用' : '停用',
    danger: !enable
  })
  if (!ok) return
  const status: CorpusDocStatus = enable ? 'active' : 'disabled'
  try {
    await updateCorpusDoc(item.id, status)
    toast.show(enable ? '已启用' : '已停用', 'success')
    await loadCorpus()
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

async function removeCorpus(item: CorpusDocItem) {
  const first = await ask({
    title: '删除语料文档',
    message: `确认删除语料文档「${item.title}」？关联切块将一并删除。`,
    confirmText: '继续',
    danger: true
  })
  if (!first) return
  const second = await ask({
    title: '再次确认删除',
    message: '此操作不可恢复，确认继续删除？',
    confirmText: '确认删除',
    danger: true
  })
  if (!second) return
  try {
    await deleteCorpusDoc(item.id)
    toast.show('语料文档已删除', 'success')
    await loadCorpus()
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

/* ===== 页头手动刷新 ===== */
const refreshing = ref(false)

async function refreshAll() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await Promise.all([loadJobs(), loadLeaves(), loadCorpus()])
  } finally {
    refreshing.value = false
  }
}

onMounted(() => {
  loadCfd()
  loadJobs()
  loadLeaves()
  loadCorpus()
})
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">铺题任务</h1>
      <button
        type="button"
        class="btn"
        :disabled="refreshing || jobsLoading || leavesLoading || corpusLoading"
        @click="refreshAll"
      >
        {{ refreshing ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <section class="card card-pad block">
      <div class="block-head">
        <div>
          <h2 class="block-title">铺题累计流（CFD）</h2>
          <p class="muted">
            近 {{ cfd?.weeks ?? 12 }} 周累计趋势 · 完成/阻塞时间按任务最近更新近似
          </p>
        </div>
      </div>
      <AppChart
        v-if="cfdOption"
        :option="cfdOption"
        height="280px"
        :loading="cfdLoading"
      />
      <EmptyState v-else-if="!cfdLoading" text="暂无铺题数据" />
      <p v-else class="muted">加载中…</p>
    </section>

    <section class="card card-pad block">
      <div class="block-head">
        <div>
          <h2 class="block-title">铺题账本</h2>
          <p class="muted">共 {{ jobsTotal }} 条任务，仅手动刷新，不自动轮询</p>
        </div>
        <button type="button" class="btn btn-danger btn-sm" @click="resetBatch">
          按当前筛选批量重置
        </button>
      </div>

      <div class="toolbar block-toolbar">
        <label class="filter-item">
          状态
          <select v-model="fillFilters.status" class="select">
            <option value="">全部</option>
            <option value="pending">待处理</option>
            <option value="materializing">生成中</option>
            <option value="filled">已铺满</option>
            <option value="blocked">阻塞</option>
            <option value="failed">失败</option>
          </select>
        </label>
        <label class="filter-item">
          行业
          <input
            v-model.trim="fillFilters.industry"
            class="input"
            type="text"
            placeholder="如：前端开发"
            @keyup.enter="searchJobs"
          />
        </label>
        <button type="button" class="btn btn-primary btn-sm" :disabled="jobsLoading" @click="searchJobs">
          查询
        </button>
      </div>

      <div class="table-wrap">
        <table class="ad-table">
          <thead>
            <tr>
              <th>叶子路径</th>
              <th>行业</th>
              <th>状态</th>
              <th>已通过题数</th>
              <th>尝试次数</th>
              <th>最近错误</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!jobs.length">
              <td colspan="8">
                <EmptyState :text="jobsLoading ? '加载中…' : '暂无铺题任务'" />
              </td>
            </tr>
            <tr v-for="item in jobs" :key="item.leafKey">
              <td class="cell-wrap">
                <div class="path-cell" :title="item.pathText">{{ item.pathText || item.leafKey }}</div>
              </td>
              <td>{{ item.industry || '—' }}</td>
              <td><StatusPill :value="item.status" /></td>
              <td>{{ item.verifiedCount }}</td>
              <td>{{ item.attempts }}</td>
              <td class="cell-wrap">
                <div class="error-cell">{{ item.lastError || '—' }}</div>
              </td>
              <td>{{ fmtDate(item.updatedAt) }}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="btn btn-sm" @click="resetOne(item)">
                    重新排队
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    @click="runOne(item.leafKey, item.pathText)"
                  >
                    立即出题
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <AppPagination
        :page="jobsPage"
        :page-size="pageSize"
        :total="jobsTotal"
        @update:page="changeJobsPage"
      />
    </section>

    <section class="card card-pad block">
      <div class="block-head">
        <div>
          <h2 class="block-title">技能叶子检索</h2>
          <p class="muted">共 {{ leavesTotal }} 个叶子</p>
        </div>
      </div>

      <div class="toolbar block-toolbar">
        <label class="filter-item">
          关键词
          <input
            v-model.trim="leafFilters.q"
            class="input input-wide"
            type="text"
            placeholder="叶子名称 / 路径"
            @keyup.enter="searchLeaves"
          />
        </label>
        <label class="filter-item">
          行业
          <input
            v-model.trim="leafFilters.industry"
            class="input"
            type="text"
            placeholder="如：前端开发"
            @keyup.enter="searchLeaves"
          />
        </label>
        <button type="button" class="btn btn-primary btn-sm" :disabled="leavesLoading" @click="searchLeaves">
          查询
        </button>
      </div>

      <div class="table-wrap">
        <table class="ad-table">
          <thead>
            <tr>
              <th>叶子名</th>
              <th>路径</th>
              <th>行业</th>
              <th>状态</th>
              <th>已通过题数</th>
              <th>尝试次数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!leaves.length">
              <td colspan="7">
                <EmptyState :text="leavesLoading ? '加载中…' : '暂无技能叶子'" />
              </td>
            </tr>
            <tr v-for="item in leaves" :key="item.leafKey">
              <td class="cell-strong">{{ item.name }}</td>
              <td class="cell-wrap">
                <div class="path-cell" :title="item.pathText">{{ item.pathText }}</div>
              </td>
              <td>{{ item.industry || '—' }}</td>
              <td><StatusPill :value="item.status" /></td>
              <td>{{ item.verifiedCount }}</td>
              <td>{{ item.attempts }}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  @click="runOne(item.leafKey, item.name)"
                >
                  立即出题
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <AppPagination
        :page="leavesPage"
        :page-size="pageSize"
        :total="leavesTotal"
        @update:page="changeLeavesPage"
      />
    </section>

    <section class="card card-pad block">
      <div class="block-head">
        <div>
          <h2 class="block-title">语料文档</h2>
          <p class="muted">共 {{ corpusTotal }} 篇语料</p>
        </div>
      </div>

      <div class="toolbar block-toolbar">
        <label class="filter-item">
          关键词
          <input
            v-model.trim="corpusFilters.q"
            class="input input-wide"
            type="text"
            placeholder="标题 / URL"
            @keyup.enter="searchCorpus"
          />
        </label>
        <label class="filter-item">
          行业
          <input
            v-model.trim="corpusFilters.industry"
            class="input"
            type="text"
            placeholder="如：前端开发"
            @keyup.enter="searchCorpus"
          />
        </label>
        <button type="button" class="btn btn-primary btn-sm" :disabled="corpusLoading" @click="searchCorpus">
          查询
        </button>
      </div>

      <div class="table-wrap">
        <table class="ad-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>站点域名</th>
              <th>行业</th>
              <th>许可</th>
              <th>状态</th>
              <th>切块数</th>
              <th>抓取时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!corpusDocs.length">
              <td colspan="8">
                <EmptyState :text="corpusLoading ? '加载中…' : '暂无语料文档'" />
              </td>
            </tr>
            <tr v-for="item in corpusDocs" :key="item.id">
              <td class="cell-wrap">
                <div class="title-cell" :title="item.title">{{ item.title }}</div>
              </td>
              <td>{{ item.siteDomain || '—' }}</td>
              <td>{{ item.industry || '—' }}</td>
              <td>{{ item.license || '—' }}</td>
              <td><StatusPill :value="item.status" /></td>
              <td>{{ item.chunkCount }}</td>
              <td>{{ fmtDate(item.fetchedAt) }}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="btn btn-sm" @click="toggleCorpus(item)">
                    {{ item.status === 'active' ? '禁用' : '启用' }}
                  </button>
                  <button type="button" class="btn btn-sm btn-danger" @click="removeCorpus(item)">
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <AppPagination
        :page="corpusPage"
        :page-size="pageSize"
        :total="corpusTotal"
        @update:page="changeCorpusPage"
      />
    </section>
  </section>
</template>

<style scoped>
.block + .block {
  margin-top: var(--wx-space-lg);
}

.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--wx-space-md);
  flex-wrap: wrap;
  margin-bottom: var(--wx-space-md);
}

.block-title {
  font-size: 16px;
  font-weight: 650;
  margin-bottom: 4px;
}

.block-toolbar {
  margin-bottom: var(--wx-space-sm);
}

.filter-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--wx-text-secondary);
  font-size: 13px;
}

.filter-item .select {
  width: 130px;
}

.filter-item .input {
  width: 150px;
}

.filter-item .input-wide {
  width: 210px;
}

.path-cell {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-cell {
  max-width: 260px;
  overflow: hidden;
  color: var(--wx-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error-cell {
  max-width: 260px;
  white-space: normal;
  word-break: break-word;
}
</style>
