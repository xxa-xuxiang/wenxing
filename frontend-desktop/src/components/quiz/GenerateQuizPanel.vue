<script setup lang="ts">
// 按技能点出题面板（右侧分栏，非模态）：输入技能点 → 匹配叶子注册表
// → 后端管线基于公开语料 RAG 出题（结构校验 + AI 二审 + 向量去重），约 1 分钟；
// 题目入库后随响应返回，交回答题/题库使用
import { ref } from 'vue'
import {
  searchLeaves,
  questionsByLeaf,
  type LeafSearchItem
} from '@/services/questionService'
import type { Question } from '@/types'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'generated', list: Question[]): void
}>()

const topic = ref('')
const count = ref(20)
const generating = ref(false)
const errorText = ref('')
const candidates = ref<LeafSearchItem[]>([])
const picked = ref<LeafSearchItem | null>(null)
let searchTimer: number | null = null

function onTopicInput() {
  picked.value = null
  if (searchTimer) window.clearTimeout(searchTimer)
  const q = topic.value.trim()
  if (q.length < 2) {
    candidates.value = []
    return
  }
  searchTimer = window.setTimeout(async () => {
    try {
      candidates.value = (await searchLeaves(q)).items
    } catch {
      candidates.value = []
    }
  }, 300)
}

function pick(c: LeafSearchItem) {
  picked.value = c
  topic.value = c.pathText
  candidates.value = []
}

async function onSubmit() {
  if (!topic.value.trim() || generating.value) return
  generating.value = true
  errorText.value = ''
  try {
    // 优先用选中的叶子；未选则取检索首条（路径精确匹配由后端完成）
    let leafKey = picked.value?.leafKey
    if (!leafKey) {
      const found = await searchLeaves(topic.value.trim())
      leafKey = found.items[0]?.leafKey
      if (!leafKey) throw new Error('未在 25,262 个技能叶子中找到该技能点，请从候选里选择')
    }
    const resp = await questionsByLeaf(leafKey, Math.max(4, Math.min(50, count.value)), true)
    if (resp.items.length === 0) {
      throw new Error('该技能点暂无合规公开语料，题目建设中（可稍后重试或走人工语料通道）')
    }
    emit('generated', resp.items)
    emit('close')
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '生成失败，请确认后端已启动'
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <aside class="wx-gen-panel">
    <header class="wx-gen-head">
      <div class="wx-gen-head-title">
        <span class="wx-gen-mark">✦</span>
        <span>为技能点出题</span>
      </div>
      <button class="wx-gen-close wx-pressable" title="收起" @click="emit('close')">×</button>
    </header>

    <div class="wx-gen-body">
      <label class="wx-gen-field">
        <span class="wx-gen-label">技能点（输入名称，从候选里选）</span>
        <input
          v-model="topic"
          class="wx-gen-input"
          type="text"
          maxlength="120"
          placeholder="例如：JavaScript语法、Apache Kafka、HTTP 与 HTTPS…"
          :disabled="generating"
          @input="onTopicInput"
          @keydown.enter="onSubmit"
        />
        <div v-if="candidates.length" class="wx-gen-suggest">
          <button
            v-for="c in candidates"
            :key="c.leafKey"
            class="wx-gen-suggest-item wx-pressable"
            type="button"
            @click="pick(c)"
          >
            <span class="wx-gen-suggest-path">{{ c.pathText }}</span>
            <span class="wx-gen-suggest-meta" :class="{ building: c.status !== 'filled' && c.verifiedCount < 20 }">
              {{ c.verifiedCount >= 20 ? `已有 ${c.verifiedCount} 题` : `库内 ${c.verifiedCount} 题 · 点击建设` }}
            </span>
          </button>
        </div>
      </label>

      <label class="wx-gen-field">
        <span class="wx-gen-label">凑题数量（4 - 50，标准卷 20）</span>
        <input
          v-model.number="count"
          class="wx-gen-input"
          type="number"
          min="4"
          max="50"
          :disabled="generating"
        />
      </label>

      <p class="wx-gen-tip">
        题目仅依据白名单公开语料生成，经 AI 二审与去重后入库，每题带解析与出处；题量不足时现场补题约需 1 分钟。
      </p>

      <div v-if="errorText" class="wx-gen-error">⚠ {{ errorText }}</div>
    </div>

    <footer class="wx-gen-foot">
      <button
        class="wx-btn-gradient wx-pressable wx-gen-submit"
        :disabled="generating || !topic.trim()"
        @click="onSubmit"
      >
        {{ generating ? '正在检索公开资料并出题，约 1 分钟…' : '✦ 开始出题 / 凑题' }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.wx-gen-panel {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 22%, transparent);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: wx-gen-in 0.28s var(--wx-ease-spring);
}
@keyframes wx-gen-in {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: translateX(0); }
}
.wx-gen-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  flex-shrink: 0;
}
.wx-gen-head-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--wx-font-serif);
  font-size: 15px;
  color: var(--wx-text-primary);
  letter-spacing: 0.04em;
}
.wx-gen-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 8px var(--wx-color-primary));
}
.wx-gen-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  font-size: 16px;
  color: var(--wx-text-secondary);
  line-height: 1;
}
.wx-gen-close:hover { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }

.wx-gen-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wx-gen-field { display: flex; flex-direction: column; gap: 6px; }
.wx-gen-label { font-size: 12px; color: var(--wx-text-secondary); }
.wx-gen-input {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-gen-input:focus { border-color: var(--wx-border-glow); }
.wx-gen-tip { font-size: 12px; color: var(--wx-text-muted); line-height: 1.6; }
.wx-gen-suggest {
  margin-top: 6px;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wx-gen-suggest-item {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
}
.wx-gen-suggest-item:hover { border-color: var(--wx-border-glow); }
.wx-gen-suggest-path { font-size: 11px; color: var(--wx-text-secondary); line-height: 1.4; }
.wx-gen-suggest-meta { font-size: 10px; color: var(--wx-text-muted); }
.wx-gen-suggest-meta.building { color: var(--wx-color-primary-soft); }
.wx-gen-error {
  padding: 8px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
  font-size: 12px;
  color: var(--wx-text-primary);
}

.wx-gen-foot {
  padding: 14px 18px;
  border-top: 1px solid var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-gen-submit { width: 100%; padding: 10px; font-size: 13px; font-weight: 600; }
.wx-gen-submit:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
