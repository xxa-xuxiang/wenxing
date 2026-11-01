<script setup lang="ts">
// 阶段3 计划制定：主画布三视图（skill 五件套文档 / 模块排期 / 甘特图）；右侧抽屉看 Agent 过程
import { computed, ref, watch } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import PlanCalendarView from '@/components/learn/PlanCalendarView.vue'
import TaskCard from '@/components/TaskCard.vue'
import type { Task } from '@/components/TaskCard.vue'
import { buildPlanMarkdown } from '@/services/planScheduler'
import { FLAGS } from '@/config/flags'
import { submitFeedback, reportLearnerEvent, type FeedbackPayload } from '@/services/feedbackService'
import BlockEditorCore from '@/components/community/BlockEditorCore.vue'
import { markdownToBlocks } from '@/components/community/blocks'
import type { LearnStatus, OutlineTask, PlanBlock } from '@/types'

// mode：wizard = 向导内（确认计划并推进）；manage = 计划管理（仅保存排期）
const props = withDefaults(defineProps<{ mode?: 'wizard' | 'manage' }>(), { mode: 'wizard' })
const emit = defineEmits<{ (e: 'done'): void }>()

const learnStore = useLearnStore()

const DAY_MIN = 1
const DAY_MAX = 60
const PRIORITIES: Array<'S' | 'A' | 'B'> = ['S', 'A', 'B']

const regenerating = ref(false)

// 主画布视图：计划文档（skill 五件套）/ 模块排期 / 甘特图
type PlanView = 'doc' | 'blocks' | 'gantt'
const VIEWS: Array<{ key: PlanView; label: string }> = [
  { key: 'doc', label: '计划文档' },
  { key: 'blocks', label: '模块排期' },
  { key: 'gantt', label: '甘特图' }
]
const view = ref<PlanView>(learnStore.planDoc ? 'doc' : 'blocks')

const outlineById = computed(() => new Map(learnStore.outline.map((t) => [t.id, t])))
// 测评掌握率索引（按任务标题）
const rateByTitle = computed(() => {
  const m = new Map<string, number>()
  for (const it of learnStore.baselineResult?.items ?? []) m.set(it.title, it.rate)
  return m
})

interface BlockVM {
  block: PlanBlock
  index: number
  tasks: OutlineTask[]
  rate: number | null
  priority: 'S' | 'A' | 'B'
}
const blocks = computed<BlockVM[]>(() =>
  learnStore.plan.map((b, i) => {
    const tasks = b.taskIds
      .map((id) => outlineById.value.get(id))
      .filter((t): t is OutlineTask => Boolean(t))
    const rates = tasks
      .map((t) => rateByTitle.value.get(t.title))
      .filter((r): r is number => r !== undefined)
    const rate = rates.length > 0 ? rates.reduce((a, x) => a + x, 0) / rates.length : null
    return { block: b, index: i, tasks, rate, priority: b.priority ?? 'A' }
  })
)

// 顶部摘要：总模块数 / 总天数 / 计划区间
const summary = computed(() => {
  const list = learnStore.plan
  if (list.length === 0) return null
  return {
    count: list.length,
    totalDays: list.reduce((s, b) => s + b.durationDays, 0),
    start: list[0].startDate,
    end: list[list.length - 1].endDate
  }
})

const busy = computed(() => regenerating.value || learnStore.generatingPlan)

// 计划文档：优先 skill 五件套，旧方案回退模块 Markdown；用块编辑器只读查看
const docMarkdown = computed(() =>
  learnStore.planDoc || buildPlanMarkdown(learnStore.plan, learnStore.selectedDomain, learnStore.outline)
)
const docBlocks = computed(() => markdownToBlocks(docMarkdown.value))

// Agent 生成完成后自动切到「计划文档」（主画布以 skill 产物为主）
watch(
  () => [learnStore.planDoc, learnStore.generatingPlan] as const,
  () => {
    if (!busy.value && learnStore.planDoc) view.value = 'doc'
  }
)

function statusClass(s: LearnStatus): string {
  return s === 'deep' ? 'wx-dot-deep' : s === 'light' ? 'wx-dot-light' : 'wx-dot-unknown'
}

function changeDays(b: PlanBlock, delta: number) {
  const next = Math.min(DAY_MAX, Math.max(DAY_MIN, b.durationDays + delta))
  if (next === b.durationDays) return
  learnStore.updateBlock(b.id, { durationDays: next })
}
function onDaysInput(b: PlanBlock, e: Event) {
  const el = e.target as HTMLInputElement
  const n = Number(el.value)
  if (!Number.isFinite(n)) return
  const next = Math.min(DAY_MAX, Math.max(DAY_MIN, Math.round(n)))
  if (next === b.durationDays) return
  learnStore.updateBlock(b.id, { durationDays: next })
}
function setPriority(b: PlanBlock, p: 'S' | 'A' | 'B') {
  if ((b.priority ?? 'A') === p) return
  learnStore.updateBlock(b.id, { priority: p })
}

async function onRegenerate() {
  if (busy.value) return
  if (!window.confirm('重新生成将调用 AI 重新排期，是否继续？')) return
  regenerating.value = true
  try {
    await learnStore.regeneratePlan()
  } finally {
    regenerating.value = false
  }
}

/** 首次 AI 深度规划：确认后生成计划文档与排期（第 5 步主入口） */
async function onGeneratePlan() {
  if (busy.value) return
  if (!window.confirm('将调用 AI 深度规划生成学习计划文档与排期，是否继续？')) return
  regenerating.value = true
  try {
    await learnStore.regeneratePlan()
  } finally {
    regenerating.value = false
  }
}
function onConfirm() {
  if (busy.value) return
  learnStore.confirmPlan()
  emit('done')
}

// 管理态：排期改动已随 updateBlock 即时落盘，此处提供显式保存反馈
const savedTip = ref('')
let savedTimer: number | null = null
function onSaveManage() {
  learnStore.persist()
  savedTip.value = '排期已保存'
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => { savedTip.value = '' }, 2400)
}

// 任务卡四字段：老大纲数据没有新字段时降级为「标题 + 反馈条」
const replyByTask = ref<Record<string, string>>({})

function toTask(t: OutlineTask): Task {
  const ext = t as OutlineTask & Partial<Task>
  return {
    id: t.id,
    title: t.title,
    est_minutes: ext.est_minutes,
    scaffold_level: ext.scaffold_level,
    is_critical_path: ext.is_critical_path,
    onboarding_note: ext.onboarding_note,
    steps: ext.steps,
    resources: ext.resources,
    deliverable: ext.deliverable,
    acceptance: ext.acceptance,
    common_errors: ext.common_errors
  }
}

async function onFeedback(t: OutlineTask, payload: FeedbackPayload): Promise<void> {
  const res = await submitFeedback(payload)
  if (res.reply) replyByTask.value = { ...replyByTask.value, [t.id]: res.reply }
  reportLearnerEvent(payload.user_given === 'stuck' ? 'task_stuck' : 'task_complete', {
    task_id: t.id,
    reason_tag: payload.reason_tag
  })
}
</script>

<template>
  <div class="wx-planstage">
    <div class="wx-planstage-head">
      <div class="wx-planstage-title">
        <span class="wx-planstage-mark">✦</span>
        <span>学习计划</span>
        <span class="wx-planstage-title-sub">{{ learnStore.selectedDomain?.name }}</span>
      </div>
      <div class="wx-planstage-head-right">
        <template v-if="summary">
          <span class="wx-planstage-stat">{{ summary.count }} 个模块</span>
          <span class="wx-planstage-stat">{{ summary.totalDays }} 天</span>
          <span class="wx-planstage-range">{{ summary.start }} ~ {{ summary.end }}</span>
        </template>
        <span v-if="busy" class="wx-planstage-running">
          <span class="wx-planstage-running-dot"></span>Agent 运行中
        </span>
        <div class="wx-planstage-views">
          <button
            v-for="v in VIEWS"
            :key="v.key"
            class="wx-planstage-viewbtn wx-pressable"
            :class="{ active: view === v.key }"
            :disabled="v.key !== 'doc' && blocks.length === 0"
            @click="view = v.key"
          >{{ v.label }}</button>
        </div>
        <button
          class="wx-planstage-viewbtn wx-planstage-agentbtn wx-pressable"
          data-test="open-agent-drawer"
          title="查看规划 Agent 的决策依据与下一步"
          @click="learnStore.openAgentDrawer()"
        >Agent 过程</button>
      </div>
    </div>

    <!-- 首次生成（尚无计划）：主画布占位，详细过程见右侧抽屉 -->
    <div v-if="busy && blocks.length === 0" class="wx-planstage-center">
      <div class="wx-planstage-center-mark wx-breathe">✦</div>
      <div>规划 Agent 正在按五阶段生成学习计划…</div>
    </div>

    <!-- 无计划：第 5 步先跑 AI 深度规划 -->
    <div v-else-if="blocks.length === 0" class="wx-planstage-center">
      <div class="wx-planstage-center-mark">✧</div>
      <div>{{ learnStore.planDoc ? '暂无学习计划' : '尚未生成学习计划' }}</div>
      <div v-if="!learnStore.planDoc" class="wx-planstage-center-sub">
        先由 AI 深度规划生成计划文档与排期，再确认进入学习
      </div>
      <div v-if="learnStore.planError" class="wx-planstage-error" data-test="plan-error">
        {{ learnStore.planError }}
      </div>
      <button
        v-if="!learnStore.planDoc"
        class="wx-btn-gradient wx-pressable wx-planstage-generate"
        :disabled="busy"
        data-test="generate-plan"
        @click="onGeneratePlan"
      >{{ busy ? 'AI 规划中…' : 'AI 深度规划生成计划' }}</button>
    </div>

    <!-- 计划文档（skill 五件套，块编辑器只读查看） -->
    <div v-else-if="view === 'doc'" class="wx-planstage-doc" data-test="plan-doc-view">
      <BlockEditorCore :blocks="docBlocks" readonly />
    </div>

    <!-- 甘特图（PlanCalendarView 自带关闭按钮） -->
    <PlanCalendarView v-else-if="view === 'gantt'" class="wx-planstage-gantt" @close="view = 'blocks'" />

    <!-- 模块卡片列表（排期辅助视图） -->
    <div v-else class="wx-planstage-body">
      <div v-for="vm in blocks" :key="vm.block.id" class="wx-planstage-block">
        <div class="wx-planstage-block-head">
          <span class="wx-planstage-block-index">{{ vm.index + 1 }}</span>
          <span class="wx-planstage-block-name">{{ vm.block.name }}</span>
          <span
            v-if="vm.rate !== null"
            class="wx-planstage-rate"
            :class="{ warn: vm.rate < 0.6 }"
          >
            测评掌握率 {{ Math.round(vm.rate * 100) }}%
          </span>
        </div>
        <div class="wx-planstage-block-range">
          {{ vm.block.startDate }} ~ {{ vm.block.endDate }}
        </div>
        <div class="wx-planstage-block-goal">目标：{{ vm.block.goal }}</div>
        <div class="wx-planstage-block-acc">验收：{{ vm.block.acceptance }}</div>

        <div v-if="FLAGS.TASK_CARD_V2" class="wx-planstage-cards">
          <TaskCard
            v-for="t in vm.tasks"
            :key="t.id"
            :task="toTask(t)"
            :reply="replyByTask[t.id]"
            @feedback="onFeedback(t, $event)"
          />
        </div>
        <ul v-else class="wx-planstage-block-tasks">
          <li v-for="t in vm.tasks" :key="t.id">
            <span class="wx-dot" :class="statusClass(t.status)"></span>
            <span class="wx-planstage-task-title">{{ t.title }}</span>
            <span class="wx-planstage-task-state">{{ t.status === 'unknown' ? '未学' : t.status === 'light' ? '轻掌握' : '已掌握' }}</span>
          </li>
        </ul>

        <div class="wx-planstage-controls">
          <div class="wx-planstage-days">
            <button class="wx-planstage-step wx-pressable" :disabled="vm.block.durationDays <= DAY_MIN" @click="changeDays(vm.block, -1)">−</button>
            <input
              class="wx-planstage-days-input"
              type="number"
              :min="DAY_MIN"
              :max="DAY_MAX"
              :value="vm.block.durationDays"
              @change="onDaysInput(vm.block, $event)"
            />
            <span class="wx-planstage-days-unit">天</span>
            <button class="wx-planstage-step wx-pressable" :disabled="vm.block.durationDays >= DAY_MAX" @click="changeDays(vm.block, 1)">＋</button>
          </div>
          <div class="wx-planstage-pri">
            <span class="wx-planstage-pri-label">优先级</span>
            <button
              v-for="p in PRIORITIES"
              :key="p"
              class="wx-planstage-pri-btn wx-pressable"
              :class="[`pri-${p}`, { active: vm.priority === p }]"
              @click="setPriority(vm.block, p)"
            >
              {{ p }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="wx-planstage-foot">
      <span v-if="savedTip" class="wx-planstage-saved">{{ savedTip }}</span>
      <span v-else-if="props.mode === 'manage'" class="wx-planstage-hint">排期改动即时生效，可随时保存</span>
      <button class="wx-planstage-regen wx-pressable" :disabled="busy" @click="onRegenerate">
        {{ busy ? '重新排期中…' : '重新生成计划' }}
      </button>
      <button
        v-if="props.mode === 'wizard'"
        class="wx-btn-gradient wx-pressable wx-planstage-submit"
        :disabled="busy || docBlocks.length === 0 || learnStore.plan.length === 0"
        @click="onConfirm"
      >
        确认计划，开始学习 →
      </button>
      <button
        v-else
        class="wx-btn-gradient wx-pressable wx-planstage-submit"
        :disabled="busy"
        @click="onSaveManage"
      >
        保存排期
      </button>
    </div>
  </div>
</template>

<style scoped>
.wx-planstage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 88px;
  gap: 14px;
  animation: wx-planstage-in 0.28s var(--wx-ease-spring);
}
@keyframes wx-planstage-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.wx-planstage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-planstage-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--wx-font-serif);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.wx-planstage-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 6px var(--wx-color-primary));
}
.wx-planstage-title-sub {
  font-size: 12px;
  font-weight: 500;
  color: var(--wx-text-tertiary);
  padding: 2px 10px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}
.wx-planstage-head-right { display: flex; align-items: center; gap: 8px; }
.wx-planstage-stat {
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
  padding: 2px 10px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-planstage-range {
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-primary-soft);
  padding: 2px 10px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
}
.wx-planstage-running {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--wx-color-primary-soft);
  white-space: nowrap;
}
.wx-planstage-running-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--wx-color-primary);
  animation: wx-breathe 1.4s infinite;
}
.wx-planstage-views {
  display: flex;
  gap: 4px;
  padding: 2px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
}
.wx-planstage-viewbtn {
  padding: 5px 12px;
  border-radius: var(--wx-radius-pill);
  font-size: 12px;
  color: var(--wx-text-secondary);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.wx-planstage-viewbtn:hover:not(:disabled) { color: var(--wx-text-primary); }
.wx-planstage-viewbtn.active {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
  border-color: var(--wx-border-glow);
}
.wx-planstage-viewbtn:disabled { opacity: 0.4; cursor: not-allowed; }
.wx-planstage-agentbtn {
  border-color: var(--wx-border-glow);
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-planstage-agentbtn:hover { color: var(--wx-color-primary); }

/* 计划文档（skill 五件套）：v-html 内容需要 :deep */
.wx-planstage-doc {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px 40px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--wx-text-secondary);
}
.wx-planstage-doc :deep(h1) {
  margin: 4px 0 14px;
  font-family: var(--wx-font-serif);
  font-size: 22px;
  color: var(--wx-text-primary);
  letter-spacing: 0.04em;
}
.wx-planstage-doc :deep(h2) {
  margin: 22px 0 10px;
  padding-left: 10px;
  border-left: 2px solid var(--wx-color-primary);
  font-size: 16px;
  color: var(--wx-text-primary);
}
.wx-planstage-doc :deep(h3) {
  margin: 14px 0 6px;
  font-size: 14px;
  color: var(--wx-color-primary-soft);
}
.wx-planstage-doc :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 2px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  color: var(--wx-text-tertiary);
  font-size: 12px;
}
.wx-planstage-doc :deep(.wx-md-table) {
  width: 100%;
  margin: 10px 0;
  border-collapse: collapse;
  font-size: 12px;
}
.wx-planstage-doc :deep(.wx-md-table th),
.wx-planstage-doc :deep(.wx-md-table td) {
  padding: 7px 10px;
  border: 1px solid var(--wx-border-soft);
  text-align: left;
  vertical-align: top;
}
.wx-planstage-doc :deep(.wx-md-table th) {
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  color: var(--wx-text-primary);
  white-space: nowrap;
}
.wx-planstage-doc :deep(ul),
.wx-planstage-doc :deep(ol) {
  margin: 6px 0;
  padding-left: 22px;
}
.wx-planstage-doc :deep(strong) { color: var(--wx-text-primary); }

.wx-planstage-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 15px;
  color: var(--wx-text-secondary);
}
.wx-planstage-center-mark {
  font-size: 40px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 12px var(--wx-color-primary));
}
.wx-planstage-center-sub { font-size: 12px; color: var(--wx-text-muted); }
.wx-planstage-error {
  max-width: 560px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wx-color-vermilion);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent);
  border-radius: var(--wx-radius-sm);
}
.wx-planstage-generate { margin-top: 6px; padding: 10px 26px; font-size: 13px; }
.wx-planstage-generate:disabled { opacity: 0.5; cursor: not-allowed; transform: none; filter: none; }

.wx-planstage-gantt { flex: 1; min-height: 0; display: flex; }

.wx-planstage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}
.wx-planstage-block {
  padding: 14px 16px;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-planstage-block-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-planstage-block-index {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wx-planstage-block-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-planstage-rate {
  flex-shrink: 0;
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-yanqing);
  padding: 2px 10px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-yanqing) 35%, transparent);
}
.wx-planstage-rate.warn {
  color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
}
.wx-planstage-block-range {
  margin-top: 4px;
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-planstage-block-goal,
.wx-planstage-block-acc {
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--wx-text-tertiary);
}
.wx-planstage-block-acc { color: var(--wx-color-yanqing); opacity: 0.9; }

.wx-planstage-block-tasks {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

/* 任务卡四字段（开关 TASK_CARD_V2） */
.wx-planstage-cards {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wx-planstage-block-tasks li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.wx-planstage-task-title {
  flex: 1;
  min-width: 0;
  color: var(--wx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-planstage-task-state { font-size: 10px; color: var(--wx-text-muted); flex-shrink: 0; }

/* 编辑控件 */
.wx-planstage-controls {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--wx-border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.wx-planstage-days { display: flex; align-items: center; gap: 6px; }
.wx-planstage-step {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-planstage-step:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-planstage-step:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }
.wx-planstage-days-input {
  width: 54px;
  padding: 4px 8px;
  text-align: center;
  font-family: var(--wx-font-mono);
  font-size: 12px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  outline: none;
}
.wx-planstage-days-input:focus { border-color: var(--wx-border-glow); }
.wx-planstage-days-unit { font-size: 11px; color: var(--wx-text-muted); }

.wx-planstage-pri { display: flex; align-items: center; gap: 6px; }
.wx-planstage-pri-label { font-size: 11px; color: var(--wx-text-tertiary); }
.wx-planstage-pri-btn {
  width: 28px;
  height: 26px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-planstage-pri-btn:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-planstage-pri-btn.pri-S.active {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 75%, transparent);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 70%, transparent);
}
.wx-planstage-pri-btn.pri-A.active {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
}
.wx-planstage-pri-btn.pri-B.active {
  color: var(--wx-text-on-accent);
  background: rgba(90, 96, 128, 0.7);
  border-color: color-mix(in srgb, var(--wx-ink) 20%, transparent);
}

.wx-planstage-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 4px 0;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-planstage-saved {
  margin-right: auto;
  font-size: 11.5px;
  color: var(--wx-color-yanqing);
}
.wx-planstage-hint {
  margin-right: auto;
  font-size: 11.5px;
  color: var(--wx-text-muted);
}
.wx-planstage-regen {
  padding: 10px 20px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-planstage-regen:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-planstage-regen:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.wx-planstage-submit:disabled { opacity: 0.4; cursor: not-allowed; transform: none; filter: none; }
</style>
