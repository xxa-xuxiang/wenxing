<script setup lang="ts">
// 「学习计划安排」独立覆盖层：两个 Tab（方案与排期 / 复盘打卡）
// 学习日历已迁出为学习页内的完整界面（LearnView 顶栏日历按钮切换），不再以弹框呈现
// 模态浮层：Esc / 点击遮罩空白 → emit('close')（复用 useOverlay）
import { ref } from 'vue'
import { useOverlay } from '@/composables/useOverlay'
import { useLearnStore } from '@/stores/learnStore'
import SchemeListPane from './SchemeListPane.vue'
import PlanStage from '@/components/learn/PlanStage.vue'
import PlanAgentDrawer from '@/components/learn/PlanAgentDrawer.vue'
import ReviewStage from '@/components/learn/ReviewStage.vue'

const props = withDefaults(defineProps<{ tab?: 1 | 3 }>(), { tab: 1 })
const emit = defineEmits<{ (e: 'close'): void }>()

const activeTab = ref<1 | 3>(props.tab)
const learnStore = useLearnStore()

const { overlayRef, onOverlayMousedown } = useOverlay({
  onClose: () => emit('close'),
  modal: true
})

const TABS: Array<{ key: 1 | 3; label: string }> = [
  { key: 1, label: '方案与排期' },
  { key: 3, label: '复盘打卡' }
]
</script>

<template>
  <div ref="overlayRef" class="wx-pb-mask" @mousedown="onOverlayMousedown">
    <div class="wx-pb">
      <!-- 顶栏：Tab 三选一 + 关闭 -->
      <header class="wx-pb-head">
        <div class="wx-pb-tabs">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="wx-pb-tab wx-pressable"
            :class="{ active: activeTab === t.key }"
            @click="activeTab = t.key"
          >{{ t.label }}</button>
        </div>
        <button class="wx-pb-close wx-pressable" title="关闭（Esc）" @click="emit('close')">✕</button>
      </header>

      <div class="wx-pb-body">
        <!-- Tab1：方案与排期 -->
        <template v-if="activeTab === 1">
          <aside class="wx-pb-schemes"><SchemeListPane /></aside>
          <section class="wx-pb-stage"><PlanStage mode="manage" /></section>
        </template>

        <!-- Tab3：复盘打卡 -->
        <section v-else class="wx-pb-fill"><ReviewStage /></section>
      </div>

      <!-- 右侧 Agent 过程抽屉（重新生成计划时展示五阶段轨迹） -->
      <PlanAgentDrawer v-if="learnStore.agentDrawerOpen" />
    </div>
  </div>
</template>

<style scoped>
.wx-pb-mask {
  position: fixed;
  inset: 0;
  z-index: 220;
  background: color-mix(in srgb, var(--wx-bg-deep) 78%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: wx-pb-mask-in 0.22s var(--wx-ease-out-soft);
}
@keyframes wx-pb-mask-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.wx-pb {
  /* 供 Agent 抽屉绝对定位 */
  position: relative;
  /* 计划模块弹框：与制定计划向导共用全局标准尺寸令牌，所有出现处保持一致 */
  width: var(--wx-wizard-w);
  height: var(--wx-wizard-h);
  min-width: var(--wx-wizard-min-w);
  min-height: var(--wx-wizard-min-h);
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--wx-bg-deep) 94%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-md);
  box-shadow: var(--wx-shadow-glow), var(--wx-shadow-lg);
  overflow: hidden;
  animation: wx-pb-in 0.28s var(--wx-ease-spring);
}
@keyframes wx-pb-in {
  from { opacity: 0; transform: translateY(12px) scale(0.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.wx-pb-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
}
.wx-pb-tabs { display: flex; align-items: center; gap: 4px; }
.wx-pb-tab {
  padding: 7px 16px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
}
.wx-pb-tab:hover { color: var(--wx-text-primary); }
.wx-pb-tab.active {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  border-color: var(--wx-border-glow);
}
.wx-pb-close {
  width: 30px;
  height: 30px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: 2px;
}
.wx-pb-close:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }

/* 主体：内容自适应占满 */
.wx-pb-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.wx-pb-schemes {
  width: 300px;
  flex-shrink: 0;
  min-height: 0;
  border-right: 1px solid var(--wx-border-soft);
}
.wx-pb-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}
.wx-pb-fill {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
</style>
