<script setup lang="ts">
// 学习规划向导（全屏弹框）：把原「阶段 1-3」收进一个弹框，5 步复用现有组件
// 步骤推进完全由现有 store 字段推导（questionnaireAnswers / skillGroups / outline / plan / resourcesConfirmed），不新增状态机
// 硬约束：向导不自动触发任何 API 调用；所有 AI 调用仍由各子组件内的按钮显式触发
import { computed, watch } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { useOverlay } from '@/composables/useOverlay'
import DirectionDialog from '@/components/learn/DirectionDialog.vue'
import OutlineConfirm from '@/components/learn/OutlineConfirm.vue'
import BaselineQuiz from '@/components/learn/BaselineQuiz.vue'
import ResourceStage from '@/components/learn/ResourceStage.vue'
import PlanStage from '@/components/learn/PlanStage.vue'
import PlanAgentDrawer from '@/components/learn/PlanAgentDrawer.vue'

const learnStore = useLearnStore()
const emit = defineEmits<{ (e: 'close'): void }>()

const { overlayRef, onOverlayMousedown } = useOverlay({
  onClose: () => emit('close'),
  modal: true
})

const STEPS = [
  { n: 1, label: '方向与学习合同', hint: '行业 · 大类 · 五题' },
  { n: 2, label: '学前测评', hint: '按推荐技能组抽题摸底' },
  { n: 3, label: '技能与大纲', hint: 'AI 精细拆解任务' },
  { n: 4, label: '资源准备', hint: '目录树 · 开放教材' },
  { n: 5, label: '计划确认', hint: 'AI 深规划 · 块编辑器' }
] as const

const step = computed<1 | 2 | 3 | 4 | 5>(() => {
  // 新流程：合同 → 测评 → AI 大纲 → 资源 → 计划确认（计划在第 5 步生成）
  if (!learnStore.questionnaireAnswers) return 1
  if (!learnStore.baselineDone) return 2
  if (learnStore.outline.length === 0) return 3
  if (!learnStore.resourcesConfirmed) return 4
  return 5
})

// 计划确认完成 → 关闭向导，进入执行工作台
watch(
  () => learnStore.planConfirmed,
  (v) => { if (v) emit('close') }
)

function state(n: number): 'done' | 'current' | 'todo' {
  if (n === step.value) return 'current'
  return n < step.value ? 'done' : 'todo'
}
</script>

<template>
  <div ref="overlayRef" class="wx-wiz-mask" @mousedown="onOverlayMousedown">
    <div class="wx-wiz">
      <header class="wx-wiz-head">
        <div class="wx-wiz-title">
          <span class="wx-wiz-mark">✦</span>
          <span>学习规划向导</span>
          <span v-if="learnStore.selectedDomain?.name" class="wx-wiz-domain">
            {{ learnStore.selectedDomain.name }}
          </span>
        </div>
        <div class="wx-wiz-steps">
          <template v-for="(s, i) in STEPS" :key="s.n">
            <span v-if="i > 0" class="wx-wiz-sep" :class="{ done: step > s.n }"></span>
            <span class="wx-wiz-step" :class="`st-${state(s.n)}`" :title="s.hint">
              <span class="wx-wiz-step-n">
                <span v-if="state(s.n) === 'done'">✓</span>
                <span v-else>{{ s.n }}</span>
              </span>
              <span class="wx-wiz-step-label">{{ s.label }}</span>
            </span>
          </template>
        </div>
        <button class="wx-wiz-close" title="关闭向导" @click="emit('close')">✕</button>
      </header>

      <div class="wx-wiz-body">
        <DirectionDialog v-if="step === 1" />
        <BaselineQuiz v-else-if="step === 2" />
        <OutlineConfirm v-else-if="step === 3" />
        <ResourceStage v-else-if="step === 4" />
        <PlanStage v-else mode="wizard" />
      </div>

      <!-- 右侧 Agent 过程抽屉：展示学习计划skill 五阶段执行轨迹 -->
      <PlanAgentDrawer v-if="learnStore.agentDrawerOpen" />
    </div>
  </div>
</template>

<style scoped>
.wx-wiz-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: color-mix(in srgb, var(--wx-bg-deep) 62%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
/* 去圆角框化：面板圆角压到 4px，头部无卡片感 */
.wx-wiz {
  /* 供 Agent 抽屉绝对定位 */
  position: relative;
  /* 制定计划区域：全局标准尺寸令牌（响应式 + 统一最小值），见 variables.css */
  width: var(--wx-wizard-w);
  height: var(--wx-wizard-h);
  min-width: var(--wx-wizard-min-w);
  min-height: var(--wx-wizard-min-h);
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  background: color-mix(in srgb, var(--wx-bg-deep) 96%, transparent);
  border: 1px solid var(--wx-border-glow);
  box-shadow: 0 24px 64px color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  overflow: hidden;
  animation: wx-wiz-in 0.26s var(--wx-ease-spring);
}
@keyframes wx-wiz-in {
  from { opacity: 0; transform: translateY(12px) scale(0.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.wx-wiz-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-wiz-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-family: var(--wx-font-serif);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.wx-wiz-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 6px var(--wx-color-primary));
}
.wx-wiz-domain {
  padding: 2px 9px;
  font-family: var(--wx-font-sans);
  font-size: 11px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-radius: 2px;
}

.wx-wiz-steps {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
}
.wx-wiz-sep {
  flex-shrink: 0;
  width: 18px;
  height: 1px;
  background: var(--wx-border-soft);
}
.wx-wiz-sep.done { background: var(--wx-color-primary-soft); }
.wx-wiz-step {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  white-space: nowrap;
}
.wx-wiz-step-n {
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
.wx-wiz-step-label { font-size: 12px; color: var(--wx-text-muted); }
.wx-wiz-step.st-done .wx-wiz-step-n {
  color: var(--wx-color-yanqing);
  border-color: color-mix(in srgb, var(--wx-color-yanqing) 40%, transparent);
}
.wx-wiz-step.st-done .wx-wiz-step-label { color: var(--wx-text-tertiary); }
.wx-wiz-step.st-current .wx-wiz-step-n {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
}
.wx-wiz-step.st-current .wx-wiz-step-label { color: var(--wx-text-primary); font-weight: 600; }

.wx-wiz-close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 2px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-wiz-close:hover { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }

.wx-wiz-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wx-wiz-body > :deep(*) { flex: 1; min-height: 0; }
/* 子组件原为整页布局，底部预留了 88px（旧底栏），向导内收紧 */
.wx-wiz-body :deep(.wx-dialog),
.wx-wiz-body :deep(.wx-oc),
.wx-wiz-body :deep(.wx-baseline),
.wx-wiz-body :deep(.wx-res),
.wx-wiz-body :deep(.wx-planstage) {
  padding-bottom: 20px;
}
</style>
