<!-- 星图关联文档底部弹层：按知识点检索向量库 TopK 文档（/api/vector/search，展开弹层时按需调用） -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { searchRelated } from '@/utils/vectorApi'
import type { RelatedDoc } from '@/utils/vectorApi'

const props = defineProps<{
  show: boolean
  kp: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const router = useRouter()

// ===== 检索状态 =====
type Phase = 'loading' | 'done' | 'error'
const phase = ref<Phase>('loading')
const errorMsg = ref('')
const degraded = ref(false)
const docs = ref<RelatedDoc[]>([])

async function load() {
  phase.value = 'loading'
  errorMsg.value = ''
  docs.value = []
  degraded.value = false
  const q = props.kp.trim()
  if (!q) {
    phase.value = 'error'
    errorMsg.value = '缺少知识点名称'
    return
  }
  try {
    const data = await searchRelated(q, 5)
    docs.value = data.docs
    degraded.value = data.degraded
    phase.value = 'done'
  } catch (e) {
    phase.value = 'error'
    errorMsg.value = e instanceof Error ? e.message : '检索失败，请重试'
  }
}

/** 点击文档条目：跳转学习页 */
function openDoc() {
  emit('close')
  void router.push('/learn')
}

/** 相似度标签 */
function scoreLabel(d: RelatedDoc): string {
  return d.score === null ? '关键词匹配' : `相似度 ${Math.round(d.score * 100)}%`
}

// 打开时按需检索（不在页面加载时调用）；打开中知识点变化则重查
watch(
  () => props.show,
  (v) => {
    if (v) void load()
  }
)
watch(
  () => props.kp,
  () => {
    if (props.show) void load()
  }
)
</script>

<template>
  <van-popup
    :show="props.show"
    position="bottom"
    round
    class="rds-popup"
    @update:show="(v: boolean) => { if (!v) emit('close') }"
  >
    <div class="rds">
      <header class="rds-head">
        <div class="rds-head-info">
          <div class="rds-title">关联文档</div>
          <div class="rds-sub">「{{ kp }}」· 向量库 Top5</div>
        </div>
        <button class="rds-close" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <!-- 降级提示条 -->
      <div v-if="degraded && phase === 'done'" class="rds-degraded">
        未配置向量服务，当前为关键词匹配模式
      </div>

      <!-- 加载态 -->
      <div v-if="phase === 'loading'" class="rds-state">
        <div class="rds-mark">✦</div>
        <div class="rds-text">正在检索关联文档…</div>
      </div>

      <!-- 错误态 -->
      <div v-else-if="phase === 'error'" class="rds-state">
        <div class="rds-mark err">⚠</div>
        <div class="rds-text">{{ errorMsg }}</div>
        <button class="rds-retry" @click="load">重新检索</button>
      </div>

      <!-- 空态 -->
      <div v-else-if="!docs.length" class="rds-state">
        <div class="rds-mark">✧</div>
        <div class="rds-text">暂未找到与「{{ kp }}」相关的文档</div>
      </div>

      <!-- 结果列表：点击条目跳转学习页 -->
      <ul v-else class="rds-list">
        <li v-for="doc in docs" :key="doc.file" class="rds-item" @click="openDoc">
          <div class="rds-item-top">
            <span class="rds-item-title">{{ doc.title }}</span>
            <span class="rds-score" :class="{ keyword: doc.score === null }">{{ scoreLabel(doc) }}</span>
          </div>
          <div class="rds-item-meta">
            <span class="rds-industry">{{ doc.industry }}</span>
            <span v-for="t in doc.tags.slice(0, 4)" :key="t" class="rds-tag">{{ t }}</span>
          </div>
          <p v-if="doc.snippet" class="rds-snippet">{{ doc.snippet }}</p>
        </li>
      </ul>
    </div>
  </van-popup>
</template>

<style scoped>
.rds-popup {
  max-height: 70vh;
  border-radius: 16px 16px 0 0;
}
.rds {
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  padding-bottom: env(safe-area-inset-bottom);
}
.rds-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  border-bottom: 1px solid #f0f1f5;
}
.rds-head-info {
  min-width: 0;
}
.rds-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}
.rds-sub {
  margin-top: 3px;
  font-size: 12px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rds-close {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  font-size: 17px;
  color: #6b7280;
  line-height: 1;
}
.rds-degraded {
  margin: 10px 16px 0;
  padding: 7px 11px;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.3);
  font-size: 12px;
  color: #b45309;
}
.rds-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 24px;
  text-align: center;
}
.rds-mark {
  font-size: 32px;
  color: #818cf8;
}
.rds-mark.err {
  color: #ef4444;
}
.rds-text {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.6;
}
.rds-retry {
  margin-top: 4px;
  padding: 7px 20px;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #818cf8, #6366f1);
  color: #fff;
  font-size: 13px;
}
.rds-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  list-style: none;
  margin: 0;
  padding: 12px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rds-item {
  padding: 12px 13px;
  border-radius: 12px;
  border: 1px solid #f0f1f5;
  background: #fafbfc;
}
.rds-item:active {
  background: rgba(129, 140, 248, 0.08);
}
.rds-item-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.rds-item-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2937;
  line-height: 1.5;
  min-width: 0;
}
.rds-score {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  background: rgba(129, 140, 248, 0.14);
  color: #6366f1;
  white-space: nowrap;
}
.rds-score.keyword {
  background: rgba(148, 163, 184, 0.14);
  color: #9ca3af;
}
.rds-item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
}
.rds-industry {
  font-size: 10.5px;
  color: #0d9488;
  background: rgba(45, 212, 191, 0.1);
  border: 1px solid rgba(45, 212, 191, 0.25);
  padding: 1px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.rds-tag {
  font-size: 10.5px;
  color: #9ca3af;
  background: #f5f6fa;
  border: 1px solid #e5e7eb;
  padding: 1px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.rds-snippet {
  margin: 8px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: #9ca3af;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
