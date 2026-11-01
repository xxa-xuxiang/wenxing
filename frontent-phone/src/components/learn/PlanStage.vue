<script setup lang="ts">
// 计划制定（向导第 5 步 / 计划管理）：主画布两视图（计划文档 / 模块排期）；Agent 过程抽屉
// 移动端单栏版：去桌面甘特图（学习日历属非目标）与任务卡微反馈；计划文档用共享 markdown 渲染
import { computed, ref, watch } from 'vue'
import { showConfirmDialog } from 'vant'
import { useLearnStore } from '@/stores/learnStore'
import TaskCardPreview from '@/components/learn/TaskCardPreview.vue'
import { buildPlanMarkdown } from '@/services/planScheduler'
import { renderMarkdown } from '@/utils/markdown'
import type { LearnStatus, OutlineTask, PlanBlock } from '@/types'

// mode：wizard = 向导内（确认计划并推进）；manage = 计划管理（仅保存排期）
const props = withDefaults(defineProps<{ mode?: 'wizard' | 'manage' }>(), { mode: 'wizard' })
const emit = defineEmits<{ (e: 'done'): void }>()

const learnStore = useLearnStore()

const DAY_MIN = 1
const DAY_MAX = 60
const PRIORITIES: Array<'S' | 'A' | 'B'> = ['S', 'A', 'B']

const regenerating = ref(false)

type PlanView = 'doc' | 'blocks'
const view = ref<PlanView>(learnStore.planDoc ? 'doc' : 'blocks')

const outlineById = computed(() => new Map(learnStore.outline.map((t) => [t.id, t])))
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

// 计划文档：优先 skill 五件套，旧方案回退模块 Markdown
const docMarkdown = computed(() =>
  learnStore.planDoc || buildPlanMarkdown(learnStore.plan, learnStore.selectedDomain, learnStore.outline)
)
const docHtml = computed(() => renderMarkdown(docMarkdown.value))

// Agent 生成完成后自动切到「计划文档」
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
  try {
    await showConfirmDialog({
      title: '重新生成计划',
      message: '将调用 AI 重新排期并覆盖当前计划，是否继续？'
    })
  } catch {
    return
  }
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
  try {
    await showConfirmDialog({
      title: 'AI 深度规划',
      message: '将调用 AI 深度规划生成学习计划文档与排期，是否继续？'
    })
  } catch {
    return
  }
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

const savedTip = ref('')
let savedTimer: number | null = null
function onSaveManage() {
  learnStore.persist()
  savedTip.value = '排期已保存'
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => {
    savedTip.value = ''
  }, 2400)
}

// 任务卡四字段预览（样例数据，不触碰业务状态）
const previewOpen = ref(false)
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
        <span v-if="busy" class="wx-planstage-running">
          <span class="wx-planstage-running-dot"></span>Agent 运行中
        </span>
        <button class="wx-planstage-agentbtn wx-pressable" @click="learnStore.openAgentDrawer()">Agent</button>
      </div>
    </div>

    <!-- 摘要 + 视图切换 -->
    <div v-if="summary" class="wx-planstage-meta">
      <span class="wx-planstage-stat">{{ summary.count }} 模块</span>
      <span class="wx-planstage-stat">{{ summary.totalDays }} 天</span>
      <span class="wx-planstage-range">{{ summary.start }} ~ {{ summary.end }}</span>
    </div>
    <div class="wx-planstage-views">
      <button
        class="wx-planstage-viewbtn wx-pressable"
        :class="{ active: view === 'doc' }"
        @click="view = 'doc'"
      >计划文档</button>
      <button
        class="wx-planstage-viewbtn wx-pressable"
        :class="{ active: view === 'blocks' }"
        :disabled="blocks.length === 0"
        @click="view = 'blocks'"
      >模块排期</button>
      <button class="wx-planstage-viewbtn wx-pressable" @click="previewOpen = true">任务卡预览</button>
    </div>

    <!-- 首次生成（尚无计划） -->
    <div v-if="busy && blocks.length === 0" class="wx-planstage-center">
      <div class="wx-planstage-center-mark wx-breathe">✦</div>
      <div>规划 Agent 正在按五阶段生成学习计划…</div>
    </div>

    <div v-else-if="blocks.length === 0" class="wx-planstage-center">
      <div class="wx-planstage-center-mark">✧</div>
      <div>{{ learnStore.planDoc ? '暂无学习计划' : '尚未生成学习计划' }}</div>
      <div v-if="!learnStore.planDoc" class="wx-planstage-center-sub">
        先由 AI 深度规划生成计划文档与排期，再确认进入学习
      </div>
      <div v-if="learnStore.planError" class="wx-planstage-error">{{ learnStore.planError }}</div>
      <button
        v-if="!learnStore.planDoc"
        class="wx-btn-gradient wx-pressable wx-planstage-generate"
        :disabled="busy"
        @click="onGeneratePlan"
      >{{ busy ? 'AI 规划中…' : 'AI 深度规划生成计划' }}</button>
    </div>

    <!-- 计划文档 -->
    <div v-else-if="view === 'doc'" class="wx-planstage-doc" v-html="docHtml"></div>

    <!-- 模块卡片列表 -->
    <div v-else class="wx-planstage-body">
      <div v-for="vm in blocks" :key="vm.block.id" class="wx-planstage-block">
        <div class="wx-planstage-block-head">
          <span class="wx-planstage-block-index">{{ vm.index + 1 }}</span>
          <span class="wx-planstage-block-name">{{ vm.block.name }}</span>
          <span v-if="vm.rate !== null" class="wx-planstage-rate" :class="{ warn: vm.rate < 0.6 }">
            {{ Math.round(vm.rate * 100) }}%
          </span>
        </div>
        <div class="wx-planstage-block-range">{{ vm.block.startDate }} ~ {{ vm.block.endDate }}</div>
        <div class="wx-planstage-block-goal">目标：{{ vm.block.goal }}</div>
        <div class="wx-planstage-block-acc">验收：{{ vm.block.acceptance }}</div>

        <ul class="wx-planstage-block-tasks">
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
            >{{ p }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="wx-planstage-foot">
      <span v-if="savedTip" class="wx-planstage-saved">{{ savedTip }}</span>
      <span v-else-if="props.mode === 'manage'" class="wx-planstage-hint">排期改动即时生效</span>
      <button class="wx-planstage-regen wx-pressable" :disabled="busy" @click="onRegenerate">
        {{ busy ? '生成中…' : '重新生成' }}
      </button>
      <button
        v-if="props.mode === 'wizard'"
        class="wx-btn-gradient wx-pressable wx-planstage-submit"
        :disabled="busy || learnStore.plan.length === 0"
        @click="onConfirm"
      >确认计划 →</button>
      <button v-else class="wx-btn-gradient wx-pressable wx-planstage-submit" :disabled="busy" @click="onSaveManage">
        保存排期
      </button>
    </div>

    <TaskCardPreview :open="previewOpen" @close="previewOpen = false" />
  </div>
</template>

<style scoped>
.wx-planstage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px 14px 0;
}
.wx-planstage-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px 9px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-planstage-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-family: var(--wx-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-primary);
  letter-spacing: 0.04em;
}
.wx-planstage-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 6px var(--wx-color-primary));
}
.wx-planstage-title-sub {
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--wx-text-tertiary);
  padding: 1px 8px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}
.wx-planstage-head-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}
.wx-planstage-running {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
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
.wx-planstage-agentbtn {
  padding: 5px 11px;
  border-radius: var(--wx-radius-pill);
  font-size: 11.5px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-planstage-meta {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.wx-planstage-stat,
.wx-planstage-range {
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
  padding: 2px 8px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-planstage-range {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
}
.wx-planstage-views {
  flex-shrink: 0;
  display: flex;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: none;
}
.wx-planstage-views::-webkit-scrollbar {
  display: none;
}
.wx-planstage-viewbtn {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: var(--wx-radius-pill);
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  white-space: nowrap;
}
.wx-planstage-viewbtn.active {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
  border-color: var(--wx-border-glow);
}
.wx-planstage-viewbtn:disabled {
  opacity: 0.4;
}

/* 计划文档 */
.wx-planstage-doc {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 4px 4px 20px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--wx-text-secondary);
  word-break: break-word;
}
.wx-planstage-doc :deep(h1) {
  margin: 4px 0 12px;
  font-family: var(--wx-font-serif);
  font-size: 19px;
  color: var(--wx-text-primary);
}
.wx-planstage-doc :deep(h2) {
  margin: 18px 0 8px;
  padding-left: 9px;
  border-left: 2px solid var(--wx-color-primary);
  font-size: 15px;
  color: var(--wx-text-primary);
}
.wx-planstage-doc :deep(h3) {
  margin: 12px 0 5px;
  font-size: 13.5px;
  color: var(--wx-color-primary-soft);
}
.wx-planstage-doc :deep(h4) {
  margin: 10px 0 4px;
  font-size: 13px;
  color: var(--wx-text-primary);
}
.wx-planstage-doc :deep(blockquote) {
  margin: 9px 0;
  padding: 7px 11px;
  border-left: 2px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  color: var(--wx-text-tertiary);
  font-size: 11.5px;
}
.wx-planstage-doc :deep(.wx-md-table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 9px 0;
  border-collapse: collapse;
  font-size: 11.5px;
}
.wx-planstage-doc :deep(.wx-md-table th),
.wx-planstage-doc :deep(.wx-md-table td) {
  padding: 6px 8px;
  border: 1px solid var(--wx-border-soft);
  text-align: left;
  vertical-align: top;
  white-space: normal;
}
.wx-planstage-doc :deep(.wx-md-table th) {
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  color: var(--wx-text-primary);
}
.wx-planstage-doc :deep(ul),
.wx-planstage-doc :deep(ol) {
  margin: 5px 0;
  padding-left: 20px;
}
.wx-planstage-doc :deep(strong) {
  color: var(--wx-text-primary);
}
.wx-planstage-doc :deep(pre.wx-code-block) {
  margin: 9px 0;
  padding: 9px 11px;
  overflow-x: auto;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
  font-size: 11.5px;
}
.wx-planstage-doc :deep(code) {
  font-family: var(--wx-font-mono);
  font-size: 11.5px;
  padding: 1px 5px;
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border-radius: 3px;
  color: var(--wx-color-primary-soft);
}
.wx-planstage-doc :deep(pre code) {
  background: transparent;
  padding: 0;
  color: var(--wx-text-primary);
}

.wx-planstage-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  padding: 20px;
  text-align: center;
  font-size: 13.5px;
  color: var(--wx-text-secondary);
}
.wx-planstage-center-mark {
  font-size: 38px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 12px var(--wx-color-primary));
}
.wx-planstage-center-sub {
  font-size: 11.5px;
  color: var(--wx-text-muted);
}
.wx-planstage-error {
  max-width: 100%;
  padding: 8px 11px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--wx-color-vermilion);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent);
  border-radius: 6px;
}
.wx-planstage-generate {
  margin-top: 4px;
  padding: 10px 22px;
  font-size: 13px;
}

/* 模块排期 */
.wx-planstage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 2px 14px;
}
.wx-planstage-block {
  padding: 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-planstage-block-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.wx-planstage-block-index {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-size: 10.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wx-planstage-block-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-planstage-rate {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-yanqing);
  padding: 1px 7px;
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
  margin-top: 3px;
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-planstage-block-goal,
.wx-planstage-block-acc {
  margin-top: 5px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--wx-text-tertiary);
}
.wx-planstage-block-acc {
  color: var(--wx-color-yanqing);
  opacity: 0.9;
}
.wx-planstage-block-tasks {
  margin: 7px 0 0;
  padding: 7px 0 0;
  border-top: 1px dashed var(--wx-border-soft);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wx-planstage-block-tasks li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
}
.wx-planstage-task-title {
  flex: 1;
  min-width: 0;
  color: var(--wx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-planstage-task-state {
  flex-shrink: 0;
  font-size: 9.5px;
  color: var(--wx-text-muted);
}

/* 编辑控件 */
.wx-planstage-controls {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--wx-border-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.wx-planstage-days {
  display: flex;
  align-items: center;
  gap: 5px;
}
.wx-planstage-step {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  font-size: 14px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-planstage-step:disabled {
  opacity: 0.35;
}
.wx-planstage-days-input {
  width: 52px;
  padding: 4px 7px;
  text-align: center;
  font-family: var(--wx-font-mono);
  font-size: 12px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
  outline: none;
}
.wx-planstage-days-unit {
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.wx-planstage-pri {
  display: flex;
  align-items: center;
  gap: 5px;
}
.wx-planstage-pri-label {
  font-size: 10.5px;
  color: var(--wx-text-tertiary);
}
.wx-planstage-pri-btn {
  width: 27px;
  height: 25px;
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 700;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
}
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
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 0 calc(9px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--wx-border-soft);
}
.wx-planstage-saved {
  flex: 1;
  font-size: 11px;
  color: var(--wx-color-yanqing);
}
.wx-planstage-hint {
  flex: 1;
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.wx-planstage-regen {
  flex-shrink: 0;
  padding: 10px 14px;
  border-radius: var(--wx-radius-pill);
  font-size: 12px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  background: transparent;
}
.wx-planstage-regen:disabled {
  opacity: 0.5;
}
.wx-planstage-submit {
  flex: 1;
  padding: 10px 12px;
  font-size: 12.5px;
}
.wx-planstage-submit:disabled {
  opacity: 0.4;
}
</style>
