<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppModal from '../components/AppModal.vue'
import AppPagination from '../components/AppPagination.vue'
import EmptyState from '../components/EmptyState.vue'
import { useConfirm } from '../stores/confirm'
import { useToast } from '../stores/toast'
import { fmtDate } from '../utils/format'
import {
  deleteDocContent,
  getDocContent,
  getDocs,
  saveDocContent
} from '../services/adminApi'
import { renderMarkdown } from '@/utils/markdown'
import type { ContentDocItem } from '../services/types'

const { ask } = useConfirm()
const toast = useToast()

const filters = reactive({ industry: '', q: '' })
const query = reactive({ industry: '', q: '' })
const items = ref<ContentDocItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

function fmtSize(size: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size)) return '—'
  return (size / 1024).toFixed(1)
}

/** 去掉 Markdown 开头的 frontmatter（--- ... ---） */
function stripFrontmatter(src: string): string {
  const text = String(src).replace(/\r\n?/g, '\n')
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---', 3)
  if (end < 0) return text
  let body = text.slice(end + 4)
  if (body.startsWith('\n')) body = body.slice(1)
  return body
}

async function load() {
  loading.value = true
  try {
    const res = await getDocs({ ...query, page: page.value, pageSize })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    loading.value = false
  }
}

function search() {
  Object.assign(query, filters)
  page.value = 1
  load()
}

function reset() {
  Object.assign(filters, { industry: '', q: '' })
  search()
}

function changePage(next: number) {
  page.value = next
  load()
}

/* ===== 预览 ===== */
const previewOpen = ref(false)
const previewLoading = ref(false)
const previewTitle = ref('')
const previewContent = ref('')

const previewHtml = computed(() => renderMarkdown(stripFrontmatter(previewContent.value)))

async function openPreview(item: ContentDocItem) {
  previewOpen.value = true
  previewTitle.value = item.title
  previewContent.value = ''
  previewLoading.value = true
  try {
    const res = await getDocContent(item.file)
    previewContent.value = res.content
  } catch (e) {
    toast.show(errorText(e), 'error')
    previewOpen.value = false
  } finally {
    previewLoading.value = false
  }
}

function closePreview() {
  previewOpen.value = false
  previewContent.value = ''
}

/* ===== 编辑 ===== */
const editOpen = ref(false)
const editLoading = ref(false)
const saving = ref(false)
const editFile = ref('')
const editTitle = ref('')
const editContent = ref('')

async function openEdit(item: ContentDocItem) {
  editOpen.value = true
  editFile.value = item.file
  editTitle.value = item.title
  editContent.value = ''
  editLoading.value = true
  try {
    const res = await getDocContent(item.file)
    editContent.value = res.content
  } catch (e) {
    toast.show(errorText(e), 'error')
    editOpen.value = false
  } finally {
    editLoading.value = false
  }
}

function closeEdit() {
  editOpen.value = false
  editContent.value = ''
}

async function saveEdit() {
  if (!editFile.value) return
  const ok = await ask({
    title: '保存文档',
    message: `确认保存文档「${editTitle.value}」？保存后将重建该文档的向量索引。`,
    confirmText: '保存'
  })
  if (!ok) return
  saving.value = true
  try {
    await saveDocContent({ file: editFile.value, content: editContent.value })
    toast.show('保存成功', 'success')
    closeEdit()
    await load()
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    saving.value = false
  }
}

/* ===== 删除 ===== */
async function removeDoc(item: ContentDocItem) {
  const first = await ask({
    title: '删除文档',
    message: `确认删除文档「${item.title}」？`,
    confirmText: '继续',
    danger: true
  })
  if (!first) return
  const second = await ask({
    title: '再次确认删除',
    message: '删除后不可恢复，且该文档的向量切块会一并删除。确认继续？',
    confirmText: '确认删除',
    danger: true
  })
  if (!second) return
  try {
    await deleteDocContent(item.file)
    toast.show('文档已删除', 'success')
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
      <h1 class="page-title">文档管理</h1>
      <span class="muted">共 {{ total }} 篇文档</span>
    </header>

    <div class="toolbar toolbar-gap">
      <label class="filter-item">
        行业
        <input
          v-model.trim="filters.industry"
          class="input"
          type="text"
          placeholder="如：前端开发"
          @keyup.enter="search"
        />
      </label>
      <label class="filter-item">
        关键词
        <input
          v-model.trim="filters.q"
          class="input input-wide"
          type="text"
          placeholder="标题 / 文件 / 标签"
          @keyup.enter="search"
        />
      </label>
      <button type="button" class="btn btn-primary" :disabled="loading" @click="search">
        查询
      </button>
      <button type="button" class="btn btn-ghost" @click="reset">重置</button>
    </div>

    <div class="table-wrap">
      <table class="ad-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>行业</th>
            <th>路径</th>
            <th>标签</th>
            <th>更新时间</th>
            <th>大小（KB）</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!items.length">
            <td colspan="7">
              <EmptyState :text="loading ? '加载中…' : '暂无文档'" />
            </td>
          </tr>
          <tr v-for="item in items" :key="item.file">
            <td class="cell-wrap">
              <div class="title-cell" :title="item.title">{{ item.title }}</div>
            </td>
            <td>{{ item.industry || '—' }}</td>
            <td class="cell-wrap">
              <div class="file-cell" :title="item.file">{{ item.file }}</div>
            </td>
            <td class="cell-wrap">
              <div class="tag-cell">{{ item.tags.length ? item.tags.join('、') : '—' }}</div>
            </td>
            <td>{{ fmtDate(item.updatedAt) }}</td>
            <td>{{ fmtSize(item.size) }}</td>
            <td>
              <div class="row-actions">
                <button type="button" class="btn btn-sm btn-ghost" @click="openPreview(item)">
                  预览
                </button>
                <button type="button" class="btn btn-sm" @click="openEdit(item)">编辑</button>
                <button type="button" class="btn btn-sm btn-danger" @click="removeDoc(item)">
                  删除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AppPagination
      :page="page"
      :page-size="pageSize"
      :total="total"
      @update:page="changePage"
    />

    <AppModal
      :open="previewOpen"
      :title="`预览：${previewTitle}`"
      width="860px"
      @close="closePreview"
    >
      <div v-if="previewLoading" class="muted">加载中…</div>
      <div v-else class="md-preview" v-html="previewHtml"></div>
      <template #footer>
        <button type="button" class="btn btn-ghost" @click="closePreview">关闭</button>
      </template>
    </AppModal>

    <AppModal
      :open="editOpen"
      :title="`编辑：${editTitle}`"
      width="860px"
      @close="closeEdit"
    >
      <div v-if="editLoading" class="muted">加载中…</div>
      <div v-else class="field">
        <label class="field-label">Markdown 原文（含 frontmatter）</label>
        <textarea v-model="editContent" class="textarea edit-area" />
      </div>
      <template #footer>
        <button type="button" class="btn btn-ghost" @click="closeEdit">取消</button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="editLoading || saving"
          @click="saveEdit"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>
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

.filter-item .input {
  width: 160px;
}

.filter-item .input-wide {
  width: 220px;
}

.title-cell {
  max-width: 260px;
  overflow: hidden;
  color: var(--wx-text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-cell {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-cell {
  max-width: 220px;
  white-space: normal;
  word-break: break-word;
}

.edit-area {
  min-height: 420px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.md-preview {
  color: var(--wx-text-primary);
  font-size: 14px;
  line-height: 1.75;
  word-break: break-word;
}

.md-preview :deep(img) {
  max-width: 100%;
  height: auto;
}

.md-preview :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
}

.md-preview :deep(table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.md-preview :deep(th),
.md-preview :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--wx-border-soft);
}

.md-preview :deep(a) {
  color: var(--wx-color-primary);
}
</style>
