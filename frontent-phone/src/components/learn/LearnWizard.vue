<script setup lang="ts">
// 学习规划向导（移动端全屏）：五步复用桌面端子组件
// 步骤推进完全由 store 字段推导（questionnaireAnswers / baselineDone / outline / resourcesConfirmed / planConfirmed）
// 硬约束：向导不自动触发任何 AI 调用；所有 AI 调用仍由各子组件内的按钮显式触发
import { computed, watch } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import DirectionDialog from '@/components/learn/DirectionDialog.vue'
import OutlineConfirm from '@/components/learn/OutlineConfirm.vue'
import BaselineQuiz from '@/components/learn/BaselineQuiz.vue'
import ResourceStage from '@/components/learn/ResourceStage.vue'
import PlanStage from '@/components/learn/PlanStage.vue'
import PlanAgentDrawer from '@/components/learn/PlanAgentDrawer.vue'

const learnStore = useLearnStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const STEPS = [
  { n: 1, label: '方向与学习合同', hint: '行业 · 大类 · 五题' },
  { n: 2, label: '学前测评', hint: '按推荐技能组抽题摸底' },
  { n: 3, label: '技能与大纲', hint: 'AI 精细拆解任务' },
  { n: 4, label: '资源准备', hint: '目录树 · 开放教材' },
  { n: 5, label: '计划确认', hint: 'AI 深规划 · 块编辑器' }
] as const

const step = computed<1 | 2 | 3 | 4 | 5>(() => {
  // 推荐进行中 / 失败时停留在第 1 步，避免测评组件在技能组就绪前挂载
  if (learnStore.generatingRecommend || learnStore.recommendError) return 1
  // 教材导入不带问卷：已有大纲即视为已越过合同，直达第 5 步确认
  if (!learnStore.questionnaireAnswers && learnStore.outline.length === 0) return 1
  if (!learnStore.baselineDone) return 2
  if (learnStore.outline.length === 0) return 3
  if (!learnStore.resourcesConfirmed) return 4
  return 5
})

// 计划确认完成 → 关闭向导，进入执行工作台
watch(
  () => learnStore.planConfirmed,
  (v) => {
    if (v) emit('close')
  }
)

function state(n: number): 'done' | 'current' | 'todo' {
  if (n === step.value) return 'current'
  return n < step.value ? 'done' : 'todo'
}
</script>

<template>
  <div class="lwiz-mask">
    <div class="lwiz">
      <header class="lwiz-head">
        <div class="lwiz-title">
          <span class="lwiz-mark">✦</span>
          <span>学习规划向导</span>
          <span v-if="learnStore.selectedDomain?.name" class="lwiz-domain">
            {{ learnStore.selectedDomain.name }}
          </span>
        </div>
        <button class="lwiz-close" title="关闭向导" @click="emit('close')">✕</button>
      </header>

      <!-- 步骤条：横向可滚动，不换行 -->
      <div class="lwiz-steps">
        <template v-for="(s, i) in STEPS" :key="s.n">
          <span v-if="i > 0" class="lwiz-sep" :class="{ done: step > s.n }"></span>
          <span class="lwiz-step" :class="`st-${state(s.n)}`">
            <span class="lwiz-step-n">
              <span v-if="state(s.n) === 'done'">✓</span>
              <span v-else>{{ s.n }}</span>
            </span>
            <span class="lwiz-step-label">{{ s.label }}</span>
          </span>
        </template>
      </div>

      <div class="lwiz-body">
        <DirectionDialog v-if="step === 1" />
        <BaselineQuiz v-else-if="step === 2" />
        <OutlineConfirm v-else-if="step === 3" />
        <ResourceStage v-else-if="step === 4" />
        <PlanStage v-else mode="wizard" />
      </div>

      <!-- Agent 过程抽屉：展示学习计划skill 五阶段执行轨迹 -->
      <PlanAgentDrawer v-if="learnStore.agentDrawerOpen" />
    </div>
  </div>
</template>

<style scoped>
.lwiz-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: color-mix(in srgb, var(--wx-bg-deep) 82%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: stretch;
}

.lwiz {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  background: color-mix(in srgb, var(--wx-bg-deep) 97%, transparent);
  overflow: hidden;
}

.lwiz-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.lwiz-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--wx-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-primary);
  letter-spacing: 0.04em;
}
.lwiz-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 6px var(--wx-color-primary));
}
.lwiz-domain {
  max-width: 42%;
  padding: 2px 8px;
  font-family: var(--wx-font-sans);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-radius: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lwiz-close {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  background: transparent;
}

/* 步骤条：单行横向滚动 */
.lwiz-steps {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--wx-border-soft);
  scrollbar-width: none;
}
.lwiz-steps::-webkit-scrollbar {
  display: none;
}
.lwiz-sep {
  flex-shrink: 0;
  width: 12px;
  height: 1px;
  background: var(--wx-border-soft);
}
.lwiz-sep.done {
  background: var(--wx-color-primary-soft);
}
.lwiz-step {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  white-space: nowrap;
}
.lwiz-step-n {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
  border: 1px solid var(--wx-border-soft);
}
.lwiz-step-label {
  font-size: 11px;
  color: var(--wx-text-muted);
}
.lwiz-step.st-done .lwiz-step-n {
  color: var(--wx-color-yanqing);
  border-color: color-mix(in srgb, var(--wx-color-yanqing) 40%, transparent);
}
.lwiz-step.st-done .lwiz-step-label {
  color: var(--wx-text-tertiary);
}
.lwiz-step.st-current .lwiz-step-n {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
}
.lwiz-step.st-current .lwiz-step-label {
  color: var(--wx-text-primary);
  font-weight: 600;
}

.lwiz-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.lwiz-body > :deep(*) {
  flex: 1;
  min-height: 0;
}
/* 子组件原为整页布局，底部预留了 88px（旧底栏），向导内收紧 */
.lwiz-body :deep(.wx-dialog),
.lwiz-body :deep(.wx-oc),
.lwiz-body :deep(.wx-baseline),
.lwiz-body :deep(.wx-res),
.lwiz-body :deep(.wx-planstage) {
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
</style>
