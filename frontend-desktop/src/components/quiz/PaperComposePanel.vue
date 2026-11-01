<script setup lang="ts">
// 智能组卷面板（右侧分栏，非模态）：试卷标题 + 知识点范围（多行，最多 6 个）+ 题量 + 每题分值
// v1.1：每个知识点匹配后端叶子注册表 → 从 verified 题库凑题（不足时管线自动补题），
//        轮转合并保证每个知识点都被覆盖；试卷暂存本地（P5 将后端化）
import { computed, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { usePaperStore } from '@/stores/paperStore'
import { searchLeaves, questionsByLeaf } from '@/services/questionService'
import type { Paper, Question } from '@/types'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', paper: Paper): void
}>()

const learnStore = useLearnStore()
const paperStore = usePaperStore()

/** 单卷最多覆盖的知识点数（每项至少 4 题，过多会导致卷面过长且生成变慢） */
const MAX_SCOPE = 6
/** 每个知识点最少让 AI 出的题数（与后端 4 题下限一致） */
const MIN_PER_SCOPE = 4

const title = ref(`${learnStore.selectedDomain?.name ?? '通用'} 能力测评卷`)
const scopeText = ref(learnStore.selectedDomain?.name ?? '')
const count = ref(20)
const scorePer = ref(5)
const generating = ref(false)
const progress = ref('')
const errorText = ref('')

const scopeList = computed(() =>
  scopeText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
)
const scopeCapped = computed(() => scopeList.value.slice(0, MAX_SCOPE))

/** 已选学习方向的大纲能力点，点击即追加到范围（免手输） */
const suggestions = computed(() => learnStore.outline.slice(0, 10).map((t) => t.title))

function addScope(name: string) {
  if (generating.value || scopeList.value.includes(name)) return
  if (scopeList.value.length >= MAX_SCOPE) {
    errorText.value = `单卷知识点范围最多 ${MAX_SCOPE} 个`
    return
  }
  errorText.value = ''
  scopeText.value = [...scopeList.value, name].join('\n')
}

async function onSubmit() {
  if (generating.value) return
  const list = scopeCapped.value
  if (list.length === 0) {
    errorText.value = '请至少填写 1 个知识点或主题'
    return
  }
  errorText.value = ''
  generating.value = true
  try {
    const n = Math.max(4, Math.min(40, Math.round(Number(count.value)) || 20))
    const per = Math.max(MIN_PER_SCOPE, Math.min(40, Math.ceil(n / list.length)))

    progress.value = `正在匹配 ${list.length} 个技能点并从题库凑题（不足会现场补题，约 1 分钟/点）…`
    // 每个知识点：先匹配叶子，再取 verified 题（generate=true → 不足时管线补题）
    const settled = await Promise.allSettled(
      list.map(async (item) => {
        const found = await searchLeaves(item)
        const leaf = found.items[0]
        if (!leaf) throw new Error(`未匹配技能点：${item}`)
        const resp = await questionsByLeaf(leaf.leafKey, per, true)
        return { item, list: resp.items }
      })
    )
    const buckets = settled
      .filter((s): s is PromiseFulfilledResult<{ item: string; list: Question[] }> => s.status === 'fulfilled')
      .map((s) => s.value)
      .filter((b) => b.list.length > 0)

    if (buckets.length === 0) throw new Error('这些技能点暂无可组卷题目（可能正在建设中），请换知识点')

    // 轮转合并：每轮各取一题，保证卷面覆盖每个知识点，直到凑够题量
    const cursor = buckets.map(() => 0)
    const merged: Question[] = []
    while (merged.length < n) {
      let picked = false
      for (let b = 0; b < buckets.length && merged.length < n; b += 1) {
        const q = buckets[b].list[cursor[b]]
        if (!q) continue
        cursor[b] += 1
        merged.push({
          ...q,
          knowledgePoints: q.knowledgePoints?.length ? q.knowledgePoints : [buckets[b].item]
        })
        picked = true
      }
      if (!picked) break
    }

    if (merged.length === 0) throw new Error('题库返回题目为空')

    const score = Math.max(1, Math.min(100, Math.round(Number(scorePer.value)) || 5))
    // 后端落库：题目以 ID 引用；返回的卷面即最终成卷
    const paper = await paperStore.create({
      title: title.value.trim() || `${list[0]} 测评卷`,
      scope: list,
      scorePer: score,
      questionIds: merged.map((q) => q.id)
    })
    emit('created', paper)
    emit('close')
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '组卷失败，请确认后端已启动'
  } finally {
    progress.value = ''
    generating.value = false
  }
}
</script>

<template>
  <aside class="wx-paper-gen">
    <header class="wx-paper-gen-head">
      <div class="wx-paper-gen-head-title">
        <span class="wx-paper-gen-mark">✦</span>
        <span>智能组卷</span>
      </div>
      <button class="wx-paper-gen-close wx-pressable" title="收起" @click="emit('close')">×</button>
    </header>

    <div class="wx-paper-gen-body">
      <label class="wx-paper-gen-field">
        <span class="wx-paper-gen-label">试卷标题</span>
        <input
          v-model="title"
          class="wx-paper-gen-input"
          type="text"
          maxlength="40"
          placeholder="例如：Vue 核心能力测评卷"
          :disabled="generating"
        />
      </label>

      <label class="wx-paper-gen-field">
        <span class="wx-paper-gen-label">
          知识点范围（每行一个，最多 {{ MAX_SCOPE }} 个）
        </span>
        <textarea
          v-model="scopeText"
          class="wx-paper-gen-textarea"
          rows="4"
          placeholder="每行一个知识点，例如：&#10;响应式原理&#10;组合式 API&#10;路由与状态管理"
          :disabled="generating"
        ></textarea>
        <span class="wx-paper-gen-count">
          {{ scopeList.length }} / {{ MAX_SCOPE }} 个知识点
          <b v-if="scopeList.length > MAX_SCOPE">超出部分不参与组卷</b>
        </span>
      </label>

      <div v-if="suggestions.length" class="wx-paper-gen-sugs">
        <span class="wx-paper-gen-label">从我的大纲快速添加</span>
        <div class="wx-paper-gen-sug-list">
          <button
            v-for="s in suggestions"
            :key="s"
            class="wx-paper-gen-sug wx-pressable"
            :disabled="generating"
            @click="addScope(s)"
          >
            + {{ s }}
          </button>
        </div>
      </div>

      <div class="wx-paper-gen-row">
        <label class="wx-paper-gen-field">
          <span class="wx-paper-gen-label">题量（4 - 40）</span>
          <input
            v-model.number="count"
            class="wx-paper-gen-input"
            type="number"
            min="4"
            max="40"
            :disabled="generating"
          />
        </label>
        <label class="wx-paper-gen-field">
          <span class="wx-paper-gen-label">每题分值</span>
          <input
            v-model.number="scorePer"
            class="wx-paper-gen-input"
            type="number"
            min="1"
            max="100"
            :disabled="generating"
          />
        </label>
      </div>

      <p class="wx-paper-gen-tip">
        难度按简单 / 中等 / 困难约 4:4:2 生成，题型混合单选、多选、简答、编程；
        生成后可在「我的试卷」中查看卷面、导出 Markdown 并整卷作答复盘。
      </p>

      <div v-if="progress" class="wx-paper-gen-progress">✦ {{ progress }}</div>
      <div v-if="errorText" class="wx-paper-gen-error">⚠ {{ errorText }}</div>
    </div>

    <footer class="wx-paper-gen-foot">
      <button
        class="wx-btn-gradient wx-pressable wx-paper-gen-submit"
        :disabled="generating || scopeList.length === 0"
        @click="onSubmit"
      >
        {{ generating ? '组卷中，请稍候…' : '✦ 生成试卷' }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.wx-paper-gen {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 22%, transparent);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: wx-paper-gen-in 0.28s var(--wx-ease-spring);
}
@keyframes wx-paper-gen-in {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: translateX(0); }
}
.wx-paper-gen-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  flex-shrink: 0;
}
.wx-paper-gen-head-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--wx-font-serif);
  font-size: 15px;
  color: var(--wx-text-primary);
  letter-spacing: 0.04em;
}
.wx-paper-gen-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 8px var(--wx-color-primary));
}
.wx-paper-gen-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  font-size: 16px;
  color: var(--wx-text-secondary);
  line-height: 1;
}
.wx-paper-gen-close:hover { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }

.wx-paper-gen-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wx-paper-gen-field { display: flex; flex-direction: column; gap: 6px; }
.wx-paper-gen-label { font-size: 12px; color: var(--wx-text-secondary); }
.wx-paper-gen-input,
.wx-paper-gen-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-primary);
  font-size: 13px;
  font-family: var(--wx-font-sans);
  outline: none;
  resize: vertical;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-paper-gen-input:focus,
.wx-paper-gen-textarea:focus { border-color: var(--wx-border-glow); }
.wx-paper-gen-count { font-size: 11px; color: var(--wx-text-muted); }
.wx-paper-gen-count b { color: var(--wx-color-amber); font-weight: 500; }

.wx-paper-gen-sugs { display: flex; flex-direction: column; gap: 8px; }
.wx-paper-gen-sug-list { display: flex; flex-wrap: wrap; gap: 6px; }
.wx-paper-gen-sug {
  max-width: 100%;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  color: var(--wx-color-primary-soft);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-paper-gen-sug:hover:not(:disabled) { background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); }
.wx-paper-gen-sug:disabled { opacity: 0.5; cursor: not-allowed; }

.wx-paper-gen-row { display: flex; gap: 12px; }
.wx-paper-gen-row .wx-paper-gen-field { flex: 1; min-width: 0; }

.wx-paper-gen-tip { font-size: 12px; color: var(--wx-text-muted); line-height: 1.7; }
.wx-paper-gen-progress {
  padding: 8px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  border: 1px solid var(--wx-border-glow);
  font-size: 12px;
  color: var(--wx-color-primary-soft);
}
.wx-paper-gen-error {
  padding: 8px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
  font-size: 12px;
  color: var(--wx-text-primary);
}

.wx-paper-gen-foot {
  padding: 14px 18px;
  border-top: 1px solid var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-paper-gen-submit { width: 100%; padding: 10px; font-size: 13px; font-weight: 600; }
.wx-paper-gen-submit:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
