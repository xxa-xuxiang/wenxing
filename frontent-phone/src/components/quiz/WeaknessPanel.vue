<!-- 薄弱专项弹层（van-popup bottom）：数据全部来自本地掌握度（masteryStore），不发统计请求 -->
<!-- 薄弱项 = 掌握度「在学」的知识点（无则在学为空时回退到已答过题的「未学」项），按近 10 题正确率升序 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useMasteryStore } from '@/stores/masteryStore'
import { useLearnStore } from '@/stores/learnStore'
import { useQuizStore } from '@/stores/quizStore'
import { questionsByLeaf, searchLeaves } from '@/services/questionService'
import type { Question } from '@/types/quiz'

const show = defineModel<boolean>('show', { required: true })

const router = useRouter()
const mastery = useMasteryStore()
const learnStore = useLearnStore()
const quiz = useQuizStore()

interface WeakRow {
  name: string
  state: 'learning' | 'unlearned'
  /** 近 10 题正确率 0~1 */
  accuracy: number
  total: number
}

const rows = computed<WeakRow[]>(() => {
  const list: WeakRow[] = []
  const push = (name: string, state: 'learning' | 'unlearned', records: { ok: boolean }[], total: number) => {
    const recent = records.slice(-10)
    const accuracy = recent.length === 0 ? 0 : recent.filter((r) => r.ok).length / recent.length
    list.push({ name, state, accuracy, total })
  }
  // 优先：在学（掌握不稳）
  for (const name of Object.keys(mastery.map)) {
    const e = mastery.map[name]
    if (!e || e.state !== 'learning') continue
    push(name, 'learning', e.records, e.records.length)
  }
  // 回退：未学但已有答题记录
  if (list.length === 0) {
    for (const name of Object.keys(mastery.map)) {
      const e = mastery.map[name]
      if (!e || e.state !== 'unlearned' || e.records.length === 0) continue
      push(name, 'unlearned', e.records, e.records.length)
    }
  }
  return list.sort((a, b) => a.accuracy - b.accuracy)
})

const busyName = ref<string | null>(null)
const errorName = ref<string | null>(null)
const errorText = ref('')

/** 专项练习（用户显式点击 → 允许触发后端 JIT 出题）：检索叶子 → 凑题 → 进答题 */
async function practice(name: string) {
  if (busyName.value) return
  busyName.value = name
  errorName.value = null
  errorText.value = ''
  try {
    const industry = learnStore.selectedDomain?.name ?? ''
    // 检索技能叶子后按 leafKey 凑题
    const found = await searchLeaves(name, industry)
    const leaf = found.items[0]
    if (!leaf) throw new Error('未找到该知识点的技能叶子，暂时无法凑题')
    const resp = await questionsByLeaf(leaf.leafKey, 12, true)
    if (resp.items.length === 0) throw new Error('该知识点题目建设中，暂无合规公开语料，请稍后再试')
    quiz.startWithQuestions(name, resp.items, 0)
    show.value = false
    void router.push('/quiz')
  } catch (e) {
    errorName.value = name
    errorText.value = e instanceof Error ? e.message : '凑题失败，请确认网络后重试'
    showToast(errorText.value)
  } finally {
    busyName.value = null
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round :style="{ height: '70vh' }">
    <div class="wk">
      <div class="wk-title">薄弱专项</div>
      <p class="wk-note">薄弱项 = 掌握度处于「在学」的知识点，按近 10 题正确率由低到高排列。</p>

      <van-empty v-if="rows.length === 0" description="暂无薄弱项数据，先去题库练几道题，结果会自动计入薄弱分析" />

      <div v-else class="wk-list">
        <div v-for="r in rows" :key="r.name" class="wk-row">
          <div class="wk-main">
            <div class="wk-name-row">
              <span class="wk-name">{{ r.name }}</span>
              <span class="wk-state" :class="`is-${r.state}`">{{ r.state === 'learning' ? '在学' : '未学' }}</span>
            </div>
            <div class="wk-meta">
              <div class="wk-bar">
                <div class="wk-bar-fill" :class="{ low: r.accuracy < 0.6 }" :style="{ width: pct(r.accuracy) }"></div>
              </div>
              <span class="wk-acc">近 10 题 {{ pct(r.accuracy) }}</span>
              <span class="wk-total">累计 {{ r.total }} 题</span>
            </div>
            <div v-if="errorName === r.name && errorText" class="wk-error">⚠ {{ errorText }}</div>
          </div>
          <van-button
            type="primary"
            size="small"
            round
            :disabled="busyName !== null"
            :loading="busyName === r.name"
            loading-text="凑题中…"
            @click="practice(r.name)"
          >
            {{ busyName === r.name ? '凑题中…' : '专项练习' }}
          </van-button>
        </div>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.wk {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px 14px 0;
  box-sizing: border-box;
}
.wk-title { font-size: 17px; font-weight: 600; text-align: center; }
.wk-note { margin: 6px 0 8px; font-size: 11.5px; color: #969799; text-align: center; }
.wk-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
}
.wk-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.wk-name-row { display: flex; align-items: center; gap: 8px; }
.wk-name {
  font-size: 14px;
  font-weight: 600;
  color: #323233;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wk-state {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
}
.wk-state.is-learning { background: rgba(251, 191, 36, 0.16); color: #d97706; }
.wk-state.is-unlearned { background: #f2f3f5; color: #969799; }
.wk-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.wk-bar {
  width: 90px;
  height: 5px;
  border-radius: 999px;
  background: #f2f3f5;
  overflow: hidden;
  flex-shrink: 0;
}
.wk-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: #1989fa;
}
.wk-bar-fill.low { background: linear-gradient(90deg, #f87171, #fb923c); }
.wk-acc { color: #646566; }
.wk-total { color: #969799; }
.wk-error { font-size: 11px; color: #ee0a24; }
</style>
