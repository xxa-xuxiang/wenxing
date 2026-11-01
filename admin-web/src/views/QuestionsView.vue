<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppModal from '../components/AppModal.vue'
import AppPagination from '../components/AppPagination.vue'
import EmptyState from '../components/EmptyState.vue'
import StatusPill from '../components/StatusPill.vue'
import { useConfirm } from '../stores/confirm'
import { useToast } from '../stores/toast'
import { fmtDate } from '../utils/format'
import {
  deleteQuestion,
  getQuestion,
  getQuestions,
  updateQuestion
} from '../services/adminApi'
import type { AdminQuestionDetail, AdminQuestionItem } from '../services/types'

const { ask } = useConfirm()
const toast = useToast()

const filters = reactive({
  status: '',
  type: '',
  difficulty: '',
  industry: '',
  q: ''
})
const query = reactive({
  status: '',
  type: '',
  difficulty: '',
  industry: '',
  q: ''
})

const items = ref<AdminQuestionItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)

const typeLabels: Record<string, string> = {
  single: '单选',
  multiple: '多选',
  short: '简答',
  coding: '编程'
}
const difficultyLabels: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难'
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

async function load() {
  loading.value = true
  try {
    const res = await getQuestions({ ...query, page: page.value, pageSize })
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
  Object.assign(filters, { status: '', type: '', difficulty: '', industry: '', q: '' })
  search()
}

function changePage(next: number) {
  page.value = next
  load()
}

async function setStatus(item: AdminQuestionItem, status: 'verified' | 'rejected') {
  const verify = status === 'verified'
  const ok = await ask({
    title: verify ? '审核通过' : '下架题目',
    message: verify
      ? `确认通过题目「${item.title}」？通过后将进入已通过题库。`
      : `确认将题目「${item.title}」下架？下架后状态变为已驳回。`,
    confirmText: verify ? '通过' : '下架',
    danger: !verify
  })
  if (!ok) return
  try {
    await updateQuestion(item.id, { status })
    toast.show(verify ? '已审核通过' : '已下架', 'success')
    if (detail.value?.id === item.id) await reloadDetail(item.id)
    await load()
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

async function removeQuestion(item: AdminQuestionItem) {
  const ok = await ask({
    title: '删除题目',
    message: `确认删除题目「${item.title}」？删除后不可恢复，相关审计记录也会一并删除。`,
    confirmText: '删除',
    danger: true
  })
  if (!ok) return
  try {
    await deleteQuestion(item.id)
    toast.show('题目已删除', 'success')
    if (detail.value?.id === item.id) closeDetail()
    await load()
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

/* ===== 详情 / 编辑 ===== */
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<AdminQuestionDetail | null>(null)
const editing = ref(false)
const saving = ref(false)
const editForm = reactive({
  title: '',
  body: '',
  answer: '',
  explanation: '',
  optionsText: '',
  type: 'single',
  difficulty: 'easy'
})

const optionLabels = computed(() =>
  (detail.value?.options ?? []).map((_, index) => String.fromCharCode(65 + index))
)

async function openDetail(item: AdminQuestionItem) {
  detailOpen.value = true
  editing.value = false
  detail.value = null
  detailLoading.value = true
  try {
    const res = await getQuestion(item.id)
    detail.value = res.question
  } catch (e) {
    toast.show(errorText(e), 'error')
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

async function reloadDetail(id: string) {
  try {
    const res = await getQuestion(id)
    detail.value = res.question
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

function closeDetail() {
  detailOpen.value = false
  editing.value = false
  detail.value = null
}

function startEdit() {
  const q = detail.value
  if (!q) return
  Object.assign(editForm, {
    title: q.title,
    body: q.body,
    answer: q.answer,
    explanation: q.explanation,
    optionsText: q.options.join('\n'),
    type: q.type,
    difficulty: q.difficulty
  })
  editing.value = true
}

async function saveEdit() {
  const q = detail.value
  if (!q) return
  const ok = await ask({
    title: '保存修改',
    message: '确认保存对当前题目的修改？保存后题目版本号将自动递增。',
    confirmText: '保存'
  })
  if (!ok) return
  saving.value = true
  try {
    await updateQuestion(q.id, {
      title: editForm.title,
      body: editForm.body,
      answer: editForm.answer,
      explanation: editForm.explanation,
      options: editForm.optionsText
        .split('\n')
        .filter((line) => line.trim() !== ''),
      type: editForm.type,
      difficulty: editForm.difficulty
    })
    toast.show('保存成功', 'success')
    editing.value = false
    await Promise.all([reloadDetail(q.id), load()])
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">题库管理</h1>
      <span class="muted">共 {{ total }} 题</span>
    </header>

    <div class="toolbar toolbar-gap">
      <label class="filter-item">
        状态
        <select v-model="filters.status" class="select">
          <option value="">全部</option>
          <option value="draft">草稿</option>
          <option value="verified">已通过</option>
          <option value="rejected">已驳回</option>
        </select>
      </label>
      <label class="filter-item">
        题型
        <select v-model="filters.type" class="select">
          <option value="">全部</option>
          <option value="single">单选</option>
          <option value="multiple">多选</option>
          <option value="short">简答</option>
          <option value="coding">编程</option>
        </select>
      </label>
      <label class="filter-item">
        难度
        <select v-model="filters.difficulty" class="select">
          <option value="">全部</option>
          <option value="easy">简单</option>
          <option value="medium">中等</option>
          <option value="hard">困难</option>
        </select>
      </label>
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
          placeholder="题干 / 叶子名称"
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
            <th>状态</th>
            <th>题型</th>
            <th>难度</th>
            <th>题干</th>
            <th>叶子路径</th>
            <th>版本</th>
            <th>反馈数</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!items.length">
            <td colspan="9">
              <EmptyState :text="loading ? '加载中…' : '暂无题目'" />
            </td>
          </tr>
          <tr v-for="item in items" :key="item.id">
            <td><StatusPill :value="item.status" /></td>
            <td>{{ typeLabels[item.type] ?? item.type }}</td>
            <td>{{ difficultyLabels[item.difficulty] ?? item.difficulty }}</td>
            <td class="cell-wrap">
              <div class="q-title" :title="item.title">{{ item.title }}</div>
            </td>
            <td class="cell-wrap">
              <div class="q-path" :title="item.leaf.pathText">{{ item.leaf.pathText }}</div>
            </td>
            <td>v{{ item.version }}</td>
            <td>{{ item.feedbackCount }}</td>
            <td>{{ fmtDate(item.updatedAt) }}</td>
            <td>
              <div class="row-actions">
                <button type="button" class="btn btn-sm btn-ghost" @click="openDetail(item)">
                  详情
                </button>
                <button
                  v-if="item.status === 'draft' || item.status === 'rejected'"
                  type="button"
                  class="btn btn-sm"
                  @click="setStatus(item, 'verified')"
                >
                  通过
                </button>
                <button
                  v-if="item.status !== 'rejected'"
                  type="button"
                  class="btn btn-sm"
                  @click="setStatus(item, 'rejected')"
                >
                  下架
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-danger"
                  @click="removeQuestion(item)"
                >
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
      :open="detailOpen"
      :title="editing ? '编辑题目' : '题目详情'"
      width="820px"
      @close="closeDetail"
    >
      <div v-if="detailLoading" class="muted">加载中…</div>

      <template v-else-if="detail">
        <template v-if="!editing">
          <div class="detail-section">
            <div class="detail-label">题干</div>
            <div class="detail-value">{{ detail.body || '—' }}</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">选项</div>
            <ul v-if="detail.options.length" class="option-list">
              <li v-for="(opt, index) in detail.options" :key="index">
                {{ optionLabels[index] }}. {{ opt }}
              </li>
            </ul>
            <div v-else class="muted">—</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">答案</div>
            <div class="detail-value">{{ detail.answer || '—' }}</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">解析</div>
            <div class="detail-value">{{ detail.explanation || '—' }}</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">出处</div>
            <ul v-if="detail.sources.length" class="source-list">
              <li v-for="(source, index) in detail.sources" :key="index">
                <a :href="source.url" target="_blank" rel="noopener noreferrer">
                  {{ source.title || source.url }}
                </a>
              </li>
            </ul>
            <div v-else class="muted">—</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">叶子完整路径</div>
            <div class="detail-value">{{ detail.leaf.pathText || '—' }}</div>
          </div>
          <div class="detail-section meta-row">
            <span>版本：v{{ detail.version }}</span>
            <span>来源：{{ detail.source || '—' }}</span>
            <span>创建：{{ fmtDate(detail.createdAt) }}</span>
            <span>更新：{{ fmtDate(detail.updatedAt) }}</span>
          </div>

          <div class="detail-section">
            <div class="detail-label">审计记录</div>
            <div v-if="detail.audits.length" class="audit-list">
              <div v-for="audit in detail.audits" :key="audit.id" class="audit-item">
                <div class="audit-head">
                  <span class="audit-verdict">{{ audit.verdict }}</span>
                  <span class="muted">第 {{ audit.attempt }} 次 · {{ fmtDate(audit.createdAt) }}</span>
                </div>
                <div class="detail-value">{{ audit.reason || '—' }}</div>
              </div>
            </div>
            <div v-else class="muted">暂无审计记录</div>
          </div>
        </template>

        <form v-else class="edit-form" @submit.prevent="saveEdit">
          <div class="field">
            <label class="field-label">标题</label>
            <input v-model="editForm.title" class="input" type="text" />
          </div>
          <div class="field">
            <label class="field-label">题干</label>
            <textarea v-model="editForm.body" class="textarea" />
          </div>
          <div class="field">
            <label class="field-label">答案</label>
            <input v-model="editForm.answer" class="input" type="text" />
          </div>
          <div class="field">
            <label class="field-label">解析</label>
            <textarea v-model="editForm.explanation" class="textarea" />
          </div>
          <div class="field">
            <label class="field-label">选项（每行一个）</label>
            <textarea v-model="editForm.optionsText" class="textarea" />
          </div>
          <div class="edit-row">
            <div class="field">
              <label class="field-label">题型</label>
              <select v-model="editForm.type" class="select">
                <option value="single">单选</option>
                <option value="multiple">多选</option>
                <option value="short">简答</option>
                <option value="coding">编程</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">难度</label>
              <select v-model="editForm.difficulty" class="select">
                <option value="easy">简单</option>
                <option value="medium">中等</option>
                <option value="hard">困难</option>
              </select>
            </div>
          </div>
        </form>
      </template>

      <template #footer>
        <template v-if="editing">
          <button type="button" class="btn btn-ghost" @click="editing = false">取消</button>
          <button type="button" class="btn btn-primary" :disabled="saving" @click="saveEdit">
            {{ saving ? '保存中…' : '保存修改' }}
          </button>
        </template>
        <template v-else>
          <button type="button" class="btn btn-ghost" @click="closeDetail">关闭</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!detail"
            @click="startEdit"
          >
            编辑
          </button>
        </template>
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

.filter-item .select {
  width: 120px;
}

.filter-item .input {
  width: 150px;
}

.filter-item .input-wide {
  width: 200px;
}

.q-title {
  display: -webkit-box;
  max-width: 340px;
  overflow: hidden;
  color: var(--wx-text-primary);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.q-path {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-section + .detail-section {
  margin-top: var(--wx-space-md);
}

.detail-label {
  margin-bottom: 4px;
  color: var(--wx-text-tertiary);
  font-size: 12px;
}

.detail-value {
  white-space: pre-wrap;
  word-break: break-word;
}

.option-list,
.source-list {
  margin: 0;
  padding-left: 20px;
}

.option-list li,
.source-list li {
  white-space: pre-wrap;
  word-break: break-word;
}

.source-list a {
  color: var(--wx-color-primary);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wx-space-md);
  color: var(--wx-text-tertiary);
  font-size: 12px;
}

.audit-list {
  display: flex;
  flex-direction: column;
  gap: var(--wx-space-sm);
}

.audit-item {
  padding: var(--wx-space-sm);
  background: var(--wx-glass-bg);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
}

.audit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wx-space-sm);
  margin-bottom: 4px;
}

.audit-verdict {
  color: var(--wx-text-primary);
  font-weight: 600;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--wx-space-md);
}

.edit-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--wx-space-md);
}
</style>
