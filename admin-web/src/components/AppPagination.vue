<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  page: number
  pageSize: number
  total: number
}>()

const emit = defineEmits<{
  (e: 'update:page', value: number): void
}>()

const totalPages = computed(() => {
  const size = props.pageSize > 0 ? props.pageSize : 1
  return Math.max(1, Math.ceil(props.total / size))
})

const pages = computed<number[]>(() => {
  const count = totalPages.value
  if (count <= 7) {
    return Array.from({ length: count }, (_, i) => i + 1)
  }
  let start = Math.max(1, props.page - 3)
  const end = Math.min(count, start + 6)
  start = Math.max(1, end - 6)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

function go(target: number) {
  if (target < 1 || target > totalPages.value || target === props.page) return
  emit('update:page', target)
}
</script>

<template>
  <div class="pagination">
    <span class="page-info">共 {{ total }} 条</span>
    <div class="page-buttons">
      <button
        type="button"
        class="page-btn"
        :disabled="page <= 1"
        @click="go(page - 1)"
      >
        上一页
      </button>
      <button
        v-for="p in pages"
        :key="p"
        type="button"
        :class="['page-btn', { active: p === page }]"
        @click="go(p)"
      >
        {{ p }}
      </button>
      <button
        type="button"
        class="page-btn"
        :disabled="page >= totalPages"
        @click="go(page + 1)"
      >
        下一页
      </button>
    </div>
  </div>
</template>
