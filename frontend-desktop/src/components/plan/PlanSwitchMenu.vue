<script setup lang="ts">
// 学习工作台顶栏「切换学习计划」按钮 + 下拉菜单
// 非模态浮层：点击菜单外部 / Esc 收起（复用 useOverlay）
import { ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { useOverlay } from '@/composables/useOverlay'
import type { PlanScheme } from '@/types'

const emit = defineEmits<{ (e: 'open-board'): void; (e: 'import-textbook'): void }>()

const learnStore = useLearnStore()

const open = ref(false)

// 非模态：overlayRef 绑到菜单根元素（按钮 + 下拉在同一根内），点击其外任意处收起
const { overlayRef } = useOverlay({
  onClose: () => { open.value = false }
})

/** 是否为当前激活方案（真实 id 或 '__active__' 占位） */
function isCurrent(s: PlanScheme): boolean {
  return s.id === '__active__' || s.id === learnStore.activePlanId
}

/** 已掌握任务数（status !== 'unknown'） */
function mastered(s: PlanScheme): number {
  return s.outline.filter((t) => t.status !== 'unknown').length
}

function toggle() {
  open.value = !open.value
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
  <div ref="overlayRef" class="wx-psm">
    <button class="wx-psm-btn wx-pressable" :class="{ open }" @click="toggle">
      <span class="wx-psm-name">{{ learnStore.activePlanName }}</span>
      <span class="wx-psm-caret" :class="{ open }">▾</span>
    </button>

    <div v-if="open" class="wx-psm-menu">
      <div v-if="learnStore.allSchemes.length === 0" class="wx-psm-empty">
        暂无学习计划，从「新建学习计划」开始
      </div>
      <button
        v-for="s in learnStore.allSchemes"
        :key="s.id"
        class="wx-psm-item"
        :class="{ active: isCurrent(s) }"
        @click="onPick(s)"
      >
        <span class="wx-psm-check">{{ isCurrent(s) ? '✓' : '' }}</span>
        <span class="wx-psm-item-body">
          <span class="wx-psm-item-name">{{ s.name }}</span>
          <span class="wx-psm-item-sub">
            {{ s.plan.length }} 个模块 · 已掌握 {{ mastered(s) }}/{{ s.outline.length }}
          </span>
        </span>
      </button>

      <div class="wx-psm-sep"></div>

      <button class="wx-psm-item wx-psm-action" @click="onCreate">＋ 新建学习计划</button>
      <button class="wx-psm-item wx-psm-action" @click="onImportTextbook">＋ 从教材导入…</button>
      <button class="wx-psm-item wx-psm-action" @click="onManage">管理计划…</button>
    </div>
  </div>
</template>

<style scoped>
.wx-psm {
  position: relative;
  display: inline-flex;
}

/* 按钮：非圆角框风格 */
.wx-psm-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
  padding: 7px 14px;
  font-size: 13px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: 2px;
}
.wx-psm-btn:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-psm-btn.open {
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  border-color: var(--wx-border-glow);
}
.wx-psm-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-psm-caret {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--wx-text-muted);
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-psm-caret.open { transform: rotate(180deg); }

/* 下拉面板：可使用 var(--wx-radius-sm) */
.wx-psm-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 80;
  min-width: 300px;
  max-width: 360px;
  padding: 6px;
  background: color-mix(in srgb, var(--wx-bg-deep) 96%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-sm);
  box-shadow: var(--wx-shadow-lg), var(--wx-shadow-glow);
}

.wx-psm-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  border-radius: 2px;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-psm-item:hover { background: color-mix(in srgb, var(--wx-ink) 5%, transparent); }
.wx-psm-item.active { background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent); }

.wx-psm-check {
  flex-shrink: 0;
  width: 12px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
}
.wx-psm-item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.wx-psm-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-psm-item-sub {
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
}

.wx-psm-sep {
  height: 1px;
  margin: 6px 4px;
  background: var(--wx-border-soft);
}

.wx-psm-empty {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--wx-text-muted);
}

.wx-psm-action {
  font-size: 12.5px;
  color: var(--wx-text-secondary);
}
.wx-psm-action:hover { color: var(--wx-color-primary-soft); }
</style>
