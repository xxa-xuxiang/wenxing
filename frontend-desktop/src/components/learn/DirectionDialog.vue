<script setup lang="ts">
// 问星 · 学习合同：步骤 0「用一句话描述方向」→ 输入 + 语音识别 → AI 拆解出 领域/能力/需学软件/技能类型
// → 用户确认 → SOP 五题 → AI 推荐技能。硬约束：所有触发 API 的按钮均先弹确认框，挂载不发请求、不轮询。
import { computed, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { questionnaireSteps } from '@/data/questionnaire'
import { industries } from '@/data/industries'
import { parseIndustryMd, flattenCategory } from '@/utils/industryMd'
import { skillTypeMeta } from '@/data/skillTypes'
import { useSpeechRecognition } from '@/composables/useSpeech'
import { decomposeGoal, type GoalDecomposition } from '@/services/aiService'
import type { QuestionnaireAnswers } from '@/types'

const learnStore = useLearnStore()

// 单页学习合同：方向拆解 + SOP 五题一次性展示，底部统一提交

// ===== 步骤 0：自由输入 + 语音识别 → AI 拆解 =====
const goalInput = ref('')
const decomposed = ref<GoalDecomposition | null>(null)
const pickedCategories = ref<Set<string>>(new Set())
const decomposing = ref(false)
const decomposeError = ref<string | null>(null)

const {
  supported: sttSupported,
  listening,
  transcript: liveTranscript,
  error: sttError,
  start: startStt,
  stop: stopStt,
  flush: flushStt
} = useSpeechRecognition({
  onFinal: (t) => {
    goalInput.value = (goalInput.value.trim() ? goalInput.value.trim() + '，' : '') + t
  }
})

function toggleMic() {
  if (listening.value) {
    flushStt()
    stopStt()
  } else {
    startStt()
  }
}

/** 一次拆解：把自由描述交给 AI，映射到 行业 + 知识大类 + 能力 + 需学软件 + 技能类型 */
async function runDecompose() {
  const goal = goalInput.value.trim()
  if (!goal || decomposing.value) return
  if (!window.confirm('将把这段描述交给 AI 拆解为领域与能力，是否继续？')) return
  decomposing.value = true
  decomposeError.value = null
  try {
    // 语音/浏览器能力差异不应阻断拆解
    stopStt()
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

function submit() {
  const d = decomposed.value
  const ind = industries.find((i) => i.name === d?.industry)
  if (!ind || !d) return
  if (!window.confirm('将把学习合同交给 AI 生成技能路径，是否继续？')) return
  // 领域（行业）确认：切换会清空旧行业数据
  if (learnStore.selectedDomain?.id !== ind.id) {
    const dom = learnStore.availableDomains.find((x) => x.id === ind.id)
    if (dom) learnStore.selectDomain(dom)
  }
  // 收集已选大类的知识点清单文本（AI 需从中锚定 kp）
  const root = parseIndustryMd(ind.md)
  const trees = Array.from(pickedCategories.value)
    .map((catName) => root.children.find((c) => c.name === catName))
    .filter(Boolean)
    .map((c) => flattenCategory(c!))

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
          <div class="wx-step0-sub">可以打字，也可以点麦克风说话；AI 会自动拆出领域、能力与需学软件</div>

          <div class="wx-goal-box">
            <textarea
              v-model="goalInput"
              class="wx-goal-input"
              rows="3"
              placeholder="例如：我想用三个月入门物联网开发，能自己做传感器采集并上云的小项目"
              :disabled="decomposing"
            ></textarea>
            <div class="wx-goal-bar">
              <button
                class="wx-mic-btn wx-pressable"
                :class="{ listening }"
                :disabled="!sttSupported || decomposing"
                :title="sttSupported ? (listening ? '停止录音' : '点击开始语音输入') : '当前浏览器不支持语音识别，请用 Chrome / Edge'"
                @click="toggleMic"
              >{{ listening ? '■ 停止' : '🎤 语音输入' }}</button>
              <button
                class="wx-btn-gradient wx-pressable wx-goal-run"
                :disabled="!goalInput.trim() || decomposing"
                @click="runDecompose"
              >{{ decomposing ? '拆解中…' : (decomposed ? '重新拆解' : 'AI 拆解方向') }}</button>
            </div>
            <div v-if="listening" class="wx-goal-live">
              <span class="wx-goal-live-dot"></span>识别中：{{ liveTranscript || '请开始说话…' }}
            </div>
            <div v-if="sttError" class="wx-goal-err">{{ sttError }}</div>
            <div v-if="decomposeError" class="wx-goal-err">{{ decomposeError }}</div>
          </div>

          <!-- 拆解结果 -->
          <div v-if="decomposed" class="wx-decomp">
            <div class="wx-decomp-sum">{{ decomposed.summary }}</div>
            <div class="wx-decomp-meta">
              <span class="wx-decomp-industry">{{ decomposed.industry }}</span>
              <span
                class="wx-decomp-type"
                :style="{ color: typeMeta.color, borderColor: typeMeta.color }"
              >{{ typeMeta.icon }} {{ typeMeta.name }}</span>
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
        >提交学习合同并生成技能组 →</button>
      </div>
    </div>

    <!-- AI 推荐中 -->
    <div v-if="loading" class="wx-dialog-loading">
      <div class="wx-loading-orb">✦</div>
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
  padding: 24px 28px 96px;
  gap: 18px;
}
.wx-dialog-head {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--wx-border-soft);
  text-align: center;
}
.wx-dialog-title {
  font-size: 22px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  letter-spacing: 0.06em;
}
.wx-dialog-domain {
  margin-left: 10px;
  padding: 2px 10px;
  font-size: 12px;
  font-family: var(--wx-font-sans);
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  border-radius: var(--wx-radius-pill);
  vertical-align: middle;
}
.wx-dialog-sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
}

/* 进度指示器 */
.wx-progress {
  display: flex;
  justify-content: center;
  gap: 10px;
}
.wx-progress-dot {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
  transition: all var(--wx-duration-mid) var(--wx-ease-spring);
}
.wx-progress-dot.active {
  background: var(--wx-gradient-primary);
  box-shadow: 0 0 8px var(--wx-color-primary);
}
.wx-progress-dot.done {
  background: color-mix(in srgb, var(--wx-color-primary) 50%, transparent);
}

.wx-dialog-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
}

/* ===== 单页学习合同 ===== */
.wx-contract { gap: 18px; }
.wx-contract-block {
  padding: 16px 18px;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-contract-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-primary);
  margin-bottom: 4px;
}
.wx-contract-sub { font-size: 12px; color: var(--wx-text-muted); margin-bottom: 12px; }
.wx-question--inline {
  padding: 12px 0;
  border-top: 1px dashed var(--wx-border-soft);
}
.wx-question--inline:first-of-type { border-top: 0; padding-top: 4px; }
.wx-question--inline.is-missing .wx-question-title { color: var(--wx-color-amber); }
.wx-contract-foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 4px 0;
  border-top: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 92%, transparent);
  backdrop-filter: blur(10px);
}
.wx-contract-hint { font-size: 12px; color: var(--wx-text-muted); }
.wx-contract-submit { padding: 10px 24px; font-size: 13px; font-weight: 600; }
.wx-contract-submit:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

/* ===== 步骤 0：方向拆解 ===== */
.wx-step0 {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wx-step0-title {
  font-size: 20px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
  text-align: center;
}
.wx-step0-sub {
  font-size: 13px;
  color: var(--wx-text-muted);
  text-align: center;
}

.wx-goal-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 640px;
  width: 100%;
  margin: 0 auto;
}
.wx-goal-input {
  width: 100%;
  resize: vertical;
  padding: 14px 16px;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-lg);
  color: var(--wx-text-primary);
  font-size: 14px;
  line-height: 1.6;
  font-family: inherit;
  outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-goal-input:focus { border-color: var(--wx-border-glow); }
.wx-goal-input:disabled { opacity: 0.6; }

.wx-goal-bar {
  display: flex;
  gap: 10px;
}
.wx-mic-btn {
  flex-shrink: 0;
  padding: 10px 18px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-spring);
}
.wx-mic-btn:hover { border-color: var(--wx-border-glow); color: var(--wx-text-primary); }
.wx-mic-btn.listening {
  color: var(--wx-text-on-accent);
  border-color: transparent;
  background: var(--wx-color-vermilion, var(--wx-color-vermilion));
  box-shadow: 0 0 12px color-mix(in srgb, var(--wx-color-vermilion) 45%, transparent);
}
.wx-mic-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.wx-goal-run { flex: 1; }

.wx-goal-live {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  border: 1px dashed var(--wx-border-glow);
  border-radius: var(--wx-radius-md);
}
.wx-goal-live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--wx-color-vermilion, var(--wx-color-vermilion));
  animation: wx-breathe 1s var(--wx-ease-in-out-soft) infinite alternate;
}
.wx-goal-err {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--wx-color-vermilion, var(--wx-color-vermilion));
  background: color-mix(in srgb, var(--wx-color-vermilion) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
  border-radius: var(--wx-radius-md);
}

/* 拆解结果卡 */
.wx-decomp {
  max-width: 720px;
  width: 100%;
  margin: 4px auto 0;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-lg);
  animation: wx-wiz-in 0.24s var(--wx-ease-spring);
}
.wx-decomp-sum {
  font-size: 14px;
  color: var(--wx-text-primary);
  line-height: 1.6;
}
.wx-decomp-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.wx-decomp-industry {
  padding: 3px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border-radius: var(--wx-radius-pill);
}
.wx-decomp-type {
  padding: 3px 12px;
  font-size: 12px;
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
  font-size: 12px;
  color: var(--wx-text-muted);
}
.wx-decomp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wx-decomp-chip {
  padding: 5px 14px;
  font-size: 13px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border-radius: var(--wx-radius-pill);
  transition: all var(--wx-duration-fast) var(--wx-ease-spring);
}
.wx-decomp-chip.on {
  color: var(--wx-text-on-accent);
  border-color: transparent;
  background: var(--wx-gradient-primary);
  box-shadow: 0 0 10px color-mix(in srgb, var(--wx-color-primary) 35%, transparent);
}
.wx-decomp-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wx-decomp-tag {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border-radius: var(--wx-radius-sm);
}
.wx-decomp-tag.soft {
  color: var(--wx-color-yanqing, var(--wx-color-yanqing));
  background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent);
}
.wx-decomp-reason {
  font-size: 12px;
  color: var(--wx-text-muted);
  line-height: 1.6;
}
.wx-step0-nav {
  text-align: center;
  margin-top: 4px;
}

/* ===== SOP 问卷题目 ===== */
.wx-question {
  text-align: center;
}
.wx-question-title {
  font-size: 20px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
  margin-bottom: 6px;
}
.wx-question-sub {
  font-size: 13px;
  color: var(--wx-text-muted);
  margin-bottom: 22px;
}

/* 选项按钮 */
.wx-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  max-width: 480px;
  margin: 0 auto;
}
.wx-option {
  padding: 16px 20px;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-primary);
  font-size: 15px;
  font-weight: 500;
  transition: all var(--wx-duration-fast) var(--wx-ease-spring);
  text-align: center;
}
.wx-option:hover {
  transform: translateY(-2px);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
}
.wx-option.selected {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
}

/* 「其他」填空 */
.wx-custom {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}
.wx-custom input {
  flex: 1;
  padding: 11px 16px;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-custom input:focus { border-color: var(--wx-border-glow); }
.wx-custom-btn {
  padding: 9px 20px;
  background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-primary);
  font-size: 13px;
  font-weight: 600;
}
.wx-custom-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* 回答回显 */
.wx-history {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 20px;
  justify-content: center;
}
.wx-history-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  border: 1px solid var(--wx-border-soft);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-history-tag:hover {
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
}
.wx-history-tag em {
  font-style: normal;
  color: var(--wx-text-muted);
}
.wx-history-tag strong {
  color: var(--wx-color-primary-soft);
  font-weight: 600;
}

/* 上一步 */
.wx-dialog-nav {
  margin-top: 16px;
  text-align: center;
}
.wx-prev-btn {
  padding: 8px 18px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-prev-btn:hover { color: var(--wx-text-primary); }

/* AI 推荐中 */
.wx-dialog-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.wx-loading-orb {
  font-size: 52px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 18px var(--wx-color-primary));
  animation: wx-breathe 2s var(--wx-ease-in-out-soft) infinite alternate;
}
.wx-loading-text {
  font-size: 16px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
}
.wx-loading-text::after {
  content: '';
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-left: 8px;
  border: 2px solid color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
  border-top-color: var(--wx-color-primary-soft);
  border-radius: 50%;
  animation: wx-spin 0.8s linear infinite;
  vertical-align: middle;
}
.wx-loading-sub {
  font-size: 13px;
  color: var(--wx-text-muted);
}

/* 错误 */
.wx-dialog-error-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.wx-dialog-error {
  font-size: 13px;
  color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
  border-radius: var(--wx-radius-md);
  padding: 10px 18px;
  max-width: 420px;
  text-align: center;
}
</style>
