<script setup lang="ts">
// 工作台左栏「学习大纲」目录树：已打开标签条（可换行 chip）+ 模块/任务两级树 + 定制下一个任务
// 数据全部来自现有 store（plan / outline / openTaskIds），无新增状态机
import { computed, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import NextTaskPicker from '@/components/learn/NextTaskPicker.vue'
import type { LearnStatus, OutlineTask } from '@/types'

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
  if (s === 'light') return 'wx-dot-light'
  if (s === 'deep') return 'wx-dot-deep'
  return 'wx-dot-unknown'
}
function statusLabel(s: LearnStatus): string {
  if (s === 'light') return '轻掌握'
  if (s === 'deep') return '深度掌握'
  return '未学'
}

const showPicker = ref(false)
</script>

<template>
  <aside class="wx-tree">
    <!-- 目录树 -->
    <div class="wx-tree-scroll">
      <template v-for="g in groups" :key="g.id">
        <button class="wx-tree-mod" :title="g.name" @click="toggleGroup(g.id)">
          <span class="wx-tree-arrow" :class="{ open: !isCollapsed(g.id) }">▸</span>
          <span class="wx-tree-mod-name">{{ g.name }}</span>
          <span class="wx-tree-mod-count">{{ masteredCount(g) }}/{{ g.tasks.length }}</span>
        </button>

        <div v-if="!isCollapsed(g.id)" class="wx-tree-tasks">
          <button
            v-for="t in g.tasks"
            :key="t.id"
            class="wx-tree-task"
            :class="{ active: t.id === learnStore.activeTaskId }"
            :title="`${t.title} · ${statusLabel(t.status)}`"
            @click="learnStore.openTask(t.id)"
          >
            <span class="wx-dot" :class="dotClass(t.status)"></span>
            <span class="wx-tree-task-title">{{ t.title }}</span>
          </button>
        </div>
      </template>

      <div v-if="groups.length === 0" class="wx-tree-empty">大纲为空，去定制第一个任务</div>
    </div>

    <div class="wx-tree-foot">
      <button class="wx-tree-add wx-pressable" @click="showPicker = true">＋ 定制下一个任务</button>
    </div>

    <NextTaskPicker v-if="showPicker" @close="showPicker = false" />
  </aside>
</template>

<style scoped>
.wx-tree {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 目录树 */
.wx-tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 0 12px;
}

.wx-tree-mod {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 8px 12px 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--wx-border-soft);
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-tree-mod:hover { background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent); }
.wx-tree-arrow {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--wx-text-muted);
  transform: rotate(0deg);
  transition: transform var(--wx-duration-fast) var(--wx-ease-spring);
}
.wx-tree-arrow.open { transform: rotate(90deg); }
.wx-tree-mod-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-tree-mod-count {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}

/* 任务：竖线 + 树线枝干（非圆角框） */
.wx-tree-tasks {
  margin-left: 16px;
  padding-left: 8px;
  border-left: 1px solid var(--wx-border-soft);
}
.wx-tree-task {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px 6px 14px;
  text-align: left;
  border-left: 2px solid transparent;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-tree-task::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 10px;
  height: 1px;
  background: var(--wx-border-soft);
}
.wx-tree-task:hover { background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent); }
.wx-tree-task:hover .wx-tree-task-title { color: var(--wx-text-primary); }
.wx-tree-task.active {
  border-left-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-tree-task-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-tree-task.active .wx-tree-task-title { color: var(--wx-text-primary); }
.wx-tree-task .wx-dot { flex-shrink: 0; }

.wx-tree-empty {
  padding: 20px 14px;
  font-size: 12px;
  color: var(--wx-text-muted);
}

/* 底部：定制下一个任务 */
.wx-tree-foot {
  flex-shrink: 0;
  padding: 10px 12px 14px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-tree-add {
  width: 100%;
  padding: 8px 12px;
  border-radius: 2px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  border: 1px dashed var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-tree-add:hover { background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent); color: var(--wx-text-on-accent); }
</style>
