<script lang="ts">
export interface AgentStep {
  key: string            // 内部键，不展示
  label: string          // 人话标签
  state: 'done' | 'running' | 'pending'
}
</script>

<script setup lang="ts">
/**
 * AgentPanel.vue —— 只暴露【决定 / 理由 / 下一步】，不暴露过程
 *
 * 整改对象：原面板显示「学习需求确认…涉及5个模块（S4/A1/B0）的优先级评分」
 *          「五阶段校验」等内部代号 —— 对用户零信息量，且制造焦虑。
 *
 * 铁律：
 * 1. 只消费后端结构化三元组 { decision, rationale, next_action }。
 * 2. 任何 S4 / A1 / B0 / "五阶段校验" 之类的字符串，一律不得出现在 UI。
 * 3. 后端还没改完时，用 CONVERT 表做兜底翻译（今晚可先上线，后端明天补）。
 */
import { computed } from 'vue'

const props = defineProps<{
  steps?: AgentStep[]
  decision?: string
  rationale?: string
  nextAction?: string
}>()

/* ---- 兜底翻译：后端仍返回内部键时，前端先翻成人话 ---- */
const CONVERT: Record<string, string> = {
  requirement: '已确认你的学习目标与约束',
  resource:    '正在匹配已审核的学习资源',
  planning:    '正在按你的时间预算排期',
  visual:      '正在生成可视化进度',
  followup:    '正在安排复习与跟进节奏',
  validate:    '已检查资源是否齐备、时长是否装得下、依赖是否成环'
}

const safeSteps = computed<AgentStep[]>(() =>
  (props.steps ?? []).map(s => ({
    key: s.key,
    label: CONVERT[s.key] ?? s.label ?? s.key,
    state: s.state
  }))
)

const progress = computed(() => {
  const list = safeSteps.value
  if (!list.length) return 0
  return Math.round((list.filter(s => s.state === 'done').length / list.length) * 100)
})

const runningLabel = computed(() => safeSteps.value.find(s => s.state === 'running')?.label ?? '')
</script>

<template>
  <aside class="nt-card nt-agent">
    <header class="nt-agent__head">
      <span class="nt-agent__title">规划进度</span>
      <span class="nt-badge nt-badge--muted">{{ progress }}%</span>
    </header>

    <div class="nt-progress">
      <div class="nt-progress__bar" :style="{ width: progress + '%' }" />
    </div>

    <!-- 步骤：人话，无代号 -->
    <ul class="nt-agent__steps">
      <li v-for="s in safeSteps" :key="s.key" :class="'is-' + s.state">
        <i />
        <span>{{ s.label }}</span>
      </li>
    </ul>

    <!-- 三元组：这才是用户要的 -->
    <section v-if="decision" class="nt-agent__block">
      <h4 class="nt-agent__label">决定</h4>
      <p>{{ decision }}</p>
    </section>
    <section v-if="rationale" class="nt-agent__block">
      <h4 class="nt-agent__label">理由</h4>
      <p>{{ rationale }}</p>
    </section>
    <section v-if="nextAction" class="nt-agent__block nt-agent__next">
      <h4 class="nt-agent__label">你下一步</h4>
      <p>{{ nextAction }}</p>
    </section>

    <p v-if="runningLabel" class="nt-agent__running">{{ runningLabel }}…</p>
  </aside>
</template>

<style scoped>
.nt-agent { display: flex; flex-direction: column; gap: 10px; }
.nt-agent__head { display: flex; align-items: center; justify-content: space-between; }
.nt-agent__title { font-size: 14.5px; font-weight: 700; }

.nt-agent__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.nt-agent__steps li {
  display: flex; align-items: center; gap: 8px;
  font-size: 13.5px;
  color: var(--nt-fg-3);
}
.nt-agent__steps li i {
  flex: none;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--nt-line);
}
.nt-agent__steps li.is-done { color: var(--nt-fg-2); }
.nt-agent__steps li.is-done i { background: var(--nt-ok); }
.nt-agent__steps li.is-running { color: var(--nt-fg); font-weight: 600; }
.nt-agent__steps li.is-running i {
  background: var(--nt-acc);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--nt-acc) 22%, transparent);
}

.nt-agent__block { display: flex; flex-direction: column; gap: 3px; }
.nt-agent__label {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--nt-fg-3);
  letter-spacing: .04em;
}
.nt-agent__block p { margin: 0; font-size: 14px; color: var(--nt-fg-2); line-height: 1.65; }
.nt-agent__next p { color: var(--nt-fg); font-weight: 600; }

.nt-agent__running { margin: 0; font-size: 13px; color: var(--nt-acc); }
</style>
