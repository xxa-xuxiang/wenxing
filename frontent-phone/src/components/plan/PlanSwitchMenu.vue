<script setup lang="ts">
// 学习页顶栏「切换学习计划」按钮 + 底部弹层（移动端）
// 纯本地操作：切换 / 新建 / 从教材导入 / 管理计划（打开 PlanBoard）
import { ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import type { PlanScheme } from '@/types'

const emit = defineEmits<{ (e: 'open-board'): void; (e: 'import-textbook'): void }>()

const learnStore = useLearnStore()
const open = ref(false)

/** 是否为当前激活方案（真实 id 或 '__active__' 占位） */
function isCurrent(s: PlanScheme): boolean {
  return s.id === '__active__' || s.id === learnStore.activePlanId
}

/** 已掌握任务数（status !== 'unknown'） */
function mastered(s: PlanScheme): number {
  return s.outline.filter((t) => t.status !== 'unknown').length
}

function onPick(s: PlanScheme) {
  open.value = false
  if (s.id === '__active__') return
  learnStore.switchPlan(s.id)
}

function onCreate() {
  open.value = false
  learnStore.createPlan()
}

function onImportTextbook() {
  open.value = false
  emit('import-textbook')
}

function onManage() {
  open.value = false
  emit('open-board')
}
</script>

<template>
  <div class="psm">
    <button class="psm-btn" :class="{ open }" @click="open = true">
      <span class="psm-mark">✧</span>
      <span class="psm-name">{{ learnStore.activePlanName }}</span>
      <span class="psm-caret" :class="{ open }">▾</span>
    </button>

    <van-popup
      v-model:show="open"
      position="bottom"
      round
      safe-area-inset-bottom
      :style="{ maxHeight: '78vh' }"
    >
      <div class="psm-sheet">
        <div class="psm-sheet-head">
          <span>学习计划</span>
          <button class="psm-sheet-close" @click="open = false">✕</button>
        </div>

        <div class="psm-sheet-body">
          <div v-if="learnStore.allSchemes.length === 0" class="psm-empty">
            暂无学习计划，从「新建学习计划」开始
          </div>
          <button
            v-for="s in learnStore.allSchemes"
            :key="s.id"
            class="psm-item"
            :class="{ active: isCurrent(s) }"
            @click="onPick(s)"
          >
            <span class="psm-check">{{ isCurrent(s) ? '✓' : '' }}</span>
            <span class="psm-item-body">
              <span class="psm-item-name">{{ s.name }}</span>
              <span class="psm-item-sub">{{ s.plan.length }} 模块 · 已掌握 {{ mastered(s) }}/{{ s.outline.length }}</span>
            </span>
          </button>

          <div class="psm-sep"></div>

          <button class="psm-action" @click="onCreate">＋ 新建学习计划</button>
          <button class="psm-action" @click="onImportTextbook">＋ 从教材导入…</button>
          <button class="psm-action" @click="onManage">管理计划（切换 / 重命名 / 删除）…</button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.psm {
  display: inline-flex;
  min-width: 0;
}
.psm-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 7px 11px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #ebedf0;
  border-radius: 999px;
}
.psm-btn.open {
  color: #4f6ef2;
  border-color: rgba(79, 110, 242, 0.4);
  background: rgba(79, 110, 242, 0.08);
}
.psm-mark {
  flex-shrink: 0;
  color: #4f6ef2;
}
.psm-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.psm-caret {
  flex-shrink: 0;
  font-size: 10px;
  color: #969799;
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.psm-caret.open {
  transform: rotate(180deg);
}

.psm-sheet {
  display: flex;
  flex-direction: column;
  max-height: 78vh;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--wx-bg-deep);
}
.psm-sheet-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--wx-text-primary);
  border-bottom: 1px solid var(--wx-border-soft);
}
.psm-sheet-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  background: transparent;
}
.psm-sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px 10px;
}
.psm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 10px;
  text-align: left;
  border-radius: 8px;
  background: transparent;
}
.psm-item.active {
  background: color-mix(in srgb, #4f6ef2 10%, transparent);
}
.psm-check {
  flex-shrink: 0;
  width: 14px;
  font-size: 12px;
  color: #4f6ef2;
}
.psm-item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.psm-item-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.psm-item-sub {
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
}
.psm-sep {
  height: 1px;
  margin: 6px 6px;
  background: var(--wx-border-soft);
}
.psm-action {
  width: 100%;
  padding: 12px 10px;
  text-align: left;
  font-size: 13px;
  color: var(--wx-text-secondary);
  background: transparent;
  border-radius: 8px;
}
.psm-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--wx-text-muted);
}
</style>
