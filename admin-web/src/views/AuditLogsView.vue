<script setup lang="ts">
import { onMounted, ref } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import { useToast } from '../stores/toast'
import { fmtDate } from '../utils/format'
import { getAuditLogs } from '../services/adminApi'
import type { AuditLogItem } from '../services/types'

const toast = useToast()

const items = ref<AuditLogItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '加载失败'
}

async function load(targetPage = 1) {
  loading.value = true
  try {
    const res = await getAuditLogs({ page: targetPage, pageSize })
    items.value = res.items
    total.value = res.total
    page.value = res.page
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    loading.value = false
  }
}

function statusPill(status: number): string {
  if (status < 300) return 'pill-green'
  if (status < 500) return 'pill-yellow'
  return 'pill-red'
}

function methodPill(method: string): string {
  if (method === 'DELETE') return 'pill-red'
  if (method === 'POST') return 'pill-blue'
  return 'pill-yellow'
}

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize))

onMounted(() => load(1))
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">审计日志</h1>
      <span class="muted">共 {{ total }} 条写操作记录（最新在前）</span>
    </header>

    <div class="toolbar toolbar-gap">
      <button type="button" class="btn" :disabled="loading" @click="load(page)">刷新</button>
    </div>

    <EmptyState v-if="!items.length" :text="loading ? '加载中…' : '暂无审计记录'" />

    <div v-else class="card table-card">
      <div class="table-wrap">
        <table class="ad-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>方法</th>
            <th>路径</th>
            <th>状态码</th>
            <th>耗时</th>
            <th>IP</th>
            <th>管理员</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in items" :key="`${item.at}-${index}`">
            <td class="nowrap muted">{{ fmtDate(item.at) }}</td>
            <td>
              <span class="pill" :class="methodPill(item.method)">{{ item.method }}</span>
            </td>
            <td class="path-cell">{{ item.path }}</td>
            <td>
              <span class="pill" :class="statusPill(item.status)">{{ item.status }}</span>
            </td>
            <td class="nowrap muted">{{ item.ms }} ms</td>
            <td class="nowrap muted">{{ item.ip || '-' }}</td>
            <td class="nowrap">{{ item.admin || '-' }}</td>
          </tr>
        </tbody>
        </table>
      </div>

      <div class="pager">
        <button type="button" class="btn btn-sm" :disabled="page <= 1 || loading" @click="load(page - 1)">
          上一页
        </button>
        <span class="muted">第 {{ page }} / {{ totalPages() }} 页</span>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="page >= totalPages() || loading"
          @click="load(page + 1)"
        >
          下一页
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.toolbar-gap {
  margin-bottom: var(--wx-space-md);
}

.table-card {
  padding: 0;
  overflow: hidden;
}

.nowrap {
  white-space: nowrap;
}

.path-cell {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wx-text-primary);
  font-family: var(--wx-font-mono, monospace);
  font-size: 12px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--wx-space-sm);
  padding: var(--wx-space-sm) var(--wx-space-md);
}
</style>
