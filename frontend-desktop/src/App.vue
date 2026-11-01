<script setup lang="ts">
// 问星 v0.7 — 根布局：自绘标题栏（fixed 顶层） + 背景层 + 路由出口 + 底部导航
// AI 桌宠已分离为独立 Tauri 子窗口，不再在主窗口内部渲染
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import TitleBar from '@/components/window/TitleBar.vue'
import AppBackground from '@/components/layout/AppBackground.vue'
import AppNav from '@/components/layout/AppNav.vue'
import ProfileDialog from '@/components/common/ProfileDialog.vue'
import SelectionTrigger from '@/components/translate/SelectionTrigger.vue'
import BillingNotice from '@/components/BillingNotice.vue'
import { useMainWindowLifecycle } from '@/composables/useTauriWindow'
import { installClickListener, installFlushHooks } from '@/services/trackService'
import { initBillingWatch } from '@/services/pricingService'
import { flushFeedbackQueue } from '@/services/feedbackService'
import { useNightUiStore } from '@/stores/nightUi'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isAuthPage = computed(() => route.path === '/auth')
const nightUi = useNightUiStore()

// 主窗口：mounted 时拉起桌宠子窗口
useMainWindowLifecycle()

/** 账号禁用事件只处理一次（并发请求可能同时触发） */
let accountDisabledHandled = false
function onAccountDisabled(): void {
  if (accountDisabledHandled) return
  accountDisabledHandled = true
  auth.logout()
  void router.replace('/auth').finally(() => window.alert('账号已被禁用'))
}

// 全局埋点（点击委托 + 关闭兜底 flush）与计费更新监听
onMounted(() => {
  installClickListener()
  installFlushHooks()
  initBillingWatch()
  // 补发上次离线期间积压的微反馈（最多 50 条，静默失败）
  void flushFeedbackQueue()
  window.addEventListener('wx:account-disabled', onAccountDisabled)
})

onUnmounted(() => {
  window.removeEventListener('wx:account-disabled', onAccountDisabled)
})
</script>

<template>
  <AppBackground />
  <div class="wx-app-shell" :class="{ 'nt-root': nightUi.enabled }" data-test="app-shell">
    <TitleBar v-if="!isAuthPage" />
    <main class="wx-app-main" :class="{ 'wx-app-main-auth': isAuthPage }" data-test="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="wx-fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <AppNav v-if="!isAuthPage" />
    <ProfileDialog />
    <SelectionTrigger v-if="!isAuthPage" />
  </div>
  <BillingNotice />
</template>

<style scoped>
.wx-app-shell {
  position: relative;
  z-index: 1;
  height: 100%;
  width: 100%;
}

/* 内容区为自绘标题栏预留顶部空间 */
.wx-app-main {
  height: 100%;
  width: 100%;
  padding-top: var(--wx-titlebar-height, 36px);
  padding-bottom: 0;
  overflow: hidden;
}

.wx-app-main-auth {
  padding-top: 0;
}
</style>
