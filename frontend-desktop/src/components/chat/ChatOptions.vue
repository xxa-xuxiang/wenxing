<script setup lang="ts">
// 问星 v1.5 — 聊天选择题选项组
// 渲染在 AI 回复气泡下方；点击即作为用户消息发出，选中后其余选项置灰
defineProps<{
  options: string[]
  chosen?: string
}>()

const emit = defineEmits<{ (e: 'choose', option: string): void }>()

function pick(option: string, disabled: boolean) {
  if (disabled) return
  emit('choose', option)
}
</script>

<template>
  <div class="wx-chat-options">
    <button
      v-for="opt in options"
      :key="opt"
      class="wx-chat-option"
      :class="{ 'wx-chat-option-chosen': chosen === opt, 'wx-chat-option-disabled': !!chosen }"
      :disabled="!!chosen"
      @click="pick(opt, !!chosen)"
    >
      {{ opt }}
    </button>
  </div>
</template>

<style scoped>
.wx-chat-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.wx-chat-option {
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}

.wx-chat-option:hover:not(:disabled) {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 28%, transparent);
  border-color: color-mix(in srgb, var(--wx-color-primary) 55%, transparent);
  transform: translateY(-1px);
}

.wx-chat-option-chosen {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
}

.wx-chat-option-disabled {
  opacity: 0.45;
  cursor: default;
}

.wx-chat-option-chosen.wx-chat-option-disabled {
  opacity: 1;
}
</style>
