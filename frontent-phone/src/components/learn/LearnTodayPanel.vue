<script setup lang="ts">
// 今日面板（移动端）：A) 今日任务 B) 今日复习 C) 今日打卡
// 〔自桌面端 components/learn/TodayPanel.vue 移植，补齐任务操作 / 复习凑题 / 云端同步〕
// 硬约束：挂载不发任何网络请求；今天的数据一律读本地缓存，远程读写仅由用户显式点击触发
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useLearnStore } from '@/stores/learnStore'
import { useMasteryStore } from '@/stores/masteryStore'
import { useQuizStore } from '@/stores/quizStore'
import { useCheckinStore, getStudiedTaskIds, getStudyMinutes, markTaskStudied } from '@/stores/checkinStore'
import { useAuthStore } from '@/stores/authStore'
import { questionsBySkillPath, questionsByLeaf, searchLeaves } from '@/services/questionService'
import type { LearnStatus, OutlineTask, Question } from '@/types'

const emit = defineEmits<{ (e: 'open-doc'): void }>()

const router = useRouter()
const learnStore = useLearnStore()
const mastery = useMasteryStore()
const quiz = useQuizStore()
const checkin = useCheckinStore()
const authStore = useAuthStore()

const HOUR = 60 * 60 * 1000
/** 复习间隔阈值：距上次答题超过 20 小时视为待复习 */
const REVIEW_GAP = 20 * HOUR

const NOW = new Date()
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'][NOW.getDay()]
const TODAY_LABEL = `${NOW.getMonth() + 1} 月 ${NOW.getDate()} 日 · 周${WEEKDAY}`
const TODAY = `${NOW.getFullYear()}-${`${NOW.getMonth() + 1}`.padStart(2, '0')}-${`${NOW.getDate()}`.padStart(2, '0')}`

function statusClass(s: LearnStatus): string {
  return s === 'deep' ? 'ltd-dot-deep' : s === 'light' ? 'ltd-dot-light' : 'ltd-dot-unknown'
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
  emit('open-doc')
}
function onQuiz(task: OutlineTask) {
  markTaskStudied(task.id)
  void router.push(`/questions?skill=${encodeURIComponent(task.title)}&title=${encodeURIComponent(task.title)}`)
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
    quiz.startWithQuestions(item.kp, items, 0, task?.id ? { skillId: task.id } : undefined)
    void router.push('/quiz')
  } catch (e) {
    reviewError.value = e instanceof Error ? e.message : '凑题失败'
  } finally {
    reviewingKp.value = null
  }
}

// ===== C) 今日打卡：一键打卡，学习时间与学习项目自动记录 =====
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
  if (authStore.user) {
    try {
      await showConfirmDialog({
        title: '同步云端',
        message: '打卡将同步到云端，是否继续？'
      })
    } catch {
      return
    }
  }
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
  try {
    await showConfirmDialog({
      title: '同步打卡',
      message: '将从云端拉取打卡记录（本地为准合并），是否继续？'
    })
  } catch {
    return
  }
  syncing.value = true
  try {
    await checkin.loadRecent(120)
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div class="ltd">
    <!-- A) 今日任务 -->
    <section class="ltd-card">
      <div class="ltd-head">
        <span class="ltd-title">今日任务</span>
        <span class="ltd-date">{{ TODAY_LABEL }}</span>
      </div>

      <ul v-if="todayTasks.length" class="ltd-list">
        <li v-for="tk in todayTasks" :key="tk.task.id" class="ltd-row">
          <div class="ltd-row-top" @click="onLearn(tk.task)">
            <span class="ltd-dot" :class="statusClass(tk.task.status)"></span>
            <div class="ltd-row-main">
              <span class="ltd-task-title" :class="{ done: tk.task.status === 'deep' }">{{ tk.task.title }}</span>
              <span class="ltd-row-sub">
                {{ tk.blockName }}<template v-if="!hasDoc(tk.task.id)"> · 未生成文档</template>
              </span>
            </div>
          </div>
          <div class="ltd-row-actions">
            <button class="ltd-btn" @click="onLearn(tk.task)">学文档</button>
            <button class="ltd-btn ltd-btn-primary" @click="onQuiz(tk.task)">去刷题</button>
          </div>
        </li>
      </ul>
      <div v-else-if="learnStore.plan.length === 0" class="ltd-empty">暂无学习计划</div>
      <div v-else class="ltd-empty">
        <span>今日不在任何模块计划期内</span>
        <span v-if="nextBlock" class="ltd-next">最近将开始：{{ nextBlock.name }}（{{ nextBlock.startDate }}）</span>
      </div>
    </section>

    <!-- B) 今日复习 -->
    <section class="ltd-card">
      <div class="ltd-head">
        <span class="ltd-title">今日复习</span>
        <span class="ltd-date">间隔 20 小时以上 · {{ reviewItems.length }} 项</span>
      </div>
      <ul v-if="reviewItems.length" class="ltd-list">
        <li v-for="rv in reviewItems" :key="rv.kp" class="ltd-row">
          <div class="ltd-row-top">
            <span class="ltd-dot" :class="rv.state === 'mastered' ? 'ltd-dot-deep' : 'ltd-dot-light'"></span>
            <div class="ltd-row-main">
              <span class="ltd-task-title">{{ rv.kp }}</span>
              <span class="ltd-row-sub">{{ rv.state === 'mastered' ? '已掌握' : '在学' }} · {{ rv.rel }}</span>
            </div>
          </div>
          <div class="ltd-row-actions">
            <button class="ltd-btn" :disabled="reviewingKp !== null" @click="onReview(rv)">
              {{ reviewingKp === rv.kp ? '凑题中…' : '凑题复习' }}
            </button>
          </div>
        </li>
      </ul>
      <div v-else class="ltd-empty">暂无需要复习的知识点</div>
      <div v-if="reviewError" class="ltd-err">{{ reviewError }}</div>
    </section>

    <!-- C) 今日打卡 -->
    <section class="ltd-card">
      <div class="ltd-checkin">
        <span class="ltd-checkin-mark" :class="{ done: !!checkin.todayRecord }">✓</span>
        <div class="ltd-checkin-info">
          <span class="ltd-checkin-label">今日打卡</span>
          <span class="ltd-checkin-status">
            已学 {{ autoMinutes }} 分钟 · {{ autoTaskIds.length }} 项 · 连续 {{ checkin.streak }} 天
          </span>
        </div>
        <button
          class="ltd-checkin-go"
          :class="{ done: !!checkin.todayRecord }"
          :disabled="saving"
          @click="quickCheckin"
        >
          {{ saving ? '打卡中…' : checkin.todayRecord ? '已打卡' : '打卡' }}
        </button>
      </div>
      <div class="ltd-sync">
        <button class="ltd-sync-btn" :disabled="syncing" @click="onSync">
          {{ syncing ? '同步中…' : '同步云端打卡记录' }}
        </button>
        <span v-if="checkin.pendingLocal" class="ltd-note">本地有未同步记录</span>
        <span v-if="!authStore.user" class="ltd-note">未登录：打卡仅保存在本地</span>
        <span v-if="savedTip" class="ltd-note">{{ savedTip }}</span>
      </div>
      <div v-if="checkin.error" class="ltd-err">{{ checkin.error }}</div>
    </section>
  </div>
</template>

<style scoped>
.ltd {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ltd-card {
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
}
.ltd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed #ebedf0;
}
.ltd-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
}
.ltd-date {
  font-size: 10.5px;
  color: #969799;
}
.ltd-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 10px;
  margin: 0;
  list-style: none;
}
.ltd-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
}
.ltd-row-top {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.ltd-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.ltd-dot-deep {
  background: #22c55e;
}
.ltd-dot-light {
  background: #fbbf24;
}
.ltd-dot-unknown {
  background: #c8c9cc;
}
.ltd-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ltd-task-title {
  font-size: 13px;
  color: #1f2329;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltd-task-title.done {
  color: #969799;
  text-decoration: line-through;
}
.ltd-row-sub {
  font-size: 10.5px;
  color: #969799;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltd-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
}
.ltd-btn {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid #ebedf0;
  background: #fff;
  font-size: 11.5px;
  color: #646566;
}
.ltd-btn-primary {
  color: #4f6ef2;
  border-color: rgba(79, 110, 242, 0.4);
  background: rgba(79, 110, 242, 0.07);
  font-weight: 600;
}
.ltd-btn:disabled {
  opacity: 0.5;
}
.ltd-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 4px 4px;
  font-size: 12.5px;
  color: #969799;
}
.ltd-next {
  font-size: 11.5px;
  color: #4f6ef2;
}
.ltd-checkin {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ltd-checkin-mark {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #4f6ef2;
  border: 1px solid rgba(79, 110, 242, 0.4);
  border-radius: 50%;
  background: rgba(79, 110, 242, 0.08);
}
.ltd-checkin-mark.done {
  color: #16a34a;
  border-color: rgba(34, 197, 94, 0.5);
  background: rgba(34, 197, 94, 0.1);
}
.ltd-checkin-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ltd-checkin-label {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2329;
}
.ltd-checkin-status {
  font-size: 11px;
  color: #969799;
}
.ltd-checkin-go {
  flex-shrink: 0;
  padding: 7px 20px;
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
}
.ltd-checkin-go.done {
  color: #16a34a;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.4);
}
.ltd-checkin-go:disabled {
  opacity: 0.55;
}
.ltd-sync {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.ltd-sync-btn {
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid rgba(79, 110, 242, 0.4);
  background: rgba(79, 110, 242, 0.07);
  font-size: 11px;
  color: #4f6ef2;
}
.ltd-sync-btn:disabled {
  opacity: 0.55;
}
.ltd-note {
  font-size: 10.5px;
  color: #969799;
}
.ltd-err {
  margin-top: 6px;
  font-size: 11px;
  color: #ee0a24;
}
</style>
