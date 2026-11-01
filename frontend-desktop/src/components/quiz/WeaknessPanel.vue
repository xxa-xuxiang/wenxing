<script setup lang="ts">
// 薄弱专项面板：数据全部来自本地掌握度（masteryStore），不发网络请求；
// 薄弱项 = 掌握度处于「在学」且近 10 题正确率偏低的知识点；
// 无在学项时回退到「未学但有答题记录」的知识点，均按正确率升序排列
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMasteryStore } from '@/stores/masteryStore'
import { useLearnStore } from '@/stores/learnStore'
import { useQuizStore } from '@/stores/quizStore'
import { searchLeaves, questionsByLeaf, questionsBySkillPath } from '@/services/questionService'
import type { Question } from '@/types'

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

/** 专项练习（用户显式点击 → 允许触发后端 JIT 出题） */
async function practice(name: string) {
  if (busyName.value) return
  busyName.value = name
  errorName.value = null
  errorText.value = ''
  try {
    const industry = learnStore.selectedDomain?.name ?? ''
    let items: Question[] = []
    // 1) 大纲里能匹配到该知识点 → 按技能路径凑题
    const task = learnStore.outline.find((t) => t.kp?.name === name || t.title === name) ?? null
    if (task) {
      const resp = await questionsBySkillPath(
        {
          industry,
          category: task.kp?.category ?? '',
          domain: task.kp?.domain ?? '',
          stack: task.kp?.stack ?? '',
          name: task.kp?.name ?? name
        },
        12,
        true
      )
      items = resp.items
    }
    // 2) 未命中或返回 0 题 → 检索技能叶子后按 leafKey 凑题
    if (items.length === 0) {
      const found = await searchLeaves(name, industry)
      const leaf = found.items[0]
      if (!leaf) throw new Error('未找到该知识点的技能叶子，暂时无法凑题')
      const resp = await questionsByLeaf(leaf.leafKey, 12, true)
      items = resp.items
    }
    if (items.length === 0) throw new Error('该知识点题目建设中，暂无合规公开语料，请稍后再试')
    quiz.startWithQuestions(name, items, 0)
    void router.push('/quiz')
  } catch (e) {
    errorName.value = name
    errorText.value = e instanceof Error ? e.message : '凑题失败，请确认后端已启动'
  } finally {
    busyName.value = null
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}
</script>

<template>
  <div class="wx-q-weak">
    <div class="wx-q-weak-head">
      <p class="wx-q-weak-note">
        ✦ 薄弱项 = 掌握度处于「在学」且正确率偏低的知识点，按近 10 题正确率由低到高排列。
      </p>
    </div>

    <!-- 空态：无任何练习数据 -->
    <div v-if="rows.length === 0" class="wx-q-weak-empty">
      <div class="wx-q-weak-empty-mark">✧</div>
      <div class="wx-q-weak-empty-title">暂无薄弱项数据</div>
      <div class="wx-q-weak-empty-sub">先去题库练习几道题，练习结果会自动计入薄弱分析</div>
      <button class="wx-btn-gradient wx-pressable wx-q-weak-empty-btn" @click="router.push('/questions')">
        去题库练习
      </button>
    </div>

    <div v-else class="wx-q-weak-list">
      <div v-for="r in rows" :key="r.name" class="wx-q-weak-row wx-glass">
        <div class="wx-q-weak-main">
          <div class="wx-q-weak-name-row">
            <span class="wx-q-weak-name">{{ r.name }}</span>
            <span class="wx-q-weak-state" :class="`is-${r.state}`">
              {{ r.state === 'learning' ? '在学' : '未学' }}
            </span>
          </div>
          <div class="wx-q-weak-meta">
            <div class="wx-q-weak-bar">
              <div
                class="wx-q-weak-bar-fill"
                :class="{ low: r.accuracy < 0.6 }"
                :style="{ width: pct(r.accuracy) }"
              ></div>
            </div>
            <span class="wx-q-weak-acc">近 10 题正确率 {{ pct(r.accuracy) }}</span>
            <span class="wx-q-weak-total">累计作答 {{ r.total }} 题</span>
          </div>
          <div v-if="errorName === r.name && errorText" class="wx-q-weak-error">⚠ {{ errorText }}</div>
        </div>
        <button
          class="wx-btn-gradient wx-pressable wx-q-weak-btn"
          :disabled="busyName !== null"
          @click="practice(r.name)"
        >
          {{ busyName === r.name ? '凑题中…' : '专项练习' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wx-q-weak {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wx-q-weak-head {
  padding: 14px 28px;
  border-bottom: 1px solid var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-q-weak-note { font-size: 12px; line-height: 1.6; color: var(--wx-text-tertiary); }

.wx-q-weak-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 28px 96px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wx-q-weak-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-radius: var(--wx-glass-radius);
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-weak-row:hover { border-color: var(--wx-border-glow); }
.wx-q-weak-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.wx-q-weak-name-row { display: flex; align-items: center; gap: 8px; }
.wx-q-weak-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-q-weak-state {
  flex-shrink: 0;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
}
.wx-q-weak-state.is-learning { background: color-mix(in srgb, var(--wx-color-amber) 15%, transparent); color: var(--wx-color-amber); }
.wx-q-weak-state.is-unlearned { background: color-mix(in srgb, var(--wx-ink) 6%, transparent); color: var(--wx-text-tertiary); }

.wx-q-weak-meta { display: flex; align-items: center; gap: 10px; font-size: 11.5px; }
.wx-q-weak-bar {
  width: 120px;
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
  overflow: hidden;
  flex-shrink: 0;
}
.wx-q-weak-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--wx-gradient-primary);
  transition: width var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-weak-bar-fill.low { background: linear-gradient(90deg, var(--wx-color-vermilion), #fb923c); }
.wx-q-weak-acc { color: var(--wx-text-secondary); }
.wx-q-weak-total { color: var(--wx-text-muted); font-family: var(--wx-font-mono); }
.wx-q-weak-error { font-size: 11.5px; color: var(--wx-color-vermilion); }
.wx-q-weak-btn { flex-shrink: 0; padding: 8px 18px; font-size: 12px; font-weight: 600; }
.wx-q-weak-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.wx-q-weak-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 28px;
  text-align: center;
}
.wx-q-weak-empty-mark { font-size: 28px; color: var(--wx-color-primary); opacity: 0.8; }
.wx-q-weak-empty-title { font-size: 16px; font-family: var(--wx-font-serif); color: var(--wx-text-primary); }
.wx-q-weak-empty-sub { font-size: 12px; color: var(--wx-text-tertiary); max-width: 420px; line-height: 1.6; }
.wx-q-weak-empty-btn { margin-top: 10px; padding: 8px 18px; font-size: 12px; }
</style>
