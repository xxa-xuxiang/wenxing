<script setup lang="ts">
// 问星 v1.5 — 翻译结果卡片（纯展示）
// 用于桌宠翻译面板与应用内划词浮层，视觉与聊天面板一致
import StarLoader from '@/components/common/StarLoader.vue'
import type { TranslateResult } from '@/services/translateService'

defineProps<{
  result: TranslateResult | null
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  (e: 'retry'): void
  (e: 'swap'): void
  (e: 'copy'): void
}>()

/** 语言标签 */
function langLabel(code: 'zh' | 'en'): string {
  return code === 'zh' ? '中文' : 'English'
}
</script>

<template>
  <div class="wx-tr-card">
    <!-- 加载中 -->
    <div v-if="loading" class="wx-tr-state">
      <StarLoader :size="26" />
      <span class="wx-tr-state-text">翻译中…</span>
    </div>

    <!-- 失败 -->
    <div v-else-if="error" class="wx-tr-state wx-tr-state-error">
      <span class="wx-tr-state-text">{{ error }}</span>
      <button class="wx-tr-retry wx-pressable" @click="emit('retry')">重试</button>
    </div>

    <!-- 结果 -->
    <template v-else-if="result">
      <div class="wx-tr-meta">
        <span class="wx-tr-lang">{{ langLabel(result.fromLang) }}</span>
        <span class="wx-tr-arrow">→</span>
        <span class="wx-tr-lang">{{ langLabel(result.toLang) }}</span>
        <span class="wx-tr-elapsed">
          {{ result.cached ? '缓存命中' : `${result.elapsedMs}ms` }}
        </span>
      </div>

      <div class="wx-tr-result">{{ result.translation }}</div>

      <div v-if="result.terms.length" class="wx-tr-terms">
        <span
          v-for="t in result.terms.slice(0, 8)"
          :key="`${t.zh}-${t.en}`"
          class="wx-tr-term"
          :title="t.note || `${t.zh} = ${t.en}`"
        >
          {{ result.fromLang === 'zh' ? t.zh : t.en }}
          <i>→</i>
          {{ result.fromLang === 'zh' ? t.en : t.zh }}
        </span>
      </div>

      <div class="wx-tr-actions">
        <button class="wx-tr-act wx-pressable" @click="emit('swap')" title="中英互换">⇄ 互换</button>
        <button class="wx-tr-act wx-pressable" @click="emit('copy')" title="复制译文">⧉ 复制</button>
        <button class="wx-tr-act wx-pressable" @click="emit('retry')" title="重新翻译">↻ 重译</button>
      </div>
    </template>

    <!-- 空态 -->
    <div v-else class="wx-tr-state">
      <span class="wx-tr-state-text">选中文字后按 Ctrl+Shift+T</span>
    </div>
  </div>
</template>

<style scoped>
.wx-tr-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 120px;
}

.wx-tr-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 8px;
  color: var(--wx-text-tertiary);
}
.wx-tr-state-text { font-size: 12px; line-height: 1.6; text-align: center; }
.wx-tr-state-error .wx-tr-state-text { color: #ff8a8a; }

.wx-tr-retry {
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
}

.wx-tr-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--wx-text-tertiary);
}
.wx-tr-lang { color: var(--wx-color-primary-soft); }
.wx-tr-arrow { opacity: 0.6; }
.wx-tr-elapsed {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  color: var(--wx-text-secondary);
}

.wx-tr-result {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--wx-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.wx-tr-terms { display: flex; flex-wrap: wrap; gap: 5px; }
.wx-tr-term {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
  cursor: default;
}
.wx-tr-term i { font-style: normal; opacity: 0.55; margin: 0 2px; }

.wx-tr-actions { display: flex; gap: 6px; }
.wx-tr-act {
  flex: 1;
  padding: 6px 0;
  border-radius: 8px;
  font-size: 11px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-ink) 8%, transparent);
  transition: all var(--wx-duration-fast);
}
.wx-tr-act:hover {
  color: var(--wx-text-primary);
  border-color: color-mix(in srgb, var(--wx-color-primary) 35%, transparent);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
}
</style>
