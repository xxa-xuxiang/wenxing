<script setup lang="ts">
// 学习计划 Agent 过程抽屉：展示「学习计划skill」五阶段执行轨迹、产物与校验结果
// 只读 learnStore.planAgent / planDoc，不触发任何请求
import { computed, onBeforeUnmount, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { renderMarkdown } from '@/utils/markdown'
import { FLAGS } from '@/config/flags'
import AgentPanel from '@/components/AgentPanel.vue'
import type { PlanAgentPhase } from '@/types'

const learnStore = useLearnStore()

type AgentTriple = { decision?: string; rationale?: string; nextAction?: string }

const now = ref(Date.now())
const timer = window.setInterval(() => {
  now.value = Date.now()
}, 1000)
onBeforeUnmount(() => window.clearInterval(timer))

const run = computed(() => learnStore.planAgent)

/** 运行耗时：运行中按墙钟，结束后按各阶段耗时求和 */
const elapsed = computed(() => {
  const r = run.value
  if (!r) return ''
  const ms = r.active ? now.value - r.startedAt : r.phases.reduce((s, p) => s + (p.ms ?? 0), 0)
  return `${(ms / 1000).toFixed(1)}s`
})

const statusIcon = (p: PlanAgentPhase): string =>
  p.status === 'done' ? '✓' : p.status === 'error' ? '!' : p.status === 'running' ? '✧' : '○'

const statusText = (p: PlanAgentPhase): string =>
  p.status === 'done' ? '完成' : p.status === 'error' ? '失败' : p.status === 'running' ? '运行中' : '待运行'

const msText = (ms?: number): string => (ms === undefined ? '' : `${(ms / 1000).toFixed(1)}s`)

const validation = computed(() => run.value?.validation)

/* ---- AgentPanel 整改：只暴露决定 / 理由 / 下一步，步骤名走 CONVERT 翻译 ---- */
const panelSteps = computed(() =>
  (run.value?.phases ?? []).map((p) => ({
    key: p.id,
    label: p.title,
    state: p.status === 'done' ? ('done' as const) : p.status === 'running' ? ('running' as const) : ('pending' as const)
  }))
)

const panelTriple = computed<AgentTriple>(() => {
  const r = run.value as unknown as AgentTriple | null
  return { decision: r?.decision, rationale: r?.rationale, nextAction: r?.nextAction }
})
</script>

<template>
  <aside class="wx-agent-drawer" data-test="plan-agent-drawer">
    <header class="wx-agent-head">
      <div class="wx-agent-title">
        <span class="wx-agent-mark" :class="{ 'wx-spin': run?.active }">✦</span>
        <span>规划 Agent</span>
        <span class="wx-agent-badge">{{ FLAGS.AGENT_PANEL_V2 ? '学习计划skill' : '学习计划skill · 五阶段' }}</span>
      </div>
      <div class="wx-agent-head-right">
        <span v-if="run" class="wx-agent-elapsed">{{ elapsed }}</span>
        <button class="wx-agent-close wx-pressable" title="收起 Agent 过程" @click="learnStore.closeAgentDrawer()">✕</button>
      </div>
    </header>

    <div v-if="!run" class="wx-agent-empty">
      <div class="wx-agent-empty-mark">✧</div>
      <div>尚未运行 Agent</div>
      <div class="wx-agent-empty-sub">
        {{ FLAGS.AGENT_PANEL_V2 ? '生成学习计划后，这里展示决定、理由与下一步' : '生成或重新生成学习计划后，这里会展示五阶段执行轨迹' }}
      </div>
    </div>

    <div v-else class="wx-agent-body">
      <AgentPanel
        v-if="FLAGS.AGENT_PANEL_V2"
        :steps="panelSteps"
        :decision="panelTriple.decision"
        :rationale="panelTriple.rationale"
        :next-action="panelTriple.nextAction"
      />
      <template v-else>
      <div v-if="run.error" class="wx-agent-error">
        <span class="wx-agent-error-mark">!</span>
        <span>{{ run.error }}（已自动改用基础生成方式，计划已生成）</span>
      </div>

      <ol class="wx-agent-phases">
        <li
          v-for="p in run.phases"
          :key="p.id"
          class="wx-agent-phase"
          :class="`st-${p.status}`"
          :data-test="`agent-phase-${p.id}`"
        >
          <div class="wx-agent-phase-head">
            <span class="wx-agent-phase-icon" :class="{ 'wx-spin': p.status === 'running', 'wx-breathe': p.status === 'running' }">
              {{ statusIcon(p) }}
            </span>
            <span class="wx-agent-phase-title">{{ p.title }}</span>
            <span class="wx-agent-phase-state">{{ statusText(p) }}</span>
            <span v-if="p.ms !== undefined" class="wx-agent-phase-ms">{{ msText(p.ms) }}</span>
          </div>
          <div v-if="p.summary" class="wx-agent-phase-summary">{{ p.summary }}</div>
          <div v-if="p.logs.length" class="wx-agent-phase-logs">
            <div v-for="(line, i) in p.logs" :key="i" class="wx-agent-log">· {{ line }}</div>
          </div>

          <details v-for="a in p.artifacts" :key="a.id" class="wx-agent-artifact">
            <summary class="wx-agent-artifact-title">{{ a.title }}</summary>
            <div class="wx-agent-artifact-body" v-html="renderMarkdown(a.markdown)"></div>
          </details>
        </li>
      </ol>

      <section v-if="validation" class="wx-agent-validation" :class="{ ok: validation.ok }" data-test="agent-validation">
        <div class="wx-agent-validation-head">
          <span class="wx-agent-validation-badge">{{ validation.ok ? '校验通过' : '校验异常' }}</span>
          <span class="wx-agent-validation-meta">
            五阶段 {{ validation.missingPhases.length === 0 ? '全覆盖' : `缺 ${validation.missingPhases.length}` }} ·
            引用 {{ validation.untraceableRefs.length === 0 ? '可追溯' : `不可追溯 ${validation.untraceableRefs.length}` }}
          </span>
        </div>
        <div v-if="validation.missingPhases.length" class="wx-agent-validation-line">
          缺失阶段：{{ validation.missingPhases.join('、') }}
        </div>
        <div v-if="validation.untraceableRefs.length" class="wx-agent-validation-line">
          不可追溯编号：{{ validation.untraceableRefs.join('、') }}
        </div>
        <div class="wx-agent-validation-line">
          检查引用 {{ validation.checkedRefs }} 个 · 技能编号库 {{ validation.taxonomy?.codes ?? 0 }} 个
        </div>
      </section>

      <div class="wx-agent-foot">量化阈值取自《学习全流程规划大纲》，产物可在左侧「计划文档」中完整查看</div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.wx-agent-drawer {
  position: absolute;
  top: 52px;
  right: 0;
  bottom: 0;
  width: min(420px, 46%);
  z-index: 6;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--wx-bg-deep-2) 96%, transparent);
  border-left: 1px solid var(--wx-border-soft);
  box-shadow: -18px 0 44px color-mix(in srgb, var(--wx-bg-deep) 52%, transparent);
  animation: wx-agent-in 0.24s var(--wx-ease-spring);
}
@keyframes wx-agent-in {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: translateX(0); }
}
.wx-agent-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-agent-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-family: var(--wx-font-serif);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--wx-text-primary);
}
.wx-agent-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 6px var(--wx-color-primary));
}
.wx-agent-badge {
  padding: 1px 7px;
  font-family: var(--wx-font-sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-radius: 2px;
  white-space: nowrap;
}
.wx-agent-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.wx-agent-elapsed {
  font-family: var(--wx-font-mono, monospace);
  font-size: 11px;
  color: var(--wx-text-muted);
}
.wx-agent-close {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid var(--wx-border-soft);
  border-radius: 3px;
  background: transparent;
  color: var(--wx-text-secondary);
  cursor: pointer;
}
.wx-agent-close:hover {
  color: var(--wx-text-primary);
  border-color: var(--wx-color-primary-soft);
}
.wx-agent-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  color: var(--wx-text-secondary);
  font-size: 13px;
}
.wx-agent-empty-mark {
  font-size: 28px;
  color: var(--wx-color-primary-soft);
}
.wx-agent-empty-sub {
  font-size: 11.5px;
  color: var(--wx-text-muted);
  max-width: 250px;
  line-height: 1.6;
}
.wx-agent-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wx-agent-error {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wx-color-vermilion);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 36%, transparent);
  border-radius: 3px;
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent);
}
.wx-agent-error-mark {
  font-weight: 700;
}
.wx-agent-phases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wx-agent-phase {
  padding: 10px 12px;
  border: 1px solid var(--wx-border-soft);
  border-radius: 4px;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-agent-phase.st-running {
  border-color: var(--wx-color-primary-soft);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
}
.wx-agent-phase.st-done {
  border-color: color-mix(in srgb, var(--wx-color-primary) 34%, transparent);
}
.wx-agent-phase.st-error {
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 42%, transparent);
}
.wx-agent-phase-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-agent-phase-icon {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
}
.wx-agent-phase.st-done .wx-agent-phase-icon {
  color: var(--wx-color-primary);
}
.wx-agent-phase.st-error .wx-agent-phase-icon {
  color: var(--wx-color-vermilion);
}
.wx-agent-phase.st-pending .wx-agent-phase-icon {
  color: var(--wx-text-muted);
}
.wx-agent-phase-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-agent-phase-state {
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.wx-agent-phase-ms {
  font-family: var(--wx-font-mono, monospace);
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.wx-agent-phase-summary {
  margin-top: 6px;
  padding-left: 24px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--wx-text-secondary);
}
.wx-agent-phase-logs {
  margin-top: 4px;
  padding-left: 24px;
}
.wx-agent-log {
  font-size: 11px;
  line-height: 1.6;
  color: var(--wx-text-muted);
  word-break: break-word;
}
.wx-agent-artifact {
  margin-top: 8px;
  margin-left: 24px;
  border-top: 1px dashed var(--wx-border-soft);
  padding-top: 6px;
}
.wx-agent-artifact-title {
  cursor: pointer;
  font-size: 11.5px;
  color: var(--wx-color-primary-soft);
  list-style: none;
}
.wx-agent-artifact-title::-webkit-details-marker {
  display: none;
}
.wx-agent-artifact-title::before {
  content: '▸ ';
}
.wx-agent-artifact[open] .wx-agent-artifact-title::before {
  content: '▾ ';
}
.wx-agent-artifact-body {
  margin-top: 8px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--wx-text-secondary);
  max-height: 260px;
  overflow-y: auto;
}
.wx-agent-artifact-body :deep(h2),
.wx-agent-artifact-body :deep(h3) {
  margin: 8px 0 6px;
  font-size: 12.5px;
  color: var(--wx-text-primary);
}
.wx-agent-artifact-body :deep(table.wx-md-table) {
  width: 100%;
  margin: 6px 0;
  border-collapse: collapse;
  font-size: 11px;
}
.wx-agent-artifact-body :deep(.wx-md-table th),
.wx-agent-artifact-body :deep(.wx-md-table td) {
  padding: 4px 6px;
  border: 1px solid var(--wx-border-soft);
  text-align: left;
  vertical-align: top;
}
.wx-agent-artifact-body :deep(.wx-md-table th) {
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  color: var(--wx-text-primary);
}
.wx-agent-artifact-body :deep(ul),
.wx-agent-artifact-body :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
}
.wx-agent-validation {
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 36%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--wx-color-vermilion) 6%, transparent);
}
.wx-agent-validation.ok {
  border-color: color-mix(in srgb, var(--wx-color-primary) 34%, transparent);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.wx-agent-validation-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wx-agent-validation-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--wx-color-vermilion);
}
.wx-agent-validation.ok .wx-agent-validation-badge {
  color: var(--wx-color-primary);
}
.wx-agent-validation-meta {
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.wx-agent-validation-line {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--wx-text-secondary);
  word-break: break-word;
}
.wx-agent-foot {
  padding-top: 4px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--wx-text-muted);
}
</style>
