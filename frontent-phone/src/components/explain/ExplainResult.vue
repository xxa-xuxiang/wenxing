<script setup lang="ts">
// 费曼讲解结果展示（移动端）：4 维度评分 + 盲区清单 + 子节点补强入口
import { computed } from 'vue'
import type { ExplainResult, GapItem } from '@/services/aiService'
import type { KpPath } from '@/types'

const props = defineProps<{
  result: ExplainResult
  kp: KpPath
  transcript: string
  /** 是否提供「去补强」下游动作（星图技能详情无任务体系时传 false，避免死按钮） */
  strengthenable?: boolean
}>()

const emit = defineEmits<{
  (e: 'retry'): void
  (e: 'close'): void
  (e: 'strengthen', gap: GapItem): void
}>()

const passThreshold = 70

const dims = computed(() => [
  { key: 'accuracy', label: '概念准确', score: props.result.scores.accuracy, max: 25, desc: '讲清楚核心是什么，没有混淆或错误' },
  { key: 'structure', label: '结构条理', score: props.result.scores.structure, max: 25, desc: '有清晰的展开顺序，听者能跟上' },
  { key: 'analogy', label: '类比落地', score: props.result.scores.analogy, max: 25, desc: '用了生活例子或类比帮助理解' },
  { key: 'gapAwareness', label: '盲区自知', score: props.result.scores.gapAwareness, max: 25, desc: '主动说清哪里不懂、哪里不确定' }
])

const totalClass = computed(() => {
  if (props.result.total >= 90) return 'excellent'
  if (props.result.total >= passThreshold) return 'pass'
  return 'fail'
})

const totalLabel = computed(() => {
  if (props.result.total >= 90) return '讲解出色，可以当小老师了'
  if (props.result.total >= passThreshold) return '通过，继续保持'
  return '未通过，建议针对盲区补强后再试'
})

const showQuotaWarn = computed(() => {
  const u = props.result.usage
  if (!u || !u.limited || u.limit === 0) return false
  return u.remaining <= Math.ceil(u.limit * 0.2)
})

function barWidth(score: number, max: number) {
  return `${(score / max) * 100}%`
}

function barColor(score: number, max: number) {
  const ratio = score / max
  if (ratio >= 0.8) return 'var(--wx-color-jade)'
  if (ratio >= 0.6) return 'var(--wx-color-primary)'
  return 'var(--wx-color-vermilion)'
}
</script>

<template>
  <div class="wx-explain-mask" @click.self="emit('close')">
    <div class="wx-explain-modal">
      <header class="wx-explain-head">
        <div class="wx-explain-head-title">
          <span class="wx-explain-mark">✦</span>
          <span>讲解评估 · {{ kp.name }}</span>
        </div>
        <button class="wx-explain-close" title="关闭" @click="emit('close')">×</button>
      </header>

      <div class="wx-explain-body">
        <div v-if="showQuotaWarn" class="wx-explain-quota-warn">
          今日讲解检测还剩 {{ result.usage?.remaining }} 次（共 {{ result.usage?.limit }} 次），升级会员不限量
        </div>

        <section class="wx-explain-total">
          <div class="wx-explain-total-orb" :class="totalClass">
            <span class="wx-explain-total-score">{{ result.total }}</span>
            <span class="wx-explain-total-unit">/ 100</span>
          </div>
          <div class="wx-explain-total-info">
            <div class="wx-explain-total-status" :class="totalClass">
              {{ result.passed ? '通过' : '未通过' }} · {{ passThreshold }} 分合格
            </div>
            <div class="wx-explain-total-tip">{{ totalLabel }}</div>
          </div>
        </section>

        <section class="wx-explain-dims">
          <h3 class="wx-explain-section-title">四维评估</h3>
          <div class="wx-explain-dim-grid">
            <div v-for="d in dims" :key="d.key" class="wx-explain-dim-card">
              <div class="wx-explain-dim-head">
                <span class="wx-explain-dim-label">{{ d.label }}</span>
                <span class="wx-explain-dim-score">{{ d.score }}<small>/{{ d.max }}</small></span>
              </div>
              <div class="wx-explain-dim-bar">
                <div
                  class="wx-explain-dim-fill"
                  :style="{ width: barWidth(d.score, d.max), background: barColor(d.score, d.max) }"
                ></div>
              </div>
              <p class="wx-explain-dim-desc">{{ d.desc }}</p>
            </div>
          </div>
        </section>

        <section class="wx-explain-summary">
          <h3 class="wx-explain-section-title">问星点评</h3>
          <p class="wx-explain-summary-text">{{ result.summary }}</p>
        </section>

        <section v-if="result.strengths.length" class="wx-explain-strengths">
          <h3 class="wx-explain-section-title">做得好的地方</h3>
          <ul class="wx-explain-strength-list">
            <li v-for="(s, i) in result.strengths" :key="i">{{ s }}</li>
          </ul>
        </section>

        <section v-if="result.gaps.length" class="wx-explain-gaps">
          <h3 class="wx-explain-section-title">发现 {{ result.gaps.length }} 个盲区</h3>
          <div class="wx-explain-gap-list">
            <div v-for="(g, i) in result.gaps" :key="i" class="wx-explain-gap-card">
              <div class="wx-explain-gap-head">
                <span class="wx-explain-gap-idx">{{ i + 1 }}</span>
                <span class="wx-explain-gap-concept">{{ g.concept }}</span>
                <button
                  v-if="strengthenable !== false"
                  class="wx-explain-gap-btn"
                  @click="emit('strengthen', g)"
                >去补强 →</button>
              </div>
              <p class="wx-explain-gap-issue">{{ g.issue }}</p>
              <p class="wx-explain-gap-suggestion">建议：{{ g.suggestion }}</p>
            </div>
          </div>
        </section>

        <footer class="wx-explain-foot">
          <button class="wx-explain-retry" @click="emit('retry')">再讲一次</button>
          <button class="wx-explain-done" @click="emit('close')">
            {{ result.passed ? '完成' : '知道了' }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wx-explain-mask {
  position: fixed;
  inset: 0;
  z-index: 220;
  background: color-mix(in srgb, var(--wx-bg-deep) 72%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.wx-explain-modal {
  width: 100%;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--wx-bg-deep) 94%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-glass-radius);
  box-shadow: var(--wx-shadow-glow), var(--wx-shadow-lg);
  overflow: hidden;
}
.wx-explain-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.wx-explain-head-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--wx-font-serif);
  font-size: 15px;
  color: var(--wx-text-primary);
}
.wx-explain-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 8px var(--wx-color-primary));
}
.wx-explain-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  font-size: 18px;
  color: var(--wx-text-secondary);
  line-height: 1;
}
.wx-explain-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.wx-explain-quota-warn {
  padding: 10px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-amber) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-amber) 30%, transparent);
  font-size: 12px;
  color: var(--wx-color-amber);
  text-align: center;
}
.wx-explain-total {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: var(--wx-radius-lg);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-explain-total-orb {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: baseline;
  justify-content: center;
  flex-shrink: 0;
  border: 2px solid;
}
.wx-explain-total-orb.excellent { background: color-mix(in srgb, var(--wx-state-deep) 12%, transparent); border-color: var(--wx-state-deep); color: var(--wx-state-deep); }
.wx-explain-total-orb.pass { background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent); border-color: var(--wx-color-primary); color: var(--wx-color-primary); }
.wx-explain-total-orb.fail { background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent); border-color: var(--wx-color-vermilion); color: var(--wx-color-vermilion); }
.wx-explain-total-score { font-size: 30px; font-weight: 700; font-family: var(--wx-font-serif); line-height: 1; }
.wx-explain-total-unit { font-size: 12px; margin-left: 2px; opacity: 0.7; }
.wx-explain-total-info { flex: 1; min-width: 0; }
.wx-explain-total-status {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  margin-bottom: 4px;
}
.wx-explain-total-status.excellent { color: var(--wx-state-deep); }
.wx-explain-total-status.pass { color: var(--wx-color-primary); }
.wx-explain-total-status.fail { color: var(--wx-color-vermilion); }
.wx-explain-total-tip { font-size: 12px; color: var(--wx-text-tertiary); }
.wx-explain-section-title {
  font-size: 13px;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-secondary);
  margin-bottom: 10px;
}
.wx-explain-dim-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.wx-explain-dim-card {
  padding: 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-explain-dim-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
.wx-explain-dim-label { font-size: 12.5px; color: var(--wx-text-primary); font-weight: 600; }
.wx-explain-dim-score { font-size: 14px; font-weight: 700; color: var(--wx-text-primary); }
.wx-explain-dim-score small { font-size: 10px; color: var(--wx-text-muted); font-weight: 400; }
.wx-explain-dim-bar {
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  overflow: hidden;
  margin-bottom: 8px;
}
.wx-explain-dim-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.6s var(--wx-ease-out-soft);
}
.wx-explain-dim-desc { font-size: 10.5px; color: var(--wx-text-muted); line-height: 1.4; margin: 0; }
.wx-explain-summary-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--wx-text-secondary);
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-yanqing) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-yanqing) 15%, transparent);
  margin: 0;
}
.wx-explain-strength-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wx-explain-strength-list li {
  font-size: 13px;
  color: var(--wx-text-secondary);
  padding-left: 16px;
  position: relative;
}
.wx-explain-strength-list li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--wx-color-jade);
}
.wx-explain-gap-list { display: flex; flex-direction: column; gap: 10px; }
.wx-explain-gap-card {
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-vermilion) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent);
}
.wx-explain-gap-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.wx-explain-gap-idx {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent);
  color: var(--wx-color-vermilion);
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wx-explain-gap-concept { flex: 1; font-size: 13px; font-weight: 600; color: var(--wx-text-primary); }
.wx-explain-gap-btn {
  padding: 4px 10px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  color: var(--wx-color-primary-soft);
  font-size: 11.5px;
}
.wx-explain-gap-issue { font-size: 12px; color: var(--wx-text-secondary); margin: 0 0 4px 28px; line-height: 1.5; }
.wx-explain-gap-suggestion { font-size: 11.5px; color: var(--wx-text-tertiary); margin: 0 0 0 28px; line-height: 1.5; }
.wx-explain-foot {
  display: flex;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-explain-retry,
.wx-explain-done {
  flex: 1;
  padding: 11px 0;
  border-radius: var(--wx-radius-pill);
  font-size: 13.5px;
}
.wx-explain-retry {
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
}
.wx-explain-done {
  border: none;
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-weight: 600;
}
</style>
