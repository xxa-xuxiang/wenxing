<script setup lang="ts">
// 问星社区网页端 — 根布局：极光背景 + 路由出口
// 与桌面端软件内社区页保持一致：不叠加额外顶栏
import AppBackground from '@/components/layout/AppBackground.vue'
</script>

<template>
  <AppBackground />
  <div class="wx-web-shell">
    <main class="wx-web-main">
      <RouterView v-slot="{ Component }">
        <Transition name="wx-fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>
