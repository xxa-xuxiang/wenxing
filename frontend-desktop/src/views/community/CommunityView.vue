<script setup lang="ts">
// 问星社区 v0.8 — 桌面端布局重构
// 结构：左侧行业导航（运营方配置，内容分区隔离）+ 顶部搜索/发布/发现（靠右）+ 当前行业交错看板 + 发现页
// 规则：切换行业即重置内容上下文（搜索词/排序/滚动）；顶部不展示品牌名与用户头像（身份入口在左侧栏底部）
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { visibleIndustries, industryName, RECOMMEND_ID } from '@/data/communityIndustries'
import { storage } from '@/utils/storage'
import { listPosts, type CommunityPostListItem } from '@/services/communityService'
import BookshelfView from './BookshelfView.vue'

const PAGE_SIZE = 20
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()

// ===== 二级结构标签（当前行业下统一） =====
type TabKey = 'recommend' | 'latest' | 'hot' | 'qa'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'recommend', label: '推荐' },
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '热榜' },
  { key: 'qa', label: '问答' }
]
const QA_TAG = '求助问答' // 问答内容以专用标签承载（隔离于普通帖子）
const activeTab = ref<TabKey>('recommend')

// ===== 视图模式：board 交错看板 / rank 排行榜 / bookshelf 书籍书架 =====
const mode = ref<'board' | 'rank' | 'bookshelf'>('board')
// 排行榜分榜：热帖 / 问答 / 活跃作者
const rankTab = ref<'hot' | 'qa' | 'author'>('hot')
const RANK_TABS: { key: 'hot' | 'qa' | 'author'; label: string }[] = [
  { key: 'hot', label: '热帖榜' },
  { key: 'qa', label: '问答榜' },
  { key: 'author', label: '活跃作者榜' }
]

// ===== 筛选条件 =====
const searchText = ref('')

const industries = computed(() => visibleIndustries())
const isRecommend = computed(() => community.activeIndustryId === RECOMMEND_ID)
const currentIndustryName = computed(() =>
  isRecommend.value ? '推荐' : industryName(community.activeIndustryId)
)

/** 当前标签映射到接口参数（问答 = 专用标签 + 按回答数排序） */
function queryOfTab(tab: TabKey): { sort?: string; tag?: string } {
  if (tab === 'latest') return { sort: 'latest' }
  if (tab === 'hot') return { sort: 'hot' }
  if (tab === 'qa') return { sort: 'comment', tag: QA_TAG }
  return {}
}

// ===== 列表状态 =====
const items = ref<CommunityPostListItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const finished = computed(() => items.value.length >= total.value)
let reqSeq = 0

function baseParams() {
  return {
    // 推荐流跨行业聚合，后端 industry=all 不加行业过滤
    industry: isRecommend.value ? 'all' : community.activeIndustryId,
    q: searchText.value.trim() || undefined,
    ...queryOfTab(activeTab.value)
  }
}

async function reload() {
  const myId = ++reqSeq
  loading.value = true
  error.value = ''
  items.value = []
  total.value = 0
  page.value = 1
  try {
    const res = await listPosts({ page: 1, pageSize: PAGE_SIZE, ...baseParams() })
    if (myId !== reqSeq) return
    items.value = res.items
    total.value = res.total
    page.value = 2
  } catch {
    if (myId !== reqSeq) return
    error.value = '加载失败，请确认后端已启动'
  } finally {
    if (myId === reqSeq) loading.value = false
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || error.value || finished.value) return
  loadingMore.value = true
  const myId = reqSeq
  try {
    const res = await listPosts({ page: page.value, pageSize: PAGE_SIZE, ...baseParams() })
    if (myId !== reqSeq) return
    items.value.push(...res.items)
    total.value = res.total
    page.value += 1
  } catch {
    /* 加载更多失败静默：滚动到底可再次触发 */
  } finally {
    if (myId === reqSeq) loadingMore.value = false
  }
}

// 搜索防抖 300ms
let searchTimer: number | undefined
watch(searchText, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    if (mode.value === 'rank') return
    reload()
  }, 300)
})

// 切换行业：清空搜索词 / 排序重置 / 退出排行榜 / 重新加载（不保留上一行业内容缓存）
watch(
  () => community.activeIndustryId,
  () => {
    searchText.value = ''
    activeTab.value = 'recommend'
    mode.value = 'board'
    void community.loadCounts()
    void reload()
  }
)

watch(activeTab, () => {
  if (mode.value === 'board') reload()
})

// ===== 发现页数据（置顶/热门/最新/热门问答/活跃作者） =====
interface DiscoverData {
  hot: CommunityPostListItem[]
  latest: CommunityPostListItem[]
  qa: CommunityPostListItem[]
}
const discover = ref<DiscoverData | null>(null)
const discoverLoading = ref(false)

const activeAuthors = computed(() => {
  const d = discover.value
  if (!d) return []
  const map = new Map<string, { name: string; count: number; likes: number }>()
  for (const p of [...d.hot, ...d.latest, ...d.qa]) {
    const cur = map.get(p.author.nickname) ?? { name: p.author.nickname, count: 0, likes: 0 }
    cur.count += 1
    cur.likes += p.likeCount
    map.set(p.author.nickname, cur)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.likes - a.likes).slice(0, 6)
})

async function loadDiscover() {
  discoverLoading.value = true
  try {
    const base = { industry: isRecommend.value ? 'all' : community.activeIndustryId }
    const [hot, latest, qa] = await Promise.all([
      listPosts({ ...base, sort: 'hot', pageSize: 6 }),
      listPosts({ ...base, sort: 'latest', pageSize: 6 }),
      listPosts({ ...base, sort: 'comment', tag: QA_TAG, pageSize: 6 })
    ])
    discover.value = { hot: hot.items, latest: latest.items, qa: qa.items }
  } catch {
    discover.value = { hot: [], latest: [], qa: [] }
  } finally {
    discoverLoading.value = false
  }
}

function toggleRank() {
  if (mode.value === 'rank') {
    mode.value = 'board'
  } else {
    mode.value = 'rank'
    void loadDiscover()
  }
}

/** 书籍书架视图（社区新栏目，置顶入口 + 分割线） */
const isShelf = computed(() => mode.value === 'bookshelf')
function openShelf() {
  mode.value = 'bookshelf'
}
function backToBoard() {
  mode.value = 'board'
}

function switchIndustry(id: string) {
  if (isShelf.value) mode.value = 'board'
  if (id !== community.activeIndustryId) community.setIndustry(id)
}

// 滚动加载更多（内部滚动容器）
const feedRef = ref<HTMLElement | null>(null)
function onFeedScroll() {
  const el = feedRef.value
  if (!el) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) loadMore()
}

// ===== 卡片规格判定（大图文/中图文/文字/短文字/问答） =====
type CardType = 'big' | 'medium' | 'text' | 'short' | 'qa'
function cardType(p: CommunityPostListItem): CardType {
  if (p.tags.includes(QA_TAG)) return 'qa'
  if (p.cover) return p.excerpt.length > 50 ? 'big' : 'medium'
  return p.excerpt.length <= 34 ? 'short' : 'text'
}

function hasDraft(id: string): boolean {
  return storage.has(`community:draft:${id}`)
}

// ===== 交互 =====
function openPost(id: string) {
  router.push(`/community/${id}`)
}
function create() {
  router.push(auth.user ? '/community/new' : '/auth')
}

onMounted(() => {
  // 资源准备页跳转：/community?books=1 直接打开书架
  if (route.query.books === '1') mode.value = 'bookshelf'
  void community.loadCounts()
  void reload()
})
</script>

<template>
  <div class="wx-cc">
    <!-- ===== 左侧行业导航（内容分区边界，运营方配置） ===== -->
    <aside class="wx-cc-side">
      <ul class="wx-cc-side-list">
        <li>
          <button
            class="wx-cc-ind"
            :class="{ active: isShelf }"
            data-test="community-books"
            @click="openShelf"
          >
            <span class="wx-cc-ind-icon">📚</span>
            <span class="wx-cc-ind-name">书籍</span>
          </button>
        </li>
        <li class="wx-cc-side-divider" aria-hidden="true"></li>
        <li>
          <button
            class="wx-cc-ind"
            :class="{ active: isRecommend && !isShelf }"
            @click="switchIndustry(RECOMMEND_ID)"
          >
            <span class="wx-cc-ind-icon">✦</span>
            <span class="wx-cc-ind-name">推荐</span>
          </button>
        </li>
        <li class="wx-cc-side-divider" aria-hidden="true"></li>
        <li v-for="ind in industries" :key="ind.id">
          <button
            class="wx-cc-ind"
            :class="{ active: ind.id === community.activeIndustryId && !isShelf }"
            @click="switchIndustry(ind.id)"
          >
            <span class="wx-cc-ind-icon">{{ ind.icon }}</span>
            <span class="wx-cc-ind-name">{{ ind.name }}</span>
            <span v-if="community.counts[ind.id]" class="wx-cc-ind-count">{{ community.counts[ind.id] }}</span>
            <span v-else-if="hasDraft(ind.id)" class="wx-cc-ind-draft" title="有未发布草稿">✎</span>
          </button>
        </li>
      </ul>
    </aside>

    <!-- ===== 主区：顶部（搜索/发布/发现靠右）+ 二级标签 + 内容 ===== -->
    <section class="wx-cc-main">
      <header class="wx-cc-top">
        <div class="wx-cc-top-left">
          <h1 class="wx-cc-title">{{ isShelf ? '书籍' : currentIndustryName }}</h1>
          <span class="wx-cc-title-hint">{{ isShelf ? '开放教材与上传书籍 · 封面书架' : '行业内容分区 · 与其他行业相互隔离' }}</span>
        </div>
        <div class="wx-cc-top-right">
          <div v-if="!isShelf" class="wx-cc-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              v-model="searchText"
              class="wx-cc-search-input"
              type="text"
              :placeholder="`搜索「${currentIndustryName}」内容`"
            />
            <button v-if="searchText" class="wx-cc-search-clear" title="清除" @click="searchText = ''">✕</button>
          </div>
          <button v-if="!isShelf" class="wx-cc-top-btn wx-cc-publish wx-pressable" @click="create">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 20h4L19 9a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16v4Z" />
              <path d="M14 6l3 3" />
            </svg>
            <span>发布</span>
          </button>
          <button
            v-if="!isShelf"
            class="wx-cc-top-btn wx-cc-discover wx-pressable"
            :class="{ active: mode === 'rank' }"
            @click="toggleRank"
          >
            <span class="wx-cc-discover-icon">♛</span>
            <span>排行榜</span>
          </button>
          <button v-if="isShelf" class="wx-cc-top-btn wx-pressable" @click="backToBoard">
            <span class="wx-cc-discover-icon">←</span>
            <span>返回看板</span>
          </button>
          <button class="wx-cc-top-btn wx-cc-mine wx-pressable" @click="router.push('/community/mine')">
            <span class="wx-cc-discover-icon">◫</span>
            <span>我的</span>
          </button>
        </div>
      </header>

      <!-- 二级结构：推荐 / 最新 / 热榜 / 问答（排行榜页时不显示） -->
      <nav v-if="mode === 'board'" class="wx-cc-tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="wx-cc-tab"
          :class="{ active: activeTab === t.key }"
          @click="activeTab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>
      <nav v-else-if="mode === 'rank'" class="wx-cc-tabs">
        <button class="wx-cc-tab active">排行榜 · {{ currentIndustryName }}</button>
        <button class="wx-cc-tab" @click="mode = 'board'">← 返回看板</button>
      </nav>

      <!-- ===== 排行榜：热帖榜 / 问答榜 / 活跃作者榜 ===== -->
      <div v-if="mode === 'rank'" class="wx-cc-feed">
        <div class="wx-cc-rank-tabs">
          <button
            v-for="rt in RANK_TABS"
            :key="rt.key"
            class="wx-cc-tab"
            :class="{ active: rankTab === rt.key }"
            @click="rankTab = rt.key"
          >{{ rt.label }}</button>
        </div>

        <div v-if="discoverLoading" class="wx-cc-tip">加载排行数据…</div>
        <template v-else-if="discover">
          <!-- 热帖榜：按热度排序，名次行 -->
          <ol v-if="rankTab === 'hot'" class="wx-cc-rank">
            <div v-if="!discover.hot.length" class="wx-cc-sec-empty">本行业暂无内容，去发布第一篇吧</div>
            <li
              v-for="(p, i) in discover.hot"
              :key="p.id"
              :class="{ top: i < 3 }"
              @click="openPost(p.id)"
            >
              <span class="wx-cc-rank-no">{{ i + 1 }}</span>
              <span class="wx-cc-rank-title">{{ p.title }}</span>
              <span class="wx-cc-rank-meta">{{ p.author.nickname }}</span>
              <span class="wx-cc-rank-val">♥ {{ p.likeCount }}</span>
            </li>
          </ol>

          <!-- 问答榜：按回答数排序 -->
          <ol v-else-if="rankTab === 'qa'" class="wx-cc-rank">
            <div v-if="!discover.qa.length" class="wx-cc-sec-empty">本行业暂无问答</div>
            <li
              v-for="(p, i) in discover.qa"
              :key="p.id"
              :class="{ top: i < 3 }"
              @click="openPost(p.id)"
            >
              <span class="wx-cc-rank-no">{{ i + 1 }}</span>
              <span class="wx-cc-rank-title">{{ p.title }}</span>
              <span class="wx-cc-rank-meta">{{ p.author.nickname }}</span>
              <span class="wx-cc-rank-val qa">{{ p.commentCount }} 回答</span>
            </li>
          </ol>

          <!-- 活跃作者榜 -->
          <ol v-else class="wx-cc-rank">
            <div v-if="!activeAuthors.length" class="wx-cc-sec-empty">暂无活跃作者</div>
            <li v-for="(a, i) in activeAuthors" :key="a.name" :class="{ top: i < 3 }">
              <span class="wx-cc-rank-no">{{ i + 1 }}</span>
              <span class="wx-cc-rank-avatar">{{ a.name.slice(0, 1) }}</span>
              <span class="wx-cc-rank-title">{{ a.name }}</span>
              <span class="wx-cc-rank-val">{{ a.count }} 篇 · ♥ {{ a.likes }}</span>
            </li>
          </ol>
        </template>
      </div>

      <!-- ===== 书籍书架 ===== -->
      <div v-else-if="mode === 'bookshelf'" class="wx-cc-feed">
        <BookshelfView />
      </div>

      <!-- ===== 交错看板 ===== -->
      <div v-else ref="feedRef" class="wx-cc-feed" @scroll.passive="onFeedScroll">
        <div v-if="loading" class="wx-cc-tip">加载中…</div>
        <div v-else-if="error" class="wx-cc-tip">
          ⚠ {{ error }}
          <button class="wx-cc-retry wx-pressable" @click="reload">重试</button>
        </div>
        <div v-else-if="!items.length" class="wx-cc-empty">
          <span class="wx-cc-empty-mark">✿</span>
          <p class="wx-cc-empty-text">
            「{{ currentIndustryName }}」还没有内容{{ searchText ? '，换个关键词试试' : '' }}
          </p>
          <button class="wx-btn-gradient wx-pressable wx-cc-empty-btn" @click="create">发布第一篇</button>
        </div>

        <template v-else>
          <div class="wx-cc-board">
            <article
              v-for="p in items"
              :key="p.id"
              class="wx-cc-card wx-glass wx-glass-hover"
              :class="`wx-cc-card-${cardType(p)}`"
              @click="openPost(p.id)"
            >
              <!-- 大图文 / 中图文：图片主导 -->
              <div v-if="p.cover" class="wx-cc-cover">
                <img :src="apiUrl(p.cover)" :alt="p.title" loading="lazy" />
                <span v-if="cardType(p) === 'qa'" class="wx-cc-qa-badge">问</span>
              </div>
              <!-- 文字卡 / 短文字卡 / 问答卡：背景色区分，不依赖颜色作唯一识别 -->
              <div
                v-else
                class="wx-cc-cover wx-cc-cover-ph"
                :class="{ 'wx-cc-cover-qa': cardType(p) === 'qa' }"
              >
                <span class="wx-cc-cover-ph-mark">{{ cardType(p) === 'qa' ? '问' : p.title.slice(0, 1) }}</span>
              </div>

              <div class="wx-cc-card-body">
                <h3 class="wx-cc-card-title">{{ p.title }}</h3>
                <p class="wx-cc-card-excerpt">{{ p.excerpt }}</p>
                <div v-if="p.tags.length" class="wx-cc-card-tags">
                  <span v-for="t in p.tags.slice(0, 3)" :key="t"># {{ t }}</span>
                </div>
                <div class="wx-cc-card-foot">
                  <span class="wx-cc-card-author">{{ p.author.nickname }}</span>
                  <span class="wx-cc-card-meta">
                    <span v-if="cardType(p) === 'qa'" class="wx-cc-card-ans">{{ p.commentCount }} 答</span>
                    <span class="wx-cc-card-like" :class="{ liked: p.liked }">♥ {{ p.likeCount }}</span>
                  </span>
                </div>
              </div>
            </article>
          </div>

          <div class="wx-cc-more">
            <span v-if="loadingMore">加载中…</span>
            <span v-else-if="finished && items.length">— 已经到底啦 —</span>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wx-cc {
  height: 100%;
  display: flex;
  overflow: hidden;
}

/* ===== 左侧行业导航 ===== */
.wx-cc-side {
  width: 208px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 12px 20px 20px;
  border-right: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 22%, transparent);
}
.wx-cc-side-head { padding: 0 8px 10px; }
.wx-cc-side-label {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--wx-text-muted);
  text-transform: uppercase;
}
.wx-cc-side-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
}
.wx-cc-side-divider {
  height: 1px;
  margin: 7px 10px;
  background: var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-cc-ind {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px 9px 12px;
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-secondary);
  font-size: 13px;
  text-align: left;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-cc-ind::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 18px;
  border-radius: 3px;
  background: var(--wx-gradient-primary);
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-cc-ind:hover { color: var(--wx-text-primary); background: color-mix(in srgb, var(--wx-ink) 5%, transparent); }
.wx-cc-ind.active {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
}
.wx-cc-ind.active::before { transform: translateY(-50%) scaleY(1); }
.wx-cc-ind-icon { font-size: 13px; opacity: 0.85; flex-shrink: 0; }
.wx-cc-ind-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wx-cc-ind-count {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10.5px;
  line-height: 16px;
  text-align: center;
  color: var(--wx-text-tertiary);
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
}
.wx-cc-ind-draft { flex-shrink: 0; font-size: 11px; color: var(--wx-color-amber); }

/* ===== 主区（高度铺满整屏） ===== */
.wx-cc-main {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 0;
  overflow: hidden;
}

/* 顶部：左侧页面标题，右侧搜索/发布/发现三入口靠右 */
.wx-cc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-cc-top-left { min-width: 0; }
.wx-cc-title {
  font-family: var(--wx-font-serif);
  font-size: 20px;
  font-weight: 600;
  color: var(--wx-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-cc-title-hint { display: block; margin-top: 3px; font-size: 11px; color: var(--wx-text-muted); }

.wx-cc-top-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.wx-cc-search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 260px;
  padding: 8px 42px 8px 14px;
  position: relative;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-tertiary);
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-cc-search:focus-within { border-color: var(--wx-border-glow); }
.wx-cc-search svg { width: 15px; height: 15px; flex-shrink: 0; }
.wx-cc-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--wx-text-primary);
  font-size: 13px;
}
.wx-cc-search-input::placeholder { color: var(--wx-text-muted); }
.wx-cc-search-clear {
  position: absolute;
  right: 38px;
  font-size: 11px;
  color: var(--wx-text-muted);
}
.wx-cc-search-clear:hover { color: var(--wx-text-primary); }

.wx-cc-top-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  white-space: nowrap;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-cc-top-btn svg { width: 15px; height: 15px; }
.wx-cc-top-btn:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-cc-publish {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--wx-color-primary) 45%, transparent);
}
.wx-cc-publish:hover { color: var(--wx-text-on-accent); filter: brightness(1.08); }
.wx-cc-discover.active {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
}
.wx-cc-discover-icon { font-size: 13px; }

/* 二级标签 */
.wx-cc-tabs { display: flex; gap: 6px; padding: 12px 4px 10px; flex-shrink: 0; }
.wx-cc-tab {
  padding: 6px 16px;
  border-radius: var(--wx-radius-pill);
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-cc-tab:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-cc-tab.active {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--wx-color-primary) 38%, transparent);
}

/* 内容滚动区（铺满剩余高度） */
.wx-cc-feed { flex: 1; height: 100%; min-height: 0; overflow-y: auto; padding: 2px 4px 96px; }
.wx-cc-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  font-size: 13px;
  color: var(--wx-text-tertiary);
}
.wx-cc-retry {
  font-size: 12px;
  padding: 4px 14px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
}
.wx-cc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 72px 0;
  text-align: center;
}
.wx-cc-empty-mark { font-size: 40px; opacity: 0.5; }
.wx-cc-empty-text { font-size: 13.5px; color: var(--wx-text-tertiary); }
.wx-cc-empty-btn { padding: 9px 22px; font-size: 12.5px; font-weight: 600; }

/* ===== 交错看板（多列，卡片高低错落） ===== */
.wx-cc-board { columns: 300px; column-gap: 16px; }
.wx-cc-card {
  break-inside: avoid;
  margin: 0 0 16px;
  overflow: hidden;
  cursor: pointer;
  display: block;
  width: 100%;
  text-align: left;
  padding: 0;
  border-radius: var(--wx-radius-lg);
}
.wx-cc-cover {
  position: relative;
  width: 100%;
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
}
.wx-cc-cover img { display: block; width: 100%; height: auto; object-fit: cover; }
.wx-cc-card-big .wx-cc-cover img { max-height: 420px; }
.wx-cc-card-medium .wx-cc-cover img { max-height: 240px; }
.wx-cc-card-qa .wx-cc-cover img { max-height: 180px; }
.wx-cc-cover-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--wx-gradient-aurora);
}
.wx-cc-card-short .wx-cc-cover-ph { min-height: 84px; }
.wx-cc-card-text .wx-cc-cover-ph { min-height: 108px; }
.wx-cc-card-qa .wx-cc-cover-ph { min-height: 96px; }
.wx-cc-cover-ph-mark {
  font-family: var(--wx-font-serif);
  font-size: 34px;
  font-weight: 600;
  color: color-mix(in srgb, var(--wx-color-primary-soft) 60%, transparent);
  text-shadow: 0 0 22px color-mix(in srgb, var(--wx-color-primary) 45%, transparent);
}
.wx-cc-cover-qa { background: linear-gradient(135deg, color-mix(in srgb, var(--wx-color-yanqing) 32%, transparent), color-mix(in srgb, var(--wx-bg-deep) 60%, transparent)); }
.wx-cc-cover-qa .wx-cc-cover-ph-mark { color: rgba(94, 234, 212, 0.85); text-shadow: 0 0 22px color-mix(in srgb, var(--wx-color-yanqing) 50%, transparent); }
.wx-cc-qa-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 10.5px;
  color: #06281f;
  background: #5eead4;
  font-weight: 700;
}

.wx-cc-card-body { padding: 12px 14px 13px; }
.wx-cc-card-short .wx-cc-card-body { padding: 14px; }
.wx-cc-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wx-cc-card-big .wx-cc-card-title { font-size: 15.5px; }
.wx-cc-card-short .wx-cc-card-title { font-size: 13.5px; -webkit-line-clamp: 3; }
.wx-cc-card-excerpt {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wx-text-tertiary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wx-cc-card-short .wx-cc-card-excerpt { -webkit-line-clamp: 2; }
.wx-cc-card-qa .wx-cc-card-excerpt { color: var(--wx-text-secondary); }
.wx-cc-card-tags { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 6px; }
.wx-cc-card-tags span { font-size: 10.5px; color: var(--wx-color-primary-soft); opacity: 0.85; }
.wx-cc-card-foot {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wx-cc-card-author {
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-cc-card-meta { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.wx-cc-card-ans { font-size: 11px; color: #5eead4; }
.wx-cc-card-like { font-size: 11.5px; color: var(--wx-text-tertiary); }
.wx-cc-card-like.liked { color: var(--wx-color-vermilion); }
.wx-cc-more { padding: 10px 0 4px; text-align: center; font-size: 11px; color: var(--wx-text-muted); }

/* ===== 排行榜 ===== */
.wx-cc-rank-tabs { display: flex; gap: 6px; padding: 0 4px 12px; }
.wx-cc-rank {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 860px;
}
.wx-cc-rank li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-cc-rank li:hover { background: color-mix(in srgb, var(--wx-ink) 6%, transparent); border-color: var(--wx-border-soft); }
.wx-cc-rank li.top { background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent); border-color: var(--wx-border-soft); }
.wx-cc-rank-no {
  flex-shrink: 0;
  width: 22px;
  font-family: var(--wx-font-mono);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  color: var(--wx-text-muted);
}
.wx-cc-rank li.top .wx-cc-rank-no { color: var(--wx-color-primary-soft); }
.wx-cc-rank-avatar {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
}
.wx-cc-rank-title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--wx-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-cc-rank-meta { flex-shrink: 0; font-size: 11.5px; color: var(--wx-text-muted); }
.wx-cc-rank-val { flex-shrink: 0; font-size: 12px; color: var(--wx-color-amber); font-family: var(--wx-font-mono); }
.wx-cc-rank-val.qa { color: #5eead4; }
.wx-cc-sec-empty {
  padding: 20px 12px;
  font-size: 12.5px;
  color: var(--wx-text-muted);
  border: 1px dashed var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
}
</style>
