<script setup lang="ts">
// 学习工作台：顶栏（左：切换学习计划 / 右：重置）+ 主区（左栏目录树与今日面板 + 右栏完整文档）
// 原「五阶段全屏流程」已收进 LearnWizard 弹框向导；计划安排收进 PlanBoard
// 学习日历 / 番茄钟 / 学习笔记 / Anki 已移到标题栏，各自作为独立窗口打开
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLearnStore } from '@/stores/learnStore'
import PlanSwitchMenu from '@/components/plan/PlanSwitchMenu.vue'
import PlanBoard from '@/components/plan/PlanBoard.vue'
import TextbookImportDialog from '@/components/plan/TextbookImportDialog.vue'
import LearnWizard from '@/components/learn/LearnWizard.vue'
import LearnOutlineTree from '@/components/learn/LearnOutlineTree.vue'
import TodayPanel from '@/components/learn/TodayPanel.vue'
import DocView from '@/components/learn/DocView.vue'
import { addStudyMinutes, markTaskStudied } from '@/stores/checkinStore'
import { openToolWindow } from '@/services/toolWindowService'

const learnStore = useLearnStore()
const route = useRoute()

// ===== 工具浮层 =====
const boardOpen = ref(false)
const boardTab = ref<1 | 3>(1)
function openBoard(tab: 1 | 3) {
  boardTab.value = tab
  boardOpen.value = true
}

// 教材导入覆盖层（与向导并行的第二条计划来源）
const textbookOpen = ref(false)

// 社区侧「学习笔记」卡片跳转：/learn?note=<noteId> → 打开笔记独立窗口并选中该笔记
onMounted(() => {
  const q = route.query.note
  if (typeof q === 'string' && q) {
    openToolWindow('notes', { note: q })
  }
})

// ===== 学习时间 / 学习项目自动记录（供今日打卡一键读取） =====
// 学习时间：学习页可见期间每分钟自动累计；学习项目：打开任务文档即自动记录
const studyTimer = window.setInterval(() => {
  if (document.visibilityState === 'visible') addStudyMinutes(1)
}, 60000)
watch(
  () => learnStore.activeTaskId,
  (id) => {
    if (id) markTaskStudied(id)
  }
)
onBeforeUnmount(() => window.clearInterval(studyTimer))

// 重置二次确认：首次点击进入确认态，3 秒无操作自动恢复，再点才真正重置
const confirmingReset = ref(false)
let resetTimer: number | null = null
function onClickReset() {
  if (!confirmingReset.value) {
    confirmingReset.value = true
    resetTimer = window.setTimeout(() => { confirmingReset.value = false }, 3000)
    return
  }
  if (resetTimer) clearTimeout(resetTimer)
  confirmingReset.value = false
  learnStore.resetAll()
}
</script>

<template>
  <div class="wx-learn">
    <!-- 顶栏：左 切换学习计划 / 右 学习工具 -->
    <header class="wx-learn-topbar">
      <div class="wx-learn-topbar-left">
        <PlanSwitchMenu @open-board="openBoard(1)" @import-textbook="textbookOpen = true" />
      </div>

      <div class="wx-learn-tools">
        <button
          class="wx-reset-btn wx-pressable"
          :class="{ 'wx-reset-confirm': confirmingReset }"
          :title="confirmingReset ? '再次点击确认清空全部进度' : '重置全部（清空大纲与文档）'"
          @click="onClickReset"
        >{{ confirmingReset ? '确认重置？' : '重置' }}</button>
      </div>
    </header>

    <!-- 主区：左栏（今日面板 + 目录树） / 右栏（完整文档） -->
    <div v-if="learnStore.outline.length > 0" class="wx-learn-exec">
      <div class="wx-learn-side">
        <div class="wx-learn-side-top">
          <TodayPanel />
        </div>
        <LearnOutlineTree />
      </div>
      <div class="wx-learn-doc">
        <DocView />
      </div>
    </div>

    <!-- 空态：无学习计划（不自动打开向导，由用户显式点击） -->
    <div v-else class="wx-learn-empty">
      <div class="wx-learn-empty-mark">✧</div>
      <div class="wx-learn-empty-title">还没有学习计划</div>
      <div class="wx-learn-empty-sub">
        从「方向与学习合同」开始，问星会陪你完成技能大纲、学前测评、资源准备与计划排期；或从一本 epub 教材直接生成章节计划
      </div>
      <div class="wx-learn-empty-actions">
        <button class="wx-btn-gradient wx-pressable wx-learn-empty-btn" @click="learnStore.wizardOpen = true">
          开始学习规划
        </button>
        <button class="wx-learn-empty-btn-ghost wx-pressable" @click="textbookOpen = true">
          从教材导入
        </button>
      </div>
    </div>

    <!-- 覆盖层 -->
    <TextbookImportDialog v-if="textbookOpen" @close="textbookOpen = false" />
    <LearnWizard v-if="learnStore.wizardOpen" @close="learnStore.wizardOpen = false" />
    <PlanBoard v-if="boardOpen" :tab="boardTab" @close="boardOpen = false" />
  </div>
</template>

<style scoped>
.wx-learn {
  height: 100%;
  width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 顶栏（z-index 需高于主区内容，低于 40+ 的浮层，否则下拉菜单会被左栏盖住） */
.wx-learn-topbar {
  position: relative;
  z-index: 20;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 9px 20px;
  background: color-mix(in srgb, var(--wx-bg-deep) 22%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-learn-topbar-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.wx-learn-tools {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-reset-btn {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: 3px;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-reset-btn:hover {
  color: var(--wx-color-vermilion);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
}
.wx-reset-btn.wx-reset-confirm {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 85%, transparent);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 60%, transparent);
}

/* 主区：左栏 + 右栏 */
.wx-learn-exec {
  flex: 1;
  min-height: 0;
  display: flex;
}
.wx-learn-side {
  width: 280px;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 18%, transparent);
  overflow: hidden;
}
.wx-learn-side-top {
  flex: 0 1 auto;
  max-height: 40%;
  min-height: 0;
  display: flex;
  border-bottom: 1px solid var(--wx-border-soft);
  overflow: hidden;
}
.wx-learn-side-top > * { flex: 1; min-width: 0; }

.wx-learn-doc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* 空态 */
.wx-learn-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
}
.wx-learn-empty-mark {
  font-size: 46px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 14px var(--wx-color-primary));
  animation: wx-breathe 4s var(--wx-ease-in-out-soft) infinite alternate;
}
.wx-learn-empty-title {
  font-size: 20px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  letter-spacing: 0.04em;
}
.wx-learn-empty-sub {
  max-width: 460px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--wx-text-tertiary);
}
.wx-learn-empty-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}
.wx-learn-empty-btn {
  padding: 10px 26px;
  font-size: 13.5px;
  font-weight: 600;
}
/* 次要入口：从教材导入（透明底 + 细边框） */
.wx-learn-empty-btn-ghost {
  padding: 9px 22px;
  font-size: 13px;
  color: var(--wx-text-secondary);
  background: transparent;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-learn-empty-btn-ghost:hover {
  color: var(--wx-text-primary);
  border-color: var(--wx-border-glow);
}
</style>
