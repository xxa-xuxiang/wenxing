<!-- 我的文章（移动端，对齐桌面）：全部/已发布/草稿筛选 + 分页 + 通知 + 跳转详情 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { industryName, visibleIndustries } from '@/data/communityIndustries'
import {
  getNotifications,
  listMyPosts,
  type MyPostItem,
  type NotificationItem
} from '@/services/communityService'
import { blocksToMarkdown, type EdBlock } from '@/components/community/blocks'
import { storage } from '@/utils/storage'

const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()

// ===== 已发布文章（全行业） =====
const posts = ref<MyPostItem[]>([])
const loading = ref(true)
const errorText = ref('')

/** 正文纯文本摘要：块树草稿走 blocksToMarkdown，旧版纯文本草稿直接截取 */
function excerptOf(blocks: unknown, content?: string): string {
  let raw = ''
  if (Array.isArray(blocks)) {
    try {
      raw = blocksToMarkdown(blocks as EdBlock[])
    } catch {
      raw = ''
    }
  }
  if (!raw) raw = typeof content === 'string' ? content : ''
  return raw
    .replace(/[#>*`\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

// ===== 草稿（按行业保存在 localStorage） =====
interface DraftItem {
  industryId: string
  title: string
  excerpt: string
  updatedAt: number
}
const draftItems = ref<DraftItem[]>([])

function loadDrafts(): void {
  const out: DraftItem[] = []
  for (const ind of visibleIndustries()) {
    const key = `community:draft:${ind.id}`
    if (!storage.has(key)) continue
    const d = storage.get<{
      title?: string
      content?: string
      blocks?: EdBlock[]
      updatedAt?: number
    } | null>(key, null)
    out.push({
      industryId: ind.id,
      title: d?.title?.trim() || '无标题草稿',
      excerpt: excerptOf(d?.blocks, d?.content),
      updatedAt: d?.updatedAt ?? 0
    })
  }
  draftItems.value = out.sort((a, b) => b.updatedAt - a.updatedAt)
}

async function load(): Promise<void> {
  loading.value = true
  errorText.value = ''
  loadDrafts()
  try {
    posts.value = (await listMyPosts()).items
  } catch (e) {
    errorText.value = (e as Error).message || '加载失败，请确认网络后重试'
  } finally {
    loading.value = false
  }
}

// ===== 筛选：全部 / 已发布 / 草稿 =====
type FilterKey = 'all' | 'published' | 'drafts'
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'published', label: '已发布' },
  { key: 'drafts', label: '草稿' }
]
const filter = ref<FilterKey>('all')

interface CardItem {
  key: string
  kind: 'post' | 'draft'
  id: string
  industryId: string
  title: string
  excerpt: string
  cover: string | null
  tags: string[]
  likeCount: number
  commentCount: number
  editedAt: number
}

const cards = computed<CardItem[]>(() => {
  const published: CardItem[] = posts.value.map((p) => ({
    key: `post:${p.id}`,
    kind: 'post',
    id: p.id,
    industryId: p.industryId,
    title: p.title,
    excerpt: p.excerpt ?? '',
    cover: p.cover,
    tags: p.tags,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    editedAt: new Date(p.updatedAt).getTime()
  }))
  const drafts: CardItem[] = draftItems.value.map((d) => ({
    key: `draft:${d.industryId}`,
    kind: 'draft',
    id: d.industryId,
    industryId: d.industryId,
    title: d.title,
    excerpt: d.excerpt,
    cover: null,
    tags: [],
    likeCount: 0,
    commentCount: 0,
    editedAt: d.updatedAt
  }))
  if (filter.value === 'published') return published
  if (filter.value === 'drafts') return drafts
  return [...published, ...drafts].sort((a, b) => b.editedAt - a.editedAt)
})

// ===== 分页（每页 10 条） =====
const PAGE_SIZE = 10
const page = ref(1)
const pageItems = computed(() => cards.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
watch(filter, () => {
  page.value = 1
})

const counts = computed(() => ({
  all: posts.value.length + draftItems.value.length,
  published: posts.value.length,
  drafts: draftItems.value.length
}))

// ===== 编辑时间 =====
function editedText(ts: number): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function openCard(c: CardItem): void {
  if (c.kind === 'post') {
    void router.push(`/community/${c.id}`)
    return
  }
  editDraft(c.industryId)
}

/** 编辑草稿：切换行业后进入发布编辑器（编辑器按行业读取本地草稿） */
function editDraft(industryId: string): void {
  community.setIndustry(industryId)
  void router.push('/community/new')
}

/** 草稿删除（二次确认；本地数据） */
async function removeDraft(d: DraftItem): Promise<void> {
  const ok = await showConfirmDialog({
    title: '删除草稿',
    message: `确定删除「${d.title}」这篇草稿？`,
    confirmButtonText: '删除',
    confirmButtonColor: '#ee0a24'
  })
    .then(() => true)
    .catch(() => false)
  if (!ok) return
  storage.remove(`community:draft:${d.industryId}`)
  loadDrafts()
  showToast('草稿已删除')
}

// ===== 通知（我发表的帖子收到的新点赞 / 新评论） =====
const notifications = ref<NotificationItem[]>([])
const notifOpen = ref(false)
const NOTIF_READ_KEY = 'community:notifLastRead'
const unreadCount = computed(() => {
  const lastRead = storage.get<number>(NOTIF_READ_KEY, 0)
  return notifications.value.filter((n) => new Date(n.createdAt).getTime() > lastRead).length
})

function openNotif(): void {
  notifOpen.value = true
  storage.set(NOTIF_READ_KEY, Date.now())
}

function gotoNotification(n: NotificationItem): void {
  notifOpen.value = false
  void router.push(`/community/${n.postId}`)
}

const newPost = () => router.push('/community/new')

onMounted(() => {
  if (!auth.user) {
    void router.replace('/auth')
    return
  }
  void load()
  void getNotifications()
    .then((res) => {
      notifications.value = res.items
    })
    .catch(() => {
      /* 后端离线时静默：通知为空态 */
    })
})
</script>

<template>
  <div class="mine-page">
    <van-nav-bar fixed placeholder left-arrow @click-left="router.back()">
      <template #title>我的文章</template>
      <template #right>
        <div class="nav-right">
          <span class="nav-bell-wrap" @click="openNotif">
            <van-icon name="bell" class="nav-bell" />
            <span v-if="unreadCount" class="bell-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
          </span>
          <span class="new-entry" @click="newPost">＋ 发帖</span>
        </div>
      </template>
    </van-nav-bar>

    <!-- 筛选 -->
    <div class="filter-bar">
      <button
        v-for="f in FILTERS"
        :key="f.key"
        class="filter-btn"
        :class="{ active: filter === f.key }"
        @click="filter = f.key"
      >
        {{ f.label }}
        <span class="filter-count">{{ counts[f.key] }}</span>
      </button>
    </div>

    <van-loading v-if="loading" class="state-tip" vertical>加载中…</van-loading>

    <div v-else-if="errorText" class="state-tip">
      <p>⚠ {{ errorText }}</p>
      <van-button size="small" round @click="load">重新加载</van-button>
    </div>

    <van-empty
      v-else-if="cards.length === 0"
      :description="
        filter === 'drafts'
          ? '还没有草稿'
          : filter === 'published'
            ? '还没有已发布的文章'
            : '还没有写过文章'
      "
    >
      <van-button round type="primary" size="small" @click="newPost">去发第一帖</van-button>
    </van-empty>

    <template v-else>
      <div class="post-list">
        <article
          v-for="c in pageItems"
          :key="c.key"
          class="post-card clickable"
          @click="openCard(c)"
        >
          <div class="cover" :class="{ 'cover-ph': !c.cover }">
            <img v-if="c.cover" :src="apiUrl(c.cover)" loading="lazy" alt="" />
            <span v-else-if="c.excerpt" class="cover-excerpt">{{ c.excerpt }}</span>
            <span v-else class="cover-mark">{{ c.title.slice(0, 1) }}</span>
            <span v-if="c.kind === 'draft'" class="status-chip draft">草稿</span>
          </div>
          <div class="main">
            <h3 class="title">{{ c.title }}</h3>
            <p v-if="c.excerpt" class="excerpt">{{ c.excerpt }}</p>
            <div class="meta">
              <span class="ind">{{ industryName(c.industryId) }}</span>
              <span v-if="c.kind === 'post'" class="nums">
                <van-icon name="good-job-o" /> {{ c.likeCount }}
                <van-icon name="chat-o" /> {{ c.commentCount }}
              </span>
              <span class="time">{{ editedText(c.editedAt) }}</span>
            </div>
            <div v-if="c.tags.length" class="tags">
              <span v-for="t in c.tags.slice(0, 3)" :key="t"># {{ t }}</span>
            </div>
            <div v-if="c.kind === 'draft'" class="acts">
              <button class="act" @click.stop="editDraft(c.industryId)">编辑草稿</button>
              <button
                class="act danger"
                @click.stop="
                  removeDraft({
                    industryId: c.industryId,
                    title: c.title,
                    excerpt: c.excerpt,
                    updatedAt: c.editedAt
                  })
                "
              >
                删除草稿
              </button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="cards.length > PAGE_SIZE" class="pager">
        <van-pagination
          v-model="page"
          :total-items="cards.length"
          :items-per-page="PAGE_SIZE"
          :show-page-size="3"
          force-ellipses
        />
      </div>
    </template>

    <!-- 通知抽屉 -->
    <van-popup v-model:show="notifOpen" position="bottom" round :style="{ maxHeight: '62%' }">
      <div class="notif-panel">
        <div class="notif-head">
          <span class="notif-title">通知</span>
          <van-icon name="cross" class="notif-close" @click="notifOpen = false" />
        </div>
        <div class="notif-body">
          <div v-if="notifications.length === 0" class="notif-empty">
            暂无通知，有人点赞或评论你的文章时会出现在这里
          </div>
          <button
            v-for="n in notifications"
            :key="n.id"
            class="notif-item"
            @click="gotoNotification(n)"
          >
            <span class="notif-kind" :class="n.kind">{{ n.kind === 'like' ? '♥' : '💬' }}</span>
            <span class="notif-text">
              <b>{{ n.from }}</b>
              {{ n.kind === 'like' ? ' 赞了你的文章' : ` 评论了「${n.postTitle}」` }}
              <em v-if="n.excerpt">「{{ n.excerpt }}」</em>
            </span>
            <span class="notif-time">{{ editedText(new Date(n.createdAt).getTime()) }}</span>
          </button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.mine-page {
  min-height: 100vh;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  background: #f7f8fa;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.nav-bell-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.nav-bell {
  font-size: 19px;
  color: #646566;
}

.bell-badge {
  position: absolute;
  top: -4px;
  right: -8px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 999px;
  font-size: 9px;
  line-height: 15px;
  text-align: center;
  color: #fff;
  background: #ee0a24;
}

.new-entry {
  font-size: 13px;
  color: #1989fa;
}

.filter-bar {
  position: sticky;
  top: 46px;
  z-index: 6;
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  background: #f7f8fa;
}

.filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  font-size: 12.5px;
  color: #646566;
  background: #fff;
}

.filter-btn.active {
  color: #1989fa;
  font-weight: 600;
  background: rgba(25, 137, 250, 0.1);
}

.filter-count {
  font-size: 10.5px;
  color: #c8c9cc;
}

.filter-btn.active .filter-count {
  color: #1989fa;
}

.state-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 90px 20px;
  color: #969799;
  font-size: 13px;
}

.state-tip p {
  margin: 0;
}

.post-list {
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.post-card {
  display: flex;
  gap: 11px;
  padding: 11px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.post-card.clickable:active {
  transform: scale(0.993);
}

.cover {
  position: relative;
  flex-shrink: 0;
  width: 92px;
  height: 92px;
  overflow: hidden;
  border-radius: 10px;
  background: #f7f8fa;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #a5b4fc 0%, #818cf8 60%, #6366f1 100%);
}

.cover-excerpt {
  align-self: stretch;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding: 8px;
  font-size: 10px;
  line-height: 1.5;
  color: #fff;
  text-align: left;
  word-break: break-all;
  opacity: 0.94;
}

.cover-mark {
  font-size: 30px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
}

.status-chip {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 700;
  color: #7c4a00;
  background: #ffd666;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.4;
  color: #323233;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.excerpt {
  margin: 4px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: #969799;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  font-size: 10.5px;
  color: #969799;
}

.ind {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  color: #4b5cc4;
  background: rgba(102, 126, 234, 0.12);
}

.nums {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.nums .van-icon {
  vertical-align: -1.5px;
}

.time {
  margin-left: auto;
  flex-shrink: 0;
  color: #c8c9cc;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 4px;
}

.tags span {
  font-size: 10px;
  color: #7c8cf8;
}

.acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
  padding-top: 6px;
}

.act {
  padding: 4px 12px;
  border: none;
  border-radius: 8px;
  font-size: 11.5px;
  color: #646566;
  background: #f7f8fa;
}

.act.danger {
  color: #ee0a24;
  background: #fff1f0;
}

.pager {
  padding: 14px 16px 4px;
}

.pager :deep(.van-pagination__item) {
  border-radius: 8px;
}

/* 通知抽屉 */
.notif-panel {
  background: #fff;
  padding-bottom: env(safe-area-inset-bottom);
}

.notif-head {
  display: flex;
  align-items: center;
  padding: 14px 16px 10px;
  border-bottom: 1px solid #f2f3f5;
}

.notif-title {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
  color: #323233;
}

.notif-close {
  font-size: 17px;
  color: #969799;
  padding: 4px;
}

.notif-body {
  max-height: 48vh;
  overflow-y: auto;
  padding: 6px 10px 10px;
}

.notif-empty {
  padding: 30px 16px;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.7;
  color: #969799;
}

.notif-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 8px;
  border: none;
  border-radius: 10px;
  text-align: left;
  background: transparent;
}

.notif-item:active {
  background: #f7f8fa;
}

.notif-kind {
  flex-shrink: 0;
  font-size: 12px;
}

.notif-kind.like {
  color: #ee0a24;
}

.notif-kind.comment {
  color: #07c160;
}

.notif-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #646566;
}

.notif-text b {
  color: #323233;
  font-weight: 600;
}

.notif-text em {
  font-style: normal;
  color: #969799;
}

.notif-time {
  flex-shrink: 0;
  font-size: 10px;
  color: #c8c9cc;
}
</style>
