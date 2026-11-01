<script setup lang="ts">
// 问星 — 功能模块独立窗口壳（番茄钟 / 学习笔记 / Anki 记忆卡片 / 学习日历）
// 由 main.ts 按 ?window=pomodoro|notes|anki|calendar 分流挂载；自绘拖拽标题栏 + 对应面板填满窗口
import { computed } from 'vue'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri } from '@/composables/useTauriWindow'
import PomodoroPanel from '@/components/learn/PomodoroPanel.vue'
import NotePad from '@/components/learn/NotePad.vue'
import AnkiPanel from '@/components/learn/AnkiPanel.vue'
import PlanCalendarView from '@/components/learn/PlanCalendarView.vue'

const params = new URLSearchParams(location.search)
const kind = params.get('window')
const noteId = params.get('note') // 社区跳转指定笔记：?window=notes&note=<id>

const TITLE: Record<string, string> = {
  pomodoro: '番茄钟',
  notes: '学习笔记',
  anki: 'Anki 记忆卡片',
  calendar: '学习日历',
}
const title = computed(() => TITLE[kind ?? ''] ?? '问星')

async function closeWin() {
  if (!isTauri()) {
    window.close()
    return
  }
  await getCurrentWebviewWindow().close()
}
</script>

<template>
  <div class="wx-tool-win" data-test="tool-window" :data-test-tool="kind">
    <!-- 自绘标题栏：非交互区可拖拽，关闭按钮 no-drag -->
    <header class="wx-tool-bar wx-app-drag" data-test="tool-titlebar">
      <span class="wx-tool-bar-title" data-test="tool-title">{{ title }}</span>
      <button class="wx-tool-bar-close wx-app-no-drag" title="关闭" data-test="tool-close" @click="closeWin">
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </header>

    <!-- 面板主体：覆盖样式把原右侧抽屉改为填满窗口 -->
    <div class="wx-tool-body">
      <PomodoroPanel v-if="kind === 'pomodoro'" @close="closeWin" />
      <NotePad v-else-if="kind === 'notes'" :note-id="noteId" @close="closeWin" />
      <AnkiPanel v-else-if="kind === 'anki'" @close="closeWin" />
      <PlanCalendarView v-else-if="kind === 'calendar'" embedded />
    </div>
  </div>
</template>

<style scoped>
.wx-tool-win {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--wx-bg-deep);
}

.wx-tool-bar {
  flex-shrink: 0;
  height: var(--wx-titlebar-height, 36px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 0 14px;
  border-bottom: 1px solid var(--wx-border-soft);
  user-select: none;
}
.wx-tool-bar-title {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--wx-text-secondary);
}
.wx-tool-bar-close {
  width: 40px;
  height: calc(var(--wx-titlebar-height, 36px) - 2px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wx-text-tertiary);
  border-radius: 4px;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft),
              color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-tool-bar-close:hover {
  background: var(--wx-color-vermilion);
  color: var(--wx-text-on-accent);
}

.wx-tool-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* 原面板为主窗口右侧固定抽屉（position: fixed），独立窗口内改为静态填满 */
.wx-tool-body :deep(.wx-pomo),
.wx-tool-body :deep(.wx-note),
.wx-tool-body :deep(.wx-anki) {
  position: static;
  width: 100%;
  max-width: none;
  height: auto;
  flex: 1;
  min-height: 0;
  z-index: 1;
  border-left: none;
  box-shadow: none;
  animation: none;
}

/* 学习日历：原为页面内分栏视图，独立窗口内去掉底部大留白、压缩内边距 */
.wx-tool-body :deep(.wx-plan) {
  padding: 14px 18px 18px;
  min-width: 0;
}
</style>
