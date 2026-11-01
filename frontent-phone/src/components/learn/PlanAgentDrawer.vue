<script setup lang="ts">
// 学习计划 Agent 过程抽屉（移动端全屏覆盖层）：展示「学习计划skill」五阶段执行轨迹、产物与校验结果
// 只读 learnStore.planAgent / planDoc，不触发任何请求
import { computed, onBeforeUnmount, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { renderMarkdown } from '@/utils/markdown'
import type { PlanAgentPhase } from '@/types'

const learnStore = useLearnStore()

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
</script>

<template>
  <div class="wx-agent-mask" @click.self="learnStore.closeAgentDrawer()">
    <aside class="wx-agent-drawer">
      <header class="wx-agent-head">
        <div class="wx-agent-title">
          <span class="wx-agent-mark" :class="{ 'wx-spin': run?.active }">✦</span>
          <span>规划 Agent</span>
          <span class="wx-agent-badge">五阶段</span>
        </div>
        <div class="wx-agent-head-right">
          <span v-if="run" class="wx-agent-elapsed">{{ elapsed }}</span>
          <button class="wx-agent-close" title="收起" @click="learnStore.closeAgentDrawer()">✕</button>
        </div>
      </header>

      <div v-if="!run" class="wx-agent-empty">
        <div class="wx-agent-empty-mark">✧</div>
        <div>尚未运行 Agent</div>
        <div class="wx-agent-empty-sub">生成或重新生成学习计划后，这里会展示五阶段执行轨迹</div>
      </div>

      <div v-else class="wx-agent-body">
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
          >
            <div class="wx-agent-phase-head">
              <span class="wx-agent-phase-icon" :class="{ 'wx-spin': p.status === 'running' }">
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

        <section v-if="validation" class="wx-agent-validation" :class="{ ok: validation.ok }">
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

        <div class="wx-agent-foot">量化阈值取自《学习全流程规划大纲》，产物可在「计划文档」中完整查看</div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.wx-agent-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.wx-agent-drawer {
  width: 92%;
  max-width: 420px;
  height: 100%;
  padding-top: env(safe-area-inset-top);
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--wx-bg-deep-2) 97%, transparent);
  border-left: 1px solid var(--wx-border-soft);
  box-shadow: -18px 0 44px color-mix(in srgb, var(--wx-bg-deep) 52%, transparent);
}
.wx-agent-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-agent-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-family: var(--wx-font-serif);
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-agent-mark {
  color: var(--wx-color-primary);
}
.wx-agent-badge {
  padding: 1px 6px;
  font-family: var(--wx-font-sans);
  font-size: 9.5px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-radius: 2px;
  white-space: nowrap;
}
.wx-agent-head-right {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}
.wx-agent-elapsed {
  font-family: var(--wx-font-mono);
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.wx-agent-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--wx-border-soft);
  border-radius: 5px;
  background: transparent;
  color: var(--wx-text-secondary);
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
  font-size: 11px;
  color: var(--wx-text-muted);
  max-width: 240px;
  line-height: 1.6;
}
.wx-agent-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 14px calc(18px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wx-agent-error {
  display: flex;
  gap: 7px;
  padding: 8px 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--wx-color-vermilion);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 36%, transparent);
  border-radius: 5px;
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
  gap: 9px;
}
.wx-agent-phase {
  padding: 9px 10px;
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-agent-phase.st-running {
  border-color: var(--wx-color-primary-soft);
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
  gap: 7px;
}
.wx-agent-phase-icon {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11.5px;
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
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-agent-phase-state {
  font-size: 10px;
  color: var(--wx-text-muted);
}
.wx-agent-phase-ms {
  font-family: var(--wx-font-mono);
  font-size: 10px;
  color: var(--wx-text-muted);
}
.wx-agent-phase-summary {
  margin-top: 5px;
  padding-left: 23px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--wx-text-secondary);
}
.wx-agent-phase-logs {
  margin-top: 4px;
  padding-left: 23px;
}
.wx-agent-log {
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--wx-text-muted);
  word-break: break-word;
}
.wx-agent-artifact {
  margin-top: 7px;
  margin-left: 23px;
  border-top: 1px dashed var(--wx-border-soft);
  padding-top: 5px;
}
.wx-agent-artifact-title {
  cursor: pointer;
  font-size: 11px;
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
  margin-top: 7px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--wx-text-secondary);
  max-height: 240px;
  overflow-y: auto;
}
.wx-agent-artifact-body :deep(h1),
.wx-agent-artifact-body :deep(h2),
.wx-agent-artifact-body :deep(h3) {
  margin: 7px 0 5px;
  font-size: 12px;
  color: var(--wx-text-primary);
}
.wx-agent-artifact-body :deep(.wx-md-table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 5px 0;
  border-collapse: collapse;
  font-size: 10.5px;
}
.wx-agent-artifact-body :deep(th),
.wx-agent-artifact-body :deep(td) {
  padding: 4px 6px;
  border: 1px solid var(--wx-border-soft);
  text-align: left;
  vertical-align: top;
}
.wx-agent-artifact-body :deep(th) {
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  color: var(--wx-text-primary);
}
.wx-agent-artifact-body :deep(ul),
.wx-agent-artifact-body :deep(ol) {
  margin: 4px 0;
  padding-left: 17px;
}
.wx-agent-validation {
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 36%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--wx-color-vermilion) 6%, transparent);
}
.wx-agent-validation.ok {
  border-color: color-mix(in srgb, var(--wx-color-primary) 34%, transparent);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.wx-agent-validation-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.wx-agent-validation-badge {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--wx-color-vermilion);
}
.wx-agent-validation.ok .wx-agent-validation-badge {
  color: var(--wx-color-primary);
}
.wx-agent-validation-meta {
  font-size: 10px;
  color: var(--wx-text-muted);
}
.wx-agent-validation-line {
  margin-top: 4px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--wx-text-secondary);
  word-break: break-word;
}
.wx-agent-foot {
  padding-top: 3px;
  font-size: 10px;
  line-height: 1.6;
  color: var(--wx-text-muted);
}
</style>
