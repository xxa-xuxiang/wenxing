<script setup lang="ts">
// 任务卡四字段预览：用 mock 计划数据渲染，仅用于「个性化 → 任务卡预览」入口
// 预览不提交反馈，不触碰任何业务状态
import TaskCard from '@/components/TaskCard.vue'
import type { Task } from '@/components/TaskCard.vue'
import sample from '@/mock/plan.sample.json'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

interface SampleStage {
  id: string
  name: string
  milestone: string
  tasks: Task[]
}

const stages = (sample.stages ?? []) as unknown as SampleStage[]
const agent = sample.agent as { decision: string; rationale: string; next_action: string }
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="nt-preview-mask" @click.self="emit('close')">
      <div class="nt-root nt-preview" data-test="task-card-preview">
        <header class="nt-preview__head">
          <div>
            <h2 class="nt-preview__title">任务卡四字段预览</h2>
            <p class="nt-preview__sub">去哪学 · 怎么做 · 做出什么 · 怎么算会（样例数据，反馈不会提交）</p>
          </div>
          <button class="nt-btn nt-btn--sm nt-btn--ghost" @click="emit('close')">关闭</button>
        </header>

        <section class="nt-card nt-card--accent nt-preview__agent">
          <h3 class="nt-card__title">Agent 决策</h3>
          <p class="nt-card__desc">{{ agent.decision }}</p>
          <p class="nt-note">下一步：{{ agent.next_action }}</p>
        </section>

        <div v-for="s in stages" :key="s.id" class="nt-preview__stage">
          <div class="nt-preview__stage-head">
            <span class="nt-badge nt-badge--p2">{{ s.name }}</span>
            <span class="nt-preview__milestone">{{ s.milestone }}</span>
          </div>
          <TaskCard v-for="t in s.tasks" :key="t.id" :task="t" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nt-preview-mask {
  position: fixed;
  inset: 0;
  /* 高于标题栏与抽屉，避免预览被遮挡 */
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  background: rgba(6, 8, 14, 0.62);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.nt-preview {
  width: min(720px, 100%);
  max-height: 100%;
  overflow-y: auto;
  border-radius: 18px;
  border: 1px solid var(--nt-line);
  background: var(--nt-bg);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.nt-preview__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.nt-preview__title { margin: 0; font-size: 18px; font-weight: 700; }
.nt-preview__sub { margin: 4px 0 0; font-size: 12.5px; color: var(--nt-fg-3); }
.nt-preview__agent { display: flex; flex-direction: column; gap: 8px; }
.nt-preview__agent .nt-card__desc { line-height: 1.7; }
.nt-preview__stage { display: flex; flex-direction: column; gap: 10px; }
.nt-preview__stage-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.nt-preview__milestone { font-size: 12.5px; color: var(--nt-fg-2); }
</style>
