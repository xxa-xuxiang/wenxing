<script setup lang="ts">
// 学习计划方案列表：切换 / 重命名 / 删除 / ＋新建（全部为纯本地操作；删除前二次确认）
// allSchemes 里的激活项 id 可能是 '__active__'（尚未归档的顶层方案占位），切换/删除需跳过
import { ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import type { PlanScheme } from '@/types'

const learnStore = useLearnStore()

const editingId = ref<string | null>(null)
const nameDraft = ref('')

/** 是否为当前激活方案（真实 id 或 '__active__' 占位） */
function isCurrent(s: PlanScheme): boolean {
  return s.id === '__active__' || s.id === learnStore.activePlanId
}

/** 已掌握任务数（status !== 'unknown'） */
function mastered(s: PlanScheme): number {
  return s.outline.filter((t) => t.status !== 'unknown').length
}

function onSwitch(s: PlanScheme) {
  if (s.id === '__active__') return
  learnStore.switchPlan(s.id)
}

function startRename(s: PlanScheme) {
  editingId.value = s.id
  nameDraft.value = s.name
}

function commitRename(s: PlanScheme) {
  if (editingId.value !== s.id) return
  editingId.value = null
  learnStore.renameScheme(s.id, nameDraft.value)
}

function onDelete(s: PlanScheme) {
  if (s.id === '__active__') return
  if (!window.confirm('删除该学习计划？其大纲与排期将一并移除，文档保留。')) return
  learnStore.deleteScheme(s.id)
}
</script>

<template>
  <div class="wx-scheme-pane">
    <div class="wx-scheme-list">
      <div
        v-for="s in learnStore.allSchemes"
        :key="s.id"
        class="wx-scheme-row"
        :class="{ active: isCurrent(s) }"
      >
        <div class="wx-scheme-main">
          <input
            v-if="editingId === s.id"
            v-model="nameDraft"
            class="wx-scheme-rename"
            autofocus
            @keydown.enter="commitRename(s)"
            @blur="commitRename(s)"
          />
          <template v-else>
            <span class="wx-scheme-name">{{ s.name }}</span>
            <span v-if="isCurrent(s)" class="wx-scheme-badge">当前</span>
          </template>
        </div>
        <div class="wx-scheme-sub">
          {{ s.plan.length }} 个模块 · 已掌握 {{ mastered(s) }}/{{ s.outline.length }}
        </div>
        <div class="wx-scheme-actions">
          <button class="wx-scheme-btn wx-pressable" @click="onSwitch(s)">切换</button>
          <button class="wx-scheme-btn wx-pressable" @click="startRename(s)">重命名</button>
          <button
            class="wx-scheme-btn wx-scheme-btn-danger wx-pressable"
            @click="onDelete(s)"
          >删除</button>
        </div>
      </div>

      <div v-if="learnStore.allSchemes.length === 0" class="wx-scheme-empty">
        暂无学习计划
      </div>
    </div>

    <div class="wx-scheme-foot">
      <button class="wx-scheme-new wx-pressable" @click="learnStore.createPlan()">
        ＋ 新建学习计划
      </button>
    </div>
  </div>
</template>

<style scoped>
.wx-scheme-pane {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.wx-scheme-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 行：非圆角框风格，行间细线分隔；选中左侧 2px 主色竖线 */
.wx-scheme-row {
  padding: 12px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
  border-left: 2px solid transparent;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-scheme-row:hover { background: color-mix(in srgb, var(--wx-ink) 3%, transparent); }
.wx-scheme-row.active {
  border-left-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}

.wx-scheme-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wx-scheme-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-scheme-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  font-size: 10px;
  border-radius: 2px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
  border: 1px solid var(--wx-border-glow);
}
.wx-scheme-rename {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  font-family: inherit;
  font-size: 13px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: 2px;
  outline: none;
}

.wx-scheme-sub {
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
}

.wx-scheme-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wx-scheme-btn {
  padding: 3px 10px;
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: 2px;
}
.wx-scheme-btn:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-scheme-btn-danger:hover {
  color: var(--wx-color-vermilion);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
}

.wx-scheme-empty {
  padding: 24px 14px;
  text-align: center;
  font-size: 12px;
  color: var(--wx-text-muted);
}

.wx-scheme-foot {
  flex-shrink: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-scheme-new {
  width: 100%;
  padding: 9px 12px;
  font-size: 12.5px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: 2px;
}
.wx-scheme-new:hover {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
}
</style>
