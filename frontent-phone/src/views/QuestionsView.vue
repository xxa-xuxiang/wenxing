<!-- 题库（Tab 页）：分面检索 + 题卡勾选集中答题 + 按知识点凑题（JIT）/ 错题本 / 薄弱专项弹层入口 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showDialog, showToast } from 'vant'
import { useQuizStore } from '@/stores/quizStore'
import { useLearnStore } from '@/stores/learnStore'
import {
  listQuestions,
  searchLeaves,
  questionsByLeaf,
  type FacetItem
} from '@/services/questionService'
import type { Question } from '@/types/quiz'
import GenerateQuizPanel from '@/components/quiz/GenerateQuizPanel.vue'
import WrongBookPanel from '@/components/quiz/WrongBookPanel.vue'
import WeaknessPanel from '@/components/quiz/WeaknessPanel.vue'

const route = useRoute()
const router = useRouter()
const quiz = useQuizStore()
const learnStore = useLearnStore()

// ===== 列表：分页 + 服务端分面（van-list 增量加载） =====
const PAGE_SIZE = 20
const items = ref<Question[]>([])
const total = ref(0)
const page = ref(1)
const listLoading = ref(false)
const listError = ref(false)
const errorText = ref('')
const finished = ref(false)

const keyword = ref('')
const facetDiff = ref<string[]>([])
const facetType = ref<string[]>([])
const facetIndustry = ref<string[]>([]) // 行业单选，数组复用切换 UI
const facets = ref<{ difficulty: FacetItem[]; type: FacetItem[]; industry: FacetItem[] }>({
  difficulty: [],
  type: [],
  industry: []
})

// ===== 题卡多选 → 底部开始答题 =====
const selectedIds = ref<Set<string>>(new Set())

let loadSeq = 0
async function onLoad() {
  if (listError.value) {
    listLoading.value = false // 失败后由「重试」显式恢复，避免 van-list 一直转圈
    return
  }
  const seq = ++loadSeq
  try {
    const resp = await listQuestions({
      q: keyword.value,
      difficulty: facetDiff.value,
      type: facetType.value,
      industry: facetIndustry.value[0] || '',
      page: page.value,
      pageSize: PAGE_SIZE
    })
    if (seq !== loadSeq) return // 已被更新一次的请求覆盖（筛选/翻页竞态保护）
    items.value = page.value === 1 ? resp.items : [...items.value, ...resp.items]
    total.value = resp.total
    facets.value = resp.facets
    page.value += 1
    finished.value = items.value.length >= resp.total
    listError.value = false
    errorText.value = ''
  } catch (e) {
    if (seq !== loadSeq) return
    listError.value = true
    errorText.value = e instanceof Error ? e.message : '题库加载失败'
    finished.value = true // 停止 van-list 的自动续拉，等待用户点「重试」
  } finally {
    if (seq === loadSeq) listLoading.value = false
  }
}

/** 条件变化后重载第一页（手动置 loading 防止 van-list 重复触发） */
function reload() {
  page.value = 1
  finished.value = false
  listError.value = false
  errorText.value = ''
  items.value = []
  // 筛选/搜索变化后旧勾选题已不在列表里，清空避免操作栏显示「已选 0 题」
  selectedIds.value = new Set()
  listLoading.value = true
  void onLoad()
}

function retry() {
  if (listLoading.value) return
  listError.value = false
  errorText.value = ''
  finished.value = false
  listLoading.value = true
  void onLoad()
}

// 关键字防抖（clearAllFilters 主动重载时跳过一次 watcher）
let kwTimer: number | null = null
let skipKeywordReload = false
watch(keyword, () => {
  if (skipKeywordReload) {
    skipKeywordReload = false
    if (kwTimer) {
      window.clearTimeout(kwTimer)
      kwTimer = null
    }
    return
  }
  if (kwTimer) window.clearTimeout(kwTimer)
  kwTimer = window.setTimeout(() => reload(), 350)
})

// ===== 筛选弹层（bottom popup，草稿态确认后生效） =====
const filterOpen = ref(false)
const diffText: Record<Question['difficulty'], string> = { easy: '简单', medium: '中等', hard: '困难' }
const typeText: Record<Question['type'], string> = {
  single: '单选',
  multiple: '多选',
  short: '简答',
  coding: '编程'
}
const draftDiff = ref<string[]>([])
const draftType = ref<string[]>([])
const draftIndustry = ref<string[]>([])

const facetCount = computed(
  () => facetDiff.value.length + facetType.value.length + facetIndustry.value.length
)

/** 服务端分面计数（无该值返回 0） */
function countOf(group: 'difficulty' | 'type' | 'industry', val: string): number {
  return facets.value[group].find((f) => f.val === val)?.count ?? 0
}

function openFilter() {
  draftDiff.value = [...facetDiff.value]
  draftType.value = [...facetType.value]
  draftIndustry.value = [...facetIndustry.value]
  filterOpen.value = true
}
function toggleDraftDiff(v: string) {
  draftDiff.value = draftDiff.value.includes(v) ? draftDiff.value.filter((x) => x !== v) : [...draftDiff.value, v]
}
function toggleDraftType(v: string) {
  draftType.value = draftType.value.includes(v) ? draftType.value.filter((x) => x !== v) : [...draftType.value, v]
}
function toggleDraftIndustry(v: string) {
  draftIndustry.value = draftIndustry.value[0] === v ? [] : [v]
}
function clearDraft() {
  draftDiff.value = []
  draftType.value = []
  draftIndustry.value = []
}
function confirmFilter() {
  const changed =
    facetDiff.value.join() !== draftDiff.value.join() ||
    facetType.value.join() !== draftType.value.join() ||
    facetIndustry.value.join() !== draftIndustry.value.join()
  facetDiff.value = [...draftDiff.value]
  facetType.value = [...draftType.value]
  facetIndustry.value = [...draftIndustry.value]
  filterOpen.value = false
  if (changed) reload()
}
/** 已选筛选摘要（筛选按钮角标） */
const filterBrief = computed(() => {
  const d = facetDiff.value.map((v) => diffText[v as Question['difficulty']] ?? v)
  const t = facetType.value.map((v) => typeText[v as Question['type']] ?? v)
  return [...d, ...t, ...facetIndustry.value].join('·')
})

/** 清空全部筛选（含关键字），立即重载第一页 */
function clearAllFilters() {
  facetDiff.value = []
  facetType.value = []
  facetIndustry.value = []
  draftDiff.value = []
  draftType.value = []
  draftIndustry.value = []
  if (keyword.value) {
    skipKeywordReload = true
    if (kwTimer) {
      window.clearTimeout(kwTimer)
      kwTimer = null
    }
    keyword.value = ''
  }
  reload()
}

// ===== 题卡多选 → 底部开始答题（selectedIds 声明见上方，供 reload 清理） =====
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
const selectedQuestions = computed<Question[]>(() => items.value.filter((q) => selectedIds.value.has(q.id)))

async function startSelected() {
  const list = selectedQuestions.value
  if (list.length === 0) return
  try {
    await showDialog({
      title: '开始答题',
      message: `共 ${list.length} 题，交卷后服务端判分并计入知识点掌握度。`,
      showCancelButton: true,
      confirmButtonText: '开始'
    })
  } catch {
    return // 用户取消
  }
  quiz.startWithQuestions('题库练习', list, 0)
  void router.push({ path: '/quiz', query: { from: 'bank' } })
}

// ===== 按知识点凑题（深链 ?skill= 支持按名称检索叶子） =====
const skillBusy = ref(false)
async function quickQuizBySkill(name: string) {
  if (skillBusy.value) return
  skillBusy.value = true
  try {
    const found = await searchLeaves(name, learnStore.selectedDomain?.name ?? '')
    const leaf = found.items[0]
    if (!leaf) throw new Error('未找到该技能点对应的题库叶子')
    const resp = await questionsByLeaf(leaf.leafKey, 20, true)
    if (resp.items.length === 0) throw new Error('该技能点题目建设中，请稍后再试')
    quiz.startWithQuestions(resp.leaf.pathText || leaf.name, resp.items, 0)
    void router.push('/quiz')
  } catch (e) {
    showToast(e instanceof Error ? e.message : '凑题失败，请稍后再试')
  } finally {
    skillBusy.value = false
  }
}

onMounted(() => {
  const skill = route.query.skill?.toString()
  if (skill) void quickQuizBySkill(skill)
})
watch(
  () => route.query.skill,
  (s) => {
    if (s && typeof s === 'string' && route.path === '/questions') void quickQuizBySkill(s)
  }
)

// ===== 弹层入口 =====
const genOpen = ref(false)
const wrongOpen = ref(false)
const weakOpen = ref(false)

/** 凑题完成 → 直接进答题 */
function onGenerated(list: Question[], title: string) {
  quiz.startWithQuestions(title, list, 0)
  void router.push('/quiz')
}
</script>

<template>
  <div class="page-with-tabbar qb">
    <!-- 头部：标题 + 入口 -->
    <div class="qb-head">
      <div>
        <h1 class="qb-title">题库</h1>
        <p class="qb-sub">分面检索 · 按知识点凑题 · 勾选集中答题</p>
      </div>
      <van-button size="small" plain round type="primary" icon="orders-o" @click="router.push('/papers')">
        我的试卷
      </van-button>
    </div>

    <!-- 检索行：搜索 + 筛选 -->
    <div class="qb-search-row">
      <van-search v-model="keyword" class="qb-search" placeholder="搜索题目 / 知识点…" shape="round" />
      <button class="qb-filter-btn" :class="{ active: facetCount > 0 }" @click="openFilter">
        <span>筛选</span>
        <span v-if="facetCount" class="qb-filter-n">{{ facetCount }}</span>
      </button>
    </div>
    <div v-if="filterBrief" class="qb-brief">
      <span class="qb-brief-text">{{ filterBrief }}</span>
      <button class="qb-brief-clear" @click="clearAllFilters">清空</button>
    </div>

    <!-- 入口行：按知识点练 / 错题本 / 薄弱专项 -->
    <div class="qb-entries">
      <button class="qb-entry" @click="genOpen = true"><span>✦</span> 按知识点练</button>
      <button class="qb-entry" @click="wrongOpen = true"><span>✗</span> 错题本</button>
      <button class="qb-entry" @click="weakOpen = true"><span>◐</span> 薄弱专项</button>
    </div>

    <!-- 题卡列表（van-list 增量加载） -->
    <div class="qb-body">
      <div v-if="total > 0 || items.length > 0" class="qb-count">
        共 {{ total }} 题<span v-if="items.length"> · 已载 {{ items.length }}</span>
        <span v-if="listError" class="qb-count-err">· 加载失败</span>
      </div>

      <div v-if="listError" class="qb-err">
        <span class="qb-err-text">⚠ {{ errorText || '题库加载失败' }}</span>
        <button class="qb-err-retry" @click="retry">重试</button>
      </div>

      <van-list
        v-model:loading="listLoading"
        :finished="finished"
        :finished-text="!listError && items.length ? '没有更多了' : ''"
        @load="onLoad"
      >
        <div
          v-for="q in items"
          :key="q.id"
          class="qb-card"
          :class="{ picked: selectedIds.has(q.id) }"
          @click="toggleSelect(q.id)"
        >
          <div class="qb-top">
            <span class="qb-badge" :class="`d-${q.difficulty}`">{{ diffText[q.difficulty] }}</span>
            <span class="qb-badge t">{{ typeText[q.type] }}</span>
            <span class="qb-badge s">{{ q.source === 'ai' ? 'RAG 题库' : '内置' }}</span>
          </div>
          <div class="qb-card-title">{{ q.title }}</div>
          <p class="qb-card-body">{{ q.body }}</p>
          <div v-if="q.knowledgePoints?.length" class="qb-tags">
            <span v-for="k in q.knowledgePoints" :key="k" class="qb-tag">{{ k }}</span>
          </div>
          <span class="qb-check">
            <van-checkbox :model-value="selectedIds.has(q.id)" shape="round" @click.stop="toggleSelect(q.id)" />
          </span>
        </div>
      </van-list>

      <!-- 空态（对齐桌面：说明 + 清空筛选出口） -->
      <div v-if="finished && !listError && items.length === 0" class="qb-empty">
        <div class="qb-empty-mark">✧</div>
        <div class="qb-empty-title">题库里还没有匹配的题目</div>
        <p class="qb-empty-sub">试试更换关键字/筛选条件，或点「按知识点练」为技能点现场建设题目</p>
        <van-button size="small" round plain type="primary" @click="clearAllFilters">
          清空筛选条件
        </van-button>
      </div>
    </div>

    <!-- 底部多选操作栏（TabBar 之上浮起） -->
    <Transition name="qb-up">
      <div v-if="selectedIds.size > 0" class="qb-bar">
        <div class="qb-bar-left">
          <span class="qb-bar-count">已选 <b>{{ selectedQuestions.length }}</b> 题</span>
          <button class="qb-bar-link" @click="selectAllLoaded">全选已载</button>
          <button class="qb-bar-link" @click="clearSelection">清空</button>
        </div>
        <van-button type="primary" size="small" round class="qb-bar-btn" @click="startSelected">
          开始答题 →
        </van-button>
      </div>
    </Transition>

    <!-- 筛选弹层 -->
    <van-popup v-model:show="filterOpen" position="bottom" round :style="{ maxHeight: '80vh' }">
      <div class="qb-filter">
        <div class="qb-filter-head">
          <button class="qb-filter-clear" @click="clearDraft">清空</button>
          <span class="qb-filter-title">筛选</span>
          <button class="qb-filter-ok" @click="confirmFilter">确定</button>
        </div>

        <div class="qb-fgroup">
          <div class="qb-fgroup-name">难度</div>
          <div class="qb-chips">
            <button
              v-for="(label, val) in diffText"
              :key="val"
              class="qb-chip"
              :class="{ active: draftDiff.includes(val), empty: countOf('difficulty', val) === 0 && !draftDiff.includes(val) }"
              :disabled="countOf('difficulty', val) === 0 && !draftDiff.includes(val)"
              @click="toggleDraftDiff(val)"
            >
              {{ label }}<i>{{ countOf('difficulty', val) }}</i>
            </button>
          </div>
        </div>

        <div class="qb-fgroup">
          <div class="qb-fgroup-name">题型</div>
          <div class="qb-chips">
            <button
              v-for="(label, val) in typeText"
              :key="val"
              class="qb-chip"
              :class="{ active: draftType.includes(val), empty: countOf('type', val) === 0 && !draftType.includes(val) }"
              :disabled="countOf('type', val) === 0 && !draftType.includes(val)"
              @click="toggleDraftType(val)"
            >
              {{ label }}<i>{{ countOf('type', val) }}</i>
            </button>
          </div>
        </div>

        <div v-if="facets.industry.length" class="qb-fgroup">
          <div class="qb-fgroup-name">行业（单选）</div>
          <div class="qb-chips">
            <button
              v-for="o in facets.industry"
              :key="o.val"
              class="qb-chip"
              :class="{ active: draftIndustry.includes(o.val), empty: o.count === 0 && !draftIndustry.includes(o.val) }"
              :disabled="o.count === 0 && !draftIndustry.includes(o.val)"
              @click="toggleDraftIndustry(o.val)"
            >
              {{ o.val }}<i>{{ o.count }}</i>
            </button>
          </div>
        </div>

        <div class="qb-filter-count">当前命中 {{ total }} 题</div>
      </div>
    </van-popup>

    <GenerateQuizPanel v-model:show="genOpen" @generated="onGenerated" />
    <WrongBookPanel v-model:show="wrongOpen" />
    <WeaknessPanel v-model:show="weakOpen" />
  </div>
</template>

<style scoped>
.qb { min-height: 100vh; }
.qb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 14px 4px;
}
.qb-title { margin: 0; font-size: 22px; font-weight: 700; color: #323233; }
.qb-sub { margin: 4px 0 0; font-size: 11.5px; color: #969799; }

.qb-search-row { display: flex; align-items: center; gap: 8px; padding: 4px 14px 0; }
.qb-search { flex: 1; min-width: 0; padding: 6px 0; background: transparent; }
.qb-filter-btn {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid #ebedf0;
  background: #fff;
  font-size: 12.5px;
  color: #646566;
}
.qb-filter-btn.active { color: #1989fa; border-color: #1989fa; }
.qb-filter-n {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #1989fa;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
.qb-brief {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px 0;
  font-size: 11.5px;
  color: #1989fa;
}
.qb-brief-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb-brief-clear { flex-shrink: 0; color: #969799; }

.qb-entries { display: flex; gap: 8px; padding: 10px 14px 2px; }
.qb-entry {
  flex: 1;
  padding: 9px 0;
  border-radius: 10px;
  border: 1px solid #ebedf0;
  background: #fff;
  font-size: 12.5px;
  color: #323233;
}
.qb-entry span { color: #1989fa; margin-right: 2px; }

.qb-body { padding: 8px 14px calc(70px + env(safe-area-inset-bottom)); }

.qb-count {
  padding: 0 2px 8px;
  font-size: 11px;
  color: #969799;
}
.qb-count-err { color: #ee0a24; }

.qb-err {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  font-size: 11.5px;
  color: #ee0a24;
}
.qb-err-text { flex: 1; min-width: 0; line-height: 1.5; }
.qb-err-retry {
  flex-shrink: 0;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid #ee0a24;
  background: #fff;
  font-size: 11px;
  color: #ee0a24;
}

.qb-card {
  position: relative;
  padding: 12px 36px 12px 12px;
  margin-bottom: 10px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qb-card.picked { border-color: #1989fa; background: #f2f6ff; }
.qb-top { display: flex; align-items: center; gap: 8px; font-size: 10.5px; }
.qb-badge { padding: 2px 8px; border-radius: 999px; background: rgba(74, 222, 128, 0.14); color: #16a34a; }
.qb-badge.d-medium { background: rgba(251, 191, 36, 0.16); color: #d97706; }
.qb-badge.d-hard { background: rgba(248, 113, 113, 0.14); color: #dc2626; }
.qb-badge.t { background: #eef3ff; color: #1989fa; }
.qb-badge.s { background: #f2f3f5; color: #969799; }
.qb-card-title { font-size: 15px; font-weight: 600; color: #323233; line-height: 1.45; }
.qb-card-body {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: #646566;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.qb-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.qb-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e8faf3;
  color: #0fa37f;
}
.qb-check { position: absolute; top: 10px; right: 10px; }

.qb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 46px 20px 60px;
  text-align: center;
}
.qb-empty-mark { font-size: 28px; color: #1989fa; opacity: 0.8; }
.qb-empty-title { font-size: 16px; color: #323233; }
.qb-empty-sub { margin: 0; font-size: 12px; line-height: 1.6; color: #969799; }

.qb-bar {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(56px + env(safe-area-inset-bottom) + 8px);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 10px 16px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid #ebedf0;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
}
.qb-bar-left { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: #646566; }
.qb-bar-count b { color: #1989fa; margin: 0 2px; }
.qb-bar-link { font-size: 11.5px; color: #969799; padding: 2px 6px; }
.qb-bar-btn { margin-left: auto; }
.qb-up-enter-active,
.qb-up-leave-active { transition: all 0.22s ease; }
.qb-up-enter-from,
.qb-up-leave-to { opacity: 0; transform: translateY(14px); }

/* 筛选弹层 */
.qb-filter {
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.qb-filter-head {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}
.qb-filter-title { font-size: 15px; font-weight: 600; }
.qb-filter-clear { text-align: left; font-size: 13px; color: #969799; }
.qb-filter-ok { text-align: right; font-size: 13px; color: #1989fa; font-weight: 600; }
.qb-fgroup { display: flex; flex-direction: column; gap: 8px; }
.qb-fgroup-name { font-size: 12px; color: #969799; }
.qb-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.qb-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid #ebedf0;
  background: #fff;
  font-size: 12.5px;
  color: #646566;
}
.qb-chip i { font-style: normal; font-size: 10px; color: #c8c9cc; }
.qb-chip.active { color: #1989fa; border-color: #1989fa; background: #f2f6ff; }
.qb-chip.active i { color: #1989fa; }
.qb-chip.empty { opacity: 0.4; }
.qb-chip:disabled { opacity: 0.4; }
.qb-filter-count { font-size: 11.5px; color: #969799; text-align: center; }
</style>
