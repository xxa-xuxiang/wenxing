<!-- 帖子详情（移动端，对齐桌面）：Markdown 正文 + 可展开目录 + 图片预览 + 作者卡 + 点赞/收藏/评论 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showImagePreview, showToast } from 'vant'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { industryName } from '@/data/communityIndustries'
import { extractHeadings, renderMarkdown } from '@/utils/markdown'
import {
  addComment,
  favoritePost,
  getPost,
  likePost,
  unfavoritePost,
  unlikePost,
  type CommunityPostDetail
} from '@/services/communityService'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()

const postId = computed(() => String(route.params.id ?? ''))
const post = ref<CommunityPostDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)
const errorText = ref('')

async function load(): Promise<void> {
  loading.value = true
  notFound.value = false
  errorText.value = ''
  post.value = null
  tocOpen.value = false
  try {
    post.value = await getPost(postId.value)
  } catch (e) {
    const status = (e as Error & { status?: number }).status
    if (status === 404) notFound.value = true
    else errorText.value = (e as Error).message || '加载失败，请确认网络后重试'
  } finally {
    loading.value = false
  }
}

watch(postId, () => {
  if (postId.value) void load()
})
onMounted(load)

// ===== Markdown 正文与目录 =====
const contentHtml = computed(() => (post.value ? renderMarkdown(post.value.content) : ''))
const headings = computed(() => (post.value ? extractHeadings(post.value.content) : []))
const tocOpen = ref(false)

/** 目录点击 → 正文滚动到对应标题（锚点 id 由 renderMarkdown 生成，规则一致） */
function scrollToHeading(id: string): void {
  tocOpen.value = false
  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 320)
}

function fmtTime(iso: string): string {
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

function previewImages(start: number): void {
  if (!post.value) return
  void showImagePreview(post.value.images.map((u) => apiUrl(u)), start)
}

/** 未登录：轻提示并跳登录页 */
function requireLogin(): boolean {
  if (auth.user) return true
  showToast('请先登录')
  void router.push('/auth')
  return false
}

// ===== 点赞 / 收藏（幂等切换） =====
const likeBusy = ref(false)
const favBusy = ref(false)

async function toggleLike(): Promise<void> {
  const p = post.value
  if (!p || likeBusy.value || !requireLogin()) return
  likeBusy.value = true
  try {
    const res = p.liked ? await unlikePost(p.id) : await likePost(p.id)
    p.liked = res.liked
    p.likeCount = res.likeCount
    showToast(res.liked ? '已点赞' : '已取消点赞')
  } catch (e) {
    showToast((e as Error).message || '操作失败，请重试')
  } finally {
    likeBusy.value = false
  }
}

async function toggleFavorite(): Promise<void> {
  const p = post.value
  if (!p || favBusy.value || !requireLogin()) return
  favBusy.value = true
  try {
    const res = p.favorited ? await unfavoritePost(p.id) : await favoritePost(p.id)
    p.favorited = res.favorited
    p.favoriteCount = res.favoriteCount
    showToast(res.favorited ? '已收藏' : '已取消收藏')
  } catch (e) {
    showToast((e as Error).message || '操作失败，请重试')
  } finally {
    favBusy.value = false
  }
}

// ===== 评论 =====
const commentText = ref('')
const sending = ref(false)

async function sendComment(): Promise<void> {
  const text = commentText.value.trim()
  const p = post.value
  if (!text || sending.value || !p) return
  if (!requireLogin()) return
  if (text.length > 500) {
    showToast('评论需为 1-500 字')
    return
  }
  sending.value = true
  try {
    const c = await addComment(p.id, text)
    p.comments.push(c)
    p.commentCount += 1
    commentText.value = ''
    showToast('评论已发布')
  } catch (e) {
    showToast((e as Error).message || '发送失败，请重试')
  } finally {
    sending.value = false
  }
}

/** 行业来源：点击回到所属行业看板 */
function goIndustry(): void {
  const p = post.value
  if (!p) return
  community.setIndustry(p.industryId)
  void router.push('/community')
}
</script>

<template>
  <div class="post-page">
    <van-nav-bar fixed placeholder left-arrow @click-left="router.back()">
      <template #title>帖子详情</template>
    </van-nav-bar>

    <van-loading v-if="loading" class="state-tip" vertical>加载中…</van-loading>

    <van-empty v-else-if="notFound" image="search" description="帖子不存在或已被删除">
      <van-button round type="primary" size="small" @click="router.replace('/community')">
        回到社区
      </van-button>
    </van-empty>

    <div v-else-if="errorText" class="state-tip">
      <p>⚠ {{ errorText }}</p>
      <van-button size="small" round @click="load">重新加载</van-button>
    </div>

    <template v-else-if="post">
      <article class="post-card">
        <!-- 图片横滑 -->
        <div v-if="post.images.length" class="gallery">
          <img
            v-for="(img, i) in post.images"
            :key="img"
            :src="apiUrl(img)"
            loading="lazy"
            alt=""
            @click="previewImages(i)"
          />
        </div>

        <h1 class="post-title">{{ post.title }}</h1>

        <!-- 作者信息卡 -->
        <div class="author-card">
          <span class="author-avatar">{{ post.author.nickname.slice(0, 1) }}</span>
          <div class="author-main">
            <div class="author-name">{{ post.author.nickname }}</div>
            <div class="author-meta">
              <button class="ind-chip" @click="goIndustry"># {{ industryName(post.industryId) }}</button>
              <span class="pub-time">{{ fmtTime(post.createdAt) }}</span>
            </div>
          </div>
        </div>

        <!-- 长文锚点目录（底部抽屉） -->
        <button v-if="headings.length >= 3" class="toc-entry" @click="tocOpen = true">
          <van-icon name="bars" />
          <span>本文目录 · {{ headings.length }} 节</span>
          <van-icon name="arrow" />
        </button>

        <!-- Markdown 正文 -->
        <div class="md" v-html="contentHtml"></div>

        <div v-if="post.tags.length" class="tags">
          <span v-for="t in post.tags" :key="t" class="tag"># {{ t }}</span>
        </div>

        <div class="post-stats">
          <span>♥ {{ post.likeCount }} 赞</span>
          <span>★ {{ post.favoriteCount }} 收藏</span>
          <span>💬 {{ post.commentCount }} 评论</span>
        </div>
      </article>

      <section class="comments">
        <div class="comments-head">评论 · {{ post.commentCount }}</div>
        <div v-if="post.comments.length === 0" class="comments-empty">还没有评论，来抢沙发～</div>
        <div v-for="c in post.comments" :key="c.id" class="comment-item">
          <span class="avatar small">{{ c.author.nickname.slice(0, 1) }}</span>
          <div class="comment-main">
            <div class="comment-meta">
              <span class="comment-author">{{ c.author.nickname }}</span>
              <span class="comment-time">{{ fmtTime(c.createdAt) }}</span>
            </div>
            <p class="comment-text">{{ c.content }}</p>
          </div>
        </div>
      </section>
    </template>

    <!-- 浮动目录入口：长文（≥3 节）时悬浮在底部操作条上方 -->
    <button
      v-if="post && headings.length >= 3"
      class="toc-fab"
      aria-label="打开本文目录"
      @click="tocOpen = true"
    >
      <van-icon name="bars" />
      <span>目录</span>
    </button>

    <!-- 底部操作条：点赞 / 收藏 / 评论输入 -->
    <div v-if="post" class="foot-bar">
      <button class="act" :class="{ on: post.liked }" :disabled="likeBusy" @click="toggleLike">
        <van-icon :name="post.liked ? 'good-job' : 'good-job-o'" />
        <span>{{ post.likeCount }}</span>
      </button>
      <button class="act favor" :class="{ on: post.favorited }" :disabled="favBusy" @click="toggleFavorite">
        <van-icon :name="post.favorited ? 'star' : 'star-o'" />
        <span>{{ post.favoriteCount }}</span>
      </button>
      <van-field
        v-model="commentText"
        class="comment-input"
        placeholder="说点什么…（1-500 字）"
        maxlength="500"
        :border="false"
        @keyup.enter="sendComment"
      />
      <van-button
        class="send-btn"
        type="primary"
        size="small"
        round
        :loading="sending"
        :disabled="!commentText.trim()"
        @click="sendComment"
      >
        发送
      </van-button>
    </div>

    <!-- 目录抽屉 -->
    <van-popup v-model:show="tocOpen" position="bottom" round :style="{ maxHeight: '65%' }">
      <div class="toc-panel">
        <div class="toc-head">
          <span class="toc-title">本文目录</span>
          <span class="toc-count">{{ headings.length }} 节</span>
          <van-icon name="cross" class="toc-close" @click="tocOpen = false" />
        </div>
        <div class="toc-body">
          <button
            v-for="h in headings"
            :key="h.id"
            class="toc-item"
            :class="`lv${h.level}`"
            @click="scrollToHeading(h.id)"
          >
            {{ h.text }}
          </button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.post-page {
  min-height: 100vh;
  padding-bottom: calc(70px + env(safe-area-inset-bottom));
  background: #f7f8fa;
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

.post-card {
  margin: 10px 12px;
  padding: 16px 15px;
  background: #fff;
  border-radius: 14px;
}

.gallery {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  border-radius: 10px;
  scrollbar-width: none;
}

.gallery::-webkit-scrollbar {
  display: none;
}

.gallery img {
  flex: 0 0 auto;
  width: 86%;
  max-height: 260px;
  object-fit: cover;
  scroll-snap-align: center;
  border-radius: 10px;
  cursor: zoom-in;
}

.post-title {
  margin: 12px 0 0;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.45;
  color: #323233;
}

/* 作者信息卡 */
.author-card {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f7f8fa;
}

.author-avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.author-main {
  flex: 1;
  min-width: 0;
}

.author-name {
  font-size: 13.5px;
  font-weight: 500;
  color: #323233;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
}

.ind-chip {
  padding: 1px 9px;
  border: none;
  border-radius: 999px;
  font-size: 10.5px;
  color: #4b5cc4;
  background: rgba(102, 126, 234, 0.12);
}

.pub-time {
  font-size: 10.5px;
  color: #c8c9cc;
}

/* 目录入口 */
.toc-entry {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
  padding: 9px 12px;
  border: 1px solid #ebedf0;
  border-radius: 10px;
  font-size: 12.5px;
  color: #646566;
  background: #fff;
}

.toc-entry span {
  flex: 1;
  text-align: left;
}

/* Markdown 正文（浅色移动样式） */
.md {
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.85;
  color: #3a3a3a;
  word-break: break-word;
}

.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
  color: #323233;
  font-weight: 600;
  line-height: 1.4;
  scroll-margin-top: 56px;
}

.md :deep(h1) {
  margin: 22px 0 10px;
  font-size: 19px;
}

.md :deep(h2) {
  margin: 20px 0 8px;
  padding-bottom: 5px;
  font-size: 16.5px;
  border-bottom: 1px solid #f2f3f5;
}

.md :deep(h3) {
  margin: 16px 0 6px;
  font-size: 15.5px;
}

.md :deep(h4) {
  margin: 14px 0 6px;
  font-size: 14.5px;
  color: #646566;
}

.md :deep(p) {
  margin: 9px 0;
}

.md :deep(ul),
.md :deep(ol) {
  margin: 9px 0;
  padding-left: 22px;
}

.md :deep(li) {
  margin: 4px 0;
}

.md :deep(a) {
  color: #1989fa;
  text-decoration: none;
  border-bottom: 1px solid rgba(25, 137, 250, 0.35);
}

.md :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 12.5px;
  background: #f7f8fa;
  color: #c7254e;
}

.md :deep(.wx-code-block) {
  margin: 12px 0;
  padding: 12px;
  border-radius: 10px;
  background: #f7f8fa;
  overflow-x: auto;
}

.md :deep(.wx-code-block code) {
  padding: 0;
  background: none;
  color: #3a3a3a;
  line-height: 1.7;
  white-space: pre;
}

.md :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 12px;
  border-left: 3px solid #1989fa;
  border-radius: 0 8px 8px 0;
  background: rgba(25, 137, 250, 0.06);
  color: #646566;
}

.md :deep(.wx-md-hr) {
  margin: 18px 0;
  border: none;
  border-top: 1px solid #f2f3f5;
}

.md :deep(.wx-md-table) {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
  font-size: 12.5px;
}

.md :deep(.wx-md-table th),
.md :deep(.wx-md-table td) {
  padding: 7px 8px;
  border: 1px solid #ebedf0;
  text-align: left;
}

.md :deep(.wx-md-table th) {
  background: #f7f8fa;
  color: #323233;
}

.md :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}

.md :deep(.wx-mark) {
  background: rgba(255, 213, 79, 0.45);
  padding: 0 2px;
  border-radius: 3px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.tag {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  color: #1989fa;
  background: rgba(25, 137, 250, 0.08);
}

.post-stats {
  display: flex;
  gap: 14px;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid #f7f8fa;
  font-size: 11.5px;
  color: #969799;
}

/* 评论区 */
.comments {
  margin: 0 12px;
  padding: 14px 15px;
  background: #fff;
  border-radius: 14px;
}

.comments-head {
  font-size: 14px;
  font-weight: 600;
  color: #323233;
  margin-bottom: 8px;
}

.comments-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 12.5px;
  color: #c8c9cc;
}

.comment-item {
  display: flex;
  gap: 9px;
  padding: 9px 0;
  border-bottom: 1px solid #f7f8fa;
}

.comment-item:last-child {
  border-bottom: none;
}

.avatar {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: #fff;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.avatar.small {
  width: 30px;
  height: 30px;
  font-size: 13px;
}

.comment-main {
  flex: 1;
  min-width: 0;
}

.comment-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.comment-author {
  font-size: 12.5px;
  color: #646566;
  font-weight: 500;
}

.comment-time {
  font-size: 10.5px;
  color: #c8c9cc;
}

.comment-text {
  margin: 4px 0 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: #323233;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 底部操作条 */
.foot-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #f2f3f5;
  z-index: 10;
}

.act {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 42px;
  padding: 2px 6px;
  border: none;
  background: none;
  font-size: 11px;
  color: #646566;
}

.act .van-icon {
  font-size: 20px;
}

.act.on {
  color: #ee0a24;
}

.act.favor.on {
  color: #f59e0b;
}

.act:disabled {
  opacity: 0.6;
}

.comment-input {
  flex: 1;
  padding: 5px 10px;
  background: #f7f8fa;
  border-radius: 999px;
  font-size: 13px;
}

.send-btn {
  flex-shrink: 0;
  padding: 0 14px;
}

/* 浮动目录 */
.toc-fab {
  position: fixed;
  right: 14px;
  bottom: calc(74px + env(safe-area-inset-bottom));
  z-index: 9;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 1px solid rgba(102, 126, 234, 0.28);
  border-radius: 50%;
  font-size: 10px;
  line-height: 1;
  color: #4b5cc4;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 14px rgba(102, 126, 234, 0.22);
}

.toc-fab .van-icon {
  font-size: 18px;
}

.toc-fab:active {
  transform: scale(0.94);
}

/* 目录抽屉 */
.toc-panel {
  background: #fff;
  padding-bottom: env(safe-area-inset-bottom);
}

.toc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid #f2f3f5;
}

.toc-title {
  font-size: 16px;
  font-weight: 600;
  color: #323233;
}

.toc-count {
  flex: 1;
  font-size: 11.5px;
  color: #969799;
}

.toc-close {
  font-size: 17px;
  color: #969799;
  padding: 4px;
}

.toc-body {
  max-height: 46vh;
  overflow-y: auto;
  padding: 6px 12px 12px;
}

.toc-item {
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  text-align: left;
  font-size: 13px;
  line-height: 1.5;
  color: #646566;
  background: transparent;
}

.toc-item:active {
  background: #f7f8fa;
}

.toc-item.lv3 {
  padding-left: 24px;
  font-size: 12.5px;
  color: #969799;
}

.toc-item.lv4 {
  padding-left: 34px;
  font-size: 12.5px;
  color: #969799;
}
</style>
