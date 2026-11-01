<script setup lang="ts">
// 问星管理后台 — 社区管理：社区数据看板（今日指标/趋势/月度对比）+ 帖子/评论管理（无轮询，手动刷新/切尺度拉取）
import { computed, onMounted, ref } from 'vue'
import {
  auditPost,
  deleteComment,
  deletePost,
  getComments,
  getCommunityAnalytics,
  getPost,
  getPosts
} from '../services/adminApi'
import type {
  AdminCommentListItem,
  AdminPostDetail,
  AdminPostListItem,
  CommunityAnalyticsResult,
  CommunityAnalyticsScale,
  CommunityAuthor
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

const INDUSTRIES = [
  { id: 'frontend', name: '前端' },
  { id: 'backend', name: '后端' },
  { id: 'aigc', name: 'AIGC' },
  { id: 'designer', name: '设计师' },
  { id: 'general', name: '综合交流' }
]

const tab = ref<'posts' | 'comments'>('posts')
const busy = ref(false)

const posts = ref<AdminPostListItem[]>([])
const postPage = ref(1)
const postTotal = ref(0)
const postLoading = ref(false)
const industry = ref('')
const postStatus = ref('')
const postKeyword = ref('')
const postAppliedKeyword = ref('')

const comments = ref<AdminCommentListItem[]>([])
const commentPage = ref(1)
const commentTotal = ref(0)
const commentLoading = ref(false)
const commentKeyword = ref('')
const commentAppliedKeyword = ref('')

const postOpen = ref(false)
const postLoadingDetail = ref(false)
const postDetail = ref<AdminPostDetail | null>(null)

/* ===== 社区数据 ===== */
const communityScales: { key: CommunityAnalyticsScale; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' }
]
const communityScale = ref<CommunityAnalyticsScale>('day')
const community = ref<CommunityAnalyticsResult | null>(null)
const communityLoading = ref(false)

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

function industryName(id: string): string {
  return INDUSTRIES.find((item) => item.id === id)?.name ?? (id || '—')
}

function authorText(author: CommunityAuthor): string {
  const nickname = author.nickname?.trim()
  return nickname ? `${nickname} @${author.username}` : `@${author.username}`
}

async function loadCommunity() {
  communityLoading.value = true
  try {
    community.value = await getCommunityAnalytics(communityScale.value)
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    communityLoading.value = false
  }
}

function switchCommunityScale(next: CommunityAnalyticsScale) {
  if (communityScale.value === next) return
  communityScale.value = next
  loadCommunity()
}

function trendXFormatter(value: string): string {
  if (communityScale.value === 'day') return value.slice(5)
  return value
}

const trendChartOption = computed<EChartsOption | null>(() => {
  const data = community.value?.series
  if (!data) return null
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 8, right: 16, top: 36, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: data.map((p) => p.bucket),
      axisLabel: { formatter: trendXFormatter }
    },
    yAxis: { type: 'value' },
    series: [
      { type: 'line', name: '帖子', smooth: true, showSymbol: false, data: data.map((p) => p.posts) },
      { type: 'line', name: '浏览', smooth: true, showSymbol: false, data: data.map((p) => p.views) },
      { type: 'line', name: '点赞', smooth: true, showSymbol: false, data: data.map((p) => p.likes) },
      {
        type: 'line',
        name: '收藏',
        smooth: true,
        showSymbol: false,
        data: data.map((p) => p.favorites)
      }
    ]
  }
})

const monthlyChartOption = computed<EChartsOption | null>(() => {
  const data = community.value?.monthly
  if (!data) return null
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 8, right: 16, top: 36, bottom: 0, containLabel: true },
    xAxis: { type: 'category', data: data.map((p) => p.bucket) },
    yAxis: { type: 'value' },
    series: [
      { type: 'bar', name: '帖子', barMaxWidth: 18, data: data.map((p) => p.posts) },
      { type: 'bar', name: '浏览', barMaxWidth: 18, data: data.map((p) => p.views) },
      { type: 'bar', name: '点赞', barMaxWidth: 18, data: data.map((p) => p.likes) },
      { type: 'bar', name: '收藏', barMaxWidth: 18, data: data.map((p) => p.favorites) }
    ]
  }
})

/* ===== 帖子 / 评论 ===== */
async function loadPosts() {
  postLoading.value = true
  try {
    const result = await getPosts({
      page: postPage.value,
      pageSize: PAGE_SIZE,
      industry: industry.value || undefined,
      status: postStatus.value || undefined,
      q: postAppliedKeyword.value || undefined
    })
    posts.value = result.items
    postTotal.value = result.total
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    postLoading.value = false
  }
}

async function loadComments() {
  commentLoading.value = true
  try {
    const result = await getComments({
      page: commentPage.value,
      pageSize: PAGE_SIZE,
      q: commentAppliedKeyword.value || undefined
    })
    comments.value = result.items
    commentTotal.value = result.total
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    commentLoading.value = false
  }
}

onMounted(() => {
  loadPosts()
  loadCommunity()
})

function switchTab(next: 'posts' | 'comments') {
  if (tab.value === next) return
  tab.value = next
  if (next === 'posts') loadPosts()
  else loadComments()
}

function searchPosts() {
  postAppliedKeyword.value = postKeyword.value.trim()
  postPage.value = 1
  loadPosts()
}

function changePostStatus() {
  postPage.value = 1
  loadPosts()
}

function changePostPage(target: number) {
  postPage.value = target
  loadPosts()
}

function searchComments() {
  commentAppliedKeyword.value = commentKeyword.value.trim()
  commentPage.value = 1
  loadComments()
}

function changeCommentPage(target: number) {
  commentPage.value = target
  loadComments()
}

/** 帖子状态 → StatusPill 取值：approved→active，rejected→rejected */
function statusPillValue(status: string): string {
  if (status === 'approved') return 'active'
  if (status === 'rejected') return 'rejected'
  return status
}

async function openPost(item: AdminPostListItem) {
  postOpen.value = true
  postDetail.value = null
  postLoadingDetail.value = true
  try {
    const result = await getPost(item.id)
    postDetail.value = result.post
  } catch (e) {
    toast.show(errorMessage(e), 'error')
    postOpen.value = false
  } finally {
    postLoadingDetail.value = false
  }
}

function closePost() {
  postOpen.value = false
  postDetail.value = null
}

/** 下架（approved → rejected）/ 恢复（rejected → approved） */
async function toggleAudit(item: AdminPostListItem) {
  if (busy.value) return
  const takingDown = item.status === 'approved'
  const ok = await ask({
    title: takingDown ? '下架帖子' : '恢复帖子',
    message: takingDown
      ? `确定要下架帖子《${item.title}》吗？下架后用户端将不再展示该帖。`
      : `确定要恢复帖子《${item.title}》吗？恢复后该帖将重新在用户端展示。`,
    confirmText: takingDown ? '下架' : '恢复',
    danger: takingDown
  })
  if (!ok) return

  busy.value = true
  try {
    await auditPost(item.id, takingDown ? 'rejected' : 'approved')
    toast.show(takingDown ? '帖子已下架' : '帖子已恢复', 'success')
    if (postOpen.value && postDetail.value?.id === item.id) closePost()
    await loadPosts()
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    busy.value = false
  }
}

async function removePost(id: string, title: string) {
  if (busy.value) return
  const ok = await ask({
    title: '删除帖子',
    message: `确定要删除帖子《${title}》吗？该帖的评论、点赞与收藏会一并删除。`,
    confirmText: '删除帖子',
    danger: true
  })
  if (!ok) return

  busy.value = true
  try {
    await deletePost(id)
    toast.show('帖子已删除', 'success')
    if (postOpen.value) closePost()
    await loadPosts()
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    busy.value = false
  }
}

async function removeComment(item: AdminCommentListItem) {
  if (busy.value) return
  const ok = await ask({
    title: '删除评论',
    message: `确定要删除 ${authorText(item.author)} 的这条评论吗？删除后不可恢复。`,
    confirmText: '删除',
    danger: true
  })
  if (!ok) return

  busy.value = true
  try {
    await deleteComment(item.id)
    toast.show('评论已删除', 'success')
    await loadComments()
  } catch (e) {
    toast.show(errorMessage(e), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">社区管理</h1>
    </header>

    <!-- ===== 社区数据区 ===== -->
    <div class="section-head">
      <h2 class="section-title">社区数据</h2>
      <button type="button" class="btn" :disabled="communityLoading" @click="loadCommunity">
        {{ communityLoading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">今日新增文章</div>
        <div class="stat-value">{{ community ? fmtNum(community.today.posts) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日新增浏览</div>
        <div class="stat-value">{{ community ? fmtNum(community.today.views) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日新增点赞</div>
        <div class="stat-value">{{ community ? fmtNum(community.today.likes) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日新增收藏</div>
        <div class="stat-value">{{ community ? fmtNum(community.today.favorites) : '—' }}</div>
      </div>
    </div>

    <div class="card card-pad block-gap">
      <div class="section-head">
        <h2 class="section-title">社区趋势</h2>
        <div class="scale-tabs">
          <button
            v-for="s in communityScales"
            :key="s.key"
            type="button"
            :class="['page-btn', { active: communityScale === s.key }]"
            :disabled="communityLoading"
            @click="switchCommunityScale(s.key)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>
      <AppChart
        v-if="community?.series"
        :option="trendChartOption"
        height="300px"
        :loading="communityLoading"
      />
      <p v-else class="muted">{{ communityLoading ? '加载中…' : '暂无数据' }}</p>
    </div>

    <div class="card card-pad block-gap">
      <div class="section-head">
        <h2 class="section-title">近 12 个月对比</h2>
      </div>
      <AppChart
        v-if="community?.monthly"
        :option="monthlyChartOption"
        height="300px"
        :loading="communityLoading"
      />
      <p v-else class="muted">{{ communityLoading ? '加载中…' : '暂无数据' }}</p>
    </div>

    <!-- ===== 帖子 / 评论管理 ===== -->
    <div class="tabs list-gap">
      <button
        type="button"
        class="btn btn-sm"
        :class="{ 'btn-primary': tab === 'posts' }"
        @click="switchTab('posts')"
      >
        帖子
      </button>
      <button
        type="button"
        class="btn btn-sm"
        :class="{ 'btn-primary': tab === 'comments' }"
        @click="switchTab('comments')"
      >
        评论
      </button>
    </div>

    <template v-if="tab === 'posts'">
      <div class="toolbar toolbar-gap">
        <select v-model="industry" class="select filter-select" @change="changePostStatus">
          <option value="">全部行业</option>
          <option v-for="item in INDUSTRIES" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select>
        <select v-model="postStatus" class="select filter-select" @change="changePostStatus">
          <option value="">全部状态</option>
          <option value="approved">已发布</option>
          <option value="rejected">已拦截</option>
        </select>
        <input
          v-model="postKeyword"
          class="input search-input"
          type="text"
          placeholder="标题 / 内容关键词"
          @keyup.enter="searchPosts"
        />
        <button type="button" class="btn btn-primary" :disabled="postLoading" @click="searchPosts">
          查询
        </button>
      </div>

      <div class="table-wrap">
        <table class="ad-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>作者</th>
              <th>行业</th>
              <th>状态</th>
              <th>点赞</th>
              <th>评论</th>
              <th>发布时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="postLoading">
              <td colspan="8" class="muted">加载中…</td>
            </tr>
            <tr v-else-if="!posts.length">
              <td colspan="8"><EmptyState text="暂无帖子" /></td>
            </tr>
            <template v-else>
              <tr v-for="item in posts" :key="item.id">
                <td class="cell-strong cell-wrap">{{ item.title }}</td>
                <td>{{ authorText(item.author) }}</td>
                <td>{{ industryName(item.industryId) }}</td>
                <td>
                  <StatusPill :value="statusPillValue(item.status)" />
                </td>
                <td>{{ item.likeCount }}</td>
                <td>{{ item.commentCount }}</td>
                <td>{{ fmtDate(item.createdAt) }}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-sm" @click="openPost(item)">
                      查看
                    </button>
                    <button
                      v-if="item.status === 'approved'"
                      type="button"
                      class="btn btn-sm"
                      :disabled="busy"
                      @click="toggleAudit(item)"
                    >
                      下架
                    </button>
                    <button
                      v-else-if="item.status === 'rejected'"
                      type="button"
                      class="btn btn-sm"
                      :disabled="busy"
                      @click="toggleAudit(item)"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-danger"
                      :disabled="busy"
                      @click="removePost(item.id, item.title)"
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
        :page="postPage"
        :page-size="PAGE_SIZE"
        :total="postTotal"
        @update:page="changePostPage"
      />
    </template>

    <template v-else>
      <div class="toolbar toolbar-gap">
        <input
          v-model="commentKeyword"
          class="input search-input"
          type="text"
          placeholder="评论内容 / 帖子标题"
          @keyup.enter="searchComments"
        />
        <button
          type="button"
          class="btn btn-primary"
          :disabled="commentLoading"
          @click="searchComments"
        >
          查询
        </button>
      </div>

      <div class="table-wrap">
        <table class="ad-table">
          <thead>
            <tr>
              <th>内容</th>
              <th>作者</th>
              <th>所属帖子</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="commentLoading">
              <td colspan="5" class="muted">加载中…</td>
            </tr>
            <tr v-else-if="!comments.length">
              <td colspan="5"><EmptyState text="暂无评论" /></td>
            </tr>
            <template v-else>
              <tr v-for="item in comments" :key="item.id">
                <td class="cell-wrap">{{ item.content }}</td>
                <td>{{ authorText(item.author) }}</td>
                <td class="cell-wrap">{{ item.postTitle || '—' }}</td>
                <td>{{ fmtDate(item.createdAt) }}</td>
                <td>
                  <div class="row-actions">
                    <button
                      type="button"
                      class="btn btn-sm btn-danger"
                      :disabled="busy"
                      @click="removeComment(item)"
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
        :page="commentPage"
        :page-size="PAGE_SIZE"
        :total="commentTotal"
        @update:page="changeCommentPage"
      />
    </template>

    <AppModal :open="postOpen" title="帖子详情" width="720px" @close="closePost">
      <p v-if="postLoadingDetail" class="muted">加载中…</p>
      <template v-else-if="postDetail">
        <h2 class="detail-title">{{ postDetail.title }}</h2>
        <p class="muted detail-meta">
          {{ authorText(postDetail.author) }} · {{ industryName(postDetail.industryId) }} ·
          {{ fmtDate(postDetail.createdAt) }} · 点赞 {{ postDetail.likeCount }} · 评论
          {{ postDetail.commentCount }} · 收藏 {{ postDetail.favoriteCount }}
        </p>
        <p v-if="postDetail.auditReason" class="audit-reason">
          拦截原因：{{ postDetail.auditReason }}
        </p>

        <div v-if="postDetail.tags.length" class="tag-row">
          <span v-for="tag in postDetail.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>

        <div class="post-content">{{ postDetail.content }}</div>

        <div v-if="postDetail.images.length" class="post-images">
          <img
            v-for="img in postDetail.images"
            :key="img"
            :src="img"
            alt="帖子图片"
            class="post-image"
          />
        </div>

        <h3 class="detail-subtitle">评论（{{ postDetail.comments.length }}）</h3>
        <EmptyState v-if="!postDetail.comments.length" text="暂无评论" />
        <ul v-else class="comment-list">
          <li v-for="comment in postDetail.comments" :key="comment.id" class="comment-item">
            <div class="comment-head">
              <span class="comment-author">{{ authorText(comment.author) }}</span>
              <span class="muted">{{ fmtDate(comment.createdAt) }}</span>
            </div>
            <p class="comment-body">{{ comment.content }}</p>
          </li>
        </ul>
      </template>
      <p v-else class="muted">暂无数据</p>

      <template #footer>
        <button type="button" class="btn" @click="closePost">关闭</button>
        <button
          v-if="postDetail"
          type="button"
          class="btn btn-danger"
          :disabled="busy"
          @click="removePost(postDetail.id, postDetail.title)"
        >
          删除帖子
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

.block-gap {
  margin-top: var(--wx-space-md);
}

.scale-tabs {
  display: flex;
  gap: var(--wx-space-xs);
}

.list-gap {
  margin-top: 32px;
}

.tabs {
  display: flex;
  gap: var(--wx-space-sm);
  margin-bottom: var(--wx-space-md);
}

.toolbar-gap {
  margin-bottom: var(--wx-space-md);
}

.filter-select {
  width: 150px;
}

.search-input {
  width: 240px;
}

.audit-reason {
  margin-top: var(--wx-space-sm);
  color: var(--wx-color-amber, #fbbf24);
  font-size: 13px;
  word-break: break-word;
}

.detail-title {
  font-size: 18px;
  font-weight: 650;
  color: var(--wx-text-primary);
  word-break: break-word;
}

.detail-meta {
  margin-top: 6px;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: var(--wx-space-sm);
}

.tag {
  padding: 2px 9px;
  color: var(--wx-text-tertiary);
  font-size: 12px;
  background: var(--wx-glass-bg);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}

.post-content {
  margin-top: var(--wx-space-md);
  padding: var(--wx-space-sm) var(--wx-space-md);
  color: var(--wx-text-primary);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--wx-glass-bg-strong);
  border-radius: var(--wx-radius-sm);
}

.post-images {
  margin-top: var(--wx-space-sm);
}

.post-image {
  display: block;
  max-width: 100%;
  margin-top: var(--wx-space-sm);
  border-radius: var(--wx-radius-sm);
}

.detail-subtitle {
  margin: var(--wx-space-md) 0 var(--wx-space-sm);
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
}

.comment-list {
  display: flex;
  flex-direction: column;
  gap: var(--wx-space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.comment-item {
  padding: var(--wx-space-sm) var(--wx-space-md);
  background: var(--wx-glass-bg);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
}

.comment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wx-space-sm);
}

.comment-author {
  color: var(--wx-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.comment-body {
  margin-top: 4px;
  color: var(--wx-text-secondary);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
