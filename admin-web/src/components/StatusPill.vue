<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  value: string
}>()

const labels: Record<string, string> = {
  verified: '已通过',
  active: '生效中',
  filled: '已铺满',
  draft: '草稿',
  pending: '待处理',
  rejected: '已驳回',
  failed: '失败',
  blocked: '阻塞',
  disabled: '已停用',
  materializing: '生成中',
  archived: '已归档'
}

const label = computed(() => {
  const key = String(props.value ?? '').toLowerCase()
  return labels[key] ?? props.value ?? '—'
})

const tone = computed(() => {
  const key = String(props.value ?? '').toLowerCase()
  if (['verified', 'active', 'filled'].includes(key)) return 'green'
  if (['draft', 'pending'].includes(key)) return 'yellow'
  if (['rejected', 'failed', 'blocked', 'disabled'].includes(key)) return 'red'
  if (key === 'materializing') return 'blue'
  return 'gray'
})
</script>

<template>
  <span :class="['pill', `pill-${tone}`]">{{ label }}</span>
</template>
