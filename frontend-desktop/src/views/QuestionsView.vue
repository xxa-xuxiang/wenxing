<script setup lang="ts">
// 题库（v1.1）：后端向量题库浏览（分页 + 服务端分面）+ 勾选集中答题
// 题目由「公开语料 RAG 出题 → AI 二审 → 向量去重」管线生产，每题带解析与出处；
// ?skill= 能力点入口改为按技能叶子凑题（verified 不足时后端 JIT 触发出题）
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLearnStore } from '@/stores/learnStore'
import { useQuizStore } from '@/stores/quizStore'
import { useAuthStore } from '@/stores/authStore'
import {
  listQuestions,
  questionsBySkillPath,
  migrateQuestions,
  type FacetItem
} from '@/services/questionService'
import { storage } from '@/utils/storage'
import type { Question } from '@/types'
import GenerateQuizPanel from '@/components/quiz/GenerateQuizPanel.vue'
import PaperComposePanel from '@/components/quiz/PaperComposePanel.vue'
import WrongBookPanel from '@/components/quiz/WrongBookPanel.vue'
import WeaknessPanel from '@/components/quiz/WeaknessPanel.vue'

const route = useRoute()
const router = useRouter()
const learnStore = useLearnStore()
const quiz = useQuizStore()
const authStore = useAuthStore()

const generateOpen = ref(false)
const composeOpen = ref(false)

/** 组卷完成 → 直接进入「我的试卷」查看刚生成的卷面 */
function onPaperCreated() {
  composeOpen.value = false
  void router.push('/papers')
}

// ===== 服务端题库：分页加载 + toast =====
const PAGE_SIZE = 60
const items = ref<Question[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadError = ref('')
const hasMore = computed(() => items.value.length < total.value)

const toastText = ref('')
let toastTimer: number | null = null
function showToast(text: string) {
  toastText.value = text
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastText.value = '' }, 4000)
}

/** 题目已由后端管线生成入库，面板只需通知刷新列表 */
function onGenerated(list: Question[]) {
  showToast(`已为该技能点建设 ${list.length} 道题（带解析与出处）`)
  void reloadFirst()
}

// ===== 检索条件：关键字 + 三组服务端分面（难度/类型/行业） =====
const keyword = ref('')
const facetDiff = ref<string[]>([])
const facetType = ref<string[]>([])
const facetIndustry = ref<string[]>([]) // 行业单选，数组仅复用切换 UI
const facets = ref<{ difficulty: FacetItem[]; type: FacetItem[]; industry: FacetItem[] }>({
  difficulty: [],
  type: [],
  industry: []
})

const facetCount = computed(
  () => facetDiff.value.length + facetType.value.length + facetIndustry.value.length
)

function flip(arr: { value: string[] }, v: string) {
  const list = arr.value
  arr.value = list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}
function toggleDiff(v: string) { flip(facetDiff, v) }
function toggleType(v: string) { flip(facetType, v) }
function toggleIndustry(v: string) {
  facetIndustry.value = facetIndustry.value[0] === v ? [] : [v]
}
function clearFacets() {
  facetDiff.value = []
  facetType.value = []
  facetIndustry.value = []
}
function clearAllFilters() {
  keyword.value = ''
  clearFacets()
}

/** 服务端分面计数（无该值返回 0） */
function countOf(group: 'difficulty' | 'type' | 'industry', val: string): number {
  return facets.value[group].find((f) => f.val === val)?.count ?? 0
}

async function load(reset = false) {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  if (reset) page.value = 1
  try {
    const resp = await listQuestions({
      q: keyword.value,
      difficulty: facetDiff.value,
      type: facetType.value,
      industry: facetIndustry.value[0] || '',
      page: page.value,
      pageSize: PAGE_SIZE
    })
    items.value = reset ? resp.items : [...items.value, ...resp.items]
    total.value = resp.total
    facets.value = resp.facets
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '题库加载失败'
  } finally {
    loading.value = false
  }
}
function reloadFirst() {
  return load(true)
}
function loadMore() {
  if (!hasMore.value || loading.value) return
  page.value += 1
  void load(false)
}

// 关键字防抖
let kwTimer: number | null = null
watch(keyword, () => {
  if (kwTimer) window.clearTimeout(kwTimer)
  kwTimer = window.setTimeout(() => void reloadFirst(), 350)
})
watch([facetDiff, facetType, facetIndustry], () => void reloadFirst(), { deep: true })

// 徽章中文显示（class 仍绑定原始值）
const diffText: Record<Question['difficulty'], string> = { easy: '简单', medium: '中等', hard: '困难' }
const typeText: Record<Question['type'], string> = {
  single: '单选', multiple: '多选', short: '简答', coding: '编程'
}
const sourceText: Record<Question['source'], string> = { manual: '内置', ai: 'RAG 题库' }

// ===== 网格 / 列表视图切换（偏好持久化） =====
const viewMode = ref<'grid' | 'list'>(storage.get<'grid' | 'list'>('questionViewMode', 'grid'))
function toggleView() {
  viewMode.value = viewMode.value === 'grid' ? 'list' : 'grid'
  storage.set('questionViewMode', viewMode.value)
}

// ===== 题卡多选：勾选后底部弹出开始答题按钮 =====
const selectedIds = ref<Set<string>>(new Set())

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function selectAllLoaded() {
  const next = new Set(selectedIds.value)
  for (const q of items.value) next.add(q.id)
  selectedIds.value = next
}
function clearSelection() {
  selectedIds.value = new Set()
}

// 当前已加载题目中被选中的题（顺序同列表）
const selectedQuestions = computed<Question[]>(() =>
  items.value.filter((q) => selectedIds.value.has(q.id))
)

function startSelected() {
  if (selectedQuestions.value.length === 0) return
  quiz.startWithQuestions('题库练习', selectedQuestions.value, 0)
  void router.push('/quiz')
}

// ===== 能力点入口：按技能叶子凑题（后端 verified 不足时 JIT 出题，约 1 分钟） =====
async function triggerQuizForSkill(skillId: string) {
  const task = learnStore.outline.find((t) => t.id === skillId) ?? null
  const title = task?.title ?? route.query.title?.toString() ?? '未知能力点'
  loading.value = true
  loadError.value = ''
  try {
    const resp = await questionsBySkillPath({
      industry: learnStore.selectedDomain?.name ?? '',
      category: task?.kp?.category ?? '',
      domain: task?.kp?.domain ?? '',
      stack: task?.kp?.stack ?? '',
      name: task?.kp?.name ?? title
    })
    if (resp.items.length === 0) {
      throw new Error('该技能点题目建设中：暂未找到合规公开语料，请稍后再试')
    }
    quiz.startWithQuestions(resp.leaf.pathText || title, resp.items, 0)
    void router.push('/quiz')
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '凑题失败'
  } finally {
    loading.value = false
  }
}

// ===== Tab 切换：题库 / 错题本 / 薄弱专项（与 ?tab= 同步，刷新后停留原 Tab） =====
type TabKey = 'bank' | 'wrong' | 'weak'
const TAB_LABELS: { key: TabKey; label: string }[] = [
  { key: 'bank', label: '题库' },
  { key: 'wrong', label: '错题本' },
  { key: 'weak', label: '薄弱专项' }
]

/** ?skill= 能力点深链入口存在时强制停留在题库 Tab（保持 triggerQuizForSkill 行为不变） */
const activeTab = computed<TabKey>(() => {
  if (route.query.skill) return 'bank'
  const t = route.query.tab?.toString()
  return t === 'wrong' || t === 'weak' ? t : 'bank'
})

// 已激活过的 Tab：面板只在首次激活时挂载（错题本挂载即拉取，未点击过的 Tab 绝不加载）
const activatedTabs = ref<Set<TabKey>>(new Set())
watch(
  activeTab,
  (t) => { activatedTabs.value = new Set(activatedTabs.value).add(t) },
  { immediate: true }
)

/** 切换 Tab：router.replace 保留其它 query，刷新后仍停留原 Tab */
function switchTab(t: TabKey) {
  if (t === activeTab.value) return
  const query = { ...route.query }
  delete query.tab
  delete query.skill // 离开题库 Tab 时清除能力点深链，避免被 ?skill= 强制拉回
  if (t === 'wrong') query.tab = 'wrong'
  else if (t === 'weak') query.tab = 'weak'
  void router.replace({ query })
}

// ===== 旧版本地自定义题一次性迁移到后端（登录用户，每账号一次；导入后为草稿，待管理员审核） =====
async function migrateLocalQuestionsOnce() {
  if (!authStore.user) return
  const flagKey = 'customQuestionsMigrated'
  if (storage.get<boolean>(flagKey, false)) return
  const local = storage.get<Question[]>('customQuestions', [])
  storage.set(flagKey, true)
  if (local.length === 0) return
  try {
    const r = await migrateQuestions(local)
    showToast(
      `已提交 ${r.imported} 题，待管理员审核后进入题库` +
        (r.skipped > 0 ? `（另有 ${r.skipped} 道无匹配技能点未导入）` : '')
    )
    storage.remove('customQuestions')
    await reloadFirst()
  } catch {
    storage.set(flagKey, false) // 迁移失败允许下次重试
  }
}

onMounted(async () => {
  await load(true)
  await migrateLocalQuestionsOnce()
  const skill = route.query.skill?.toString()
  if (skill) await triggerQuizForSkill(skill)
})

watch(
  () => route.query.skill,
  async (s) => {
    if (s && typeof s === 'string' && route.path === '/questions') {
      await triggerQuizForSkill(s)
    }
  }
)
</script>

<template>
  <div class="wx-q">
    <div class="wx-q-head">
      <div class="wx-q-head-main">
        <h1 class="wx-q-title">题库</h1>
        <p class="wx-q-sub">关键字检索 · 分面检索 · 按技能点出题（带解析与出处）· 勾选集中答题</p>
      </div>
      <!-- 标题行右侧矢量图标：题库/错题本/薄弱专项 切换 + 切换视图 / 生题 / 反馈中心 -->
      <div class="wx-q-actions">
        <button
          v-for="t in TAB_LABELS"
          :key="t.key"
          class="wx-q-icon-btn wx-pressable"
          :class="{ active: activeTab === t.key }"
          :title="t.label"
          @click="switchTab(t.key)"
        >
          <!-- 题库：层叠 -->
          <svg v-if="t.key === 'bank'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l9 5-9 5-9-5 9-5z" />
            <path d="M3 13l9 5 9-5" />
          </svg>
          <!-- 错题本：带叉笔记 -->
          <svg v-else-if="t.key === 'wrong'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
            <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
          </svg>
          <!-- 薄弱专项：靶心 -->
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
        <span class="wx-q-actions-sep"></span>
        <button
          class="wx-q-icon-btn wx-pressable"
          :title="viewMode === 'grid' ? '切换为列表视图' : '切换为卡片视图'"
          @click="toggleView"
        >
          <svg v-if="viewMode === 'grid'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 6h13M8 12h13M8 18h13" />
            <circle cx="4" cy="6" r="0.6" fill="currentColor" />
            <circle cx="4" cy="12" r="0.6" fill="currentColor" />
            <circle cx="4" cy="18" r="0.6" fill="currentColor" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
          </svg>
        </button>
        <button
          class="wx-q-icon-btn wx-pressable"
          :class="{ active: composeOpen }"
          title="智能组卷"
          @click="composeOpen = !composeOpen"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M9 13h6M9 17h4" />
          </svg>
        </button>
        <button
          class="wx-q-icon-btn wx-pressable"
          title="我的试卷"
          @click="router.push('/papers')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 4h9a2 2 0 0 1 2 2v11" />
            <rect x="5" y="7" width="11" height="14" rx="2" />
          </svg>
        </button>
        <button
          class="wx-q-icon-btn wx-pressable"
          :class="{ active: generateOpen }"
          title="AI 生题"
          @click="generateOpen = !generateOpen"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4l1.7 4.6L18.5 10l-4.8 1.4L12 16l-1.7-4.6L5.5 10l4.8-1.4L12 4z" />
            <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
          </svg>
        </button>
        <button class="wx-q-icon-btn wx-pressable" title="反馈中心" @click="router.push('/feedback')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    </div>

    <div class="wx-q-body">
      <!-- 题库 Tab：检索分面 + 题卡网格/列表 + 生题/组卷面板（原行为不变） -->
      <template v-if="activeTab === 'bank'">
      <!-- 左边栏：上 = 关键字检索框，下 = 标签筛选 -->
      <aside class="wx-q-filter">
        <div class="wx-q-filter-title">检索</div>
        <div class="wx-q-search">
          <svg class="wx-q-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            v-model="keyword"
            class="wx-q-search-input"
            type="text"
            placeholder="搜索题目 / 知识点…"
          />
          <button v-if="keyword" class="wx-q-search-clear" title="清空" @click="keyword = ''">×</button>
        </div>

        <div class="wx-q-filter-sep"></div>

        <div class="wx-q-filter-head">
          <span class="wx-q-filter-title">分面检索</span>
          <button v-if="facetCount" class="wx-q-tag-clear" @click="clearFacets">清空</button>
        </div>
        <div class="wx-q-facets">
          <div class="wx-q-facet">
            <div class="wx-q-facet-name">难度</div>
            <div class="wx-q-facet-opts">
              <button
                v-for="(label, val) in diffText"
                :key="val"
                class="wx-q-chip wx-pressable"
                :class="{ active: facetDiff.includes(val), empty: countOf('difficulty', val) === 0 }"
                :disabled="countOf('difficulty', val) === 0 && !facetDiff.includes(val)"
                @click="toggleDiff(val)"
              >
                <span class="wx-q-chip-text">{{ label }}</span><span class="wx-q-chip-num">{{ countOf('difficulty', val) }}</span>
              </button>
            </div>
          </div>

          <div class="wx-q-facet">
            <div class="wx-q-facet-name">题型</div>
            <div class="wx-q-facet-opts">
              <button
                v-for="(label, val) in typeText"
                :key="val"
                class="wx-q-chip wx-pressable"
                :class="{ active: facetType.includes(val), empty: countOf('type', val) === 0 }"
                :disabled="countOf('type', val) === 0 && !facetType.includes(val)"
                @click="toggleType(val)"
              >
                <span class="wx-q-chip-text">{{ label }}</span><span class="wx-q-chip-num">{{ countOf('type', val) }}</span>
              </button>
            </div>
          </div>

          <div v-if="facets.industry.length" class="wx-q-facet">
            <div class="wx-q-facet-name">行业</div>
            <div class="wx-q-facet-opts">
              <button
                v-for="o in facets.industry"
                :key="o.val"
                class="wx-q-chip wx-pressable"
                :class="{ active: facetIndustry.includes(o.val), empty: o.count === 0 }"
                :disabled="o.count === 0 && !facetIndustry.includes(o.val)"
                :title="o.val"
                @click="toggleIndustry(o.val)"
              >
                <span class="wx-q-chip-text">{{ o.val }}</span><span class="wx-q-chip-num">{{ o.count }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="wx-q-filter-count">
          共 {{ total }} 题
          <span v-if="loadError" class="wx-q-filter-err">· {{ loadError }}</span>
        </div>
      </aside>

      <!-- 内容区：网格 / 列表（服务端分页，每页 60 题） -->
      <div v-if="items.length || loading" class="wx-q-main" :class="`is-${viewMode}`">
        <div
          v-for="q in items"
          :key="q.id"
          class="wx-q-card wx-glass"
          :class="{ 'is-list': viewMode === 'list', 'is-selected': selectedIds.has(q.id) }"
          @click="toggleSelect(q.id)"
        >
          <label class="wx-q-check" @click.stop="toggleSelect(q.id)">
            <input type="checkbox" :checked="selectedIds.has(q.id)" @change="toggleSelect(q.id)" />
            <span class="wx-q-check-box">
              <svg v-if="selectedIds.has(q.id)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </span>
          </label>
          <div class="wx-q-card-top">
            <span class="wx-q-diff" :class="`diff-${q.difficulty}`">{{ diffText[q.difficulty] }}</span>
            <span class="wx-q-type">{{ typeText[q.type] }}</span>
            <span class="wx-q-source" :class="`src-${q.source}`">{{ sourceText[q.source] }}</span>
          </div>
          <div class="wx-q-card-main">
            <h3 class="wx-q-card-title">{{ q.title }}</h3>
            <p class="wx-q-card-body">{{ q.body }}</p>
            <div class="wx-q-card-tags">
              <span v-for="k in q.knowledgePoints" :key="k" class="wx-q-tag">{{ k }}</span>
            </div>
          </div>
        </div>
        <div v-if="loading" class="wx-q-loadbar">题库加载中…</div>
        <button v-else-if="hasMore" class="wx-q-loadmore wx-pressable" @click="loadMore">
          加载更多（已载 {{ items.length }} / {{ total }}）
        </button>
      </div>

      <!-- 空态 -->
      <div v-else class="wx-q-empty">
        <div class="wx-q-empty-mark">✧</div>
        <div class="wx-q-empty-title">题库里还没有匹配的题目</div>
        <div class="wx-q-empty-sub">试试更换关键字/分面，或点右上角 ✦ 为技能点现场建设题目</div>
        <button class="wx-btn-gradient wx-pressable wx-q-empty-btn" @click="clearAllFilters">
          清空筛选条件
        </button>
      </div>

      <!-- 右分栏：按技能点出题面板（RAG + 二审，非模态，与题卡区并列） -->
      <GenerateQuizPanel v-if="generateOpen" @close="generateOpen = false" @generated="onGenerated" />

      <!-- 右分栏：智能组卷面板（生成成卷后进入「我的试卷」） -->
      <PaperComposePanel v-if="composeOpen" @close="composeOpen = false" @created="onPaperCreated" />
      </template>

      <!-- 错题本 Tab：仅首次激活才挂载（挂载即拉取一次），来回切换不重复请求 -->
      <WrongBookPanel v-if="activatedTabs.has('wrong')" v-show="activeTab === 'wrong'" />

      <!-- 薄弱专项 Tab：仅首次激活才挂载（数据全部来自本地掌握度，不发请求） -->
      <WeaknessPanel v-if="activatedTabs.has('weak')" v-show="activeTab === 'weak'" />
    </div>

    <!-- 底部多选操作栏（有选中时浮起） -->
    <Transition name="wx-slide-up">
      <div v-if="activeTab === 'bank' && selectedIds.size > 0" class="wx-q-actionbar wx-glass">
        <div class="wx-q-actionbar-left">
          <span class="wx-q-actionbar-count">已选 <b>{{ selectedQuestions.length }}</b> 题</span>
          <button class="wx-q-actionbar-link" @click="selectAllLoaded">全选已加载</button>
          <button class="wx-q-actionbar-link" @click="clearSelection">清空</button>
        </div>
        <button class="wx-btn-gradient wx-pressable wx-q-actionbar-start" @click="startSelected">
          开始答题 →
        </button>
      </div>
    </Transition>

    <!-- 生题成功提示 -->
    <Transition name="wx-fade">
      <div v-if="toastText" class="wx-q-toast">{{ toastText }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.wx-q {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wx-q-head {
  padding: 18px 28px 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-q-head-main { min-width: 0; }
.wx-q-title {
  font-family: var(--wx-font-serif);
  font-size: 26px;
  font-weight: 600;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-q-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

/* 标题行右侧图标按钮 */
.wx-q-actions { display: flex; gap: 8px; padding-top: 4px; }
.wx-q-icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-icon-btn svg { width: 18px; height: 18px; }
.wx-q-icon-btn:hover {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
}
.wx-q-icon-btn.active {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
}
/* Tab 图标组与操作图标组之间的分隔线 */
.wx-q-actions-sep {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: var(--wx-border-soft);
}

.wx-q-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* ===== 左边栏 ===== */
.wx-q-filter {
  width: 232px;
  flex-shrink: 0;
  padding: 20px 16px;
  border-right: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 22%, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}
.wx-q-filter-title { font-size: 15px; font-weight: 600; }
.wx-q-filter-sep { height: 1px; background: var(--wx-border-soft); margin: 4px 0; }
.wx-q-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wx-q-tag-clear {
  font-size: 11px;
  color: var(--wx-text-tertiary);
  padding: 2px 8px;
  border-radius: 999px;
}
.wx-q-tag-clear:hover { color: var(--wx-color-vermilion); background: color-mix(in srgb, var(--wx-color-vermilion) 10%, transparent); }

.wx-q-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-search:focus-within { border-color: var(--wx-border-glow); }
.wx-q-search-icon { width: 15px; height: 15px; color: var(--wx-text-muted); flex-shrink: 0; }
.wx-q-search-input {
  flex: 1;
  min-width: 0;
  padding: 9px 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--wx-text-primary);
  font-size: 13px;
}
.wx-q-search-input::placeholder { color: var(--wx-text-muted); }
.wx-q-search-clear {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--wx-text-tertiary);
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
}
.wx-q-search-clear:hover { color: var(--wx-color-vermilion); background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent); }

/* 分面检索 */
.wx-q-facets {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding-bottom: 4px;
}
.wx-q-facet { display: flex; flex-direction: column; gap: 6px; }
.wx-q-facet-name { font-size: 11px; letter-spacing: 0.08em; color: var(--wx-text-tertiary); }
.wx-q-facet-opts { display: flex; flex-wrap: wrap; gap: 6px; }
.wx-q-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 9px;
  font-size: 11.5px;
  border-radius: 999px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-chip:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-q-chip.active {
  color: var(--wx-text-on-accent);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 28%, transparent);
}
.wx-q-chip.empty { opacity: 0.35; }
.wx-q-chip:disabled { cursor: not-allowed; }
.wx-q-chip-text {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-q-chip-num { font-family: var(--wx-font-mono); font-size: 10px; color: var(--wx-text-muted); }
.wx-q-chip.active .wx-q-chip-num { color: color-mix(in srgb, var(--wx-ink) 75%, transparent); }
.wx-q-facet-more { align-self: flex-start; font-size: 11px; color: var(--wx-text-tertiary); }
.wx-q-facet-more:hover { color: var(--wx-color-primary-soft); }
.wx-q-filter-count {
  font-size: 11px;
  color: var(--wx-text-muted);
  padding-top: 8px;
  border-top: 1px solid var(--wx-border-soft);
}

/* ===== 内容区 ===== */
.wx-q-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 28px 96px;
}
.wx-q-main.is-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  align-content: start;
}
.wx-q-main.is-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wx-q-card {
  position: relative;
  padding: 16px;
  border-radius: var(--wx-glass-radius);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft), box-shadow var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-card:hover {
  border-color: var(--wx-border-glow);
}
.wx-q-card.is-selected {
  border-color: var(--wx-color-primary);
  box-shadow: 0 0 16px color-mix(in srgb, var(--wx-color-primary) 28%, transparent);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.wx-q-card.is-list {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 12px 16px 12px 48px;
}
.wx-q-card.is-list .wx-q-card-top { flex-shrink: 0; }
.wx-q-card.is-list .wx-q-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.wx-q-card.is-list .wx-q-card-body { -webkit-line-clamp: 1; }

/* 卡片左上角勾选框 */
.wx-q-check {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 18px;
  height: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-q-card:not(.is-list) { padding-top: 36px; }
.wx-q-check input { display: none; }
.wx-q-check-box {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid var(--wx-border-soft);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wx-text-on-accent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-check-box svg { width: 12px; height: 12px; }
.wx-q-card.is-selected .wx-q-check-box {
  background: var(--wx-color-primary);
  border-color: var(--wx-color-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--wx-color-primary) 60%, transparent);
}

.wx-q-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
}
.wx-q-diff,
.wx-q-type,
.wx-q-source {
  padding: 2px 9px;
  border-radius: 999px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.wx-q-diff.diff-easy { background: color-mix(in srgb, var(--wx-state-deep) 15%, transparent); color: var(--wx-state-deep); }
.wx-q-diff.diff-medium { background: color-mix(in srgb, var(--wx-color-amber) 15%, transparent); color: var(--wx-color-amber); }
.wx-q-diff.diff-hard { background: color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent); color: var(--wx-color-vermilion); }
.wx-q-type { background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent); color: var(--wx-color-primary-soft); }
.wx-q-source.src-manual { background: color-mix(in srgb, var(--wx-ink) 6%, transparent); color: var(--wx-text-tertiary); }
.wx-q-source.src-ai { background: color-mix(in srgb, var(--wx-color-yanqing) 15%, transparent); color: var(--wx-color-yanqing); }

.wx-q-card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-q-card-body {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--wx-text-tertiary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wx-q-card-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.wx-q-tag {
  font-size: 10px;
  padding: 2px 8px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  border-radius: 999px;
  color: var(--wx-text-secondary);
}

/* ===== 空态 / 提示 ===== */
.wx-q-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.wx-q-empty-mark { font-size: 28px; color: var(--wx-color-primary); opacity: 0.8; }
.wx-q-empty-title { font-size: 16px; font-family: var(--wx-font-serif); color: var(--wx-text-primary); }
.wx-q-empty-sub { font-size: 12px; color: var(--wx-text-tertiary); }
.wx-q-empty-btn { margin-top: 10px; padding: 8px 18px; font-size: 12px; }

/* 分页加载 / 侧栏错误 */
.wx-q-loadmore {
  grid-column: 1 / -1;
  justify-self: center;
  margin: 14px 0 96px;
  padding: 8px 22px;
  font-size: 12px;
  border-radius: 999px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-q-loadmore:hover { background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); }
.wx-q-loadbar { grid-column: 1 / -1; justify-self: center; margin: 14px 0 96px; font-size: 12px; color: var(--wx-text-tertiary); }
.wx-q-filter-err { color: var(--wx-color-vermilion); }

.wx-q-toast {
  position: fixed;
  top: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 120;
  padding: 10px 20px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-bg-deep) 92%, transparent);
  border: 1px solid var(--wx-border-glow);
  box-shadow: var(--wx-shadow-glow);
  font-size: 13px;
  color: var(--wx-text-primary);
}

/* ===== 底部多选操作栏 ===== */
.wx-q-actionbar {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 110;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px 10px 18px;
  min-width: 360px;
  border-radius: 50px;
}
.wx-q-actionbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
}
.wx-q-actionbar-count b { color: var(--wx-color-primary-soft); font-weight: 700; margin: 0 2px; }
.wx-q-actionbar-link {
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 999px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-q-actionbar-link:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-q-actionbar-start { padding: 8px 20px; font-size: 13px; font-weight: 600; }

.wx-slide-up-enter-active,
.wx-slide-up-leave-active { transition: all 0.25s var(--wx-ease-spring); }
.wx-slide-up-enter-from,
.wx-slide-up-leave-to { opacity: 0; transform: translate(-50%, 16px); }
</style>
