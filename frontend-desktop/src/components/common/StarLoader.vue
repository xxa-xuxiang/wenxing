<script setup lang="ts">
// 问星 — 通用加载动画（旋转星星）
// props：size（px）/ text（旁边文案）
import { computed } from 'vue'

const props = withDefaults(defineProps<{ size?: number; text?: string; speed?: number }>(), {
  size: 48,
  text: '',
  speed: 1.6, // 旋转周期（秒）
})

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  animationDuration: `${props.speed}s`,
}))
</script>

<template>
  <div class="wx-star-loader" :class="{ 'wx-star-loader-inline': !!text }">
    <div class="wx-star-rotate" :style="style">
      <!-- 六角星 CSS 绘制 -->
      <svg class="wx-star-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <polygon
          points="50,5 61,38 96,38 67,58 78,92 50,72 22,92 33,58 4,38 39,38"
          fill="url(#wx-star-grad)"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
        <defs>
          <linearGradient id="wx-star-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#a5b4fc" />
            <stop offset="60%" stop-color="#818cf8" />
            <stop offset="100%" stop-color="#c084fc" />
          </linearGradient>
        </defs>
      </svg>
      <!-- 光晕 -->
      <span class="wx-star-glow"></span>
    </div>
    <span v-if="text" class="wx-star-text">{{ text }}</span>
  </div>
</template>

<style scoped>
.wx-star-loader {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--wx-color-primary-soft);
}
.wx-star-loader-inline { gap: 12px; }

.wx-star-rotate {
  position: relative;
  animation: wx-star-spin var(--dur, 1.6s) linear infinite;
}

@keyframes wx-star-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.wx-star-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--wx-color-primary) 55%, transparent));
}

.wx-star-glow {
  position: absolute;
  inset: -20%;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--wx-color-primary) 28%, transparent) 0%, transparent 65%);
  animation: wx-star-pulse 1.6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes wx-star-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.92); }
  50%      { opacity: 0.9;  transform: scale(1.1); }
}

.wx-star-text {
  font-size: 13px;
  color: var(--wx-text-secondary);
  letter-spacing: 0.04em;
}
</style>
