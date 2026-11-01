<script setup lang="ts">
// 问星 v0.9 — 个人全行业文章管理界面
// 左侧栏：个人文件分类目录树（回答「文件放在哪里、属于谁、处于什么状态」）
// 主区：规律等宽缩略图网格（非瀑布流）——卡片只做三件事：预览图、标题、Edited 时间（+ 标签，元数据克制）
// 顶栏：通知铃铛（有人点赞/评论即通知，点击条状通知定位到对应文章）
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { visibleIndustries } from '@/data/communityIndustries'
import { storage } from '@/utils/storage'
import {
  listMyPosts,
  getNotifications,
  type MyPostItem,
  type NotificationItem
} from '@/services/communityService'
import { listNotes } from '@/services/noteService'
import { blocksToMarkdown, type EdBlock } from '@/components/community/blocks'

/** 从块树提取纯文本摘要（看板卡片内容预览；损坏数据静默回落空串） */
function excerptOf(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  try {
    return blocksToMarkdown(blocks as EdBlock[])
      .replace(/[#>*`\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
  } catch {
    return ''
  }
}

const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()

// ===== 我的已发布文章（全行业） =====
const posts = ref<MyPostItem[]>([])
const loading = ref(false)
const error = ref('')

// ===== 草稿（归属行业，localStorage 自动保存） =====
interface DraftItem {
  industryId: string
  title: string
  excerpt: string
  updatedAt: number
}
const drafts = computed<DraftItem[]>(() => {
  const out: DraftItem[] = []
  for (const ind of visibleIndustries()) {
    const key = `community:draft:${ind.id}`
    if (!storage.has(key)) continue
    const d = storage.get<{ title?: string; updatedAt?: number; blocks?: EdBlock[] } | null>(key, null)
    out.push({
      industryId: ind.id,
      title: d?.title?.trim() || '无标题草稿',
      excerpt: excerptOf(d?.blocks),
      updatedAt: d?.updatedAt ?? 0
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
})

// ===== 学习笔记（与社区草稿同命名空间：community:notes:<noteId>，见 services/noteService） =====
const notes = computed<FileCard[]>(() =>
  listNotes().map((n) => ({
    key: `note:${n.id}`,
    kind: 'note',
    id: n.id,
    industryId: n.industryId,
    title: n.title?.trim() || '未命名笔记',
    excerpt: excerptOf(n.blocks),
    cover: null,
    tags: [],
    editedAt: n.updatedAt
  }))
)

// ===== 左侧分类树 =====
type FilterKey = 'all' | 'drafts' | 'notes' | `ind:${string}`
const filter = ref<FilterKey>('all')
// 行业分类文件夹展开态（目录树）
const treeOpen = ref(true)

interface IndGroup {
  id: string
  name: string
  icon: string
  postCount: number
  draftCount: number
}
const indGroups = computed<IndGroup[]>(() =>
  visibleIndustries().map((ind) => ({
    id: ind.id,
    name: ind.name,
    icon: ind.icon,
    postCount: posts.value.filter((p) => p.industryId === ind.id).length,
    draftCount: drafts.value.filter((d) => d.industryId === ind.id).length
  }))
)

// 等宽网格数据源：已发布 + 草稿统一为「文件卡」，草稿带状态标记
interface FileCard {
  key: string
  kind: 'post' | 'draft' | 'note'
  id: string
  industryId: string
  title: string
  /** 内容摘要（封面无图时做文稿预览） */
  excerpt: string
  cover: string | null
  tags: string[]
  editedAt: number
}
const cards = computed<FileCard[]>(() => {
  let list: FileCard[] = []
  const published: FileCard[] = posts.value.map((p) => ({
    key: `post:${p.id}`,
    kind: 'post',
    id: p.id,
    industryId: p.industryId,
    title: p.title,
    excerpt: p.excerpt ?? '',
    cover: p.cover,
    tags: p.tags,
    editedAt: new Date(p.updatedAt).getTime()
  }))
  const draftCards: FileCard[] = drafts.value.map((d) => ({
    key: `draft:${d.industryId}`,
    kind: 'draft',
    id: d.industryId,
    industryId: d.industryId,
    title: d.title,
    excerpt: d.excerpt,
    cover: null,
    tags: [],
    editedAt: d.updatedAt
  }))
  const noteCards = notes.value
  if (filter.value === 'all') list = [...published, ...draftCards, ...noteCards]
  else if (filter.value === 'drafts') list = draftCards
  else if (filter.value === 'notes') list = noteCards
  else {
    const indId = filter.value.slice(3)
    list = [...published.filter((p) => p.industryId === indId), ...draftCards.filter((d) => d.industryId === indId)]
  }
  return list.sort((a, b) => b.editedAt - a.editedAt)
})

const totalCount = computed(() => posts.value.length + drafts.value.length + notes.value.length)
const draftTotal = computed(() => drafts.value.length)

// ===== 通知（我发表的帖子收到的新点赞 / 新评论） =====
const notifications = ref<NotificationItem[]>([])
const notifOpen = ref(false)
const NOTIF_READ_KEY = 'community:notifLastRead'

/** 未读数 = 晚于上次已读时间戳的通知条数 */
const unreadCount = computed(() => {
  const lastRead = storage.get<number>(NOTIF_READ_KEY, 0)
  return notifications.value.filter((n) => new Date(n.createdAt).getTime() > lastRead).length
})

function toggleNotif() {
  notifOpen.value = !notifOpen.value
  if (notifOpen.value) storage.set(NOTIF_READ_KEY, Date.now()) // 打开即视为已读
}

/** 点击条状通知 → 定位到对应文章 */
function gotoNotification(n: NotificationItem) {
  notifOpen.value = false
  router.push(`/community/${n.postId}`)
}

function openCard(c: FileCard) {
  if (c.kind === 'post') router.push(`/community/${c.id}`)
  else if (c.kind === 'note') router.push('/learn?note=' + c.id) // 回到学习界面打开对应笔记
  else {
    community.setIndustry(c.industryId)
    router.push('/community/new')
  }
}

function newPost() {
  router.push('/community/new')
}

/** Edited 时间：当天显示时分，一周内显示「x 天前」，更早显示日期 */
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

onMounted(() => {
  if (!auth.user) {
    router.replace('/auth')
    return
  }
  loading.value = true
  void listMyPosts()
    .then((res) => {
      posts.value = res.items
    })
    .catch(() => {
      error.value = '文章列表加载失败，请确认后端已启动'
    })
    .finally(() => {
      loading.value = false
    })
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
  <div class="wx-mp">
    <!-- ===== 顶栏：返回 + 标题 + 通知铃铛 ===== -->
    <header class="wx-mp-top">
      <button class="wx-mp-back wx-pressable" title="返回社区" @click="router.push('/community')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div class="wx-mp-head">
        <h1 class="wx-mp-title">我的文章</h1>
        <span class="wx-mp-sub">全行业 · {{ posts.length }} 篇已发布 · {{ draftTotal }} 篇草稿</span>
      </div>
      <button class="wx-mp-new wx-btn-gradient wx-pressable" @click="newPost">＋ 新建文章</button>

      <!-- 通知铃铛 + 条状通知下拉 -->
      <div class="wx-mp-bell-wrap">
        <button class="wx-mp-bell wx-pressable" :class="{ open: notifOpen }" title="通知" @click="toggleNotif">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <span v-if="unreadCount > 0" class="wx-mp-bell-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
        </button>
        <Transition name="wx-mp-pop">
          <div v-if="notifOpen" class="wx-mp-notif wx-glass-strong">
            <div class="wx-mp-notif-head">通知</div>
            <div v-if="notifications.length === 0" class="wx-mp-notif-empty">暂无通知，有人点赞或评论你的文章时会出现在这里</div>
            <button
              v-for="n in notifications"
              :key="n.id"
              class="wx-mp-notif-item"
              :title="n.postTitle"
              @click="gotoNotification(n)"
            >
              <span class="wx-mp-notif-kind" :class="n.kind">{{ n.kind === 'like' ? '♥' : '💬' }}</span>
              <span class="wx-mp-notif-text">
                <b>{{ n.from }}</b>
                {{ n.kind === 'like' ? ' 赞了你的文章' : ` 评论了「${n.postTitle}」` }}
                <em v-if="n.excerpt">「{{ n.excerpt }}」</em>
              </span>
              <span class="wx-mp-notif-time">{{ editedText(new Date(n.createdAt).getTime()) }}</span>
            </button>
          </div>
        </Transition>
      </div>
    </header>

    <div class="wx-mp-body">
      <!-- ===== 左侧：个人文件目录树（文件夹可折叠） ===== -->
      <aside class="wx-mp-side">
        <div class="wx-mp-side-label">文件目录</div>
        <ul class="wx-mp-tree">
          <li>
            <button class="wx-mp-node" :class="{ active: filter === 'all' }" @click="filter = 'all'">
              <span class="wx-mp-node-icon">🗂</span>
              <span class="wx-mp-node-name">全部文章</span>
              <span class="wx-mp-node-count">{{ totalCount }}</span>
            </button>
          </li>
          <li>
            <button class="wx-mp-node wx-mp-folder" :class="{ open: treeOpen }" @click="treeOpen = !treeOpen">
              <span class="wx-mp-node-chevron">▸</span>
              <span class="wx-mp-node-icon">📁</span>
              <span class="wx-mp-node-name">行业分类</span>
            </button>
            <ul v-show="treeOpen" class="wx-mp-subtree">
              <li v-for="g in indGroups" :key="g.id">
                <button class="wx-mp-node" :class="{ active: filter === `ind:${g.id}` }" @click="filter = `ind:${g.id}`">
                  <span class="wx-mp-node-icon">{{ g.icon }}</span>
                  <span class="wx-mp-node-name">{{ g.name }}</span>
                  <span v-if="g.draftCount" class="wx-mp-node-draft" title="有草稿">✎</span>
                  <span class="wx-mp-node-count">{{ g.postCount }}</span>
                </button>
              </li>
            </ul>
          </li>
          <li>
            <button class="wx-mp-node" :class="{ active: filter === 'drafts' }" @click="filter = 'drafts'">
              <span class="wx-mp-node-icon">📝</span>
              <span class="wx-mp-node-name">草稿箱</span>
              <span class="wx-mp-node-count">{{ draftTotal }}</span>
            </button>
          </li>
          <li>
            <button class="wx-mp-node" :class="{ active: filter === 'notes' }" @click="filter = 'notes'">
              <span class="wx-mp-node-icon">✎</span>
              <span class="wx-mp-node-name">学习笔记</span>
              <span class="wx-mp-node-count">{{ notes.length }}</span>
            </button>
          </li>
        </ul>
      </aside>

      <!-- ===== 主区：规律等宽缩略图网格 ===== -->
      <section class="wx-mp-main">
        <div v-if="loading" class="wx-mp-tip">加载中…</div>
        <div v-else-if="error" class="wx-mp-tip">⚠ {{ error }}</div>
        <div v-else-if="cards.length === 0" class="wx-mp-empty">
          <span class="wx-mp-empty-mark">❋</span>
          <p class="wx-mp-empty-text">
            {{ filter === 'notes' ? '还没有学习笔记，去学习界面点上方「笔记」开始记录' : '这里还没有文件，去写第一篇吧' }}
          </p>
          <button v-if="filter !== 'notes'" class="wx-btn-gradient wx-pressable" @click="newPost">新建文章</button>
          <button v-else class="wx-btn-gradient wx-pressable" @click="router.push('/learn')">去学习界面</button>
        </div>
        <div v-else class="wx-mp-grid">
          <article v-for="c in cards" :key="c.key" class="wx-mp-card wx-glass wx-glass-hover" @click="openCard(c)">
            <!-- 预览图：封面即内容预览；无封面用摘要文本做文稿预览，无摘要回落首字占位 -->
            <div class="wx-mp-cover">
              <img v-if="c.cover" :src="apiUrl(c.cover)" :alt="c.title" loading="lazy" />
              <span v-else-if="c.excerpt" class="wx-mp-cover-excerpt">{{ c.excerpt }}</span>
              <span v-else class="wx-mp-cover-ph">{{ c.title.slice(0, 1) }}</span>
              <span v-if="c.kind === 'draft'" class="wx-mp-card-draft">草稿</span>
              <span v-else-if="c.kind === 'note'" class="wx-mp-card-note">笔记</span>
            </div>
            <div class="wx-mp-card-body">
              <h3 class="wx-mp-card-title" :title="c.excerpt ? `${c.title}\n\n${c.excerpt}` : c.title">{{ c.title }}</h3>
              <div class="wx-mp-card-meta">
                <span class="wx-mp-card-edited">Edited {{ editedText(c.editedAt) }}</span>
                <span v-if="c.tags.length" class="wx-mp-card-tags">{{ c.tags.slice(0, 2).map((t) => `# ${t}`).join(' ') }}</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.wx-mp {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ===== 顶栏 ===== */
.wx-mp-top {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 24px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-mp-back {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-mp-back svg { width: 17px; height: 17px; }
.wx-mp-back:hover { color: var(--wx-color-primary-soft); border-color: var(--wx-border-glow); }
.wx-mp-head { flex: 1; min-width: 0; }
.wx-mp-title {
  font-family: var(--wx-font-serif);
  font-size: 19px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-mp-sub { display: block; margin-top: 2px; font-size: 11px; color: var(--wx-text-muted); }
.wx-mp-new { flex-shrink: 0; padding: 8px 18px; font-size: 12.5px; font-weight: 600; border-radius: var(--wx-radius-pill); }

/* 通知铃铛 */
.wx-mp-bell-wrap { position: relative; flex-shrink: 0; }
.wx-mp-bell {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  position: relative;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-mp-bell svg { width: 17px; height: 17px; }
.wx-mp-bell:hover, .wx-mp-bell.open { color: var(--wx-color-primary-soft); border-color: var(--wx-border-glow); }
.wx-mp-bell-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 9.5px;
  line-height: 16px;
  text-align: center;
  color: var(--wx-text-on-accent);
  background: var(--wx-color-vermilion);
  box-shadow: 0 0 8px color-mix(in srgb, var(--wx-color-vermilion) 55%, transparent);
}
.wx-mp-notif {
  position: absolute;
  top: 46px;
  right: 0;
  width: 340px;
  max-height: 420px;
  overflow-y: auto;
  z-index: 40;
  border-radius: var(--wx-radius-lg);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wx-mp-notif-head {
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--wx-text-muted);
  padding: 2px 6px 6px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-mp-notif-empty { font-size: 12px; color: var(--wx-text-muted); padding: 18px 8px; text-align: center; line-height: 1.7; }
.wx-mp-notif-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 8px;
  border-radius: var(--wx-radius-md);
  text-align: left;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-mp-notif-item:hover { background: color-mix(in srgb, var(--wx-ink) 6%, transparent); }
.wx-mp-notif-kind { flex-shrink: 0; font-size: 12px; }
.wx-mp-notif-kind.like { color: var(--wx-color-vermilion); }
.wx-mp-notif-kind.comment { color: #5eead4; }
.wx-mp-notif-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wx-text-secondary);
  line-height: 1.6;
}
.wx-mp-notif-text b { color: var(--wx-text-primary); font-weight: 600; }
.wx-mp-notif-text em { font-style: normal; color: var(--wx-text-muted); }
.wx-mp-notif-time { flex-shrink: 0; font-size: 10.5px; color: var(--wx-text-muted); }
.wx-mp-pop-enter-active, .wx-mp-pop-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.wx-mp-pop-enter-from, .wx-mp-pop-leave-to { opacity: 0; transform: translateY(-6px); }

/* ===== 主体：左树 + 右网格 ===== */
.wx-mp-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.wx-mp-side {
  width: 216px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 10px 14px 20px;
  border-right: 1px solid var(--wx-border-soft);
  overflow-y: auto;
  scrollbar-width: thin;
}
.wx-mp-side-label {
  font-size: 10.5px;
  letter-spacing: 0.18em;
  color: var(--wx-text-muted);
  text-transform: uppercase;
  padding: 0 8px 8px;
}
.wx-mp-tree { display: flex; flex-direction: column; gap: 2px; }
.wx-mp-node-chevron {
  flex-shrink: 0;
  width: 12px;
  font-size: 10px;
  color: var(--wx-text-muted);
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-mp-folder.open .wx-mp-node-chevron { transform: rotate(90deg); }
/* 目录树子级：缩进 + 左侧连接线 */
.wx-mp-subtree {
  margin-left: 11px;
  padding-left: 10px;
  border-left: 1px solid var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wx-mp-node {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-secondary);
  font-size: 12.5px;
  text-align: left;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-mp-node:hover { color: var(--wx-text-primary); background: color-mix(in srgb, var(--wx-ink) 5%, transparent); }
.wx-mp-node.active { color: var(--wx-text-on-accent); background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent); }
.wx-mp-node-icon { flex-shrink: 0; font-size: 12px; opacity: 0.85; }
.wx-mp-node-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wx-mp-node-draft { flex-shrink: 0; font-size: 10.5px; color: var(--wx-color-amber); }
.wx-mp-node-count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10px;
  line-height: 15px;
  text-align: center;
  color: var(--wx-text-tertiary);
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
}

/* ===== 主区：规律等宽缩略图网格（非瀑布流） ===== */
.wx-mp-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 24px 80px;
  scrollbar-width: thin;
}
.wx-mp-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  font-size: 13px;
  color: var(--wx-text-tertiary);
}
.wx-mp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 80px 0;
  text-align: center;
}
.wx-mp-empty-mark { font-size: 38px; opacity: 0.5; }
.wx-mp-empty-text { font-size: 13px; color: var(--wx-text-tertiary); }

.wx-mp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
.wx-mp-card {
  border-radius: var(--wx-radius-lg);
  overflow: hidden;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}
.wx-mp-cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background: var(--wx-gradient-aurora);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-mp-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wx-mp-cover-ph {
  font-family: var(--wx-font-serif);
  font-size: 32px;
  font-weight: 600;
  color: color-mix(in srgb, var(--wx-color-primary-soft) 60%, transparent);
  text-shadow: 0 0 22px color-mix(in srgb, var(--wx-color-primary) 45%, transparent);
}
/* 文稿预览：无封面时封面区直接显示正文摘要 */
.wx-mp-cover-excerpt {
  align-self: stretch;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding: 14px 14px 10px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--wx-text-tertiary);
  text-align: left;
  word-break: break-all;
}
.wx-mp-card-draft {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  color: #1a1a1a;
  background: var(--wx-color-amber);
  font-weight: 700;
}
.wx-mp-card-note {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  color: #1a1a1a;
  background: var(--wx-color-primary-soft);
  font-weight: 700;
}
.wx-mp-card-body { padding: 11px 13px 12px; }
.wx-mp-card-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wx-mp-card-meta {
  margin-top: 7px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wx-mp-card-edited { flex-shrink: 0; font-size: 11px; color: var(--wx-text-muted); font-family: var(--wx-font-mono); }
.wx-mp-card-tags {
  min-width: 0;
  font-size: 10.5px;
  color: var(--wx-color-primary-soft);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
