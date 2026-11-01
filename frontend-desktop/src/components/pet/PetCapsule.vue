<script setup lang="ts">
// 问星 — 桌宠胶囊状态栏（hover 悬浮球时展开，向右弹出）
// 内容：当前状态图标 + 今日学习进度 + 时钟
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { useCheckinStore } from '@/stores/checkinStore'

const learn = useLearnStore()
const checkin = useCheckinStore()

const now = ref(new Date())
let clockTimer: number | null = null

onMounted(() => {
  clockTimer = window.setInterval(() => {
    now.value = new Date()
  }, 30000)
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
})

const timeStr = computed(() => {
  const h = now.value.getHours().toString().padStart(2, '0')
  const m = now.value.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
})

const taskSummary = computed(() => {
  // 桌宠简化版：只看是否有激活计划
  const hasPlan = Boolean(learn.activePlanId)
  return hasPlan ? '学习中' : '暂无计划'
})

const checkedIn = computed(() => Boolean(checkin.todayRecord))
</script>

<template>
  <div class="wx-pet-capsule" data-test="pet-capsule">
    <!-- 状态段 -->
    <span class="wx-pet-cap-section">
      <span class="wx-pet-cap-dot"></span>
      <span class="wx-pet-cap-label">在线</span>
    </span>
    <span class="wx-pet-cap-divider"></span>
    <!-- 进度段 -->
    <span class="wx-pet-cap-section">
      <span class="wx-pet-cap-icon">✦</span>
      <span class="wx-pet-cap-label">{{ taskSummary }}</span>
    </span>
    <span class="wx-pet-cap-divider"></span>
    <!-- 签到段 -->
    <span class="wx-pet-cap-section">
      <span class="wx-pet-cap-icon">{{ checkedIn ? '✓' : '○' }}</span>
      <span class="wx-pet-cap-label">{{ checkedIn ? '已签到' : '未签到' }}</span>
    </span>
    <span class="wx-pet-cap-divider"></span>
    <!-- 时间段 -->
    <span class="wx-pet-cap-section">
      <span class="wx-pet-cap-label wx-pet-cap-time">{{ timeStr }}</span>
    </span>
  </div>
</template>

<style scoped>
.wx-pet-capsule {
  position: absolute;
  bottom: 4px;   /* 与球同底 */
  right: 48px;   /* 球 36px + 右距 4px + 8px 间距，贴在球左侧 */
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  height: 36px;
  background: color-mix(in srgb, var(--wx-bg-deep) 82%, transparent);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 25%, transparent);
  border-radius: 999px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4), 0 0 20px color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  white-space: nowrap;
  animation: wx-pet-cap-slide 280ms var(--wx-ease-out-soft);
  pointer-events: none;
}

@keyframes wx-pet-cap-slide {
  from {
    opacity: 0;
    transform: translateX(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

.wx-pet-cap-section {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.wx-pet-cap-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--wx-state-deep);
  box-shadow: 0 0 6px var(--wx-state-deep);
  animation: wx-pet-cap-pulse 2s ease-in-out infinite;
}

@keyframes wx-pet-cap-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.wx-pet-cap-icon {
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  line-height: 1;
}

.wx-pet-cap-label {
  font-size: 11px;
  color: var(--wx-text-secondary);
  font-weight: 500;
  letter-spacing: 0.01em;
}

.wx-pet-cap-time {
  color: var(--wx-text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.wx-pet-cap-divider {
  width: 1px;
  height: 14px;
  background: color-mix(in srgb, var(--wx-ink) 10%, transparent);
  margin: 0 2px;
}
</style>
