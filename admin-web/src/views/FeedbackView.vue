<script setup lang="ts">
import { onMounted, ref } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import { useConfirm } from '../stores/confirm'
import { useToast } from '../stores/toast'
import { fmtDate } from '../utils/format'
import { deleteFeedback, getFeedback, updateFeedbackStatus } from '../services/adminApi'
import type { FeedbackItem, FeedbackStatus } from '../services/types'

const { ask } = useConfirm()
const toast = useToast()

const industry = ref('')
const industries = ref<string[]>([])
const items = ref<FeedbackItem[]>([])
const total = ref(0)
const loading = ref(false)

const STATUS_META: Record<FeedbackStatus, { label: string; pill: string }> = {
  pending: { label: '待处理', pill: 'pill-yellow' },
  processing: { label: '处理中', pill: 'pill-blue' },
  done: { label: '已完成', pill: 'pill-green' }
}
const STATUS_FLOW: FeedbackStatus[] = ['pending', 'processing', 'done']

async function setStatus(item: FeedbackItem, status: FeedbackStatus) {
  if (item.status === status) return
  try {
    await updateFeedbackStatus({ industry: item.industry, time: item.time, status })
    item.status = status
    toast.show(`已标记为「${STATUS_META[status].label}」`, 'success')
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

async function load() {
  loading.value = true
  try {
    const res = await getFeedback(industry.value || undefined)
    items.value = res.items
    total.value = res.total
    const set = new Set(industries.value)
    for (const item of res.items) {
      if (item.industry) set.add(item.industry)
    }
    industries.value = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    loading.value = false
  }
}

async function removeItem(item: FeedbackItem) {
  const preview = item.content.length > 60 ? `${item.content.slice(0, 60)}…` : item.content
  const ok = await ask({
    title: '删除反馈',
    message: `确认删除该条反馈？\n行业：${item.industry}\n时间：${fmtDate(item.time)}\n内容：${preview}`,
    confirmText: '删除',
    danger: true
  })
  if (!ok) return
  try {
    await deleteFeedback({ industry: item.industry, time: item.time })
    toast.show('反馈已删除', 'success')
    await load()
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

async function clearIndustry() {
  if (!industry.value) {
    toast.show('请先选择具体行业', 'error')
    return
  }
  const first = await ask({
    title: '清空当前行业反馈',
    message: `确认清空行业「${industry.value}」下的全部反馈？`,
    confirmText: '继续',
    danger: true
  })
  if (!first) return
  const second = await ask({
    title: '再次确认清空',
    message: `行业「${industry.value}」下的反馈将被永久删除，不可恢复。确认继续？`,
    confirmText: '确认清空',
    danger: true
  })
  if (!second) return
  try {
    const res = await deleteFeedback({ industry: industry.value })
    toast.show(`已清空 ${res.removed} 条反馈`, 'success')
    await load()
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

onMounted(load)
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">用户反馈</h1>
      <span class="muted">共 {{ total }} 条</span>
    </header>

    <div class="toolbar toolbar-gap">
      <label class="filter-item">
        行业
        <select v-model="industry" class="select">
          <option value="">全部</option>
          <option v-for="name in industries" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <button type="button" class="btn btn-primary" :disabled="loading" @click="load">
        查询
      </button>
      <button type="button" class="btn" :disabled="loading" @click="load">刷新</button>
      <button
        type="button"
        class="btn btn-danger"
        :disabled="!industry"
        @click="clearIndustry"
      >
        清空当前行业
      </button>
    </div>

    <EmptyState v-if="!items.length" :text="loading ? '加载中…' : '暂无反馈'" />

    <div v-else class="feedback-list">
      <article v-for="(item, index) in items" :key="`${item.industry}-${item.time}-${index}`" class="card feedback-card">
        <div class="feedback-head">
          <div class="feedback-meta">
            <span class="pill" :class="STATUS_META[item.status].pill">
              {{ STATUS_META[item.status].label }}
            </span>
            <span class="feedback-time">{{ fmtDate(item.time) }}</span>
            <span class="pill pill-gray">{{ item.industry || '未知行业' }}</span>
            <span class="pill pill-gray">{{ item.source || '未知来源' }}</span>
          </div>
          <div class="feedback-actions">
            <button
              v-for="s in STATUS_FLOW"
              :key="s"
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': item.status === s }"
              :disabled="item.status === s"
              @click="setStatus(item, s)"
            >
              {{ STATUS_META[s].label }}
            </button>
            <button type="button" class="btn btn-sm btn-danger" @click="removeItem(item)">
              删除
            </button>
          </div>
        </div>
        <p class="feedback-content">{{ item.content }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.toolbar-gap {
  margin-bottom: var(--wx-space-md);
}

.filter-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--wx-text-secondary);
  font-size: 13px;
}

.filter-item .select {
  width: 180px;
}

.feedback-list {
  display: flex;
  flex-direction: column;
  gap: var(--wx-space-sm);
}

.feedback-card {
  padding: var(--wx-space-md) var(--wx-space-lg);
}

.feedback-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wx-space-sm);
  flex-wrap: wrap;
  margin-bottom: var(--wx-space-sm);
}

.feedback-meta {
  display: flex;
  align-items: center;
  gap: var(--wx-space-sm);
  flex-wrap: wrap;
}

.feedback-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.feedback-time {
  color: var(--wx-text-tertiary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.feedback-content {
  color: var(--wx-text-primary);
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
