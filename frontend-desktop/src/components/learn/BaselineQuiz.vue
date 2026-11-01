<script setup lang="ts">
// 阶段1 学前测评：本地只读抽题（generate=false，零 AI）→ 逐题作答 → 本地判分 → 生成/跳过计划
// 抽题走纯本地 DB 查询，允许挂载时自动执行；其余网络调用均需用户点击
import { computed, onMounted, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { questionsBySkillPath, listQuestions } from '@/services/questionService'
import type { BaselineResult, BaselineTaskResult, LearnStatus, Question } from '@/types'

const learnStore = useLearnStore()

const TARGET = 15 // 累计抽满即停止
const PER_TASK = 2 // 每个技能点抽题数

interface QuizGroup {
  taskId: string
  title: string
  status: LearnStatus
  questions: Question[]
}

const picking = ref(true) // 抽题中
const pickDone = ref(0) // 已完成抽题的任务数
const pickTotal = ref(0) // 参与抽题的任务数（有 kp 者）
const groups = ref<QuizGroup[]>([])
const answers = ref<Map<string, number[]>>(new Map()) // questionId → 已选索引
const submitting = ref(false) // 已提交（生成/跳过）

const diffText: Record<Question['difficulty'], string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难'
}
function statusClass(s: LearnStatus): string {
  return s === 'deep' ? 'wx-dot-deep' : s === 'light' ? 'wx-dot-light' : 'wx-dot-unknown'
}
/** 单选/多选项索引 → 字母标注（A/B/C/D） */
function letter(i: number): string {
  return String.fromCharCode(65 + i)
}

// 抽题：按第 1 步 AI 推荐的技能组知识点抽题（最多 8 个知识点、累计 15 题）
// 无 kp 或 by-skill 无题时退化为行业关键词检索，仍无题则跳过该知识点
onMounted(async () => {
  const items = await learnStore.resolveGroupItems()
  const picked = items.slice(0, 8)
  pickTotal.value = picked.length
  let collected = 0
  for (const it of picked) {
    if (collected >= TARGET) break
    const industry = learnStore.selectedDomain?.name ?? ''
    let qs: Question[] = []
    if (it.kp) {
      try {
        const resp = await questionsBySkillPath(
          {
            industry,
            category: it.kp.category,
            domain: it.kp.domain,
            stack: it.kp.stack,
            name: it.kp.name
          },
          PER_TASK,
          false
        )
        qs = resp.items
          .filter((q) => q.type === 'single' || q.type === 'multiple')
          .slice(0, PER_TASK)
      } catch {
        /* 单知识点失败：走关键词兜底 */
      }
    }
    if (qs.length === 0) {
      try {
        const resp = await listQuestions({ industry, q: it.title, pageSize: PER_TASK })
        qs = resp.items
          .filter((q) => q.type === 'single' || q.type === 'multiple')
          .slice(0, PER_TASK)
      } catch {
        /* 忽略：该知识点无题 */
      }
    }
    if (qs.length > 0) {
      groups.value.push({ taskId: it.id, title: it.title, status: 'unknown', questions: qs })
      collected += qs.length
    }
    pickDone.value += 1
  }
  picking.value = false
})

const answeredCount = computed(() => {
  let n = 0
  for (const g of groups.value) {
    for (const q of g.questions) if ((answers.value.get(q.id)?.length ?? 0) > 0) n += 1
  }
  return n
})
// 提交后（含 store 正在生成计划）显示等待态
const waiting = computed(() => submitting.value || learnStore.generatingPlan)

function isSelected(qid: string, idx: number): boolean {
  return (answers.value.get(qid) ?? []).includes(idx)
}
function pickOption(qid: string, idx: number, multi: boolean) {
  const cur = new Map(answers.value)
  const arr = cur.get(qid) ?? []
  if (multi) {
    cur.set(qid, arr.includes(idx) ? arr.filter((x) => x !== idx) : [...arr, idx])
  } else {
    cur.set(qid, [idx])
  }
  answers.value = cur
}

// 本地判分：answer 形如 "A" / "AC"，提取字母集合后与用户所选字母集合排序比较
function correctLetters(q: Question): string {
  return (q.answer || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .sort()
    .join('')
}
function userLetters(q: Question): string {
  return (answers.value.get(q.id) ?? []).map(letter).sort().join('')
}
function isCorrect(q: Question): boolean {
  const u = userLetters(q)
  return u.length > 0 && u === correctLetters(q)
}

/** 仅统计「至少答过 1 题」的任务；total 为抽到的题量，rate = correct / total */
function buildResult(): BaselineResult {
  const items: BaselineTaskResult[] = []
  for (const g of groups.value) {
    const total = g.questions.length
    let answeredInTask = 0
    let correct = 0
    for (const q of g.questions) {
      if ((answers.value.get(q.id)?.length ?? 0) > 0) {
        answeredInTask += 1
        if (isCorrect(q)) correct += 1
      }
    }
    if (answeredInTask > 0) {
      items.push({
        taskId: g.taskId,
        title: g.title,
        total,
        correct,
        rate: total > 0 ? correct / total : 0
      })
    }
  }
  return { items, answered: answeredCount.value, at: Date.now() }
}

async function submit() {
  if (submitting.value || learnStore.generatingPlan || answeredCount.value === 0) return
  submitting.value = true
  try {
    await learnStore.finishBaseline(buildResult())
  } finally {
    submitting.value = false
  }
}
async function skip() {
  if (submitting.value || learnStore.generatingPlan) return
  submitting.value = true
  try {
    await learnStore.finishBaseline(null)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="wx-baseline">
    <div class="wx-baseline-head">
      <div class="wx-baseline-title">
        <span class="wx-baseline-mark">✦</span>
        <span>学前测评</span>
        <span class="wx-baseline-title-sub">{{ learnStore.selectedDomain?.name }}</span>
      </div>
      <div class="wx-baseline-progress">
        <span class="wx-dot wx-dot-deep"></span>
        <span>已答 {{ answeredCount }} 题</span>
      </div>
    </div>

    <!-- 抽题中 -->
    <div v-if="picking" class="wx-baseline-center">
      <div class="wx-baseline-center-mark wx-spin">✧</div>
      <div>正在为 {{ pickTotal }} 个技能点抽题…（已完成 {{ pickDone }}/{{ pickTotal }}）</div>
      <div class="wx-baseline-center-sub">仅读取本地题库，不消耗 AI 额度</div>
    </div>

    <!-- 提交等待态 -->
    <div v-else-if="waiting" class="wx-baseline-center">
      <div class="wx-baseline-center-mark wx-breathe">✦</div>
      <div>正在提交测评结果…</div>
      <div class="wx-baseline-center-sub">下一步：AI 精细拆解技能与大纲</div>
    </div>

    <!-- 空态：全部知识点都没抽到题 -->
    <div v-else-if="groups.length === 0" class="wx-baseline-center">
      <div class="wx-baseline-center-mark">✧</div>
      <div>题库尚未为这些知识点建设题目，可直接进入大纲拆解</div>
      <button class="wx-btn-gradient wx-pressable wx-baseline-empty-btn" @click="skip">
        跳过测评，继续 →
      </button>
    </div>

    <!-- 题目列表：按任务分组 -->
    <div v-else class="wx-baseline-body">
      <div v-for="g in groups" :key="g.taskId" class="wx-baseline-group">
        <div class="wx-baseline-group-head">
          <span class="wx-dot" :class="statusClass(g.status)"></span>
          <span class="wx-baseline-group-title">{{ g.title }}</span>
          <span class="wx-baseline-group-count">{{ g.questions.length }} 题</span>
        </div>

        <div v-for="(q, qi) in g.questions" :key="q.id" class="wx-baseline-q">
          <div class="wx-baseline-q-head">
            <span class="wx-baseline-q-index">{{ qi + 1 }}</span>
            <span class="wx-baseline-q-stem">{{ q.title }}</span>
            <span class="wx-baseline-q-diff" :class="`diff-${q.difficulty}`">{{ diffText[q.difficulty] }}</span>
          </div>
          <div v-if="q.body && q.body !== q.title" class="wx-baseline-q-body">{{ q.body }}</div>
          <div v-if="q.options && q.options.length" class="wx-baseline-opts">
            <button
              v-for="(opt, oi) in q.options"
              :key="oi"
              class="wx-baseline-opt wx-pressable"
              :class="{ sel: isSelected(q.id, oi), multi: q.type === 'multiple' }"
              @click="pickOption(q.id, oi, q.type === 'multiple')"
            >
              <span class="wx-baseline-opt-letter">{{ letter(oi) }}</span>
              <span class="wx-baseline-opt-text">{{ opt }}</span>
            </button>
          </div>
          <div class="wx-baseline-q-type">{{ q.type === 'multiple' ? '多选题' : '单选题' }}</div>
        </div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div v-if="!picking && !waiting && groups.length > 0" class="wx-baseline-foot">
      <div class="wx-baseline-tip">测评仅用于学习计划排期参考，不会写入掌握度记录</div>
      <div class="wx-baseline-foot-actions">
        <button class="wx-baseline-skip wx-pressable" @click="skip">跳过测评</button>
        <button
          class="wx-btn-gradient wx-pressable wx-baseline-submit"
          :disabled="answeredCount === 0"
          @click="submit"
        >
          提交测评，继续 →
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wx-baseline {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 88px;
  gap: 14px;
  animation: wx-baseline-in 0.28s var(--wx-ease-spring);
}
@keyframes wx-baseline-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.wx-baseline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-baseline-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--wx-font-serif);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.wx-baseline-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 6px var(--wx-color-primary));
}
.wx-baseline-title-sub {
  font-size: 12px;
  font-weight: 500;
  color: var(--wx-text-tertiary);
  padding: 2px 10px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}
.wx-baseline-progress {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-tertiary);
}

/* 抽题 / 等待 / 空态 */
.wx-baseline-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  font-size: 15px;
  color: var(--wx-text-secondary);
}
.wx-baseline-center-mark {
  font-size: 40px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 12px var(--wx-color-primary));
}
.wx-baseline-center-sub { font-size: 12px; color: var(--wx-text-muted); }
.wx-baseline-empty-btn { margin-top: 8px; padding: 10px 22px; font-size: 13px; }

/* 题目列表 */
.wx-baseline-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;
}
.wx-baseline-group {
  padding: 14px 16px;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-baseline-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--wx-border-soft);
}
.wx-baseline-group-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-baseline-group-count {
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-primary-soft);
  padding: 1px 8px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
  flex-shrink: 0;
}

.wx-baseline-q { margin-top: 12px; }
.wx-baseline-q-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.wx-baseline-q-index {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wx-baseline-q-stem {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--wx-text-primary);
}
.wx-baseline-q-diff {
  flex-shrink: 0;
  font-size: 10px;
  padding: 2px 9px;
  border-radius: var(--wx-radius-pill);
  font-weight: 500;
}
.wx-baseline-q-diff.diff-easy { background: color-mix(in srgb, var(--wx-state-deep) 15%, transparent); color: var(--wx-state-deep); }
.wx-baseline-q-diff.diff-medium { background: color-mix(in srgb, var(--wx-color-amber) 15%, transparent); color: var(--wx-color-amber); }
.wx-baseline-q-diff.diff-hard { background: color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent); color: var(--wx-color-vermilion); }
.wx-baseline-q-body {
  margin: 6px 0 0 28px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--wx-text-tertiary);
}
.wx-baseline-opts {
  margin: 10px 0 0 28px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.wx-baseline-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
  text-align: left;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-baseline-opt:hover { border-color: var(--wx-border-glow); }
.wx-baseline-opt.sel {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
}
.wx-baseline-opt-letter {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-baseline-opt.sel .wx-baseline-opt-letter {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-color: transparent;
}
.wx-baseline-opt-text {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--wx-text-secondary);
}
.wx-baseline-opt.sel .wx-baseline-opt-text { color: var(--wx-text-primary); }
.wx-baseline-q-type {
  margin: 6px 0 0 28px;
  font-size: 10px;
  color: var(--wx-text-muted);
}

/* 底部操作 */
.wx-baseline-foot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-baseline-tip {
  font-size: 11.5px;
  color: var(--wx-text-muted);
}
.wx-baseline-foot-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
.wx-baseline-skip {
  padding: 10px 20px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-baseline-skip:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-baseline-submit:disabled { opacity: 0.4; cursor: not-allowed; transform: none; filter: none; }
</style>
