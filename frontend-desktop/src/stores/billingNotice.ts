// 问星 v1.7 — 计费更新提醒状态：pricingService 检测到计费 version 变化时 show()，
// BillingNotice.vue 消费 visible 渲染左上角卡片
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useBillingNoticeStore = defineStore('billingNotice', () => {
  const visible = ref(false)

  function show(): void {
    visible.value = true
  }

  function hide(): void {
    visible.value = false
  }

  return { visible, show, hide }
})
