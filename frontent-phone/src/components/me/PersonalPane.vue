<!-- 个性化分区：主题三态（跟随系统 / 极夜黑 / 曙光白），选中即持久化 -->
<script setup lang="ts">
import { computed } from 'vue'
import { THEMES, useThemeStore } from '@/stores/themeStore'

const themeStore = useThemeStore()

/** 当前实际解析出的主题（auto 时按系统深色 / 浅色） */
const resolvedName = computed(() => (themeStore.name === 'midnight' ? '极夜黑' : '曙光白'))
</script>

<template>
  <div class="pane">
    <section class="card">
      <h3 class="card-title">整体风格</h3>
      <div class="theme-list">
        <button
          v-for="t in THEMES"
          :key="t.id"
          type="button"
          class="theme-card"
          :class="{ active: themeStore.choice === t.id }"
          @click="themeStore.set(t.id)"
        >
          <span class="swatch" :class="'swatch-' + t.id"></span>
          <span class="theme-name">{{ t.name }}</span>
          <span class="theme-hint">{{ t.hint }}</span>
        </button>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">当前主题</h3>
      <div class="current">
        <span class="current-label">解析结果</span>
        <span class="current-value">{{ resolvedName }}</span>
        <van-tag type="primary" plain>{{ themeStore.choice === 'auto' ? '跟随系统' : '手动选择' }}</van-tag>
      </div>
      <p class="tip">
        主题主要驱动星图与桌面风面板；其余 Vant 页面保持浅色。选择后立即生效并保存在本机，下次启动沿用。
      </p>
    </section>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: #fff;
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 4px 14px rgba(25, 137, 250, 0.06);
}

.card-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.theme-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  text-align: left;
  border-radius: 12px;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
  transition: all 0.15s ease;
}

.theme-card.active {
  border-color: #1989fa;
  background: rgba(25, 137, 250, 0.06);
  box-shadow: 0 0 0 1px rgba(25, 137, 250, 0.25);
}

.theme-card.active::after {
  content: '✓';
  position: absolute;
  top: 10px;
  right: 12px;
  font-size: 14px;
  font-weight: 700;
  color: #1989fa;
}

.swatch {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  border: 1px solid #ebedf0;
  margin-bottom: 4px;
}

.swatch-auto {
  background: linear-gradient(135deg, #000510 0%, #030018 49%, #fff5e8 50%, #fff5e8 100%);
}

.swatch-midnight {
  background: linear-gradient(135deg, #000510 0%, #030018 50%, #000 100%);
}

.swatch-dawn {
  background: linear-gradient(135deg, #fff5e8 0%, #ffe8f0 50%, #f0f4ff 100%);
}

.theme-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #323233;
}

.theme-hint {
  font-size: 11px;
  color: #969799;
}

.current {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f7f8fa;
}

.current-label {
  font-size: 12px;
  color: #969799;
}

.current-value {
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.tip {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: #969799;
}
</style>
