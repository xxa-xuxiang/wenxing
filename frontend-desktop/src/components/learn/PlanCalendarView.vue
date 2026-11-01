<script setup lang="ts">
// 学习日历（页面内分栏视图，非模态）：左边完整学习计划，右边甘特图（纯 SVG 手绘）+ 甘特图下方日程表
// v1.3：聚合全部学习计划方案（不是只显示当前激活方案）；每套方案一种配色，甘特图按方案着色
// 进度按模块内「已掌握（读完文档）任务比例」填充；今日线在范围内时标出
import { computed, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { useOverlay } from '@/composables/useOverlay'
import type { OutlineTask, PlanBlock, PlanScheme } from '@/types'

// embedded：内联嵌入形态（由 PlanBoard Tab 使用），隐藏关闭按钮、不接管 Esc
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const emit = defineEmits<{ close: [] }>()

const learnStore = useLearnStore()

// 页面内视图：仅保留 Esc 关闭，不监听外部点击（非浮层，无遮罩）
// embedded 时不接管 Esc（交由外层浮层处理），也不 emit close
useOverlay({
  onClose: () => emit('close'),
  closeOnOutside: false,
  closeOnEsc: !props.embedded
})

const DAY = 24 * 60 * 60 * 1000

function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

// 每套方案一种配色（循环取用）
const PALETTE = ['#818cf8', '#2dd4bf', '#c084fc', '#fbbf24', '#f87171', '#34d399', '#60a5fa', '#fb923c']

// 模块视图模型：补齐任务列表、完成度、所属方案
interface BlockVM extends PlanBlock {
  tasks: OutlineTask[]
  done: number
  schemeName: string
  schemeId: string
  color: string
}

// 全部方案聚合：激活方案用即时顶层字段（归档快照可能滞后），其余用归档快照
const liveId = computed(() => learnStore.activePlanId ?? '__active__')
const sourceSchemes = computed<PlanScheme[]>(() =>
  learnStore.allSchemes.map((s) =>
    s.id === liveId.value ? { ...s, outline: learnStore.outline, plan: learnStore.plan } : s
  )
)

const schemeGroups = computed(() =>
  sourceSchemes.value
    .map((s, idx) => {
      const byId = new Map(s.outline.map((t) => [t.id, t]))
      const blocks: BlockVM[] = (s.plan ?? [])
        .map((b) => {
          const tasks = b.taskIds.map((id) => byId.get(id)).filter((t): t is OutlineTask => Boolean(t))
          return {
            ...b,
            tasks,
            done: tasks.filter((t) => t.status !== 'unknown').length,
            schemeName: s.name,
            schemeId: s.id,
            color: PALETTE[idx % PALETTE.length]
          }
        })
        .filter((b) => b.tasks.length > 0)
      return { scheme: s, color: PALETTE[idx % PALETTE.length], blocks }
    })
    .filter((g) => g.blocks.length > 0)
)

const blocks = computed<BlockVM[]>(() => schemeGroups.value.flatMap((g) => g.blocks))

// ===== 甘特图布局（viewBox 单位） =====
const LABEL_W = 148
const CHART_W = 620
const PAD_R = 16
const TOP_H = 36
const ROW_H = 42
const BAR_H = 16
const BOTTOM_PAD = 14

const gantt = computed(() => {
  const list = blocks.value
  if (list.length === 0) return null
  const minStart = Math.min(...list.map((b) => parseDay(b.startDate).getTime()))
  const maxEnd = Math.max(...list.map((b) => parseDay(b.endDate).getTime()))
  const totalDays = Math.max(1, Math.round((maxEnd - minStart) / DAY) + 1)
  const width = LABEL_W + CHART_W + PAD_R
  const height = TOP_H + list.length * ROW_H + BOTTOM_PAD

  const xOf = (t: number) => LABEL_W + ((t - minStart) / DAY / totalDays) * CHART_W
  const wOf = (days: number) => (days / totalDays) * CHART_W

  // 日期刻度：最多 6 个，均匀取整
  const tickCount = Math.min(6, totalDays)
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const dayOffset = tickCount === 1 ? 0 : Math.round((i * (totalDays - 1)) / (tickCount - 1))
    const t = minStart + dayOffset * DAY
    const d = new Date(t)
    return { x: xOf(t), label: `${d.getMonth() + 1}/${d.getDate()}` }
  })

  // 行：模块名 + 条形（含进度填充，按方案着色）
  const rows = list.map((b, i) => {
    const start = parseDay(b.startDate).getTime()
    const y = TOP_H + i * ROW_H + (ROW_H - BAR_H) / 2
    const ratio = b.done / Math.max(1, b.tasks.length)
    const w = Math.max(6, wOf(b.durationDays))
    return {
      key: `${b.schemeId}-${b.id}`,
      name: b.name.length > 9 ? `${b.name.slice(0, 9)}…` : b.name,
      fullName: `${b.schemeName} · ${b.name}`,
      color: b.color,
      x: xOf(start),
      y,
      w,
      pw: Math.max(ratio > 0 ? 4 : 0, w * ratio),
      label: `${b.startDate.slice(5).replace('-', '/')} ~ ${b.endDate.slice(5).replace('-', '/')}`,
      centerY: y + BAR_H / 2
    }
  })

  // 今日线（在排期范围内才显示）
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayT = today.getTime()
  const todayX = todayT >= minStart && todayT <= maxEnd + DAY ? xOf(Math.min(todayT, maxEnd)) : null

  return { width, height, ticks, rows, todayX, totalDays, minStart, maxEnd }
})

// 日程表：跨方案罗列（按起始日期排序）
const scheduleRows = computed(() =>
  [...blocks.value].sort((a, b) => parseDay(a.startDate).getTime() - parseDay(b.startDate).getTime())
)

const _now = new Date()
const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`
function dayState(b: BlockVM): 'done' | 'active' | 'future' {
  if (b.tasks.length > 0 && b.done === b.tasks.length) return 'done'
  if (b.startDate <= todayStr && todayStr <= b.endDate) return 'active'
  return 'future'
}

// ===== 月历（周一为每周起点；有计划的日期按方案配色标记圆点） =====
interface CalCell {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
  colors: string[]
}
const calCursor = ref(new Date())
function shiftMonth(delta: number) {
  const d = new Date(calCursor.value)
  d.setDate(1)
  d.setMonth(d.getMonth() + delta)
  calCursor.value = d
}
const CAL_WEEKS = ['一', '二', '三', '四', '五', '六', '日']
const calCells = computed<CalCell[]>(() => {
  const y = calCursor.value.getFullYear()
  const m = calCursor.value.getMonth()
  const offset = (new Date(y, m, 1).getDay() + 6) % 7 // 周一为起点
  const cells: CalCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - offset + i)
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const colors: string[] = []
    for (const b of blocks.value) {
      if (b.startDate <= ds && ds <= b.endDate && !colors.includes(b.color)) {
        colors.push(b.color)
        if (colors.length >= 4) break
      }
    }
    cells.push({ key: ds, day: d.getDate(), inMonth: d.getMonth() === m, isToday: ds === todayStr, colors })
  }
  return cells
})
</script>

<template>
  <div class="wx-plan" :class="{ 'wx-plan-embedded': props.embedded }">
    <!-- 头部 -->
    <div class="wx-plan-head">
      <div class="wx-plan-title">
        <span class="wx-plan-title-mark">✦</span>
        <span>学习日历</span>
        <span class="wx-plan-title-sub">
          全部计划 · {{ schemeGroups.length }} 套
        </span>
      </div>
      <button v-if="!props.embedded" class="wx-plan-close wx-pressable" title="返回工作台（Esc）" @click="$emit('close')">✕</button>
    </div>

    <!-- 生成中 -->
    <div v-if="learnStore.generatingPlan" class="wx-plan-empty">
      <div class="wx-plan-empty-mark">✦</div>
      <div>正在为你生成学习计划…</div>
    </div>
    <!-- 无计划 -->
    <div v-else-if="blocks.length === 0" class="wx-plan-empty">
      <div class="wx-plan-empty-mark">✧</div>
      <div>暂无学习计划</div>
      <div class="wx-plan-empty-sub">确认技能组后将自动生成分块学习计划</div>
    </div>

    <!-- 主体：左计划 / 右甘特 -->
    <div v-else class="wx-plan-body">
      <!-- 左：完整学习计划（按方案分组） -->
      <div class="wx-plan-list">
        <template v-for="g in schemeGroups" :key="g.scheme.id">
          <div class="wx-plan-scheme">
            <span class="wx-plan-scheme-dot" :style="{ background: g.color }"></span>
            <span class="wx-plan-scheme-name">{{ g.scheme.name }}</span>
            <span class="wx-plan-scheme-count">{{ g.blocks.length }} 模块</span>
          </div>
          <div v-for="b in g.blocks" :key="`${g.scheme.id}-${b.id}`" class="wx-plan-block" :style="{ borderLeftColor: g.color }">
            <div class="wx-plan-block-head">
              <span class="wx-plan-block-name">{{ b.name }}</span>
              <span class="wx-plan-block-days">{{ b.durationDays }} 天</span>
            </div>
            <div class="wx-plan-block-range">{{ b.startDate }} ~ {{ b.endDate }}</div>
            <div class="wx-plan-block-goal">目标：{{ b.goal }}</div>
            <div class="wx-plan-block-acc">验收：{{ b.acceptance }}</div>
            <ul class="wx-plan-block-tasks">
              <li v-for="t in b.tasks" :key="t.id">
                <span class="wx-dot" :class="t.status === 'unknown' ? 'wx-dot-unknown' : 'wx-dot-deep'"></span>
                <span class="wx-plan-task-title">{{ t.title }}</span>
                <span class="wx-plan-task-state">{{ t.status === 'unknown' ? '未学' : '已掌握' }}</span>
              </li>
            </ul>
          </div>
        </template>
      </div>

      <!-- 右：甘特图 + 图例 -->
      <div class="wx-plan-right">
        <div class="wx-plan-gantt">
          <div class="wx-plan-gantt-title">
            <span>甘特图</span>
            <span class="wx-plan-legend">
              <span v-for="g in schemeGroups" :key="g.scheme.id" class="wx-plan-legend-item">
                <span class="wx-plan-legend-dot" :style="{ background: g.color }"></span>{{ g.scheme.name }}
              </span>
            </span>
          </div>
          <div class="wx-plan-gantt-scroll">
            <svg
              v-if="gantt"
              :viewBox="`0 0 ${gantt.width} ${gantt.height}`"
              :width="gantt.width"
              :height="gantt.height"
              class="wx-gantt-svg"
            >
              <!-- 日期刻度 -->
              <g v-for="(tk, i) in gantt.ticks" :key="`t${i}`">
                <line
                  :x1="tk.x" :y1="TOP_H - 8" :x2="tk.x" :y2="gantt.height - BOTTOM_PAD + 4"
                  stroke="var(--wx-border-soft)" stroke-width="1"
                />
                <text :x="tk.x" :y="TOP_H - 14" class="wx-gantt-tick">{{ tk.label }}</text>
              </g>

              <!-- 行：模块条（按方案着色） -->
              <g v-for="r in gantt.rows" :key="r.key">
                <text :x="LABEL_W - 10" :y="r.centerY" class="wx-gantt-row-name">{{ r.name }}</text>
                <rect
                  :x="r.x" :y="r.y" :width="r.w" :height="BAR_H" :rx="BAR_H / 2"
                  :fill="r.color" fill-opacity="0.14" :stroke="r.color" stroke-opacity="0.45" stroke-width="1"
                >
                  <title>{{ r.fullName }} · {{ r.label }}</title>
                </rect>
                <rect
                  v-if="r.pw > 0"
                  :x="r.x" :y="r.y" :width="Math.min(r.pw, r.w)" :height="BAR_H" :rx="BAR_H / 2"
                  :fill="r.color" fill-opacity="0.85"
                >
                  <title>{{ r.fullName }} · 已掌握进度</title>
                </rect>
                <text :x="r.x + r.w + 6" :y="r.centerY" class="wx-gantt-row-date">{{ r.label }}</text>
              </g>

              <!-- 今日线 -->
              <g v-if="gantt.todayX !== null">
                <line
                  :x1="gantt.todayX" :y1="TOP_H - 8" :x2="gantt.todayX" :y2="gantt.height - BOTTOM_PAD + 4"
                  stroke="#2dd4bf" stroke-width="1.5" stroke-dasharray="4 3"
                />
                <text :x="gantt.todayX" :y="gantt.height - 2" class="wx-gantt-today">今天</text>
              </g>
            </svg>
          </div>
        </div>

        <!-- 甘特图下方：日程表 + 月历（并排，拉高） -->
        <div class="wx-plan-bottom">
          <div class="wx-plan-sched">
            <div class="wx-plan-sched-title">日程表</div>
            <div class="wx-plan-sched-scroll">
              <table class="wx-sched-table">
                <thead>
                  <tr>
                    <th>计划</th>
                    <th>模块</th>
                    <th>起止日期</th>
                    <th>天数</th>
                    <th>进度</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="b in scheduleRows" :key="`${b.schemeId}-${b.id}`" :class="`st-${dayState(b)}`">
                    <td class="wx-sched-scheme">
                      <span class="wx-plan-legend-dot" :style="{ background: b.color }"></span>{{ b.schemeName }}
                    </td>
                    <td class="wx-sched-name">{{ b.name }}</td>
                    <td class="wx-sched-range">{{ b.startDate }} ~ {{ b.endDate }}</td>
                    <td class="wx-sched-days">{{ b.durationDays }}</td>
                    <td class="wx-sched-prog">{{ b.done }}/{{ b.tasks.length }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 月历：有计划的日期按方案配色标记 -->
          <div class="wx-plan-month">
            <div class="wx-plan-month-head">
              <button class="wx-cal-nav wx-pressable" title="上个月" @click="shiftMonth(-1)">‹</button>
              <span class="wx-plan-month-title">{{ calCursor.getFullYear() }} 年 {{ calCursor.getMonth() + 1 }} 月</span>
              <button class="wx-cal-nav wx-pressable" title="下个月" @click="shiftMonth(1)">›</button>
            </div>
            <div class="wx-cal-weeks">
              <span v-for="w in CAL_WEEKS" :key="w">{{ w }}</span>
            </div>
            <div class="wx-cal-grid">
              <div
                v-for="c in calCells"
                :key="c.key"
                class="wx-cal-day"
                :class="{ 'is-dim': !c.inMonth, 'is-today': c.isToday, 'has-plan': c.colors.length > 0 }"
              >
                <span class="wx-cal-num">{{ c.day }}</span>
                <span class="wx-cal-dots">
                  <i v-for="(color, ci) in c.colors" :key="ci" :style="{ background: color }"></i>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wx-plan {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 88px;
  gap: 14px;
  animation: wx-plan-in 0.28s var(--wx-ease-spring);
}
@keyframes wx-plan-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 内联嵌入形态：占满父容器，收紧内边距 */
.wx-plan-embedded {
  padding: 14px 18px;
}
.wx-plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-plan-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--wx-font-serif);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.wx-plan-title-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 6px var(--wx-color-primary));
}
.wx-plan-title-sub {
  font-size: 12px;
  font-weight: 500;
  color: var(--wx-text-tertiary);
  padding: 2px 10px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}
.wx-plan-close {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-plan-close:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }

.wx-plan-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 15px;
  color: var(--wx-text-secondary);
}
.wx-plan-empty-mark {
  font-size: 40px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 12px var(--wx-color-primary));
  animation: wx-breathe 4s var(--wx-ease-in-out-soft) infinite alternate;
}
.wx-plan-empty-sub { font-size: 12px; color: var(--wx-text-muted); }

.wx-plan-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
}

/* 左：完整学习计划（按方案分组） */
.wx-plan-list {
  width: 360px;
  flex-shrink: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 4px;
}
.wx-plan-scheme {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 2px 0;
}
.wx-plan-scheme-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wx-plan-scheme-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-plan-scheme-count {
  font-size: 11px;
  color: var(--wx-text-muted);
  flex-shrink: 0;
}
.wx-plan-block {
  padding: 12px 14px;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-left: 3px solid var(--wx-color-primary);
}
.wx-plan-block-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-plan-block-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-plan-block-days {
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-primary-soft);
  padding: 1px 8px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
  flex-shrink: 0;
}
.wx-plan-block-range {
  margin-top: 4px;
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-plan-block-goal,
.wx-plan-block-acc {
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--wx-text-tertiary);
}
.wx-plan-block-acc { color: var(--wx-color-yanqing); opacity: 0.9; }
.wx-plan-block-tasks {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.wx-plan-block-tasks li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.wx-plan-task-title {
  flex: 1;
  min-width: 0;
  color: var(--wx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-plan-task-state {
  font-size: 10px;
  color: var(--wx-text-muted);
  flex-shrink: 0;
}

/* 右：甘特图 + 日程表 */
.wx-plan-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wx-plan-gantt {
  flex: 1 1 0;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
  padding: 12px 14px;
}
.wx-plan-gantt-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-secondary);
  margin-bottom: 8px;
}
.wx-plan-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--wx-text-muted);
}
.wx-plan-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-plan-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
  margin-right: 4px;
}
.wx-plan-gantt-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.wx-gantt-svg { display: block; }
.wx-gantt-tick {
  font-size: 10px;
  fill: var(--wx-text-muted);
  text-anchor: middle;
  font-family: var(--wx-font-mono);
}
.wx-gantt-row-name {
  font-size: 11px;
  fill: var(--wx-text-secondary);
  text-anchor: end;
  dominant-baseline: middle;
}
.wx-gantt-row-date {
  font-size: 10px;
  fill: var(--wx-text-muted);
  dominant-baseline: middle;
  font-family: var(--wx-font-mono);
}
.wx-gantt-today {
  font-size: 10px;
  fill: var(--wx-color-yanqing);
  text-anchor: middle;
}

/* 甘特图下方：日程表 + 月历（并排，拉高占满剩余高度） */
.wx-plan-bottom {
  flex: 1 1 0;
  min-height: 260px;
  display: flex;
  gap: 12px;
}
.wx-plan-sched {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
  padding: 10px 14px 6px;
}
.wx-plan-sched-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-secondary);
  margin-bottom: 6px;
}
.wx-plan-sched-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* 月历 */
.wx-plan-month {
  width: 300px;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
  padding: 10px 14px 12px;
}
.wx-plan-month-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.wx-plan-month-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-secondary);
  font-family: var(--wx-font-mono);
  letter-spacing: 0.04em;
}
.wx-cal-nav {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-cal-nav:hover { color: var(--wx-color-primary-soft); border-color: var(--wx-border-glow); }
.wx-cal-weeks {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 10px;
  color: var(--wx-text-muted);
  margin-bottom: 4px;
}
.wx-cal-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(6, 1fr);
  gap: 2px;
}
.wx-cal-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 0;
  border-radius: var(--wx-radius-sm);
  font-size: 11px;
  color: var(--wx-text-secondary);
}
.wx-cal-day.is-dim { opacity: 0.3; }
.wx-cal-day.has-plan { background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent); }
.wx-cal-num {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--wx-font-mono);
}
.wx-cal-day.is-today .wx-cal-num {
  color: var(--wx-text-on-accent);
  background: var(--wx-color-vermilion);
  border-radius: 50%;
  font-weight: 600;
}
.wx-cal-dots {
  display: flex;
  gap: 2px;
  height: 4px;
  margin-top: 2px;
}
.wx-cal-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
}
.wx-sched-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}
.wx-sched-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--wx-bg-deep) 92%, transparent);
  text-align: left;
  font-weight: 600;
  color: var(--wx-text-muted);
  padding: 6px 8px;
  border-bottom: 1px solid var(--wx-border-soft);
  white-space: nowrap;
}
.wx-sched-table td {
  padding: 6px 8px;
  border-bottom: 1px dashed var(--wx-border-soft);
  color: var(--wx-text-secondary);
  white-space: nowrap;
  vertical-align: middle;
}
.wx-sched-table tr:last-child td { border-bottom: none; }
.wx-sched-scheme { max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.wx-sched-name { color: var(--wx-text-primary); font-weight: 500; }
.wx-sched-range,
.wx-sched-days,
.wx-sched-prog {
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-sched-prog { text-align: right; }
.wx-sched-table tr.st-done .wx-sched-prog { color: var(--wx-color-yanqing); }
.wx-sched-table tr.st-active .wx-sched-name { color: var(--wx-color-primary-soft); }
.wx-sched-table tr.st-active .wx-sched-range { color: var(--wx-color-primary-soft); }
</style>
