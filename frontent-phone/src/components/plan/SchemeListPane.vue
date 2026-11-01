<script setup lang="ts">
// 学习计划方案列表（移动端）：切换 / 重命名 / 删除 / ＋新建（全部为纯本地操作；删除前二次确认）
// allSchemes 里的激活项 id 可能是 '__active__'（尚未归档的顶层方案占位），切换/删除需跳过
import { ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useLearnStore } from '@/stores/learnStore'
import type { PlanScheme } from '@/types'

const learnStore = useLearnStore()

const editingId = ref<string | null>(null)
const nameDraft = ref('')

function isCurrent(s: PlanScheme): boolean {
  return s.id === '__active__' || s.id === learnStore.activePlanId
}

function mastered(s: PlanScheme): number {
  return s.outline.filter((t) => t.status !== 'unknown').length
}

function onSwitch(s: PlanScheme) {
  if (s.id === '__active__') return
  learnStore.switchPlan(s.id)
  showToast(`已切换到「${s.name}」`)
}

function startRename(s: PlanScheme) {
  if (s.id === '__active__') return
  editingId.value = s.id
  nameDraft.value = s.name
}

function commitRename(s: PlanScheme) {
  if (editingId.value !== s.id) return
  editingId.value = null
  const n = nameDraft.value.trim()
  if (!n) return
  learnStore.renameScheme(s.id, n)
  showToast('已重命名')
}

async function onDelete(s: PlanScheme) {
  if (s.id === '__active__') return
  try {
    await showConfirmDialog({
      title: '删除学习计划',
      message: '删除该学习计划？其大纲与排期将一并移除，文档保留。'
    })
  } catch {
    return
  }
  learnStore.deleteScheme(s.id)
  showToast('已删除')
}
</script>

<template>
  <div class="scheme-pane">
    <div class="scheme-list">
      <div v-for="s in learnStore.allSchemes" :key="s.id" class="scheme-row" :class="{ active: isCurrent(s) }">
        <div class="scheme-main">
          <input
            v-if="editingId === s.id"
            v-model="nameDraft"
            class="scheme-rename"
            autofocus
            @keydown.enter="commitRename(s)"
            @blur="commitRename(s)"
          />
          <template v-else>
            <span class="scheme-name">{{ s.name }}</span>
            <span v-if="isCurrent(s)" class="scheme-badge">当前</span>
          </template>
        </div>
        <div class="scheme-sub">{{ s.plan.length }} 个模块 · 已掌握 {{ mastered(s) }}/{{ s.outline.length }}</div>
        <div class="scheme-actions">
          <button class="scheme-btn" @click="onSwitch(s)">切换</button>
          <button class="scheme-btn" @click="startRename(s)">重命名</button>
          <button class="scheme-btn scheme-btn-danger" @click="onDelete(s)">删除</button>
        </div>
      </div>

      <div v-if="learnStore.allSchemes.length === 0" class="scheme-empty">暂无学习计划</div>
    </div>

    <div class="scheme-foot">
      <button class="scheme-new" @click="learnStore.createPlan()">＋ 新建学习计划</button>
    </div>
  </div>
</template>

<style scoped>
.scheme-pane {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--wx-bg-deep);
}
.scheme-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.scheme-row {
  padding: 12px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
  border-left: 2px solid transparent;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.scheme-row.active {
  border-left-color: #4f6ef2;
  background: color-mix(in srgb, #4f6ef2 8%, transparent);
}
.scheme-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.scheme-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scheme-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  font-size: 10px;
  border-radius: 4px;
  color: #4f6ef2;
  background: color-mix(in srgb, #4f6ef2 16%, transparent);
  border: 1px solid rgba(79, 110, 242, 0.35);
}
.scheme-rename {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  font-family: inherit;
  font-size: 13px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid rgba(79, 110, 242, 0.5);
  border-radius: 6px;
  outline: none;
}
.scheme-sub {
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
}
.scheme-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.scheme-btn {
  padding: 5px 12px;
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
}
.scheme-btn-danger {
  color: var(--wx-color-vermilion);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 30%, transparent);
}
.scheme-empty {
  padding: 24px 14px;
  text-align: center;
  font-size: 12px;
  color: var(--wx-text-muted);
}
.scheme-foot {
  flex-shrink: 0;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--wx-border-soft);
}
.scheme-new {
  width: 100%;
  padding: 10px 12px;
  font-size: 12.5px;
  color: #4f6ef2;
  background: color-mix(in srgb, #4f6ef2 10%, transparent);
  border: 1px solid rgba(79, 110, 242, 0.4);
  border-radius: 8px;
}
</style>
