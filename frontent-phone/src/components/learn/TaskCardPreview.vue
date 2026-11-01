<script setup lang="ts">
// 任务卡四字段预览：用内置样例数据渲染，仅用于「个性化 → 任务卡预览」入口
// 预览不提交反馈，不触碰任何业务状态（移动端版不依赖桌面 TaskCard / mock 文件）
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

interface SampleTask {
  id: string
  title: string
  estMinutes: number
  scaffold: string
  critical?: boolean
  onboarding: string
  steps: string[]
  resources: Array<{ title: string; type: string; durationMin: number }>
  deliverable: string
  acceptance: string[]
  errors: Array<{ error: string; diagnose: string }>
}

const stages: Array<{ name: string; milestone: string; tasks: SampleTask[] }> = [
  {
    name: '阶段一 · 基础与样例',
    milestone: '能照做完成第一个可运行样例',
    tasks: [
      {
        id: 'sample-1',
        title: '搭建开发环境并跑通 Hello World',
        estMinutes: 45,
        scaffold: '完整样例',
        critical: true,
        onboarding: '这是你项目的第 1 步：先让环境跑起来',
        steps: ['安装运行时与编辑器', '新建最小项目', '运行并看到输出'],
        resources: [
          { title: '官方快速开始文档', type: '文档', durationMin: 15 },
          { title: '环境配置视频', type: '视频', durationMin: 20 }
        ],
        deliverable: '一个能本地运行的最小项目',
        acceptance: ['项目能正常启动', '能修改一行代码并看到变化'],
        errors: [{ error: '启动报端口占用', diagnose: '关闭占用端口的进程或换端口' }]
      }
    ]
  },
  {
    name: '阶段二 · 独立实践',
    milestone: '独立完成一个可演示的小功能',
    tasks: [
      {
        id: 'sample-2',
        title: '实现一个带表单校验的功能模块',
        estMinutes: 90,
        scaffold: '提示引导',
        onboarding: '这是你项目的第 2 步：把输入与反馈串起来',
        steps: ['画出数据流', '实现输入与校验', '处理异常与空态'],
        resources: [{ title: '表单设计模式速查', type: '文档', durationMin: 25 }],
        deliverable: '可演示的功能模块与一段说明',
        acceptance: ['正常输入可提交', '非法输入有明确提示', '能复述校验规则'],
        errors: [{ error: '提交后状态不刷新', diagnose: '检查响应式依赖与更新时机' }]
      }
    ]
  }
]
</script>

<template>
  <div v-if="open" class="nt-preview-mask" @click.self="emit('close')">
    <div class="nt-preview">
      <header class="nt-preview__head">
        <div>
          <h2 class="nt-preview__title">任务卡四字段预览</h2>
          <p class="nt-preview__sub">去哪学 · 怎么做 · 做出什么 · 怎么算会（样例数据，反馈不会提交）</p>
        </div>
        <button class="nt-preview__close" @click="emit('close')">关闭</button>
      </header>

      <section class="nt-card nt-card--accent">
        <h3 class="nt-card__title">Agent 决策</h3>
        <p class="nt-card__desc">先建立可运行的最小闭环，再逐步增加复杂度；关键路径任务优先排期。</p>
        <p class="nt-note">下一步：根据验收结果决定是否进入独立实践阶段。</p>
      </section>

      <div v-for="s in stages" :key="s.name" class="nt-preview__stage">
        <div class="nt-preview__stage-head">
          <span class="nt-badge">{{ s.name }}</span>
          <span class="nt-preview__milestone">{{ s.milestone }}</span>
        </div>
        <article v-for="t in s.tasks" :key="t.id" class="nt-card" :class="{ 'nt-card--accent': t.critical }">
          <header class="nt-task__head">
            <h3 class="nt-card__title">{{ t.title }}</h3>
            <div class="nt-task__meta">
              <span class="nt-badge nt-badge--muted">≈ {{ t.estMinutes }} 分钟</span>
              <span class="nt-badge nt-badge--muted">{{ t.scaffold }}</span>
              <span v-if="t.critical" class="nt-badge nt-badge--crit">关键路径</span>
            </div>
          </header>
          <p class="nt-note">{{ t.onboarding }}</p>

          <section class="nt-task__block">
            <h4 class="nt-task__label">去哪学</h4>
            <ul class="nt-task__res">
              <li v-for="(r, i) in t.resources" :key="i">
                <span>{{ r.title }}</span>
                <span class="nt-task__resmeta">{{ r.type }} · {{ r.durationMin }} 分钟</span>
              </li>
            </ul>
          </section>

          <section class="nt-task__block">
            <h4 class="nt-task__label">怎么做</h4>
            <ol class="nt-steps">
              <li v-for="(step, i) in t.steps" :key="i">{{ step }}</li>
            </ol>
          </section>

          <section class="nt-task__block">
            <h4 class="nt-task__label">做出什么</h4>
            <p class="nt-task__deliverable">{{ t.deliverable }}</p>
          </section>

          <section class="nt-task__block">
            <h4 class="nt-task__label">怎么算会</h4>
            <ul class="nt-check">
              <li v-for="(a, i) in t.acceptance" :key="i">{{ a }}</li>
            </ul>
          </section>

          <section class="nt-task__block">
            <h4 class="nt-task__label">常见错误</h4>
            <div v-for="(e, i) in t.errors" :key="i" class="nt-task__error">
              <code>{{ e.error }}</code>
              <span>{{ e.diagnose }}</span>
            </div>
          </section>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nt-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: stretch;
  background: rgba(6, 8, 14, 0.7);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.nt-preview {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: calc(16px + env(safe-area-inset-top)) 14px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--wx-bg-deep);
}
.nt-preview__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.nt-preview__title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--wx-text-primary);
  font-family: var(--wx-font-serif);
}
.nt-preview__sub {
  margin: 4px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--wx-text-tertiary);
}
.nt-preview__close {
  flex-shrink: 0;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  background: transparent;
}
.nt-preview__stage {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.nt-preview__stage-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.nt-preview__milestone {
  font-size: 11px;
  color: var(--wx-text-secondary);
}

.nt-card {
  padding: 12px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nt-card--accent {
  border-color: color-mix(in srgb, var(--wx-color-primary) 34%, transparent);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.nt-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.nt-card__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--wx-text-secondary);
}
.nt-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--wx-text-tertiary);
}
.nt-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  font-size: 10.5px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.nt-badge--muted {
  color: var(--wx-text-tertiary);
  border-color: var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
}
.nt-badge--crit {
  color: var(--wx-color-vermilion);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
  background: transparent;
}
.nt-task__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.nt-task__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: none;
}
.nt-task__block {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.nt-task__label {
  margin: 0;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--wx-text-tertiary);
}
.nt-task__res,
.nt-check {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--wx-text-secondary);
}
.nt-task__res li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nt-task__resmeta {
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.nt-steps {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--wx-text-secondary);
}
.nt-task__deliverable {
  margin: 0;
  font-size: 12px;
  color: var(--wx-text-secondary);
}
.nt-task__error {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--wx-border-soft);
  border-radius: 5px;
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  font-size: 11.5px;
}
.nt-task__error code {
  font-family: var(--wx-font-mono);
  color: var(--wx-color-vermilion);
}
.nt-task__error span {
  color: var(--wx-text-secondary);
}
</style>
