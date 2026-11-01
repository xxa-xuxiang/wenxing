<!-- 社区 Tab 页（移动端，对齐桌面）：分段「看板 / 排行榜 / 书架」+ 最新/热门/问答 + 行业筛选 + 搜索防抖 + 分页 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { visibleIndustries } from '@/data/communityIndustries'
import { listPosts, type CommunityPostListItem } from '@/services/communityService'
import BookshelfView from './BookshelfView.vue'

const PAGE_SIZE = 10
/** 问答内容以专用标签承载（隔离于普通帖子） */
const QA_TAG = '求助问答'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()
const industries = visibleIndustries()

// ===== 顶部分段：看板 / 排行榜 / 书架 =====
type Mode = 'board' | 'rank' | 'bookshelf'
const MODES: { key: Mode; label: string }[] = [
  { key: 'board', label: '看板' },
  { key: 'rank', label: '排行榜' },
  { key: 'bookshelf', label: '书架' }
]
const mode = ref<Mode>('board')
/** van-tabs 双向绑定：模式切换与原有 mode 状态同步（Vant 的 active 为 string | number） */
const modeIndex = computed<string | number>({
  get: () => mode.value,
  set: (v) => {
    const key = String(v)
    mode.value = (MODES.some((m) => m.key === key) ? key : 'board') as Mode
  }
})

// ===== 看板二级标签：最新 / 热门 / 问答 =====
type TabKey = 'latest' | 'hot' | 'qa'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '热门' },
  { key: 'qa', label: '问答' }
]
const activeTab = ref<TabKey>('latest')

// ===== 排行榜分榜 =====
type RankKey = 'hot' | 'qa' | 'author'
const RANK_TABS: { key: RankKey; label: string }[] = [
  { key: 'hot', label: '热帖榜' },
  { key: 'qa', label: '问答榜' },
  { key: 'author', label: '活跃作者' }
]
const rankTab = ref<RankKey>('hot')

// ===== 行业筛选（'all' = 跨行业推荐流，底部弹层选择） =====
const industryFilter = ref<string>('all')
const filterOpen = ref(false)
const industryChips = computed(() => [
  { id: 'all', name: '推荐', icon: '✦' },
  ...industries.map((i) => ({ id: i.id, name: i.name, icon: i.icon }))
])
const currentIndustryName = computed(() =>
  industryFilter.value === 'all'
    ? '推荐'
    : industries.find((i) => i.id === industryFilter.value)?.name ?? industryFilter.value
)

const searchText = ref('')

/** 当前标签映射到接口参数（问答 = 专用标签 + 按回答数排序） */
function queryOfTab(tab: TabKey): { sort?: string; tag?: string } {
  if (tab === 'latest') return { sort: 'latest' }
  if (tab === 'hot') return { sort: 'hot' }
  if (tab === 'qa') return { sort: 'comment', tag: QA_TAG }
  return {}
}

function baseParams() {
  return {
    industry: industryFilter.value === 'all' ? 'all' : industryFilter.value,
    q: searchText.value.trim() || undefined,
    ...queryOfTab(activeTab.value)
  }
}

// ===== 看板列表（van-list 增量加载） =====
const items = ref<CommunityPostListItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref(false)
const finished = ref(false)
let loadSeq = 0

async function onLoad(): Promise<void> {
  const seq = ++loadSeq
  try {
    const res = await listPosts({ page: page.value, pageSize: PAGE_SIZE, ...baseParams() })
    if (seq !== loadSeq) return
    items.value = page.value === 1 ? res.items : [...items.value, ...res.items]
    total.value = res.total
    page.value += 1
    finished.value = res.items.length === 0 || items.value.length >= res.total
    error.value = false
  } catch {
    if (seq !== loadSeq) return
    error.value = true
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** 条件变化后重载第一页（手动置 loading 防止 van-list 重复触发） */
function reload(): void {
  page.value = 1
  finished.value = false
  error.value = false
  items.value = []
  total.value = 0
  loading.value = true
  void onLoad()
}

// 搜索防抖 300ms
let searchTimer: number | undefined
/** 切换行业时清空搜索词属于「重置」而非用户输入，跳过这次防抖重载（行业 watcher 已重载） */
let skipSearchReload = false
watch(searchText, () => {
  if (skipSearchReload) {
    skipSearchReload = false
    return
  }
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    if (mode.value !== 'board') return
    reload()
  }, 300)
})

// 切换行业：看板回到第一页；排行榜同步重拉数据
watch(industryFilter, () => {
  reload()
  if (mode.value === 'rank') void loadDiscover()
})

watch(activeTab, () => {
  if (mode.value === 'board') reload()
})

function selectIndustry(id: string): void {
  filterOpen.value = false
  if (id === industryFilter.value) return
  industryFilter.value = id
  if (id !== 'all') community.setIndustry(id)
  // 切换行业即重置搜索上下文（与桌面端一致）
  if (searchText.value) {
    skipSearchReload = true
    searchText.value = ''
  }
}

// ===== 排行榜数据（热帖 / 问答 / 活跃作者） =====
interface DiscoverData {
  hot: CommunityPostListItem[]
  qa: CommunityPostListItem[]
}
const discover = ref<DiscoverData | null>(null)
const discoverLoading = ref(false)
const discoverError = ref('')

const activeAuthors = computed(() => {
  const d = discover.value
  if (!d) return []
  const map = new Map<string, { name: string; count: number; likes: number }>()
  for (const p of [...d.hot, ...d.qa]) {
    const cur = map.get(p.author.nickname) ?? { name: p.author.nickname, count: 0, likes: 0 }
    cur.count += 1
    cur.likes += p.likeCount
    map.set(p.author.nickname, cur)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.likes - a.likes).slice(0, 10)
})

async function loadDiscover(): Promise<void> {
  discoverLoading.value = true
  discoverError.value = ''
  try {
    const industry = industryFilter.value === 'all' ? 'all' : industryFilter.value
    const [hot, qa] = await Promise.all([
      listPosts({ industry, sort: 'hot', pageSize: 10 }),
      listPosts({ industry, sort: 'comment', tag: QA_TAG, pageSize: 10 })
    ])
    discover.value = { hot: hot.items, qa: qa.items }
  } catch {
    discover.value = { hot: [], qa: [] }
    discoverError.value = '排行数据加载失败，点击重试'
  } finally {
    discoverLoading.value = false
  }
}

watch(mode, (m) => {
  if (m === 'rank') void loadDiscover()
})

// ===== 卡片规格（大图文 / 中图文 / 文字 / 短文字 / 问答） =====
type CardType = 'big' | 'medium' | 'text' | 'short' | 'qa'
function cardType(p: CommunityPostListItem): CardType {
  if (p.tags.includes(QA_TAG)) return 'qa'
  if (p.cover) return p.excerpt.length > 50 ? 'big' : 'medium'
  return p.excerpt.length <= 34 ? 'short' : 'text'
}

function fmtTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ===== 交互 =====
function openPost(id: string): void {
  void router.push(`/community/${id}`)
}
function create(): void {
  void router.push(auth.user ? '/community/new' : '/auth')
}

onMounted(() => {
  // 资源准备页跳转：/community?books=1 直接打开书架
  if (route.query.books === '1') mode.value = 'bookshelf'
  void community.loadCounts()
})
</script>

<template>
  <div class="page-with-tabbar community-page">
    <van-nav-bar fixed placeholder>
      <template #title>社区</template>
      <template #right>
        <span class="nav-entry" @click="router.push('/community/mine')">我的文章</span>
      </template>
    </van-nav-bar>

    <!-- 顶部分段 + 筛选区（浅色白卡，滚动时吸顶） -->
    <div class="community-head">
      <!-- 模式：看板 / 排行榜 / 书架 -->
      <van-tabs
        v-model:active="modeIndex"
        class="mode-tabs"
        type="line"
        shrink
        :line-width="22"
        :line-height="3"
        background="transparent"
      >
        <van-tab v-for="m in MODES" :key="m.key" :name="m.key" :title="m.label" />
      </van-tabs>

      <!-- 行业筛选入口（底部弹层）+ 看板搜索 -->
      <div v-if="mode !== 'bookshelf'" class="filter-row">
        <button class="filter-trigger" @click="filterOpen = true">
          <van-icon name="filter-o" class="filter-icon" />
          <span class="filter-name">{{ currentIndustryName }}</span>
          <van-icon name="arrow-down" class="filter-arrow" />
        </button>
        <div v-if="mode === 'board'" class="search-bar">
          <van-icon name="search" class="search-icon" />
          <input
            v-model="searchText"
            class="search-input"
            type="search"
            :placeholder="`搜索「${currentIndustryName}」内容`"
          />
          <van-icon v-if="searchText" name="clear" class="search-clear" @click="searchText = ''" />
        </div>
      </div>

      <!-- 看板二级标签：最新 / 热门 / 问答 -->
      <div v-if="mode === 'board'" class="sub-tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="sub-tab"
          :class="{ active: activeTab === t.key }"
          @click="activeTab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- 排行榜分榜 -->
      <div v-if="mode === 'rank'" class="sub-tabs">
        <button
          v-for="rt in RANK_TABS"
          :key="rt.key"
          class="sub-tab"
          :class="{ active: rankTab === rt.key }"
          @click="rankTab = rt.key"
        >
          {{ rt.label }}
        </button>
      </div>
    </div>

    <!-- 行业筛选底部弹层 -->
    <van-popup v-model:show="filterOpen" position="bottom" round safe-area-inset-bottom>
      <div class="filter-panel">
        <div class="filter-head">
          <span class="filter-title">行业筛选</span>
          <span class="filter-sub">切换行业将重置搜索与排序</span>
          <van-icon name="cross" class="filter-close" @click="filterOpen = false" />
        </div>
        <div class="filter-grid">
          <button
            v-for="ind in industryChips"
            :key="ind.id"
            class="filter-opt"
            :class="{ active: industryFilter === ind.id }"
            @click="selectIndustry(ind.id)"
          >
            <span class="filter-opt-icon">{{ ind.icon }}</span>
            <span class="filter-opt-name">{{ ind.name }}</span>
            <span
              v-if="ind.id !== 'all' && community.counts[ind.id]"
              class="filter-opt-count"
            >{{ community.counts[ind.id] }}</span>
          </button>
        </div>
      </div>
    </van-popup>

    <!-- ===== 交流看板 ===== -->
    <van-list
      v-if="mode === 'board'"
      v-model:loading="loading"
      v-model:error="error"
      :finished="finished"
      :finished-text="items.length ? '— 已经到底啦 —' : ''"
      error-text="加载失败，点击重试"
      class="post-list"
      @load="onLoad"
    >
      <div v-if="items.length" class="board">
        <article
          v-for="p in items"
          :key="p.id"
          class="post-card"
          :class="`card-${cardType(p)}`"
          @click="openPost(p.id)"
        >
          <div v-if="p.cover" class="card-cover">
            <img :src="apiUrl(p.cover)" :alt="p.title" loading="lazy" />
            <span v-if="cardType(p) === 'qa'" class="qa-badge">问</span>
          </div>
          <div v-else class="card-cover card-cover-ph" :class="{ qa: cardType(p) === 'qa' }">
            <span class="ph-mark">{{ cardType(p) === 'qa' ? '问' : p.title.slice(0, 1) }}</span>
          </div>

          <div class="card-body">
            <h3 class="card-title">{{ p.title }}</h3>
            <p class="card-excerpt">{{ p.excerpt }}</p>
            <div v-if="p.tags.length" class="card-tags">
              <span v-for="t in p.tags.slice(0, 3)" :key="t"># {{ t }}</span>
            </div>
            <div class="card-foot">
              <span class="card-author">{{ p.author.nickname }}</span>
              <span class="card-nums">
                <span v-if="cardType(p) === 'qa'" class="qa-ans">{{ p.commentCount }} 答</span>
                <span class="card-like" :class="{ liked: p.liked }">♥ {{ p.likeCount }}</span>
              </span>
            </div>
            <div class="card-time">{{ fmtTime(p.createdAt) }}</div>
          </div>
        </article>
      </div>

      <van-empty
        v-if="finished && items.length === 0 && !error"
        image="search"
        :description="
          searchText ? '没有匹配的内容，换个关键词试试' : `「${currentIndustryName}」还没有内容`
        "
      >
        <van-button round type="primary" size="small" @click="create">发布第一篇</van-button>
      </van-empty>
    </van-list>

    <!-- ===== 排行榜 ===== -->
    <div v-else-if="mode === 'rank'" class="rank-wrap">
      <div v-if="discoverLoading" class="rank-tip">加载排行数据…</div>
      <div v-else-if="discoverError" class="rank-tip">
        <span>⚠ {{ discoverError }}</span>
        <van-button size="small" round plain type="primary" @click="loadDiscover">重试</van-button>
      </div>
      <template v-else-if="discover">
        <ol v-if="rankTab === 'hot'" class="rank-list">
          <li v-if="!discover.hot.length" class="rank-empty">本行业暂无内容，去发布第一篇吧</li>
          <li
            v-for="(p, i) in discover.hot"
            :key="p.id"
            :class="{ top: i < 3 }"
            @click="openPost(p.id)"
          >
            <span class="rank-no">{{ i + 1 }}</span>
            <span class="rank-main">
              <span class="rank-title">{{ p.title }}</span>
              <span class="rank-meta">{{ p.author.nickname }} · {{ fmtTime(p.createdAt) }}</span>
            </span>
            <span class="rank-val">♥ {{ p.likeCount }}</span>
          </li>
        </ol>

        <ol v-else-if="rankTab === 'qa'" class="rank-list">
          <li v-if="!discover.qa.length" class="rank-empty">本行业暂无问答</li>
          <li
            v-for="(p, i) in discover.qa"
            :key="p.id"
            :class="{ top: i < 3 }"
            @click="openPost(p.id)"
          >
            <span class="rank-no">{{ i + 1 }}</span>
            <span class="rank-main">
              <span class="rank-title">{{ p.title }}</span>
              <span class="rank-meta">{{ p.author.nickname }}</span>
            </span>
            <span class="rank-val qa">{{ p.commentCount }} 回答</span>
          </li>
        </ol>

        <ol v-else class="rank-list">
          <li v-if="!activeAuthors.length" class="rank-empty">暂无活跃作者</li>
          <li v-for="(a, i) in activeAuthors" :key="a.name" :class="{ top: i < 3 }">
            <span class="rank-no">{{ i + 1 }}</span>
            <span class="rank-avatar">{{ a.name.slice(0, 1) }}</span>
            <span class="rank-main">
              <span class="rank-title">{{ a.name }}</span>
              <span class="rank-meta">{{ a.count }} 篇 · ♥ {{ a.likes }}</span>
            </span>
          </li>
        </ol>
      </template>
    </div>

    <!-- ===== 书架 ===== -->
    <BookshelfView v-else />

    <!-- 悬浮发帖（仅看板，避开底部 TabBar） -->
    <button v-if="mode === 'board'" class="fab" aria-label="发布帖子" @click="create">＋</button>
  </div>
</template>

<style scoped>
.community-page {
  min-height: 100vh;
  background: #f7f8fa;
}

.nav-entry {
  font-size: 13px;
  color: #1989fa;
}

/* ===== 筛选区（吸顶） ===== */
.community-head {
  position: sticky;
  top: 46px;
  z-index: 8;
  padding: 10px 12px 6px;
  background: #f7f8fa;
}

.mode-tabs :deep(.van-tabs__wrap) {
  height: 38px;
}

.mode-tabs :deep(.van-tabs__nav) {
  padding-bottom: 2px;
  background: transparent;
}

.mode-tabs :deep(.van-tab) {
  min-width: 74px;
  padding: 0 10px;
  font-size: 14px;
  color: #646566;
}

.mode-tabs :deep(.van-tab--active) {
  color: #323233;
  font-weight: 600;
}

.mode-tabs :deep(.van-tabs__line) {
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 3px;
}

/* ===== 筛选入口 + 搜索 ===== */
.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.filter-trigger {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 132px;
  padding: 7px 12px;
  border: none;
  border-radius: 999px;
  font-size: 12.5px;
  color: #646566;
  background: #fff;
}

.filter-icon {
  font-size: 14px;
  color: #969799;
}

.filter-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-arrow {
  font-size: 10px;
  color: #c8c9cc;
}

.search-bar {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 13px;
  border-radius: 999px;
  background: #fff;
}

.search-icon {
  flex-shrink: 0;
  font-size: 15px;
  color: #c8c9cc;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  font-size: 13px;
  color: #323233;
  background: transparent;
  -webkit-appearance: none;
}

.search-input::placeholder {
  color: #c8c9cc;
}

.search-clear {
  flex-shrink: 0;
  font-size: 15px;
  color: #c8c9cc;
}

/* ===== 行业筛选底部弹层 ===== */
.filter-panel {
  padding: 16px 16px calc(20px + env(safe-area-inset-bottom));
  background: #fff;
}

.filter-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 12px;
}

.filter-title {
  font-size: 16px;
  font-weight: 600;
  color: #323233;
}

.filter-sub {
  flex: 1;
  font-size: 11px;
  color: #c8c9cc;
}

.filter-close {
  font-size: 17px;
  color: #969799;
  padding: 2px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.filter-opt {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 10px;
  border: 1px solid #ebedf0;
  border-radius: 10px;
  font-size: 13px;
  color: #646566;
  background: #fff;
  text-align: left;
}

.filter-opt.active {
  color: #4b5cc4;
  font-weight: 600;
  border-color: transparent;
  background: rgba(102, 126, 234, 0.12);
}

.filter-opt-icon {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.85;
}

.filter-opt-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-opt-count {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 15px;
  color: #969799;
  background: rgba(0, 0, 0, 0.06);
}

.filter-opt.active .filter-opt-count {
  color: #1989fa;
  background: rgba(255, 255, 255, 0.7);
}

.sub-tabs {
  display: flex;
  gap: 6px;
  margin-top: 9px;
}

.sub-tab {
  padding: 5px 15px;
  border: none;
  border-radius: 999px;
  font-size: 12.5px;
  color: #646566;
  background: #fff;
}

.sub-tab.active {
  color: #1989fa;
  font-weight: 600;
  background: rgba(25, 137, 250, 0.1);
}

/* ===== 交错看板（两列瀑布） ===== */
.post-list {
  padding: 6px 12px 8px;
}

.board {
  columns: 2;
  column-gap: 10px;
}

.post-card {
  break-inside: avoid;
  margin: 0 0 10px;
  overflow: hidden;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.post-card:active {
  transform: scale(0.99);
}

.card-cover {
  position: relative;
  width: 100%;
  background: #f7f8fa;
}

.card-cover img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 220px;
  object-fit: cover;
}

.card-medium .card-cover img {
  max-height: 150px;
}

.card-qa .card-cover img {
  max-height: 130px;
}

.card-cover-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 78px;
  background: linear-gradient(135deg, #a5b4fc 0%, #818cf8 58%, #6366f1 100%);
}

.card-text .card-cover-ph {
  min-height: 66px;
}

.card-cover-ph.qa {
  background: linear-gradient(135deg, #5eead4 0%, #2dd4bf 60%, #14b8a6 100%);
}

.ph-mark {
  font-size: 28px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
}

.qa-badge {
  position: absolute;
  top: 7px;
  left: 7px;
  padding: 1px 7px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 700;
  color: #06281f;
  background: #5eead4;
}

.card-body {
  padding: 9px 10px 10px;
}

.card-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.45;
  color: #323233;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-big .card-title {
  font-size: 14.5px;
}

.card-short .card-title {
  -webkit-line-clamp: 3;
}

.card-excerpt {
  margin: 4px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: #969799;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-short .card-excerpt {
  -webkit-line-clamp: 2;
}

.card-qa .card-excerpt {
  color: #646566;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.card-tags span {
  font-size: 10px;
  color: #7c8cf8;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 7px;
}

.card-author {
  min-width: 0;
  font-size: 10.5px;
  color: #969799;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-nums {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: #c8c9cc;
}

.card-like.liked {
  color: #ee0a24;
}

.qa-ans {
  color: #14b8a6;
}

.card-time {
  margin-top: 3px;
  font-size: 10px;
  color: #c8c9cc;
}

/* ===== 排行榜 ===== */
.rank-wrap {
  padding: 6px 12px 0;
}

.rank-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 70px 20px;
  font-size: 13px;
  color: #969799;
}

.rank-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rank-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 14px;
  background: #fff;
}

.rank-list li.top {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), #fff 70%);
}

.rank-no {
  flex-shrink: 0;
  width: 20px;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  color: #c8c9cc;
}

.rank-list li.top .rank-no {
  color: #667eea;
}

.rank-avatar {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.rank-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rank-title {
  font-size: 13.5px;
  color: #323233;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rank-meta {
  font-size: 11px;
  color: #969799;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rank-val {
  flex-shrink: 0;
  font-size: 12px;
  color: #f59e0b;
}

.rank-val.qa {
  color: #14b8a6;
}

.rank-empty {
  justify-content: center;
  padding: 22px 12px;
  font-size: 12.5px;
  color: #969799;
  border: 1px dashed #ebedf0;
  background: transparent !important;
}

/* ===== 悬浮发帖 ===== */
.fab {
  position: fixed;
  right: 18px;
  bottom: calc(66px + env(safe-area-inset-bottom));
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  font-size: 26px;
  line-height: 1;
  color: #fff;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 6px 18px rgba(102, 126, 234, 0.45);
  z-index: 10;
}

.fab:active {
  transform: scale(0.94);
}
</style>
