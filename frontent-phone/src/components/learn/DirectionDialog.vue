<script setup lang="ts">
// 学习合同（向导第 1 步）：一句话描述方向 → AI 拆解 → 确认大类 → SOP 五题 → AI 推荐技能
// 移动端单栏全屏版：去桌面语音识别（Web Speech 不保证可用），保留文字输入
// 硬约束：所有触发 API 的按钮均先弹确认框，挂载不发请求、不轮询
import { computed, onMounted, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useLearnStore } from '@/stores/learnStore'
import { questionnaireSteps } from '@/data/questionnaire'
import { industries } from '@/data/industries'
import { parseIndustryMd, flattenCategory } from '@/utils/learnMd'
import { skillTypeMeta } from '@/data/skillTypes'
import { decomposeGoal, type GoalDecomposition } from '@/services/aiService'
import type { QuestionnaireAnswers } from '@/types'

const learnStore = useLearnStore()

// 重新进入向导时清掉上一次推荐失败的旧错误，避免第 1 步被历史错误卡住
onMounted(() => learnStore.clearRecommendError())

// ===== 方向拆解 =====
const goalInput = ref('')
const decomposed = ref<GoalDecomposition | null>(null)
const pickedCategories = ref<Set<string>>(new Set())
const decomposing = ref(false)
const decomposeError = ref<string | null>(null)

/** 一次拆解：把自由描述交给 AI，映射到 行业 + 知识大类 + 细分方向 + 能力 + 技能类型 */
async function runDecompose() {
  const goal = goalInput.value.trim()
  if (!goal || decomposing.value) return
  try {
    await showConfirmDialog({
      title: 'AI 拆解方向',
      message: '将把这段描述交给 AI 拆解为领域与能力，是否继续？'
    })
  } catch {
    return
  }
  decomposing.value = true
  decomposeError.value = null
  try {
    // 行业 → 大类 → 细分方向（二级领域）紧凑注册表，供 AI 逐字锚定
    const registry = industries.map((i) => {
      const root = parseIndustryMd(i.md)
      const domains: Record<string, string[]> = {}
      for (const c of root.children) domains[c.name] = c.children.map((d) => d.name)
      return { name: i.name, categories: root.children.map((c) => c.name), domains }
    })
    const res = await decomposeGoal(goal, registry)
    decomposed.value = res
    pickedCategories.value = new Set(res.categories ?? [])
  } catch (e) {
    decomposeError.value = e instanceof Error ? e.message : 'AI 拆解失败'
  } finally {
    decomposing.value = false
  }
}

function togglePicked(name: string) {
  const next = new Set(pickedCategories.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  pickedCategories.value = next
}

const typeMeta = computed(() => skillTypeMeta(decomposed.value?.skillType ?? 'mixed'))

// ===== 单页五题：选中即记录；「其他」输入优先 =====
const answers = ref<Record<string, string>>({})
const customInputs = ref<Record<string, string>>({})

function choose(key: string, value: string) {
  answers.value[key] = value
  customInputs.value[key] = ''
}
function onCustom(key: string) {
  const v = (customInputs.value[key] ?? '').trim()
  if (v) answers.value[key] = v
  else delete answers.value[key]
}

const missingKeys = computed(() =>
  questionnaireSteps.filter((q) => !(answers.value[q.key] ?? '').trim()).map((q) => q.key)
)
const canSubmit = computed(
  () => Boolean(decomposed.value) && pickedCategories.value.size > 0 && missingKeys.value.length === 0
)

const loading = computed(() => learnStore.generatingRecommend)
const hasError = computed(() => !!learnStore.recommendError)

const directionLabel = computed(() => decomposed.value?.industry ?? learnStore.selectedDomain?.name ?? '未确定')

async function submit() {
  const d = decomposed.value
  const ind = industries.find((i) => i.name === d?.industry)
  if (!ind || !d) return
  try {
    await showConfirmDialog({
      title: 'AI 推荐技能',
      message: '将把学习合同交给 AI 生成技能路径，是否继续？'
    })
  } catch {
    return
  }
  // 领域（行业）确认：切换会清空旧行业数据
  if (learnStore.selectedDomain?.id !== ind.id) {
    const dom = learnStore.availableDomains.find((x) => x.id === ind.id)
    if (dom) learnStore.selectDomain(dom)
    else {
      showToast(`暂未收录「${ind.name}」行业`)
      return
    }
  }
  // 收集已选大类的知识点清单文本（AI 需从中锚定 kp）
  const root = parseIndustryMd(ind.md)
  const trees = Array.from(pickedCategories.value)
    .map((catName) => root.children.find((c) => c.name === catName))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => flattenCategory(c))

  learnStore.requestRecommend({
    categories: Array.from(pickedCategories.value),
    directions: d.directions ?? [],
    categoryTrees: trees,
    sopPath: answers.value.sopPath || '从零入门',
    goal30: answers.value.goal30 || '未指定',
    baseline: answers.value.baseline || '未指定',
    timeCommitment: answers.value.timeCommitment || '未指定',
    obstacle: answers.value.obstacle || '未指定',
    skillType: d.skillType
  } as QuestionnaireAnswers & { categoryTrees: string[] })
}
</script>

<template>
  <div class="wx-dialog">
    <div class="wx-dialog-head">
      <div class="wx-dialog-title">
        说说你想学的方向
        <span v-if="decomposed || learnStore.selectedDomain" class="wx-dialog-domain">{{ directionLabel }}</span>
      </div>
      <div class="wx-dialog-sub">一句话描述目标，AI 帮你拆出领域与能力</div>
    </div>

    <div v-if="!loading && !hasError" class="wx-dialog-body wx-contract">
      <!-- ===== 方向拆解 ===== -->
      <section class="wx-step0 wx-contract-block">
        <div class="wx-step0-title">用一句话说说你想学什么</div>
        <div class="wx-step0-sub">AI 会自动拆出领域、能力与需学软件</div>

        <div class="wx-goal-box">
          <textarea
            v-model="goalInput"
            class="wx-goal-input"
            rows="3"
            placeholder="例如：我想用三个月入门物联网开发，能自己做传感器采集并上云的小项目"
            :disabled="decomposing"
          ></textarea>
          <button
            class="wx-btn-gradient wx-pressable wx-goal-run"
            :disabled="!goalInput.trim() || decomposing"
            @click="runDecompose"
          >{{ decomposing ? '拆解中…' : (decomposed ? '重新拆解' : '✦ AI 拆解方向') }}</button>
          <div v-if="decomposeError" class="wx-goal-err">{{ decomposeError }}</div>
        </div>

        <!-- 拆解结果 -->
        <div v-if="decomposed" class="wx-decomp">
          <div class="wx-decomp-sum">{{ decomposed.summary }}</div>
          <div class="wx-decomp-meta">
            <span class="wx-decomp-industry">{{ decomposed.industry }}</span>
            <span class="wx-decomp-type" :style="{ color: typeMeta.color, borderColor: typeMeta.color }">
              {{ typeMeta.icon }} {{ typeMeta.name }}
            </span>
          </div>

          <div class="wx-decomp-sec">
            <div class="wx-decomp-label">建议知识大类（点击可增减）</div>
            <div class="wx-decomp-chips">
              <button
                v-for="c in decomposed.categories ?? []"
                :key="c"
                class="wx-decomp-chip wx-pressable"
                :class="{ on: pickedCategories.has(c) }"
                @click="togglePicked(c)"
              >{{ c }}</button>
            </div>
          </div>

          <div v-if="decomposed.directions?.length" class="wx-decomp-sec">
            <div class="wx-decomp-label">细分方向</div>
            <div class="wx-decomp-tags">
              <span v-for="dir in decomposed.directions" :key="dir" class="wx-decomp-tag">{{ dir }}</span>
            </div>
          </div>

          <div v-if="decomposed.capabilities?.length" class="wx-decomp-sec">
            <div class="wx-decomp-label">所需能力</div>
            <div class="wx-decomp-tags">
              <span v-for="cap in decomposed.capabilities" :key="cap" class="wx-decomp-tag">{{ cap }}</span>
            </div>
          </div>

          <div v-if="decomposed.software?.length" class="wx-decomp-sec">
            <div class="wx-decomp-label">需学软件 / 工具</div>
            <div class="wx-decomp-tags">
              <span v-for="s in decomposed.software" :key="s" class="wx-decomp-tag soft">{{ s }}</span>
            </div>
          </div>

          <div class="wx-decomp-reason">判定理由：{{ decomposed.reason }}</div>
        </div>
      </section>

      <!-- ===== 学习合同：5 题单页一次填完 ===== -->
      <section v-if="decomposed" class="wx-contract-block">
        <div class="wx-contract-title">学习合同</div>
        <div class="wx-contract-sub">5 个问题一次填完，提交后 AI 生成技能组</div>

        <div
          v-for="(q, i) in questionnaireSteps"
          :key="q.key"
          class="wx-question wx-question--inline"
          :class="{ 'is-missing': !(answers[q.key] ?? '').trim() }"
        >
          <div class="wx-question-title">{{ i + 1 }}. {{ q.title }}</div>
          <div v-if="q.subtitle" class="wx-question-sub">{{ q.subtitle }}</div>

          <div class="wx-options">
            <button
              v-for="opt in q.options"
              :key="opt.value"
              class="wx-option wx-pressable"
              :class="{ selected: answers[q.key] === opt.value }"
              @click="choose(q.key, opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>

          <div class="wx-custom">
            <input
              v-model="customInputs[q.key]"
              type="text"
              placeholder="其他：自己输入…"
              @input="onCustom(q.key)"
            />
          </div>
        </div>
      </section>

      <div class="wx-contract-foot">
        <span class="wx-contract-hint">
          {{ !decomposed ? '先完成方向拆解' : missingKeys.length ? `还有 ${missingKeys.length} 题未选择` : '信息已完整，可提交' }}
        </span>
        <button
          class="wx-btn-gradient wx-pressable wx-contract-submit"
          :disabled="!canSubmit"
          @click="submit"
        >提交并生成技能组 →</button>
      </div>
    </div>

    <!-- AI 推荐中 -->
    <div v-if="loading" class="wx-dialog-loading">
      <div class="wx-loading-orb wx-breathe">✦</div>
      <div class="wx-loading-text">问星 AI 正在为你推荐技能路径…</div>
      <div class="wx-loading-sub">结合你的学习合同，从所选大类的知识点清单中锚定任务</div>
    </div>

    <!-- 错误提示 -->
    <div v-if="hasError" class="wx-dialog-error-wrap">
      <div class="wx-dialog-error">{{ learnStore.recommendError }}</div>
      <button class="wx-btn-gradient wx-pressable" @click="submit">重试</button>
    </div>
  </div>
</template>

<style scoped>
.wx-dialog {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}
.wx-dialog-head {
  flex-shrink: 0;
  padding: 4px 16px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
  text-align: center;
}
.wx-dialog-title {
  font-size: 19px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  letter-spacing: 0.05em;
  color: var(--wx-text-primary);
}
.wx-dialog-domain {
  margin-left: 8px;
  padding: 2px 9px;
  font-size: 11px;
  font-family: var(--wx-font-sans);
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  border-radius: var(--wx-radius-pill);
  vertical-align: middle;
}
.wx-dialog-sub {
  margin-top: 5px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

.wx-dialog-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 4px 14px 24px;
  display: flex;
  flex-direction: column;
}

/* ===== 单页学习合同 ===== */
.wx-contract {
  gap: 12px;
}
.wx-contract-block {
  padding: 14px 14px;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-contract-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--wx-text-primary);
  margin-bottom: 4px;
}
.wx-contract-sub {
  font-size: 11.5px;
  color: var(--wx-text-muted);
  margin-bottom: 10px;
}
.wx-question--inline {
  padding: 12px 0;
  border-top: 1px dashed var(--wx-border-soft);
}
.wx-question--inline:first-of-type {
  border-top: 0;
  padding-top: 4px;
}
.wx-question--inline.is-missing .wx-question-title {
  color: var(--wx-color-amber);
}
.wx-contract-foot {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 2px 0;
  border-top: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 94%, transparent);
  backdrop-filter: blur(10px);
}
.wx-contract-hint {
  font-size: 11.5px;
  color: var(--wx-text-muted);
}
.wx-contract-submit {
  width: 100%;
  padding: 11px 18px;
  font-size: 13.5px;
  font-weight: 600;
}
.wx-contract-submit:disabled {
  opacity: 0.45;
}

/* ===== 方向拆解 ===== */
.wx-step0 {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wx-step0-title {
  font-size: 17px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
  text-align: center;
}
.wx-step0-sub {
  font-size: 12px;
  color: var(--wx-text-muted);
  text-align: center;
}

.wx-goal-box {
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: 100%;
}
.wx-goal-input {
  width: 100%;
  resize: vertical;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-lg);
  color: var(--wx-text-primary);
  font-size: 13.5px;
  line-height: 1.6;
  font-family: inherit;
  outline: none;
}
.wx-goal-input:focus {
  border-color: var(--wx-border-glow);
}
.wx-goal-input:disabled {
  opacity: 0.6;
}
.wx-goal-run {
  width: 100%;
  padding: 11px 18px;
  font-size: 13.5px;
}
.wx-goal-err {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
  border-radius: var(--wx-radius-md);
}

/* 拆解结果卡 */
.wx-decomp {
  width: 100%;
  margin-top: 4px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-lg);
}
.wx-decomp-sum {
  font-size: 13.5px;
  color: var(--wx-text-primary);
  line-height: 1.6;
}
.wx-decomp-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wx-decomp-industry {
  padding: 3px 11px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-radius: var(--wx-radius-pill);
}
.wx-decomp-type {
  padding: 3px 11px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid currentColor;
  border-radius: var(--wx-radius-pill);
}
.wx-decomp-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wx-decomp-label {
  font-size: 11.5px;
  color: var(--wx-text-muted);
}
.wx-decomp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.wx-decomp-chip {
  padding: 5px 12px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border-radius: var(--wx-radius-pill);
}
.wx-decomp-chip.on {
  color: var(--wx-text-on-accent);
  border-color: transparent;
  background: var(--wx-gradient-primary);
}
.wx-decomp-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wx-decomp-tag {
  padding: 3px 9px;
  font-size: 11.5px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border-radius: var(--wx-radius-sm);
}
.wx-decomp-tag.soft {
  color: var(--wx-color-yanqing);
  background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent);
}
.wx-decomp-reason {
  font-size: 11.5px;
  color: var(--wx-text-muted);
  line-height: 1.6;
}

/* ===== SOP 问卷题目 ===== */
.wx-question {
  text-align: left;
}
.wx-question-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  margin-bottom: 4px;
}
.wx-question-sub {
  font-size: 11.5px;
  color: var(--wx-text-muted);
  margin-bottom: 8px;
}

/* 选项按钮：单列 */
.wx-options {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.wx-option {
  padding: 10px 13px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-primary);
  font-size: 13px;
  text-align: left;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-option.selected {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
}

.wx-custom {
  display: flex;
  margin-top: 8px;
}
.wx-custom input {
  flex: 1;
  min-width: 0;
  padding: 9px 13px;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-primary);
  font-size: 13px;
  outline: none;
}
.wx-custom input:focus {
  border-color: var(--wx-border-glow);
}

/* AI 推荐中 */
.wx-dialog-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
}
.wx-loading-orb {
  font-size: 46px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 18px var(--wx-color-primary));
}
.wx-loading-text {
  font-size: 15px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
  text-align: center;
}
.wx-loading-sub {
  font-size: 12px;
  color: var(--wx-text-muted);
  text-align: center;
}

/* 错误 */
.wx-dialog-error-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px;
}
.wx-dialog-error {
  font-size: 12.5px;
  color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
  border-radius: var(--wx-radius-md);
  padding: 10px 16px;
  text-align: center;
}
</style>
