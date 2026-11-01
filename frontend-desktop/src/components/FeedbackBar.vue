<script setup lang="ts">
/**
 * FeedbackBar.vue —— 微反馈 + 归因四选一
 *
 * 三原则（勿改）：
 * 1. 一键、1 秒完成，不打字 —— 反馈成本必须低于放弃成本。
 * 2. 归因用四选一，不用自由文本 —— 结构化才能聚合；自由文本只能读不能算。
 * 3. 提交后必须有【即时回报】 —— 用户要当场看到计划变了什么。
 *    没有即时回报的反馈就是单向索取，二次反馈率会归零。
 *
 * 四类归因（与后端 REASON_MAP 一一对应）：
 *   environment 环境问题 → 环境自检 + 排障手册（不是用户学不会）
 *   unclear     看不懂   → 换资源 + 降脚手架
 *   cannot_do   做不出来 → 补全式练习 + 常见错误清单
 *   no_time     时间不够 → 缩减范围 + 重排
 */
import { ref, computed } from 'vue'
import type { FeedbackPayload } from '@/services/feedbackService'

const props = defineProps<{
  taskId: string
  context?: Record<string, unknown>   // 由父组件补齐，绝不让用户填
  /** 父级拿到后端 reply 后回填；未回填时用本地兜底文案 */
  reply?: string
}>()
const emit = defineEmits<{ (e: 'submit', payload: FeedbackPayload): void }>()

type ReasonKey = 'environment' | 'unclear' | 'cannot_do' | 'no_time' | 'other'

const REASONS: { key: ReasonKey; label: string; hint: string; reply: string }[] = [
  {
    key: 'environment',
    label: '环境问题',
    hint: '板子没识别 / 驱动装不上 / 串口被占',
    reply: '已把这条记为环境问题（不是你的问题）。已附上环境自检清单，今天的产出目标不变。'
  },
  {
    key: 'unclear',
    label: '看不懂',
    hint: '不知道这段在讲什么',
    reply: '已换成更基础的讲解资源，并把提示升级为完整样例。今天的目标缩减为 2 步。'
  },
  {
    key: 'cannot_do',
    label: '做不出来',
    hint: '看懂了但写不出来',
    reply: '已切到补全式练习：你只需填空关键几行，并附上这条任务的常见错误清单。'
  },
  {
    key: 'no_time',
    label: '时间不够',
    hint: '今天只剩一点时间',
    reply: '已砍掉非关键路径任务，今天只需完成 1 步即可打卡，后续已重新排期。'
  },
  { key: 'other', label: '其他', hint: '以上都不是', reply: '已记录，会纳入这条任务的优化。' }
]

const state = ref<'idle' | 'asking' | 'done'>('idle')
const chosen = ref<ReasonKey | null>(null)
const detail = ref('')
const submitting = ref(false)

const currentReply = computed(() => REASONS.find(r => r.key === chosen.value)?.reply ?? '')
/** 优先展示后端即时回报文案；后端未返回时用本地兜底 */
const displayReply = computed(() => props.reply || currentReply.value || '已记录，感谢反馈。')

async function mark(kind: 'smooth' | 'stuck') {
  if (kind === 'smooth') {
    await send({ user_given: 'smooth', reason_tag: null })
    state.value = 'done'
    return
  }
  state.value = 'asking'   // 卡住了 → 再给四选一（仍是一键）
}

async function submitReason() {
  if (!chosen.value) return
  await send({ user_given: 'stuck', reason_tag: chosen.value, detail: detail.value.trim() || undefined })
  state.value = 'done'
}

async function send(
  extra: { user_given: FeedbackPayload['user_given'] } & Partial<FeedbackPayload>
): Promise<void> {
  submitting.value = true
  const payload: FeedbackPayload = {
    task_id: props.taskId,
    ts: Date.now(),
    // 上下文全部由系统补齐，用户只给 user_given + reason_tag
    context: props.context ?? {},
    ...extra
  }
  try {
    emit('submit', payload)          // 交给父组件统一上报（便于加开关 / 队列 / 重试）
  } finally {
    submitting.value = false
  }
}

function reset() {
  state.value = 'idle'
  chosen.value = null
  detail.value = ''
}
</script>

<template>
  <div class="nt-fb">
    <!-- 状态 1：常驻双按钮 -->
    <div v-if="state === 'idle'" class="nt-fb__row">
      <span class="nt-fb__ask">这一步</span>
      <button class="nt-btn nt-btn--sm nt-btn--ok" :disabled="submitting" @click="mark('smooth')">顺利</button>
      <button class="nt-btn nt-btn--sm nt-btn--bad" :disabled="submitting" @click="mark('stuck')">卡住了</button>
    </div>

    <!-- 状态 2：归因四选一 -->
    <div v-else-if="state === 'asking'" class="nt-fb__panel">
      <p class="nt-fb__title">卡在哪一类？</p>
      <div class="nt-fb__opts">
        <button
          v-for="r in REASONS"
          :key="r.key"
          class="nt-fb__opt"
          :class="{ 'is-on': chosen === r.key }"
          @click="chosen = r.key"
        >
          <b>{{ r.label }}</b>
          <small>{{ r.hint }}</small>
        </button>
      </div>
      <input
        v-if="chosen"
        v-model="detail"
        class="nt-fb__input"
        placeholder="补充说明（可不填）"
        maxlength="200"
      />
      <div class="nt-fb__row nt-fb__row--end">
        <button class="nt-btn nt-btn--sm nt-btn--ghost" @click="reset">取消</button>
        <button class="nt-btn nt-btn--sm nt-btn--primary" :disabled="!chosen || submitting" @click="submitReason">
          {{ submitting ? '提交中…' : '提交' }}
        </button>
      </div>
    </div>

    <!-- 状态 3：即时回报（这一屏决定二次反馈率，不能省） -->
    <div v-else class="nt-fb__panel">
      <p class="nt-alert nt-alert--ok nt-fb__reply">
        <b>已收到，计划已调整：</b>{{ displayReply }}
      </p>
      <button class="nt-btn nt-btn--sm nt-btn--ghost" @click="reset">再反馈一次</button>
    </div>
  </div>
</template>

<style scoped>
.nt-fb { display: flex; flex-direction: column; gap: 8px; }
.nt-fb__row { display: flex; align-items: center; gap: 8px; }
.nt-fb__row--end { justify-content: flex-end; }
.nt-fb__ask { font-size: 13px; color: var(--nt-fg-3); margin-right: auto; }

.nt-fb__panel { display: flex; flex-direction: column; gap: 8px; }
.nt-fb__title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--nt-fg-2); }

.nt-fb__opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.nt-fb__opt {
  display: flex; flex-direction: column; gap: 2px;
  text-align: left;
  padding: 9px 10px;
  border-radius: var(--nt-radius-sm);
  border: 1px solid var(--nt-line);
  background: var(--nt-card);
  color: var(--nt-fg);
  cursor: pointer;
  font-size: 13.5px;
}
.nt-fb__opt small { color: var(--nt-fg-3); font-size: 11.5px; line-height: 1.45; }
.nt-fb__opt.is-on {
  border-color: var(--nt-acc);
  background: color-mix(in srgb, var(--nt-acc) 14%, var(--nt-card));
}

.nt-fb__input {
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  border-radius: var(--nt-radius-sm);
  border: 1px solid var(--nt-line);
  background: var(--nt-bg-2);
  color: var(--nt-fg);
  font-size: 13.5px;
  font-family: inherit;
}
.nt-fb__input:focus { outline: none; border-color: var(--nt-acc); }

.nt-fb__reply { margin: 0; line-height: 1.6; }

@media (max-width: 400px) {
  .nt-fb__opts { grid-template-columns: 1fr; }
}
</style>
