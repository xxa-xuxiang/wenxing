<script setup lang="ts">
// 帖子详情：行业来源标识 + Markdown 正文（长文生成锚点目录）+ 图片横滑 + 标签 + 点赞收藏 + 评论
// 404（帖子不存在）显示空态与返回按钮；未登录点操作跳 /auth
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { industryName } from '@/data/communityIndustries'
import { renderMarkdown, extractHeadings } from '@/utils/markdown'
import {
  addComment,
  favoritePost,
  getPost,
  likePost,
  unfavoritePost,
  unlikePost,
  type CommunityPostDetail
} from '@/services/communityService'
import { trackEvent } from '@/services/trackService'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()

const postId = computed(() => String(route.params.id ?? ''))
const post = ref<CommunityPostDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)
const errorText = ref('')

async function load() {
  loading.value = true
  notFound.value = false
  errorText.value = ''
  post.value = null
  try {
    post.value = await getPost(postId.value)
  } catch (e) {
    const status = (e as Error & { status?: number }).status
    if (status === 404) notFound.value = true
    else errorText.value = (e as Error).message || '加载失败，请确认后端已启动'
  } finally {
    loading.value = false
  }
}

watch(postId, () => {
  if (postId.value) load()
})
onMounted(load)

// 行为埋点：帖子详情曝光（target=帖子 id）
onMounted(() => {
  if (postId.value) trackEvent('post_view', 'community', { target: postId.value })
})

// ===== 时间显示 =====
function formatTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ===== 轻提示 =====
const notice = ref('')
let noticeTimer: number | undefined
function showNotice(text: string) {
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 2600)
}

// ===== 点赞 / 收藏 =====
const likeBusy = ref(false)
const favBusy = ref(false)

async function toggleLike() {
  if (!auth.user) {
    router.push('/auth')
    return
  }
  const p = post.value
  if (!p || likeBusy.value) return
  likeBusy.value = true
  try {
    const res = p.liked ? await unlikePost(p.id) : await likePost(p.id)
    p.liked = res.liked
    p.likeCount = res.likeCount
  } catch (e) {
    showNotice((e as Error).message || '操作失败，请重试')
  } finally {
    likeBusy.value = false
  }
}

async function toggleFavorite() {
  if (!auth.user) {
    router.push('/auth')
    return
  }
  const p = post.value
  if (!p || favBusy.value) return
  favBusy.value = true
  try {
    const res = p.favorited ? await unfavoritePost(p.id) : await favoritePost(p.id)
    p.favorited = res.favorited
    p.favoriteCount = res.favoriteCount
  } catch (e) {
    showNotice((e as Error).message || '操作失败，请重试')
  } finally {
    favBusy.value = false
  }
}

// ===== 评论 =====
const commentText = ref('')
const sending = ref(false)

async function sendComment() {
  const text = commentText.value.trim()
  if (!text || sending.value) return
  if (!auth.user) {
    router.push('/auth')
    return
  }
  const p = post.value
  if (!p) return
  sending.value = true
  try {
    const c = await addComment(p.id, text)
    p.comments.push(c) // 追加到列表末尾（接口按时间正序）
    p.commentCount += 1
    commentText.value = ''
  } catch (e) {
    showNotice((e as Error).message || '发送失败，请重试')
  } finally {
    sending.value = false
  }
}

const totalImages = computed(() => post.value?.images.length ?? 0)

// ===== Markdown 正文与目录 =====
const contentHtml = computed(() => (post.value ? renderMarkdown(post.value.content) : ''))
const headings = computed(() => (post.value ? extractHeadings(post.value.content) : []))
const articleRef = ref<HTMLElement | null>(null)

/** 目录点击 → 正文滚动到对应标题（锚点 id 由 renderMarkdown 生成，规则一致） */
function scrollToHeading(id: string) {
  const el = articleRef.value?.querySelector<HTMLElement>(`[id="${id}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 行业来源：点击回到所属行业看板（不允许跨行业推荐/跳转） */
function goIndustry() {
  const p = post.value
  if (!p) return
  community.setIndustry(p.industryId)
  router.push('/community')
}
</script>

<template>
  <div class="wx-pd">
    <header class="wx-pd-head">
      <button class="wx-pd-back wx-pressable" title="返回" @click="router.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <span class="wx-pd-head-title">帖子详情</span>
    </header>

    <div v-if="loading" class="wx-pd-tip">加载中…</div>

    <!-- 帖子不存在 -->
    <div v-else-if="notFound" class="wx-pd-tip">
      <span>✿</span>
      <div class="wx-pd-tip-main">
        <p class="wx-pd-tip-text">帖子不存在或已被删除</p>
        <button class="wx-pd-tip-btn wx-pressable" @click="router.push('/community')">返回社区</button>
      </div>
    </div>

    <div v-else-if="!post" class="wx-pd-tip">
      <span>⚠ {{ errorText }}</span>
      <button class="wx-pd-tip-btn wx-pressable" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- 正文滚动区 -->
      <div class="wx-pd-scroll">
        <article ref="articleRef" class="wx-pd-card wx-glass">
          <!-- 图片横滑 -->
          <div v-if="totalImages" class="wx-pd-gallery">
            <div
              v-for="(img, i) in post.images"
              :key="i"
              class="wx-pd-slide"
            >
              <img :src="apiUrl(img)" :alt="`${post.title} ${i + 1}/${totalImages}`" />
            </div>
          </div>
          <div v-if="totalImages > 1" class="wx-pd-gallery-hint">{{ totalImages }} 张图片 · 左右滑动查看</div>

          <h1 class="wx-pd-title">{{ post.title }}</h1>
          <div class="wx-pd-meta">
            <span class="wx-pd-avatar">{{ post.author.nickname.slice(0, 1) }}</span>
            <span class="wx-pd-author">{{ post.author.nickname }}</span>
            <button class="wx-pd-industry" title="返回所属行业看板" @click="goIndustry">
              # {{ industryName(post.industryId) }}
            </button>
            <span class="wx-pd-time">{{ formatTime(post.createdAt) }}</span>
          </div>

          <!-- 长文锚点目录：仅当有 3 个以上章节时展示 -->
          <nav v-if="headings.length >= 3" class="wx-pd-toc">
            <span class="wx-pd-toc-label">本文目录</span>
            <button
              v-for="h in headings"
              :key="h.id"
              class="wx-pd-toc-item"
              :class="`lv${h.level}`"
              @click="scrollToHeading(h.id)"
            >
              {{ h.text }}
            </button>
          </nav>

          <!-- Markdown 正文 -->
          <div class="wx-pd-md" v-html="contentHtml"></div>

          <div v-if="post.tags.length" class="wx-pd-tags">
            <span v-for="t in post.tags" :key="t" class="wx-pd-tag"># {{ t }}</span>
          </div>
        </article>

        <!-- 评论区 -->
        <section class="wx-pd-comments">
          <h2 class="wx-pd-comments-title">评论 · {{ post.commentCount }}</h2>
          <div v-if="!post.comments.length" class="wx-pd-comment-empty">还没有评论，来抢沙发吧</div>
          <div v-for="c in post.comments" :key="c.id" class="wx-pd-comment">
            <span class="wx-pd-avatar wx-pd-avatar-sm">{{ c.author.nickname.slice(0, 1) }}</span>
            <div class="wx-pd-comment-main">
              <div class="wx-pd-comment-meta">
                <span class="wx-pd-author">{{ c.author.nickname }}</span>
                <span class="wx-pd-time">{{ formatTime(c.createdAt) }}</span>
              </div>
              <p class="wx-pd-comment-content">{{ c.content }}</p>
            </div>
          </div>
        </section>
      </div>

      <!-- 底部操作栏：评论输入 + 点赞 + 收藏 -->
      <footer class="wx-pd-bar wx-glass">
        <input
          v-model="commentText"
          class="wx-pd-bar-input"
          type="text"
          maxlength="500"
          placeholder="说点什么…"
          @keydown.enter="sendComment"
        />
        <button
          class="wx-pd-send wx-pressable"
          :disabled="sending || !commentText.trim()"
          @click="sendComment"
        >
          {{ sending ? '发送中…' : '发送' }}
        </button>
        <span class="wx-pd-bar-divider"></span>
        <button class="wx-pd-act" :class="{ liked: post.liked, busy: likeBusy }" @click="toggleLike">
          <span class="wx-pd-act-icon">{{ post.liked ? '♥' : '♡' }}</span>
          <span class="wx-pd-act-count">{{ post.likeCount }}</span>
        </button>
        <button class="wx-pd-act" :class="{ favored: post.favorited, busy: favBusy }" @click="toggleFavorite">
          <span class="wx-pd-act-icon">{{ post.favorited ? '★' : '☆' }}</span>
          <span class="wx-pd-act-count">{{ post.favoriteCount }}</span>
        </button>
      </footer>

      <div v-if="notice" class="wx-pd-toast">{{ notice }}</div>
    </template>
  </div>
</template>

<style scoped>
.wx-pd {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 24px;
  overflow: hidden;
}
.wx-pd-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 4px 14px;
}
.wx-pd-back {
  width: 36px;
  height: 36px;
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
.wx-pd-back svg { width: 18px; height: 18px; }
.wx-pd-back:hover {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-pd-head-title {
  font-family: var(--wx-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-secondary);
}

.wx-pd-tip {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
}
.wx-pd-tip > span:first-child { font-size: 34px; opacity: 0.6; }
.wx-pd-tip-main { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.wx-pd-tip-text { font-size: 14px; }
.wx-pd-tip-btn {
  font-size: 12px;
  padding: 6px 20px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
}

.wx-pd-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px;
}
.wx-pd-card { padding: 20px 22px; }
.wx-pd-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--wx-text-primary);
  line-height: 1.5;
}
.wx-pd-meta {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.wx-pd-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  box-shadow: 0 0 10px color-mix(in srgb, var(--wx-color-primary) 45%, transparent);
}
.wx-pd-avatar-sm { width: 26px; height: 26px; font-size: 11px; }
.wx-pd-author { font-size: 12.5px; color: var(--wx-text-secondary); font-weight: 500; }
.wx-pd-time { font-size: 11px; color: var(--wx-text-muted); margin-left: auto; }

.wx-pd-industry {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  color: var(--wx-color-primary-soft);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 28%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pd-industry:hover { background: color-mix(in srgb, var(--wx-color-primary) 24%, transparent); color: var(--wx-text-on-accent); }
.wx-pd-content {
  margin-top: 14px;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--wx-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 长文锚点目录 */
.wx-pd-toc {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border: 1px solid var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wx-pd-toc-label {
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--wx-text-muted);
  margin-bottom: 4px;
}
.wx-pd-toc-item {
  text-align: left;
  font-size: 12.5px;
  color: var(--wx-text-tertiary);
  padding: 3px 6px;
  border-radius: 6px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pd-toc-item:hover { color: var(--wx-color-primary-soft); background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent); }
.wx-pd-toc-item.lv3 { padding-left: 20px; font-size: 12px; color: var(--wx-text-muted); }

/* Markdown 正文（v-html 渲染，需 :deep 穿透作用域） */
.wx-pd-md { margin-top: 14px; font-size: 13.5px; line-height: 1.85; color: var(--wx-text-secondary); word-break: break-word; }
.wx-pd-md :deep(h1),
.wx-pd-md :deep(h2),
.wx-pd-md :deep(h3),
.wx-pd-md :deep(h4) {
  color: var(--wx-text-primary);
  font-weight: 600;
  line-height: 1.4;
  scroll-margin-top: 20px;
}
.wx-pd-md :deep(h1) { font-size: 19px; margin: 22px 0 10px; }
.wx-pd-md :deep(h2) { font-size: 16px; margin: 20px 0 8px; padding-bottom: 5px; border-bottom: 1px solid var(--wx-border-soft); }
.wx-pd-md :deep(h3) { font-size: 14.5px; margin: 16px 0 6px; }
.wx-pd-md :deep(h4) { font-size: 13.5px; margin: 14px 0 6px; color: var(--wx-text-secondary); }
.wx-pd-md :deep(p) { margin: 9px 0; }
.wx-pd-md :deep(ul),
.wx-pd-md :deep(ol) { margin: 9px 0; padding-left: 22px; }
.wx-pd-md :deep(li) { margin: 4px 0; }
.wx-pd-md :deep(a) { color: var(--wx-color-primary-soft); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--wx-color-primary) 35%, transparent); }
.wx-pd-md :deep(a:hover) { color: var(--wx-text-on-accent); }
.wx-pd-md :deep(code) {
  font-family: var(--wx-font-mono);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--wx-bg-deep) 70%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-secondary);
}
.wx-pd-md :deep(.wx-code-block) {
  margin: 12px 0;
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 85%, transparent);
  border: 1px solid var(--wx-border-soft);
  overflow-x: auto;
}
.wx-pd-md :deep(.wx-code-block code) { background: none; border: none; padding: 0; color: var(--wx-text-secondary); line-height: 1.7; }
.wx-pd-md :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 14px;
  border-left: 3px solid var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  border-radius: 0 var(--wx-radius-sm) var(--wx-radius-sm) 0;
  color: var(--wx-text-tertiary);
}
.wx-pd-md :deep(.wx-md-hr) { margin: 18px 0; border: none; border-top: 1px solid var(--wx-border-soft); }
.wx-pd-md :deep(.wx-md-table) { width: 100%; margin: 12px 0; border-collapse: collapse; font-size: 12.5px; }
.wx-pd-md :deep(.wx-md-table th),
.wx-pd-md :deep(.wx-md-table td) { padding: 7px 10px; border: 1px solid var(--wx-border-soft); text-align: left; }
.wx-pd-md :deep(.wx-md-table th) { background: color-mix(in srgb, var(--wx-ink) 4%, transparent); color: var(--wx-text-primary); }
.wx-pd-md :deep(img) { max-width: 100%; border-radius: var(--wx-radius-sm); }
.wx-pd-md :deep(.wx-mark) { background: color-mix(in srgb, var(--wx-color-amber) 32%, transparent); color: inherit; padding: 0 2px; border-radius: 3px; }
.wx-pd-md :deep(u) { text-decoration-color: color-mix(in srgb, var(--wx-color-primary) 70%, transparent); text-underline-offset: 3px; }
.wx-pd-md :deep(del) { opacity: 0.7; }
.wx-pd-tags { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; }
.wx-pd-tag {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  color: var(--wx-color-primary-soft);
}

/* 图片横滑（scroll-snap） */
.wx-pd-gallery {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  gap: 10px;
  border-radius: var(--wx-radius-md);
  scrollbar-width: none;
}
.wx-pd-gallery::-webkit-scrollbar { display: none; }
.wx-pd-slide {
  flex: 0 0 100%;
  scroll-snap-align: center;
  border-radius: var(--wx-radius-md);
  overflow: hidden;
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
}
.wx-pd-slide img {
  display: block;
  width: 100%;
  max-height: 400px;
  object-fit: contain;
}
.wx-pd-gallery-hint {
  margin-top: 8px;
  text-align: center;
  font-size: 11px;
  color: var(--wx-text-muted);
}

/* 评论区 */
.wx-pd-comments {
  padding: 6px 4px 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wx-pd-comments-title { font-size: 14px; font-weight: 600; color: var(--wx-text-secondary); }
.wx-pd-comment-empty {
  padding: 26px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--wx-text-muted);
}
.wx-pd-comment {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-pd-comment-main { flex: 1; min-width: 0; }
.wx-pd-comment-meta { display: flex; align-items: center; gap: 10px; }
.wx-pd-comment-meta .wx-pd-time { margin-left: auto; }
.wx-pd-comment-content {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--wx-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 底部操作栏 */
.wx-pd-bar {
  flex-shrink: 0;
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 96px 10px 12px; /* 右侧留白避开 AI 悬浮球，保证点赞/收藏可点击 */
  border-radius: var(--wx-radius-pill);
}
.wx-pd-bar-input {
  flex: 1;
  min-width: 0;
  padding: 8px 14px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-primary);
  font-size: 12.5px;
  outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pd-bar-input:focus { border-color: var(--wx-border-glow); }
.wx-pd-send {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 16px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  transition: filter var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pd-send:hover:not(:disabled) { filter: brightness(1.1); }
.wx-pd-send:disabled { opacity: 0.45; cursor: not-allowed; }
.wx-pd-bar-divider {
  width: 1px;
  height: 20px;
  background: var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-pd-act {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-tertiary);
  font-size: 12px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-pd-act:hover { background: color-mix(in srgb, var(--wx-ink) 6%, transparent); }
.wx-pd-act.busy { opacity: 0.6; pointer-events: none; }
.wx-pd-act-icon { font-size: 16px; line-height: 1; }
.wx-pd-act.liked { color: var(--wx-color-vermilion); }
.wx-pd-act.liked .wx-pd-act-icon { text-shadow: 0 0 10px color-mix(in srgb, var(--wx-color-vermilion) 60%, transparent); }
.wx-pd-act.favored { color: var(--wx-color-amber); }
.wx-pd-act.favored .wx-pd-act-icon { text-shadow: 0 0 10px color-mix(in srgb, var(--wx-color-amber) 60%, transparent); }

.wx-pd-toast {
  position: fixed;
  left: 50%;
  bottom: 110px;
  transform: translateX(-50%);
  z-index: 60;
  padding: 8px 18px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-bg-deep) 85%, transparent);
  border: 1px solid var(--wx-border-glow);
  backdrop-filter: blur(12px);
  font-size: 12px;
  color: var(--wx-text-primary);
  box-shadow: var(--wx-shadow-md);
}
</style>
