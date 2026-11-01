<script setup lang="ts">
// 学习规划引导（移动端一页式）：输入目标 → AI 拆解方向 → 学习合同问卷 → AI 推荐技能
// → 确认生成计划（AI 分块 + 确定性回退）→ 确认计划
// 〔参考桌面端 LearnWizard / DirectionDialog / OutlineConfirm / PlanStage 合并精简〕
// 硬约束：所有 AI 生成类操作先 showDialog 确认；挂载不发请求、不轮询
import { computed, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useLearnStore } from '@/stores/learnStore'
import { decomposeGoal, type GoalDecomposition, type SkillGroup } from '@/services/aiService'
import { industries } from '@/data/industries'
import { parseIndustryMd, flattenCategory } from '@/utils/learnMd'
import { questionnaireSteps } from '@/data/questionnaire'
import { skillTypeMeta } from '@/data/skillTypes'

const emit = defineEmits<{ (e: 'done'): void }>()

const learnStore = useLearnStore()

// ===== 步骤推进（复用 store 状态推导，不新增状态机） =====
// 1 = 方向与合同  2 = 技能确认  3 = 计划确认
const step = computed<1 | 2 | 3>(() => {
  if (learnStore.skillGroups) return 2
  if (learnStore.outline.length === 0 || learnStore.plan.length === 0) return 1
  return 3
})

// ===== 步骤 1a：自由输入 → AI 拆解 =====
const goalInput = ref('')
const decomposed = ref<GoalDecomposition | null>(null)
const pickedCategories = ref<Set<string>>(new Set())
const decomposing = ref(false)
const decomposeError = ref<string | null>(null)

/** 一次拆解：把自由描述交给 AI，映射到 行业 + 知识大类 + 能力 + 需学软件 + 技能类型 */
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
    // 行业→大类名 紧凑注册表（仅名称，供 AI 只输出领域/大类名）
    const registry = industries.map((i) => ({
      name: i.name,
      categories: parseIndustryMd(i.md).children.map((c) => c.name)
    }))
    const res = await decomposeGoal(goal, registry)
    decomposed.value = res
    pickedCategories.value = new Set(res.categories)
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

/** 确认拆解结果 → 设定领域（不触发 API） */
function confirmDirection() {
  const d = decomposed.value
  if (!d || pickedCategories.value.size === 0) return
  const dom = learnStore.availableDomains.find((x) => x.name === d.industry)
  if (!dom) {
    showToast(`暂未收录「${d.industry}」行业，请调整描述`)
    return
  }
  learnStore.selectDomain(dom)
  showToast('方向已确认，请完成下方学习合同')
}

// ===== 步骤 1b：SOP 学习合同（5 题，默认选中第一项，可改/可填其他） =====
const answers = ref<Record<string, string>>(
  Object.fromEntries(questionnaireSteps.map((s) => [s.key, s.options[0]?.value ?? '']))
)
const customs = ref<Record<string, string>>({})
const submitting = computed(() => learnStore.generatingRecommend)

/** 把学习合同交给 AI 推荐技能路径（AI 写操作：先确认） */
async function submit() {
  const d = decomposed.value
  if (!d) return
  const ind = industries.find((i) => i.name === d.industry)
  if (!ind || !learnStore.selectedDomain) return
  if (submitting.value) return
  try {
    await showConfirmDialog({
      title: 'AI 推荐技能',
      message: '将把学习合同交给 AI 生成技能路径，是否继续？'
    })
  } catch {
    return
  }
  // 收集已选大类的知识点清单文本（AI 需从中锚定 kp）
  const root = parseIndustryMd(ind.md)
  const trees = Array.from(pickedCategories.value)
    .map((catName) => root.children.find((c) => c.name === catName))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => flattenCategory(c))

  learnStore.requestRecommend({
    categories: Array.from(pickedCategories.value),
    categoryTrees: trees,
    sopPath: answers.value.sopPath || '从零入门',
    goal30: answers.value.goal30 || '未指定',
    baseline: answers.value.baseline || '未指定',
    timeCommitment: answers.value.timeCommitment || '未指定',
    obstacle: answers.value.obstacle || '未指定',
    skillType: d.skillType
  })
}

// ===== 步骤 2：技能组确认 → 生成计划 =====
const planning = computed(() => learnStore.generatingPlan)
const groupsView = computed<SkillGroup[] | null>(() => learnStore.skillGroups)

/** 确认技能组 → 展平大纲 → 生成学习计划（AI 分块，失败回退确定性分块） */
async function onConfirmSkills() {
  const groups = groupsView.value
  if (!groups || planning.value) return
  try {
    await showConfirmDialog({
      title: '生成学习计划',
      message: '将按技能组生成学习大纲与分块计划，是否继续？'
    })
  } catch {
    return
  }
  await learnStore.confirmSkills(groups)
  await learnStore.finishBaseline(null)
  showToast('学习计划已生成')
}

function onCancelRecommend() {
  learnStore.cancelRecommend()
}

// ===== 步骤 3：计划确认 =====
const planView = computed(() => learnStore.plan)
const outlineView = computed(() => learnStore.outline)

function taskTitle(id: string): string {
  return outlineView.value.find((t) => t.id === id)?.title ?? id
}

/** 确认学习计划，进入执行 */
async function onConfirmPlan() {
  try {
    await showConfirmDialog({
      title: '确认学习计划',
      message: '确认后将按此计划开始学习，是否继续？'
    })
  } catch {
    return
  }
  learnStore.confirmPlan()
  emit('done')
}

/** 重新生成计划（AI 写操作：先确认） */
async function onRegenerate() {
  try {
    await showConfirmDialog({
      title: '重新生成计划',
      message: '将重新调用 AI 生成学习计划并覆盖当前排期，是否继续？'
    })
  } catch {
    return
  }
  await learnStore.regeneratePlan()
}

// 计划确认完成 → 通知父级关闭引导
watch(
  () => learnStore.planConfirmed,
  (v) => {
    if (v) emit('done')
  }
)
</script>

<template>
  <div class="lguide">
    <!-- ===== 步骤 1：方向与合同 ===== -->
    <template v-if="step === 1">
      <div class="lguide-sec">
        <div class="lguide-sec-title">用一句话说说你想学什么</div>
        <div class="lguide-sec-sub">AI 会自动拆出领域、能力与需学软件</div>
        <textarea
          v-model="goalInput"
          class="lguide-goal"
          rows="3"
          placeholder="例如：我想用三个月入门物联网开发，能自己做传感器采集并上云的小项目"
          :disabled="decomposing"
        ></textarea>
        <button
          class="lguide-btn-primary"
          :disabled="!goalInput.trim() || decomposing"
          @click="runDecompose"
        >{{ decomposing ? '拆解中…' : (decomposed ? '重新拆解' : '✦ AI 拆解方向') }}</button>
        <div v-if="decomposeError" class="lguide-err">{{ decomposeError }}</div>
      </div>

      <!-- 拆解结果 -->
      <div v-if="decomposed" class="lguide-sec">
        <div class="lguide-sum">{{ decomposed.summary }}</div>
        <div class="lguide-meta">
          <span class="lguide-industry">{{ decomposed.industry }}</span>
          <span
            class="lguide-type"
            :style="{ color: typeMeta.color, borderColor: typeMeta.color }"
          >{{ typeMeta.icon }} {{ typeMeta.name }}</span>
        </div>

        <div class="lguide-label">建议知识大类（点击可增减）</div>
        <div class="lguide-chips">
          <button
            v-for="c in decomposed.categories"
            :key="c"
            class="lguide-chip"
            :class="{ on: pickedCategories.has(c) }"
            @click="togglePicked(c)"
          >{{ c }}</button>
        </div>

        <div v-if="decomposed.capabilities.length" class="lguide-label">所需能力</div>
        <div class="lguide-tags">
          <span v-for="cap in decomposed.capabilities" :key="cap" class="lguide-tag">{{ cap }}</span>
        </div>

        <div v-if="decomposed.software.length" class="lguide-label">需学软件 / 工具</div>
        <div class="lguide-tags">
          <span v-for="s in decomposed.software" :key="s" class="lguide-tag soft">{{ s }}</span>
        </div>

        <div class="lguide-reason">判定理由：{{ decomposed.reason }}</div>

        <button
          class="lguide-btn-primary"
          :disabled="pickedCategories.size === 0"
          @click="confirmDirection"
        >确认方向，完成学习合同 →</button>
      </div>

      <!-- SOP 学习合同（确认方向后展示） -->
      <div v-if="learnStore.selectedDomain" class="lguide-sec">
        <div class="lguide-sec-title">学习合同 · {{ learnStore.selectedDomain.name }}</div>
        <div class="lguide-sec-sub">回答 5 个小问题，让 AI 更懂你的节奏（已给默认答案，可直接提交）</div>
        <div v-for="s in questionnaireSteps" :key="s.key" class="lguide-q">
          <div class="lguide-q-title">{{ s.title }}</div>
          <div class="lguide-q-opts">
            <button
              v-for="opt in s.options"
              :key="opt.value"
              class="lguide-q-opt"
              :class="{ on: answers[s.key] === opt.value }"
              @click="answers[s.key] = opt.value"
            >{{ opt.label }}</button>
          </div>
          <input
            v-model="customs[s.key]"
            class="lguide-q-custom"
            type="text"
            placeholder="其他：自己输入…"
            @input="answers[s.key] = customs[s.key] ?? ''"
          />
        </div>
        <button class="lguide-btn-primary" :disabled="submitting" @click="submit">
          {{ submitting ? 'AI 推荐中…' : '✦ 提交合同，AI 推荐技能' }}
        </button>
        <div v-if="learnStore.recommendError" class="lguide-err">
          {{ learnStore.recommendError }}
          <button class="lguide-retry" @click="submit">重试</button>
        </div>
      </div>
    </template>

    <!-- ===== 步骤 2：技能组确认 ===== -->
    <template v-else-if="step === 2 && groupsView">
      <div class="lguide-sec">
        <div class="lguide-sec-title">AI 推荐的技能路径</div>
        <div class="lguide-sec-sub">确认后将展开为学习大纲并生成分块计划</div>
        <div v-for="g in groupsView" :key="g.name" class="lguide-group">
          <div class="lguide-group-name">{{ g.name }}</div>
          <div class="lguide-group-desc">{{ g.description }}</div>
          <ul class="lguide-group-items">
            <li v-for="it in g.items" :key="it.title">{{ it.title }}</li>
          </ul>
        </div>
        <div class="lguide-btn-row">
          <button class="lguide-btn-ghost" @click="onCancelRecommend">取消，重新填写</button>
          <button class="lguide-btn-primary" :disabled="planning" @click="onConfirmSkills">
            {{ planning ? '计划生成中…' : '✦ 确认，生成学习计划' }}
          </button>
        </div>
      </div>
    </template>

    <!-- ===== 步骤 3：计划确认 ===== -->
    <template v-else>
      <div class="lguide-sec">
        <div class="lguide-sec-title">学习计划</div>
        <div class="lguide-sec-sub">共 {{ planView.length }} 个模块 · 深度掌握导向</div>
        <div v-for="(b, i) in planView" :key="b.id" class="lguide-block">
          <div class="lguide-block-name">模块 {{ i + 1 }}：{{ b.name }}</div>
          <div class="lguide-block-row">学习期限：{{ b.startDate }} ~ {{ b.endDate }}（{{ b.durationDays }} 天）</div>
          <div class="lguide-block-row">目标：{{ b.goal }}</div>
          <div class="lguide-block-row">验收：{{ b.acceptance }}</div>
          <ul class="lguide-group-items">
            <li v-for="id in b.taskIds" :key="id">{{ taskTitle(id) }}</li>
          </ul>
        </div>
        <div class="lguide-btn-row">
          <button class="lguide-btn-ghost" :disabled="planning" @click="onRegenerate">重新生成</button>
          <button class="lguide-btn-primary" @click="onConfirmPlan">✓ 确认计划，开始学习</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lguide {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.lguide-sec {
  padding: 14px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lguide-sec-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2329;
}
.lguide-sec-sub {
  font-size: 12px;
  color: #969799;
  margin-top: -6px;
}
.lguide-goal {
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  border-radius: 10px;
  color: #323233;
  font-size: 14px;
  line-height: 1.6;
  font-family: inherit;
  outline: none;
}
.lguide-goal:focus {
  border-color: #4f6ef2;
}
.lguide-btn-primary {
  padding: 10px 20px;
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
}
.lguide-btn-primary:disabled {
  opacity: 0.5;
}
.lguide-btn-ghost {
  padding: 10px 18px;
  border: 1px solid #dcdee0;
  border-radius: 999px;
  font-size: 13px;
  color: #646566;
  background: #fff;
}
.lguide-btn-row {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.lguide-err {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #ee0a24;
}
.lguide-retry {
  flex-shrink: 0;
  padding: 3px 12px;
  border-radius: 999px;
  border: 1px solid rgba(238, 10, 36, 0.4);
  color: #ee0a24;
  font-size: 12px;
  background: rgba(238, 10, 36, 0.05);
}
.lguide-sum {
  font-size: 13.5px;
  color: #43474d;
  line-height: 1.6;
}
.lguide-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.lguide-industry {
  padding: 3px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
  border-radius: 999px;
}
.lguide-type {
  padding: 3px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid currentColor;
  border-radius: 999px;
}
.lguide-label {
  font-size: 12px;
  color: #969799;
}
.lguide-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.lguide-chip {
  padding: 5px 14px;
  font-size: 13px;
  color: #43474d;
  border: 1px solid #dcdee0;
  background: #f7f8fa;
  border-radius: 999px;
}
.lguide-chip.on {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #6a83f7, #4f6ef2);
}
.lguide-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lguide-tag {
  padding: 3px 10px;
  font-size: 12px;
  color: #4f6ef2;
  background: rgba(79, 110, 242, 0.1);
  border-radius: 6px;
}
.lguide-tag.soft {
  color: #0d9488;
  background: rgba(13, 148, 136, 0.1);
}
.lguide-reason {
  font-size: 11.5px;
  color: #969799;
  line-height: 1.6;
}
.lguide-q {
  padding-top: 6px;
  border-top: 1px dashed #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lguide-q-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #43474d;
}
.lguide-q-opts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lguide-q-opt {
  padding: 9px 12px;
  text-align: left;
  border-radius: 8px;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
  font-size: 13px;
  color: #43474d;
}
.lguide-q-opt.on {
  color: #4f6ef2;
  border-color: rgba(79, 110, 242, 0.5);
  background: rgba(79, 110, 242, 0.08);
  font-weight: 600;
}
.lguide-q-custom {
  padding: 8px 12px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  border-radius: 999px;
  font-size: 13px;
  color: #323233;
  outline: none;
}
.lguide-group {
  padding: 12px;
  border-radius: 10px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lguide-group-name {
  font-size: 14.5px;
  font-weight: 600;
  color: #1f2329;
}
.lguide-group-desc {
  font-size: 12.5px;
  color: #646566;
  line-height: 1.55;
}
.lguide-group-items {
  margin: 2px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lguide-group-items li {
  font-size: 12.5px;
  color: #43474d;
}
.lguide-block {
  padding: 12px;
  border-radius: 10px;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lguide-block-name {
  font-size: 14.5px;
  font-weight: 600;
  color: #1f2329;
}
.lguide-block-row {
  font-size: 12.5px;
  color: #646566;
  line-height: 1.55;
}
</style>
