<script setup lang="ts">
// 问星 — 桌宠聊天独立原生窗口（label: pet-chat，可移动/缩放/最大化）
// 关闭按钮只隐藏窗口不销毁，保留会话上下文；再次点击悬浮球即聚焦回来
import { onMounted } from 'vue'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri } from '@/composables/useTauriWindow'
import PetChatPanel from '@/components/pet/PetChatPanel.vue'

async function closeWindow() {
  if (!isTauri()) return
  try {
    await getCurrentWebviewWindow().hide()
  } catch (e) {
    console.warn('[pet-chat] hide error:', e)
  }
}

onMounted(async () => {
  if (!isTauri()) return
  // 原生关闭按钮（×）同样转为隐藏，避免窗口销毁后聊天状态丢失
  try {
    const win = getCurrentWebviewWindow()
    await win.onCloseRequested((e) => {
      e.preventDefault()
      void win.hide()
    })
  } catch (e) {
    console.warn('[pet-chat] onCloseRequested error:', e)
  }
})
</script>

<template>
  <div class="wx-petchat-root" data-test="pet-chat-window">
    <PetChatPanel @close="closeWindow" />
  </div>
</template>

<style scoped>
.wx-petchat-root {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: var(--wx-bg-deep);
}

/* 独立窗口模式：聊天面板铺满整个窗口，去掉内嵌桌宠时的偏移与圆角 */
.wx-petchat-root :deep(.wx-pet-chat) {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  max-width: none;
  height: 100%;
  border-radius: 0;
  border: none;
  box-shadow: none;
  animation: none;
}
</style>
