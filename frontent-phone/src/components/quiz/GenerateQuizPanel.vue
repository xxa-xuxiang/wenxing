<!-- 按技能点出题弹层（van-popup bottom）：检索技能叶子 → JIT 凑题/出题（约 1 分钟）→ 交回答题 -->
<!-- 顶部展示后端题库覆盖度小结（/api/questions/coverage） -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getCoverage, questionsByLeaf, searchLeaves, type CoverageItem, type LeafSearchItem } from '@/services/questionService'
import type { Question } from '@/types/quiz'

const show = defineModel<boolean>('show', { required: true })

const emit = defineEmits<{
  (e: 'generated', list: Question[], title: string): void
}>()

const topic = ref('')
const count = ref(20)
const generating = ref(false)
const errorText = ref('')
const candidates = ref<LeafSearchItem[]>([])
const picked = ref<LeafSearchItem | null>(null)
let searchTimer: number | null = null

// 覆盖度小结（挂载拉取一次）
const coverage = ref<CoverageItem[] | null>(null)
const covSummary = ref<{ leaves: number; filled: number; questions: number } | null>(null)

onMounted(async () => {
  try {
    const r = await getCoverage()
    coverage.value = r.items
    covSummary.value = {
      leaves: r.items.reduce((s, i) => s + i.leaves, 0),
      filled: r.items.reduce((s, i) => s + i.filled, 0),
      questions: r.items.reduce((s, i) => s + i.questions, 0)
    }
  } catch {
    coverage.value = null
  }
})

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
    let leaf = picked.value
    if (!leaf) {
      const found = await searchLeaves(topic.value.trim())
      leaf = found.items[0]
      if (!leaf) throw new Error('未在技能叶子注册表中找到该技能点，请从候选里选择')
    }
    const resp = await questionsByLeaf(leaf.leafKey, Math.max(4, Math.min(50, count.value)), true)
    if (resp.items.length === 0) {
      throw new Error('该技能点暂无合规公开语料，题目建设中（可稍后重试）')
    }
    emit('generated', resp.items, resp.leaf.pathText || leaf.name)
    show.value = false
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '生成失败，请确认网络后重试'
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <van-popup
    v-model:show="show"
    position="bottom"
    round
    :style="{ maxHeight: '86vh' }"
    closeable
    close-icon-position="top-left"
  >
    <div class="gq">
      <div class="gq-title">按知识点练</div>

      <!-- 覆盖度小结 -->
      <div v-if="covSummary" class="gq-cov">
        <span>题库 <b>{{ covSummary.questions }}</b> 题</span>
        <span>技能点 <b>{{ covSummary.leaves }}</b> 个</span>
        <span>已建成 <b>{{ covSummary.filled }}</b> 个</span>
      </div>

      <van-field
        v-model="topic"
        class="gq-input"
        label="技能点"
        placeholder="输入名称并从候选里选择"
        maxlength="120"
        :disabled="generating"
        @update:model-value="onTopicInput"
      />
      <div v-if="candidates.length" class="gq-suggest">
        <button v-for="c in candidates" :key="c.leafKey" type="button" class="gq-sug" @click="pick(c)">
          <span class="gq-sug-path">{{ c.pathText }}</span>
          <span class="gq-sug-meta">{{ c.verifiedCount >= 20 ? `已有 ${c.verifiedCount} 题` : `库内 ${c.verifiedCount} 题 · 点击建设` }}</span>
        </button>
      </div>
      <div v-else-if="picked" class="gq-picked">已选：{{ picked.pathText }}</div>

      <div class="gq-row">
        <span class="gq-row-label">凑题数量（4 - 50）</span>
        <van-stepper v-model="count" :min="4" :max="50" integer :disabled="generating" />
      </div>

      <p class="gq-tip">题目仅依据公开语料生成，带解析与出处；题量不足时现场补题约需 1 分钟。</p>
      <div v-if="errorText" class="gq-error">⚠ {{ errorText }}</div>

      <div class="gq-foot">
        <van-button type="primary" round block :loading="generating" :disabled="!topic.trim()" loading-text="正在检索资料并出题…" @click="onSubmit">
          {{ generating ? '正在出题，约 1 分钟…' : '开始出题 / 凑题' }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.gq {
  padding: 20px 16px calc(16px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.gq-title {
  font-size: 17px;
  font-weight: 600;
  color: #323233;
  text-align: center;
}
.gq-cov {
  display: flex;
  justify-content: space-around;
  padding: 10px 8px;
  border-radius: 10px;
  background: #f2f6ff;
  font-size: 12px;
  color: #646566;
}
.gq-cov b { color: #1989fa; font-weight: 600; }
.gq-input { padding: 0; background: transparent; }
.gq-suggest {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gq-sug {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #ebedf0;
  background: #fff;
}
.gq-sug-path { font-size: 12px; color: #323233; line-height: 1.4; }
.gq-sug-meta { font-size: 10.5px; color: #969799; }
.gq-picked { font-size: 12px; color: #1989fa; }
.gq-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}
.gq-row-label { font-size: 13px; color: #646566; }
.gq-tip { margin: 0; font-size: 11.5px; line-height: 1.6; color: #969799; }
.gq-error {
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff1f0;
  font-size: 12px;
  color: #ee0a24;
}
.gq-foot { padding-top: 4px; }
</style>
