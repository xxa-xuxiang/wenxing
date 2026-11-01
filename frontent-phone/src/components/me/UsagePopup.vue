<!-- AI 用量结果弹层：仅在用户点击「AI 用量」并确认后由父级拉取数据展示 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { AiUsageResult } from '@/types/me'

const props = defineProps<{
  show: boolean
  loading: boolean
  data: AiUsageResult | null
  error: string
}>()

const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

/** action → 中文名（与后端 DAILY_LIMITS 分桶对应） */
const ACTION_LABELS: Record<string, string> = {
  recommend: '技能推荐',
  doc: '文档生成',
  revise: '文档修订',
  chat: '对话聊天',
  questions: '批量出题',
  explainCheck: '讲解检测',
  plan: '学习计划'
}

const rows = computed(() => {
  const usage = props.data?.usage ?? {}
  return Object.keys(usage).map((key) => {
    const b = usage[key]
    return {
      key,
      label: ACTION_LABELS[key] ?? key,
      used: b.used,
      limit: b.limit,
      remaining: b.remaining,
      percent: b.limit > 0 ? Math.min(100, Math.round((b.used / b.limit) * 100)) : 0
    }
  })
})

const modeText = computed(() => {
  if (!props.data) return ''
  return props.data.mode === 'byo' ? '自带 API Key · 不计平台 AI 次数' : '平台 AI · 按次计费'
})
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    closeable
    class="usage-popup"
    @update:show="emit('update:show', $event)"
  >
    <h3 class="usage-title">今日 AI 用量</h3>
    <p v-if="modeText" class="usage-mode">当前模式：{{ modeText }}</p>

    <div v-if="loading" class="usage-center">
      <van-loading size="24">查询中…</van-loading>
    </div>

    <div v-else-if="error" class="usage-center">
      <p class="usage-error">{{ error }}</p>
      <p class="usage-hint">请检查网络或服务器地址后重试</p>
    </div>

    <template v-else-if="data">
      <div class="usage-rows">
        <div v-for="r in rows" :key="r.key" class="usage-row">
          <div class="usage-row-head">
            <span class="usage-label">{{ r.label }}</span>
            <span class="usage-count">{{ r.used }} / {{ r.limit }} · 剩余 {{ r.remaining }}</span>
          </div>
          <van-progress :percentage="r.percent" :show-pivot="false" stroke-width="6" />
        </div>
      </div>
      <p v-if="data.billing?.note" class="usage-note">{{ data.billing.note }}</p>
    </template>
  </van-popup>
</template>

<style scoped>
.usage-popup {
  padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
}

.usage-title {
  margin: 0 0 4px;
  font-size: 16px;
  color: #323233;
}

.usage-mode {
  margin: 0 0 14px;
  font-size: 12px;
  color: #969799;
}

.usage-center {
  padding: 32px 0;
  text-align: center;
  color: #969799;
  font-size: 13px;
}

.usage-error {
  margin: 0 0 6px;
  color: #ee0a24;
}

.usage-hint {
  margin: 0;
  font-size: 12px;
  color: #c8c9cc;
}

.usage-rows {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 46vh;
  overflow-y: auto;
}

.usage-row-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}

.usage-label {
  font-size: 13px;
  color: #323233;
}

.usage-count {
  font-size: 11px;
  color: #969799;
}

.usage-note {
  margin: 14px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #c8c9cc;
}
</style>
