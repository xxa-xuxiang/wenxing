<script setup lang="ts">
// 「学习计划安排」全屏覆盖层（移动端）：方案列表 / 排期看板两个 Tab
// 学习日历属非目标，不在移动端实现；复盘打卡由「我的」页承接
import { ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import SchemeListPane from './SchemeListPane.vue'
import PlanStage from '@/components/learn/PlanStage.vue'
import PlanAgentDrawer from '@/components/learn/PlanAgentDrawer.vue'

const props = withDefaults(defineProps<{ tab?: 1 | 2 }>(), { tab: 1 })
const emit = defineEmits<{ (e: 'close'): void }>()

const activeTab = ref<1 | 2>(props.tab)
const learnStore = useLearnStore()

const TABS: Array<{ key: 1 | 2; label: string }> = [
  { key: 1, label: '方案' },
  { key: 2, label: '排期看板' }
]
</script>

<template>
  <div class="pb-mask">
    <div class="pb">
      <header class="pb-head">
        <div class="pb-tabs">
          <button
            v-for="t in TABS"
            :key="t.key"
            class="pb-tab"
            :class="{ active: activeTab === t.key }"
            @click="activeTab = t.key"
          >{{ t.label }}</button>
        </div>
        <button class="pb-close" title="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="pb-body">
        <SchemeListPane v-if="activeTab === 1" />
        <PlanStage v-else mode="manage" />
      </div>

      <PlanAgentDrawer v-if="learnStore.agentDrawerOpen" />
    </div>
  </div>
</template>

<style scoped>
.pb-mask {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  align-items: stretch;
  background: color-mix(in srgb, var(--wx-bg-deep) 88%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.pb {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  background: var(--wx-bg-deep);
  overflow: hidden;
}
.pb-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
}
.pb-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pb-tab {
  padding: 7px 16px;
  font-size: 12.5px;
  color: var(--wx-text-tertiary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
}
.pb-tab.active {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
  border-color: var(--wx-border-glow);
}
.pb-close {
  width: 30px;
  height: 30px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
  background: transparent;
}
.pb-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.pb-body > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
