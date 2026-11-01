<script setup lang="ts">
// 阶段4 今日执行面板（嵌入学习布局顶部）：A) 今日任务 B) 今日复习 C) 今日打卡
// 硬约束：挂载不发任何网络请求；今天的数据一律读本地缓存，远程读写仅由用户显式点击触发
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLearnStore } from '@/stores/learnStore'
import { useMasteryStore } from '@/stores/masteryStore'
import { useQuizStore } from '@/stores/quizStore'
import { useCheckinStore, getStudiedTaskIds, getStudyMinutes, markTaskStudied } from '@/stores/checkinStore'
import { useAuthStore } from '@/stores/authStore'
import { questionsBySkillPath, questionsByLeaf, searchLeaves } from '@/services/questionService'
import type { LearnStatus, OutlineTask, Question } from '@/types'

const router = useRouter()
const learnStore = useLearnStore()
const mastery = useMasteryStore()
const quiz = useQuizStore()
const checkin = useCheckinStore()
const authStore = useAuthStore()

const HOUR = 60 * 60 * 1000
/** 复习间隔阈值：距上次答题超过 20 小时视为待复习 */
const REVIEW_GAP = 20 * HOUR

// 本地日期键 YYYY-MM-DD（与计划排期同格式，可直接字符串比较）
function localDateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
const NOW = new Date()
const TODAY = localDateKey(NOW)
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'][NOW.getDay()]
const TODAY_LABEL = `${NOW.getMonth() + 1} 月 ${NOW.getDate()} 日 · 周${WEEKDAY}`

function statusClass(s: LearnStatus): string {
  return s === 'deep' ? 'wx-dot-deep' : s === 'light' ? 'wx-dot-light' : 'wx-dot-unknown'
}
function hasDoc(taskId: string): boolean {
  return learnStore.docs.some((d) => d.skillId === taskId)
}
/** 相对时间（如「2 天前」） */
function relTime(t: number): string {
  const min = Math.floor((Date.now() - t) / 60000)
  if (min < 60) return `${Math.max(1, min)} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

// ===== A) 今日任务（纯本地数据） =====
interface TodayTask {
  task: OutlineTask
  blockName: string
}
/** 今天落在排期区间内的模块 */
const todayBlocks = computed(() => learnStore.plan.filter((b) => b.startDate <= TODAY && TODAY <= b.endDate))
const todayTasks = computed<TodayTask[]>(() => {
  const byId = new Map(learnStore.outline.map((t) => [t.id, t]))
  const list: TodayTask[] = []
  for (const b of todayBlocks.value) {
    for (const id of b.taskIds) {
      const t = byId.get(id)
      if (t) list.push({ task: t, blockName: b.name })
    }
  }
  return list
})
/** 最近一个尚未开始的模块（今天早于其 startDate） */
const nextBlock = computed(() => {
  const upcoming = learnStore.plan
    .filter((b) => b.startDate > TODAY)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  return upcoming[0] ?? null
})

function onLearn(task: OutlineTask) {
  markTaskStudied(task.id) // 学习项目自动记录
  learnStore.openTask(task.id)
}
function onQuiz(task: OutlineTask) {
  markTaskStudied(task.id) // 学习项目自动记录
  void router.push(`/questions?skill=${task.id}&title=${encodeURIComponent(task.title)}`)
}

// ===== B) 今日复习（只读掌握度本地记录） =====
interface ReviewItem {
  kp: string
  state: 'learning' | 'mastered'
  lastT: number
  rel: string
}
const reviewItems = computed<ReviewItem[]>(() => {
  const now = Date.now()
  const list: ReviewItem[] = []
  for (const [kp, entry] of Object.entries(mastery.map)) {
    if (entry.state === 'unlearned') continue
    const last = entry.records[entry.records.length - 1]
    if (!last || now - last.t <= REVIEW_GAP) continue
    list.push({ kp, state: entry.state, lastT: last.t, rel: relTime(last.t) })
  }
  // 按最后答题时间正序（最久未复习的排最前），取前 5
  list.sort((a, b) => a.lastT - b.lastT)
  return list.slice(0, 5)
})

const reviewingKp = ref<string | null>(null)
const reviewError = ref('')
/** 显式点击才凑题（允许后端 JIT 出题，禁止自动执行） */
async function onReview(item: ReviewItem) {
  if (reviewingKp.value) return
  reviewingKp.value = item.kp
  reviewError.value = ''
  try {
    // 先在 outline 里按知识点名定位任务，拿到完整 kp 路径
    const task = learnStore.outline.find((t) => t.kp?.name === item.kp || t.title === item.kp)
    let items: Question[] = []
    if (task?.kp) {
      const resp = await questionsBySkillPath(
        {
          industry: learnStore.selectedDomain?.name ?? '',
          category: task.kp.category,
          domain: task.kp.domain,
          stack: task.kp.stack,
          name: task.kp.name
        },
        10,
        true
      )
      items = resp.items
    }
    // 未找到任务或路径无题 → 退回叶子检索再按 leafKey 凑题
    if (items.length === 0) {
      const found = await searchLeaves(item.kp, learnStore.selectedDomain?.name ?? '')
      const leaf = found.items[0]
      if (!leaf) throw new Error('未匹配到相关技能叶子，暂时无法凑题')
      const resp2 = await questionsByLeaf(leaf.leafKey, 10, true)
      if (resp2.items.length === 0) throw new Error('该知识点暂无可用题目，请稍后再试')
      items = resp2.items
    }
    quiz.startWithQuestions(item.kp, items, 0)
    void router.push('/quiz')
  } catch (e) {
    reviewError.value = e instanceof Error ? e.message : '凑题失败'
  } finally {
    reviewingKp.value = null
  }
}

// ===== 栏化：今日任务 / 今日复习默认收起，点击栏标题展开 =====
const tasksOpen = ref(false)
const reviewOpen = ref(false)

// ===== C) 今日打卡（一键打卡：学习时间与学习项目自动记录，无需填表） =====
const saving = ref(false)
const savedTip = ref('')
const syncing = ref(false)

/** 今日已学习时长（取自动累计与已打卡记录的较大值，重复打卡不回退） */
const autoMinutes = computed(() => Math.max(getStudyMinutes(), checkin.todayRecord?.minutes ?? 0))
/** 今日已学习项目数（自动记录 ∪ 已打卡记录） */
const autoTaskIds = computed(() => {
  const s = new Set<string>(getStudiedTaskIds())
  for (const id of checkin.todayRecord?.taskIds ?? []) s.add(id)
  return [...s]
})

/** 一键打卡：分钟数与学习项目来自自动记录，不填表；登录态会先确认再同步云端 */
async function quickCheckin() {
  if (saving.value) return
  if (authStore.user && !window.confirm('打卡将同步到云端，是否继续？')) return
  saving.value = true
  savedTip.value = ''
  try {
    await checkin.saveDaily(checkin.todayKey, {
      minutes: autoMinutes.value,
      taskIds: autoTaskIds.value,
      note: checkin.todayRecord?.note ?? ''
    })
    savedTip.value = '今日打卡已保存'
  } catch (e) {
    savedTip.value = e instanceof Error ? e.message : '打卡保存失败'
  } finally {
    saving.value = false
  }
}
/** 显式点击才拉取云端打卡（挂载不自动请求） */
async function onSync() {
  if (syncing.value) return
  if (!window.confirm('将从云端拉取打卡记录，是否继续？')) return
  syncing.value = true
  try {
    await checkin.loadRecent(120)
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div class="wx-today">
    <!-- 今日打卡：上部分只保留一个简单的打卡按钮（学习时长与项目自动记录） -->
    <section class="wx-today-checkin wx-glass">
      <div class="wx-checkin-row">
        <span class="wx-checkin-mark" :class="{ done: !!checkin.todayRecord }">✓</span>
        <div class="wx-checkin-info">
          <span class="wx-checkin-label">今日打卡</span>
          <span class="wx-checkin-status">
            已学 {{ autoMinutes }} 分钟 · {{ autoTaskIds.length }} 项 · 连续 {{ checkin.streak }} 天
          </span>
        </div>
        <button class="wx-checkin-go wx-pressable" :class="{ done: !!checkin.todayRecord }" :disabled="saving" @click="quickCheckin">
          {{ saving ? '打卡中…' : checkin.todayRecord ? '已打卡' : '打卡' }}
        </button>
      </div>
      <div class="wx-today-sync">
        <button class="wx-today-link wx-pressable" :disabled="syncing" @click="onSync">
          {{ syncing ? '同步中…' : '同步云端打卡记录' }}
        </button>
        <span v-if="checkin.pendingLocal" class="wx-today-note">本地有未同步记录</span>
        <span v-if="!authStore.user" class="wx-today-note">未登录：打卡仅保存在本地</span>
        <span v-if="savedTip" class="wx-today-note">{{ savedTip }}</span>
        <span v-if="checkin.error" class="wx-today-err">{{ checkin.error }}</span>
      </div>
    </section>

    <!-- 今日任务（栏化：单行标题，点击展开） -->
    <section class="wx-today-bar wx-glass" :class="{ open: tasksOpen }">
      <button class="wx-today-bar-head wx-pressable" @click="tasksOpen = !tasksOpen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
          <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
          <path d="M7.5 14l1.6 1.6L13 12" />
        </svg>
        <span class="wx-today-bar-title">今日任务</span>
        <span class="wx-today-bar-tag">{{ todayTasks.length }}</span>
        <span class="wx-today-bar-date">{{ TODAY_LABEL }}</span>
        <span class="wx-today-bar-caret">▾</span>
      </button>

      <div v-if="tasksOpen" class="wx-today-bar-body">
        <ul v-if="todayTasks.length" class="wx-today-list">
          <li v-for="tk in todayTasks" :key="tk.task.id" class="wx-today-row wx-task-row">
            <span class="wx-dot" :class="statusClass(tk.task.status)"></span>
            <span class="wx-today-task-title">{{ tk.task.title }}</span>
            <span class="wx-today-block">{{ tk.blockName }}</span>
            <span v-if="!hasDoc(tk.task.id)" class="wx-today-nodoc">未生成文档</span>
            <button class="wx-today-btn wx-pressable" @click="onLearn(tk.task)">学文档</button>
            <button class="wx-today-btn wx-today-btn-primary wx-pressable" @click="onQuiz(tk.task)">去刷题</button>
          </li>
        </ul>
        <div v-else-if="learnStore.plan.length === 0" class="wx-today-empty">暂无学习计划</div>
        <div v-else class="wx-today-empty">
          <span>今日不在任何模块计划期内</span>
          <span v-if="nextBlock" class="wx-today-next">
            最近将开始：{{ nextBlock.name }}（{{ nextBlock.startDate }}）
          </span>
        </div>
      </div>
    </section>

    <!-- 今日复习（栏化：单行标题，点击展开） -->
    <section class="wx-today-bar wx-glass" :class="{ open: reviewOpen }">
      <button class="wx-today-bar-head wx-pressable" @click="reviewOpen = !reviewOpen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 12a8 8 0 1 1 2.5 5.7" />
          <path d="M4 19v-4h4" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
        <span class="wx-today-bar-title">今日复习</span>
        <span class="wx-today-bar-tag">{{ reviewItems.length }}</span>
        <span class="wx-today-bar-date">间隔 20 小时以上</span>
        <span class="wx-today-bar-caret">▾</span>
      </button>

      <div v-if="reviewOpen" class="wx-today-bar-body">
        <ul v-if="reviewItems.length" class="wx-today-list">
          <li v-for="rv in reviewItems" :key="rv.kp" class="wx-today-row wx-task-row">
            <span class="wx-dot" :class="rv.state === 'mastered' ? 'wx-dot-deep' : 'wx-dot-light'"></span>
            <span class="wx-today-task-title">{{ rv.kp }}</span>
            <span class="wx-today-block">{{ rv.state === 'mastered' ? '已掌握' : '在学' }}</span>
            <span class="wx-today-rel">{{ rv.rel }}</span>
            <button
              class="wx-today-btn wx-pressable"
              :disabled="reviewingKp !== null"
              @click="onReview(rv)"
            >
              {{ reviewingKp === rv.kp ? '凑题中…' : '凑题复习' }}
            </button>
          </li>
        </ul>
        <div v-else class="wx-today-empty">暂无需要复习的知识点</div>
        <div v-if="reviewError" class="wx-today-err">{{ reviewError }}</div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wx-today {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 14px;
  animation: wx-today-in 0.28s var(--wx-ease-spring);
}
@keyframes wx-today-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.wx-today-checkin {
  padding: 9px 10px;
  border-radius: var(--wx-radius-md);
}

/* 栏化：今日任务 / 今日复习（单行标题，默认收起） */
.wx-today-bar {
  border-radius: var(--wx-radius-md);
  overflow: hidden;
}
.wx-today-bar-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  color: var(--wx-text-primary);
  text-align: left;
}
.wx-today-bar-head svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--wx-color-primary-soft);
}
.wx-today-bar-title {
  flex-shrink: 0;
  font-size: 13.5px;
  font-weight: 600;
}
.wx-today-bar-tag {
  flex-shrink: 0;
  min-width: 18px;
  padding: 1px 6px;
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  text-align: center;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-pill);
}
.wx-today-bar-date {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-today-bar-caret {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--wx-text-tertiary);
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-today-bar.open .wx-today-bar-caret { transform: rotate(180deg); }
.wx-today-bar-body {
  padding: 0 10px 10px;
  border-top: 1px dashed var(--wx-border-soft);
}
.wx-today-bar-body .wx-today-list { padding-top: 8px; }

/* 任务 / 复习行 */
.wx-today-list { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; }
.wx-today-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  padding: 7px 9px;
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-today-task-title {
  flex: 1 1 auto;
  min-width: 100px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-today-block {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--wx-text-tertiary);
  padding: 2px 8px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-today-nodoc { flex-shrink: 0; font-size: 10px; color: var(--wx-color-amber); }
.wx-today-rel { flex-shrink: 0; font-size: 10.5px; font-family: var(--wx-font-mono); color: var(--wx-text-muted); }

.wx-today-btn {
  flex-shrink: 0;
  padding: 5px 13px;
  border-radius: var(--wx-radius-pill);
  font-size: 12px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
}
.wx-today-btn:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-today-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.wx-today-btn-primary {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-today-btn-primary:hover { background: color-mix(in srgb, var(--wx-color-primary) 20%, transparent); }

.wx-today-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 4px 4px;
  font-size: 12px;
  color: var(--wx-text-muted);
}
.wx-today-next { font-size: 11px; color: var(--wx-color-primary-soft); }

/* 打卡：一键打卡（学习时间与项目自动记录） */
.wx-checkin-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.wx-checkin-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wx-checkin-mark {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  border-radius: 50%;
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-checkin-mark.done {
  color: var(--wx-color-yanqing);
  border-color: color-mix(in srgb, var(--wx-color-yanqing) 50%, transparent);
  background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent);
}
.wx-checkin-label {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-checkin-status {
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-checkin-go {
  flex-shrink: 0;
  padding: 6px 18px;
  border-radius: var(--wx-radius-pill);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border: none;
}
.wx-checkin-go.done {
  color: var(--wx-color-yanqing);
  background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-yanqing) 45%, transparent);
}
.wx-checkin-go:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

/* 同步条 */
.wx-today-sync { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.wx-today-link {
  font-size: 11.5px;
  color: var(--wx-color-primary-soft);
  padding: 4px 12px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-today-link:hover { background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); }
.wx-today-link:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.wx-today-note { font-size: 11px; color: var(--wx-text-muted); }
.wx-today-err { font-size: 11px; color: var(--wx-color-vermilion); }
</style>
