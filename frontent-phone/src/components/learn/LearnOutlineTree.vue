<script setup lang="ts">
// 目录树（移动端抽屉内）：计划模块/任务两级树 + 定制下一个任务
// 点击任务切换当前文档；展开状态本地维护，当前任务高亮〔对齐桌面端 LearnOutlineTree〕
import { computed, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import NextTaskPicker from '@/components/learn/NextTaskPicker.vue'
import type { LearnStatus, OutlineTask } from '@/types'

const emit = defineEmits<{ (e: 'pick'): void }>()

const learnStore = useLearnStore()

interface TreeGroup {
  id: string
  name: string
  tasks: OutlineTask[]
}

// 折叠状态（局部，不持久化）
const collapsed = ref<Set<string>>(new Set())
function toggleGroup(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}
function isCollapsed(id: string): boolean {
  return collapsed.value.has(id)
}

// 模块分组：按学习计划模块顺序；未入块的任务归入「未分组」；无计划时整体为「未分组」
const groups = computed<TreeGroup[]>(() => {
  const byId = new Map(learnStore.outline.map((t) => [t.id, t]))
  const assigned = new Set<string>()
  const out: TreeGroup[] = []
  for (const b of learnStore.plan) {
    const tasks = b.taskIds.map((id) => byId.get(id)).filter((t): t is OutlineTask => Boolean(t))
    for (const t of tasks) assigned.add(t.id)
    if (tasks.length > 0) out.push({ id: b.id, name: b.name, tasks })
  }
  const rest = learnStore.outline.filter((t) => !assigned.has(t.id))
  if (rest.length > 0) out.push({ id: '__ungrouped__', name: '未分组', tasks: rest })
  return out
})

function masteredCount(g: TreeGroup): number {
  return g.tasks.filter((t) => t.status !== 'unknown').length
}

function dotClass(s: LearnStatus): string {
  if (s === 'light') return 'lt-dot-light'
  if (s === 'deep') return 'lt-dot-deep'
  return 'lt-dot-unknown'
}
function statusLabel(s: LearnStatus): string {
  if (s === 'light') return '轻掌握'
  if (s === 'deep') return '深度掌握'
  return '未学'
}

const showPicker = ref(false)

function pick(id: string) {
  learnStore.openTask(id)
  emit('pick')
}
</script>

<template>
  <div class="ltree">
    <div class="ltree-scroll">
      <template v-for="g in groups" :key="g.id">
        <button class="ltree-mod" @click="toggleGroup(g.id)">
          <span class="ltree-arrow" :class="{ open: !isCollapsed(g.id) }">▸</span>
          <span class="ltree-mod-name">{{ g.name }}</span>
          <span class="ltree-mod-count">{{ masteredCount(g) }}/{{ g.tasks.length }}</span>
        </button>

        <div v-if="!isCollapsed(g.id)" class="ltree-tasks">
          <button
            v-for="t in g.tasks"
            :key="t.id"
            class="ltree-task"
            :class="{ active: t.id === learnStore.activeTaskId }"
            :title="`${t.title} · ${statusLabel(t.status)}`"
            @click="pick(t.id)"
          >
            <span class="ltree-dot" :class="dotClass(t.status)"></span>
            <span class="ltree-task-title">{{ t.title }}</span>
          </button>
        </div>
      </template>

      <div v-if="groups.length === 0" class="ltree-empty">大纲为空，去定制第一个任务</div>
    </div>

    <div class="ltree-foot">
      <button class="ltree-add" @click="showPicker = true">＋ 定制下一个任务</button>
    </div>

    <NextTaskPicker v-if="showPicker" @close="showPicker = false" />
  </div>
</template>

<style scoped>
.ltree {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.ltree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0 12px;
}
.ltree-mod {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 10px 14px;
  text-align: left;
  border-bottom: 1px solid #f0f1f3;
  background: none;
}
.ltree-arrow {
  flex-shrink: 0;
  font-size: 10px;
  color: #969799;
  transition: transform 0.2s;
}
.ltree-arrow.open {
  transform: rotate(90deg);
}
.ltree-mod-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2329;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltree-mod-count {
  flex-shrink: 0;
  font-size: 10.5px;
  color: #969799;
}
.ltree-tasks {
  margin-left: 18px;
  padding-left: 8px;
  border-left: 1px solid #ebedf0;
}
.ltree-task {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px 8px 12px;
  text-align: left;
  border-left: 2px solid transparent;
  background: none;
}
.ltree-task.active {
  border-left-color: #4f6ef2;
  background: rgba(79, 110, 242, 0.07);
}
.ltree-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.ltree-dot-deep {
  background: #22c55e;
}
.ltree-dot-light {
  background: #fbbf24;
}
.ltree-dot-unknown {
  background: #c8c9cc;
}
.ltree-task-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #43474d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltree-task.active .ltree-task-title {
  color: #4f6ef2;
  font-weight: 600;
}
.ltree-empty {
  padding: 24px 14px;
  font-size: 12.5px;
  color: #969799;
  text-align: center;
}
.ltree-foot {
  flex-shrink: 0;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid #ebedf0;
}
.ltree-add {
  width: 100%;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  color: #4f6ef2;
  border: 1px dashed rgba(79, 110, 242, 0.45);
  background: rgba(79, 110, 242, 0.06);
}
</style>
