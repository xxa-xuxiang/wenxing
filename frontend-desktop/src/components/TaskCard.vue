<script lang="ts">
export interface TaskResource {
  type: string          // 视频 | 文档 | 接线图 | 代码模板 | 动画
  title: string
  url?: string
  duration_min?: number
  anchor?: string       // 如 "02:15 接线部分"
}

export interface AcceptanceItem {
  text: string
  done?: boolean
}

export interface Task {
  id: string
  title: string
  est_minutes?: number
  scaffold_level?: 0 | 1 | 2 | 3   // 3=完整样例 → 0=独立
  is_critical_path?: boolean
  onboarding_note?: string
  steps?: string[]
  resources?: TaskResource[]
  deliverable?: string
  acceptance?: (string | AcceptanceItem)[]
  common_errors?: { error: string; diagnose: string }[]
}
</script>

<script setup lang="ts">
/**
 * TaskCard.vue —— 任务卡四字段（本次改造最核心的一项）
 *
 * 解决「精细度不够」：任务从"一句标题"变成"打开就能上手"的学习对象。
 * 四字段：resources（去哪学）/ steps（怎么做）/ deliverable（做出什么）/ acceptance（怎么算会）
 *
 * 用法：
 *   <TaskCard :task="task" @feedback="onFeedback" />
 *
 * 设计要点（勿改）：
 * 1. 全部字段可选 —— 老数据没有新字段时必须降级渲染，绝不能白屏。
 * 2. 微反馈常驻在卡片底部，不是弹窗 —— 反馈成本必须低于放弃成本。
 * 3. acceptance 可勾选，勾选状态本地记忆（灰度期不依赖后端）。
 */
import { computed, ref, watch } from 'vue'
import FeedbackBar from './FeedbackBar.vue'
import type { FeedbackPayload } from '@/services/feedbackService'

const props = defineProps<{ task: Task; reply?: string }>()
const emit = defineEmits<{ (e: 'feedback', payload: FeedbackPayload): void }>()

/* ---- 验收标准：兼容 string[] 与 {text,done}[] 两种形态 ---- */
const acceptanceList = computed<AcceptanceItem[]>(() =>
  (props.task.acceptance ?? []).map(a => (typeof a === 'string' ? { text: a, done: false } : { ...a, done: !!a.done }))
)

const checked = ref<boolean[]>([])
watch(
  () => props.task.id,
  () => { checked.value = acceptanceList.value.map(a => !!a.done) },
  { immediate: true }
)
watch(acceptanceList, (v) => {
  if (checked.value.length !== v.length) checked.value = v.map(a => !!a.done)
})

const doneCount = computed(() => checked.value.filter(Boolean).length)
const allPassed = computed(() => acceptanceList.value.length > 0 && doneCount.value === acceptanceList.value.length)

/* ---- 脚手架级别：翻译成人话，不暴露数字 ---- */
const scaffoldText = computed(() => {
  switch (props.task.scaffold_level) {
    case 3: return '完整样例'
    case 2: return '补全练习'
    case 1: return '提示引导'
    case 0: return '独立完成'
    default: return ''
  }
})

const showErrors = ref(false)
</script>

<template>
  <article class="nt-card nt-task" :class="{ 'nt-card--accent': task.is_critical_path }">
    <!-- 头部：标题 + 元信息 -->
    <header class="nt-task__head">
      <h3 class="nt-card__title">{{ task.title }}</h3>
      <div class="nt-task__meta">
        <span v-if="task.est_minutes" class="nt-badge nt-badge--muted">≈ {{ task.est_minutes }} 分钟</span>
        <span v-if="scaffoldText" class="nt-badge nt-badge--muted">{{ scaffoldText }}</span>
        <span v-if="task.is_critical_path" class="nt-badge nt-badge--p1">关键路径</span>
      </div>
    </header>

    <p v-if="task.onboarding_note" class="nt-note nt-task__onboard">{{ task.onboarding_note }}</p>

    <!-- 字段 1：去哪学 -->
    <section v-if="task.resources?.length" class="nt-task__block">
      <h4 class="nt-task__label">去哪学</h4>
      <ul class="nt-task__res">
        <li v-for="(r, i) in task.resources" :key="i">
          <a v-if="r.url" :href="r.url" target="_blank" rel="noopener">{{ r.title }}</a>
          <span v-else>{{ r.title }}</span>
          <span class="nt-task__resmeta">
            <span v-if="r.type">{{ r.type }}</span>
            <span v-if="r.duration_min">{{ r.duration_min }} 分钟</span>
            <span v-if="r.anchor">@ {{ r.anchor }}</span>
          </span>
        </li>
      </ul>
    </section>

    <!-- 字段 2：怎么做 -->
    <section v-if="task.steps?.length" class="nt-task__block">
      <h4 class="nt-task__label">怎么做</h4>
      <ol class="nt-steps">
        <li v-for="(s, i) in task.steps" :key="i">{{ s }}</li>
      </ol>
    </section>

    <!-- 字段 3：做出什么 -->
    <section v-if="task.deliverable" class="nt-task__block">
      <h4 class="nt-task__label">做出什么</h4>
      <p class="nt-task__deliverable">{{ task.deliverable }}</p>
    </section>

    <!-- 字段 4：怎么算会 -->
    <section v-if="acceptanceList.length" class="nt-task__block">
      <h4 class="nt-task__label">
        怎么算会
        <span class="nt-task__count">{{ doneCount }}/{{ acceptanceList.length }}</span>
      </h4>
      <ul class="nt-check">
        <li
          v-for="(a, i) in acceptanceList"
          :key="i"
          :class="{ 'is-done': checked[i] }"
          @click="checked[i] = !checked[i]"
        >{{ a.text }}</li>
      </ul>
      <p v-if="allPassed" class="nt-alert nt-alert--ok">验收通过，可以进入下一项</p>
    </section>

    <!-- 常见错误（折叠，避免吓到新手） -->
    <section v-if="task.common_errors?.length" class="nt-task__block">
      <button class="nt-btn nt-btn--sm nt-btn--ghost" @click="showErrors = !showErrors">
        {{ showErrors ? '收起' : '卡住了？看常见错误' }}
      </button>
      <div v-if="showErrors" class="nt-task__errors">
        <div v-for="(e, i) in task.common_errors" :key="i" class="nt-task__error">
          <code>{{ e.error }}</code>
          <span>{{ e.diagnose }}</span>
        </div>
      </div>
    </section>

    <!-- 微反馈：常驻，不弹窗 -->
    <FeedbackBar
      class="nt-task__feedback"
      :task-id="task.id"
      :reply="reply"
      :context="{
        est_minutes: task.est_minutes,
        scaffold_level: task.scaffold_level,
        acceptance_done: doneCount,
        acceptance_total: acceptanceList.length
      }"
      @submit="emit('feedback', $event)"
    />
  </article>
</template>

<style scoped>
.nt-task { display: flex; flex-direction: column; gap: 12px; }
.nt-task__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.nt-task__meta { display: flex; flex-wrap: wrap; gap: 5px; flex: none; }
.nt-task__onboard { margin: 0; }
.nt-task__block { display: flex; flex-direction: column; gap: 6px; }
.nt-task__label {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--nt-fg-3);
  letter-spacing: .04em;
}
.nt-task__count { color: var(--nt-acc); margin-left: 6px; font-weight: 600; }

.nt-task__res { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.nt-task__res li { font-size: 14px; display: flex; flex-direction: column; }
.nt-task__resmeta { font-size: 12px; color: var(--nt-fg-3); display: flex; gap: 8px; }

.nt-task__deliverable { margin: 0; font-size: 14px; color: var(--nt-fg-2); }

.nt-check li { cursor: pointer; user-select: none; }

.nt-task__errors { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.nt-task__error {
  display: flex; flex-direction: column; gap: 3px;
  background: var(--nt-bg-2);
  border: 1px solid var(--nt-line);
  border-radius: var(--nt-radius-sm);
  padding: 8px 10px;
  font-size: 13px;
}
.nt-task__error code { color: var(--nt-bad); font-family: var(--nt-mono); }
.nt-task__error span { color: var(--nt-fg-2); }

.nt-task__feedback { border-top: 1px solid var(--nt-line); padding-top: 10px; }
</style>
