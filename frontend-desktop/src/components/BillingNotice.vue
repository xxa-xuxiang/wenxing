<!-- 问星 v1.7 — 计费标准更新提醒：左上角滑入卡片，5 秒自动消失，可手动关闭 -->
<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { useBillingNoticeStore } from '@/stores/billingNotice'

const store = useBillingNoticeStore()
let autoHideTimer: number | undefined

function close() {
  window.clearTimeout(autoHideTimer)
  store.hide()
}

// 每次出现重置 5 秒倒计时；手动关闭时取消定时器
watch(
  () => store.visible,
  (v) => {
    window.clearTimeout(autoHideTimer)
    if (v) autoHideTimer = window.setTimeout(close, 5000)
  }
)

onUnmounted(() => window.clearTimeout(autoHideTimer))
</script>

<template>
  <transition name="wx-billing-notice">
    <div v-if="store.visible" class="wx-billing-notice">
      <span class="wx-billing-notice-text">AI 计费标准已更新，请查看个人中心 · 计费</span>
      <button class="wx-billing-notice-close" type="button" aria-label="关闭" @click="close">×</button>
    </div>
  </transition>
</template>

<style scoped>
.wx-billing-notice {
  position: fixed;
  top: 16px;
  left: 16px;
  /* 高于页面内容，低于弹窗/标题栏，不挡弹窗 */
  z-index: 150;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 320px;
  padding: 10px 14px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 85%, transparent);
  box-shadow: var(--wx-shadow-glow);
  backdrop-filter: blur(10px);
}

.wx-billing-notice-text {
  font-size: 13px;
  color: var(--wx-text-primary);
}

.wx-billing-notice-close {
  flex: none;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--wx-text-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}

.wx-billing-notice-close:hover {
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
}

/* 滑入 / 滑出 */
.wx-billing-notice-enter-active,
.wx-billing-notice-leave-active {
  transition: transform 0.28s var(--wx-ease-out-soft), opacity 0.28s var(--wx-ease-out-soft);
}

.wx-billing-notice-enter-from,
.wx-billing-notice-leave-to {
  transform: translateX(-16px);
  opacity: 0;
}
</style>
