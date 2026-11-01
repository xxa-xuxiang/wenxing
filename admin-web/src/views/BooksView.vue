<script setup lang="ts">
// 问星管理后台 — 书架管理：书籍列表（封面/标题/作者/格式/大小/来源）+ 管理员删除
// 列表与删除均走统一 request 封装，自动携带管理员 token；删除需二次确认
import { onMounted, ref } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import { useConfirm } from '../stores/confirm'
import { useToast } from '../stores/toast'
import { deleteBook, getBooks } from '../services/adminApi'
import type { AdminBookItem } from '../services/types'

const { ask } = useConfirm()
const toast = useToast()

const items = ref<AdminBookItem[]>([])
const loading = ref(false)
const busy = ref(false)
/** 封面加载失败的书籍 id（回落到占位块） */
const failedCovers = ref<Set<string>>(new Set())

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

async function load() {
  loading.value = true
  try {
    const res = await getBooks()
    items.value = res.items
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    loading.value = false
  }
}

/** 封面地址：接口返回相对路径，需按部署基地址拼接 */
function coverSrc(coverUrl: string): string {
  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')
  return /^https?:\/\//i.test(coverUrl) ? coverUrl : `${base}${coverUrl}`
}

function onCoverError(id: string) {
  const next = new Set(failedCovers.value)
  next.add(id)
  failedCovers.value = next
}

/** 文件大小：字节转 MB/KB */
function sizeText(size: number | null): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return '—'
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

/** 来源：优先展示许可，其次展示原始链接域名 */
function sourceText(item: AdminBookItem): string {
  if (item.license) return item.license
  if (!item.sourceUrl) return '来源未标注'
  try {
    return new URL(item.sourceUrl).hostname
  } catch {
    return '来源未标注'
  }
}

async function removeBook(item: AdminBookItem) {
  if (busy.value) return
  const ok = await ask({
    title: '删除书籍',
    message: `确认从书架删除《${item.title}》？删除后文件与封面会一并移除，且不可恢复。`,
    confirmText: '删除',
    danger: true
  })
  if (!ok) return
  busy.value = true
  try {
    await deleteBook(item.id)
    items.value = items.value.filter((x) => x.id !== item.id)
    toast.show('书籍已删除', 'success')
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">书架管理</h1>
      <span class="muted">共 {{ items.length }} 本</span>
    </header>

    <div class="table-wrap">
      <table class="ad-table">
        <thead>
          <tr>
            <th>封面</th>
            <th>标题</th>
            <th>作者</th>
            <th>格式</th>
            <th>大小</th>
            <th>来源</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7"><EmptyState text="加载中…" /></td>
          </tr>
          <tr v-else-if="!items.length">
            <td colspan="7"><EmptyState text="暂无书籍" /></td>
          </tr>
          <tr v-for="item in items" :key="item.id">
            <td>
              <div class="book-cover">
                <img
                  v-if="item.coverUrl && !failedCovers.has(item.id)"
                  :src="coverSrc(item.coverUrl)"
                  :alt="item.title"
                  loading="lazy"
                  @error="onCoverError(item.id)"
                />
                <span v-else class="book-cover-placeholder">{{ item.title.slice(0, 1) }}</span>
              </div>
            </td>
            <td class="cell-wrap">
              <div class="book-title" :title="item.title">{{ item.title }}</div>
            </td>
            <td>{{ item.author || '未知作者' }}</td>
            <td>{{ item.format.toUpperCase() }}</td>
            <td>{{ sizeText(item.fileSize) }}</td>
            <td class="cell-wrap">
              <div class="book-source" :title="item.sourceUrl || sourceText(item)">
                {{ sourceText(item) }}
              </div>
            </td>
            <td>
              <div class="row-actions">
                <button
                  type="button"
                  class="btn btn-sm btn-danger"
                  :disabled="busy"
                  @click="removeBook(item)"
                >
                  删除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.book-cover {
  width: 40px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--wx-border-soft);
  border-radius: 3px 6px 6px 3px;
  background: var(--wx-glass-bg);
}

.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.book-cover-placeholder {
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-tertiary);
}

.book-title {
  max-width: 340px;
  overflow: hidden;
  color: var(--wx-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-source {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
