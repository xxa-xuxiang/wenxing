<script setup lang="ts">
// 学习页（移动端 Tab 1，单栏布局）：
// 顶栏（计划名 / AI 对话 / 更多工具）+ 空态（开始规划 / 从教材导入）+ 执行台（今日面板 + 文档阅读）
// 〔自桌面端 views/LearnView.vue 移植，去番茄钟/笔记/Anki/学习日历/桌宠/多窗口〕
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { showConfirmDialog, showToast, showDialog } from 'vant'
import type { ActionSheetAction } from 'vant'
import { useLearnStore } from '@/stores/learnStore'
import LearnTodayPanel from '@/components/learn/LearnTodayPanel.vue'
import LearnDocView from '@/components/learn/LearnDocView.vue'
import LearnOutlineTree from '@/components/learn/LearnOutlineTree.vue'
import LearnChatPanel from '@/components/learn/LearnChatPanel.vue'
import LearnWizard from '@/components/learn/LearnWizard.vue'
import PlanSwitchMenu from '@/components/plan/PlanSwitchMenu.vue'
import PlanBoard from '@/components/plan/PlanBoard.vue'
import TextbookImportDialog from '@/components/plan/TextbookImportDialog.vue'
import { useCheckinStore, addStudyMinutes, markTaskStudied } from '@/stores/checkinStore'

const learnStore = useLearnStore()
const checkin = useCheckinStore()

// ===== 浮层状态 =====
const treeOpen = ref(false)
const chatShow = ref(false)
const moreShow = ref(false)
const boardOpen = ref(false)
const boardTab = ref<1 | 2>(1)
const textbookOpen = ref(false)

function openBoard(tab: 1 | 2 = 1) {
  boardTab.value = tab
  boardOpen.value = true
}

// ===== 更多工具菜单 =====
interface MoreAction {
  name: string
  key: 'create' | 'switch' | 'sync' | 'reset'
  color?: string
}
const moreActions = computed<MoreAction[]>(() => [
  { name: '新建学习计划', key: 'create' },
  { name: '切换学习计划', key: 'switch' },
  { name: '同步云端打卡记录', key: 'sync' },
  { name: '重置全部进度', key: 'reset', color: '#ee0a24' }
])

async function onMoreSelect(action: MoreAction) {
  if (action.key === 'create') {
    try {
      await showConfirmDialog({
        title: '新建学习计划',
        message: '当前计划将自动归档，开始新的学习规划，是否继续？'
      })
    } catch {
      return
    }
    learnStore.createPlan()
  } else if (action.key === 'switch') {
    openBoard(1)
  } else if (action.key === 'sync') {
    try {
      await showConfirmDialog({
        title: '同步打卡',
        message: '将从云端拉取打卡记录（本地为准合并），是否继续？'
      })
    } catch {
      return
    }
    await checkin.loadRecent(120)
    if (!checkin.error) showToast('打卡记录已同步')
  } else if (action.key === 'reset') {
    try {
      const res = await showDialog({
        title: '重置全部进度',
        message: '将清空学习大纲、文档、计划与知识点掌握度（已登录会同步清空云端），该操作不可撤销。确认重置？',
        showCancelButton: true
      })
      if (res !== 'confirm') return
    } catch {
      return
    }
    learnStore.resetAll()
    showToast('已重置')
  }
}

// ActionSheet 回调包装（模板内不写 TS 断言，统一在 script 内收窄）
function onMoreSheetSelect(a: ActionSheetAction) {
  void onMoreSelect(a as MoreAction)
}

// ===== 学习时间 / 学习项目自动记录（供今日打卡一键读取） =====
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

// 登录/退出切换用户命名空间后对齐打卡本地缓存（authStore 未接管 checkinStore）
onMounted(() => {
  checkin.reload()
})

// 今日面板点击任务 → 滚动到文档区
const docAnchor = ref<HTMLElement | null>(null)
function scrollDoc() {
  docAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="page-with-tabbar llearn">
    <!-- 顶栏：计划切换 + 工具图标 -->
    <header class="llearn-head">
      <div class="llearn-head-main">
        <div class="llearn-title">学习</div>
        <PlanSwitchMenu
          class="llearn-plan-switch"
          @open-board="openBoard(1)"
          @import-textbook="textbookOpen = true"
        />
      </div>
      <div class="llearn-tools">
        <button
          v-if="learnStore.outline.length > 0"
          class="llearn-tool"
          title="目录树"
          @click="treeOpen = true"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 4h14" />
            <path d="M7 4v6" />
            <path d="M7 10h9" />
            <path d="M12 10v5" />
            <path d="M12 15h8" />
          </svg>
        </button>
        <button class="llearn-tool" title="AI 学习伙伴" @click="chatShow = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z" />
            <path d="M9 11h.01M13 11h.01M17 11h.01" />
          </svg>
        </button>
        <button class="llearn-tool" title="更多工具" @click="moreShow = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
    </header>

    <!-- 空态：无学习计划（不自动打开向导，由用户显式点击） -->
    <main v-if="learnStore.outline.length === 0" class="llearn-body llearn-empty">
      <div class="llearn-empty-mark">✧</div>
      <div class="llearn-empty-title">还没有学习计划</div>
      <div class="llearn-empty-sub">
        从「方向与学习合同」开始，问星会陪你完成技能大纲、学前测评、资源准备与计划排期；或从一本 epub 教材直接生成章节计划
      </div>
      <div class="llearn-empty-actions">
        <button class="llearn-empty-btn" @click="learnStore.wizardOpen = true">开始学习规划</button>
        <button class="llearn-empty-btn-ghost" @click="textbookOpen = true">从教材导入</button>
      </div>
    </main>

    <!-- 有计划：执行台（今日面板 + 文档阅读区） -->
    <main v-else class="llearn-body">
      <LearnTodayPanel @open-doc="scrollDoc" />
      <div ref="docAnchor">
        <LearnDocView />
      </div>
    </main>

    <!-- 目录树抽屉（左侧） -->
    <van-popup v-model:show="treeOpen" position="left" :style="{ width: '82%', height: '100%' }">
      <div class="llearn-drawer">
        <div class="llearn-drawer-head">学习大纲</div>
        <LearnOutlineTree @pick="treeOpen = false" />
      </div>
    </van-popup>

    <!-- AI 对话（全屏底部弹层） -->
    <LearnChatPanel v-model:show="chatShow" />

    <!-- 更多工具菜单 -->
    <van-action-sheet
      v-model:show="moreShow"
      :actions="moreActions"
      cancel-text="取消"
      close-on-click-action
      @select="onMoreSheetSelect"
    />

    <!-- 五步向导 / 计划管理 / 教材导入 -->
    <LearnWizard v-if="learnStore.wizardOpen" @close="learnStore.wizardOpen = false" />
    <PlanBoard v-if="boardOpen" :tab="boardTab" @close="boardOpen = false" />
    <TextbookImportDialog v-if="textbookOpen" @close="textbookOpen = false" />
  </div>
</template>

<style scoped>
.llearn {
  min-height: 100vh;
  background: #f7f8fa;
}
.llearn-head {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid #ebedf0;
}
.llearn-head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.llearn-title {
  flex-shrink: 0;
  font-size: 18px;
  font-weight: 700;
  color: #1f2329;
}
.llearn-plan-switch {
  flex: 1;
  min-width: 0;
}
.llearn-tools {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.llearn-tool {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #646566;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
}
.llearn-tool svg {
  width: 18px;
  height: 18px;
}
.llearn-body {
  padding: 12px 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.llearn-empty {
  align-items: center;
  text-align: center;
  padding: 52px 24px 40px;
  gap: 10px;
}
.llearn-empty-mark {
  font-size: 44px;
  color: #4f6ef2;
  filter: drop-shadow(0 0 14px rgba(79, 110, 242, 0.55));
}
.llearn-empty-title {
  font-size: 19px;
  font-weight: 600;
  color: #1f2329;
}
.llearn-empty-sub {
  max-width: 340px;
  font-size: 12.5px;
  line-height: 1.65;
  color: #969799;
}
.llearn-empty-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 280px;
  margin-top: 10px;
}
.llearn-empty-btn {
  width: 100%;
  padding: 12px 20px;
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
  box-shadow: 0 6px 20px rgba(79, 110, 242, 0.3);
}
.llearn-empty-btn-ghost {
  width: 100%;
  padding: 11px 20px;
  font-size: 13px;
  color: #646566;
  background: transparent;
  border: 1px solid #dcdee0;
  border-radius: 999px;
}
.llearn-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.llearn-drawer-head {
  flex-shrink: 0;
  padding: 14px 16px 10px;
  font-size: 15px;
  font-weight: 600;
  color: #1f2329;
  border-bottom: 1px solid #ebedf0;
}
</style>
