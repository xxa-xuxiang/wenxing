<script setup lang="ts">
// 问星 v4 — Anki 记忆卡片面板（右侧抽屉）
// 硬约束：挂载不发任何网络请求（从错题生成只能由用户点击 + 确认后触发）；不轮询
import { computed, ref, watch } from 'vue'
import { useAnkiStore } from '@/stores/ankiStore'
import { useLearnStore } from '@/stores/learnStore'
import { useOverlay } from '@/composables/useOverlay'
import type { AnkiCard } from '@/types'

const emit = defineEmits<{ (e: 'close'): void }>()

// 统一浮层行为：Esc / 点击抽屉外任意处 → 关闭
const { overlayRef } = useOverlay({ onClose: () => emit('close') })

const anki = useAnkiStore()
const learn = useLearnStore()

const DAY = 86400000

// ===== 复习队列 =====
const current = computed<AnkiCard | null>(() => anki.dueCards[0] ?? null)
const showBack = ref(false)
/** 本日已完成数（面板会话内累计；评分会推进队列） */
const reviewedToday = ref(0)
const remaining = computed(() => anki.dueCards.length)

// 队列前进（当前卡评分后离开待复习队列）时收起答案
watch(
  () => current.value?.id,
  () => {
    showBack.value = false
  }
)

function onGrade(g: 0 | 1 | 2 | 3) {
  const c = current.value
  if (!c) return
  anki.grade(c.id, g)
  reviewedToday.value += 1
}

// ===== 顶部入口：手动建卡 =====
const manualOpen = ref(false)
const formFront = ref('')
const formBack = ref('')

function openManual() {
  manualOpen.value = !manualOpen.value
}
function saveManual() {
  if (!formFront.value.trim() || !formBack.value.trim()) {
    tip.value = '请填写正面与背面内容'
    return
  }
  const n = anki.addManual(formFront.value, formBack.value)
  formFront.value = ''
  formBack.value = ''
  manualOpen.value = false
  tip.value = n > 0 ? `已添加 ${n} 张卡片` : '卡片已存在，未重复添加'
}

// ===== 顶部入口：从文档 / 错题生成 =====
const busy = ref(false)
const tip = ref('')

function onFromDoc() {
  const taskId = learn.activeTaskId
  if (!taskId) {
    tip.value = '请先在学习工作台选择一个任务'
    return
  }
  if (!window.confirm('将从当前文档抽取记忆卡片，是否继续？')) return
  const n = anki.addFromDoc(taskId)
  tip.value = n > 0 ? `已从当前文档添加 ${n} 张卡片` : '当前任务暂无文档或未抽取到可用的卡片'
}

async function onFromWrong() {
  if (busy.value) return
  if (!window.confirm('将从错题本抽取记忆卡片，是否继续？')) return
  busy.value = true
  tip.value = ''
  try {
    const n = await anki.addFromWrong()
    tip.value = n > 0 ? `已从错题本添加 ${n} 张卡片` : '错题本暂无可抽取的题目'
  } catch (e) {
    const msg = e instanceof Error ? e.message : '错题本暂不可用'
    tip.value = /未登录/.test(msg) ? '未登录：请先登录后再从错题本生成卡片' : `生成失败：${msg}`
  } finally {
    busy.value = false
  }
}

// ===== 展示辅助 =====
const SOURCE_LABEL: Record<AnkiCard['source'], string> = {
  manual: '手动',
  doc: '文档',
  wrong: '错题'
}

/** 下次到期时间（相对） */
function dueLabel(c: AnkiCard): string {
  const diff = c.dueAt - Date.now()
  if (diff <= 0) return '待复习'
  const days = Math.ceil(diff / DAY)
  return days <= 1 ? '明天' : `${days} 天后`
}

function onDelete(id: string) {
  anki.deleteCard(id)
}
</script>

<template>
  <aside ref="overlayRef" class="wx-anki" data-test="panel-anki">
    <!-- 顶部：统计 + 三条入口 -->
    <header class="wx-anki-head">
      <div class="wx-anki-head-row">
        <div class="wx-anki-title">
          <span class="wx-anki-title-mark">✦</span>
          <span>记忆卡片</span>
        </div>
        <div class="wx-anki-stats">
          <span class="wx-anki-stat">总卡 <b>{{ anki.stats.total }}</b></span>
          <span class="wx-anki-stat">今日待复习 <b>{{ anki.stats.due }}</b></span>
          <span class="wx-anki-stat">已掌握 <b>{{ anki.stats.mastered }}</b></span>
        </div>
        <button class="wx-anki-close wx-pressable" title="关闭" @click="emit('close')">✕</button>
      </div>

      <div class="wx-anki-tools">
        <button class="wx-anki-tool wx-pressable" :class="{ active: manualOpen }" @click="openManual">
          ＋ 手动建卡
        </button>
        <button class="wx-anki-tool wx-pressable" @click="onFromDoc">从当前文档生成</button>
        <button class="wx-anki-tool wx-pressable" :disabled="busy" @click="onFromWrong">
          {{ busy ? '生成中…' : '从错题生成' }}
        </button>
      </div>

      <!-- 手动建卡 inline 表单 -->
      <div v-if="manualOpen" class="wx-anki-form">
        <label class="wx-anki-field">
          <span class="wx-anki-field-label">正面</span>
          <input v-model="formFront" class="wx-anki-input" type="text" placeholder="问题 / 概念" />
        </label>
        <label class="wx-anki-field">
          <span class="wx-anki-field-label">背面</span>
          <textarea v-model="formBack" class="wx-anki-textarea" rows="2" placeholder="答案 / 要点"></textarea>
        </label>
        <div class="wx-anki-form-foot">
          <button class="wx-anki-save wx-pressable" @click="saveManual">保存</button>
          <button class="wx-anki-cancel wx-pressable" @click="manualOpen = false">取消</button>
        </div>
      </div>

      <div v-if="tip" class="wx-anki-tip">{{ tip }}</div>
    </header>

    <!-- 主体：左列表 + 右复习区 -->
    <div class="wx-anki-body">
      <!-- 左：卡片列表 -->
      <section class="wx-anki-list">
        <div class="wx-anki-list-head">
          <span>全部卡片</span>
          <span class="wx-anki-list-count">{{ anki.cards.length }}</span>
        </div>
        <ul v-if="anki.cards.length" class="wx-anki-list-ul">
          <li v-for="c in anki.cards" :key="c.id" class="wx-anki-item" :class="{ due: c.dueAt <= Date.now() }">
            <span class="wx-anki-item-front" :title="c.front">{{ c.front }}</span>
            <span class="wx-anki-tag" :class="`is-${c.source}`">{{ SOURCE_LABEL[c.source] }}</span>
            <span class="wx-anki-item-due">{{ dueLabel(c) }}</span>
            <button class="wx-anki-del wx-pressable" title="删除" @click="onDelete(c.id)">✕</button>
          </li>
        </ul>
        <div v-else class="wx-anki-empty-inline">还没有卡片</div>
      </section>

      <!-- 右：复习区 -->
      <section class="wx-anki-review">
        <div class="wx-anki-review-bar">
          <span>剩余待复习 <b>{{ remaining }}</b> 张</span>
          <span>本日已完成 <b>{{ reviewedToday }}</b> 张</span>
        </div>

        <div v-if="current" class="wx-anki-card">
          <div class="wx-anki-face">
            <div class="wx-anki-face-label">正面</div>
            <div class="wx-anki-face-text">{{ current.front }}</div>
          </div>

          <div v-if="!showBack" class="wx-anki-reveal">
            <button class="wx-anki-show wx-pressable" @click="showBack = true">显示答案</button>
          </div>

          <template v-else>
            <div class="wx-anki-face wx-anki-face-back">
              <div class="wx-anki-face-label">背面</div>
              <div class="wx-anki-face-text">{{ current.back }}</div>
            </div>
            <div class="wx-anki-grades">
              <button class="wx-anki-grade is-again wx-pressable" @click="onGrade(0)">重来</button>
              <button class="wx-anki-grade is-hard wx-pressable" @click="onGrade(1)">困难</button>
              <button class="wx-anki-grade is-good wx-pressable" @click="onGrade(2)">良好</button>
              <button class="wx-anki-grade is-easy wx-pressable" @click="onGrade(3)">简单</button>
            </div>
          </template>
        </div>

        <div v-else class="wx-anki-done">
          <div class="wx-anki-done-mark">✦</div>
          <div class="wx-anki-done-title">
            {{ anki.stats.total > 0 ? '今日复习完成' : '还没有记忆卡片' }}
          </div>
          <div class="wx-anki-done-sub">
            {{ anki.stats.total > 0 ? '明天再来巩固吧' : '用上方入口手动建卡，或从文档 / 错题抽取' }}
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.wx-anki {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: min(880px, 94vw);
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--wx-glass-bg-strong);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  border-left: 1px solid var(--wx-border-soft);
  box-shadow: var(--wx-shadow-lg);
  animation: wx-anki-in var(--wx-duration-mid) var(--wx-ease-out-soft);
}
@keyframes wx-anki-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

/* ===== 顶部 ===== */
.wx-anki-head {
  flex-shrink: 0;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-anki-head-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.wx-anki-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-anki-title-mark { color: var(--wx-color-primary-soft); }
.wx-anki-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  min-width: 0;
}
.wx-anki-stat {
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
  font-family: var(--wx-font-mono);
}
.wx-anki-stat b { color: var(--wx-color-primary-soft); font-weight: 700; }
.wx-anki-close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  background: transparent;
}
.wx-anki-close:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }

.wx-anki-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
}
.wx-anki-tool {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-anki-tool:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-anki-tool.active {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
}
.wx-anki-tool:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

/* 手动建卡表单 */
.wx-anki-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding: 12px 0 2px;
  border-top: 1px dashed var(--wx-border-soft);
}
.wx-anki-field { display: flex; align-items: flex-start; gap: 10px; }
.wx-anki-field-label {
  flex-shrink: 0;
  width: 40px;
  padding-top: 6px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}
.wx-anki-input,
.wx-anki-textarea {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  outline: none;
}
.wx-anki-textarea { resize: vertical; }
.wx-anki-input:focus,
.wx-anki-textarea:focus { border-color: var(--wx-border-glow); }
.wx-anki-input::placeholder,
.wx-anki-textarea::placeholder { color: var(--wx-text-muted); }
.wx-anki-form-foot { display: flex; gap: 8px; padding-left: 50px; }
.wx-anki-save {
  padding: 6px 18px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
}
.wx-anki-save:hover { background: color-mix(in srgb, var(--wx-color-primary) 24%, transparent); }
.wx-anki-cancel {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  background: transparent;
}
.wx-anki-cancel:hover { color: var(--wx-text-secondary); }

.wx-anki-tip {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--wx-color-amber);
}

/* ===== 主体 ===== */
.wx-anki-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.wx-anki-list {
  flex: 0 0 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wx-border-soft);
}
.wx-anki-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-anki-list-count { font-family: var(--wx-font-mono); color: var(--wx-text-muted); }
.wx-anki-list-ul {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px;
}
.wx-anki-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: var(--wx-radius-sm);
}
.wx-anki-item + .wx-anki-item { border-top: 1px solid var(--wx-border-soft); }
.wx-anki-item.due { background: color-mix(in srgb, var(--wx-color-primary) 7%, transparent); }
.wx-anki-item-front {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-anki-tag {
  flex-shrink: 0;
  padding: 1px 7px;
  font-size: 10px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-tertiary);
}
.wx-anki-tag.is-manual { color: var(--wx-color-primary-soft); border-color: color-mix(in srgb, var(--wx-color-primary) 40%, transparent); }
.wx-anki-tag.is-doc { color: var(--wx-color-yanqing); border-color: color-mix(in srgb, var(--wx-color-yanqing) 35%, transparent); }
.wx-anki-tag.is-wrong { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent); }
.wx-anki-item-due {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-anki-del {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  font-size: 10px;
  color: var(--wx-text-muted);
  border: none;
  background: transparent;
}
.wx-anki-del:hover { color: var(--wx-color-vermilion); }
.wx-anki-empty-inline {
  padding: 16px;
  font-size: 12px;
  color: var(--wx-text-muted);
}

/* 复习区 */
.wx-anki-review {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 20px 20px;
}
.wx-anki-review-bar {
  flex-shrink: 0;
  display: flex;
  gap: 20px;
  padding-bottom: 12px;
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
  border-bottom: 1px dashed var(--wx-border-soft);
}
.wx-anki-review-bar b { color: var(--wx-color-primary-soft); font-family: var(--wx-font-mono); }

.wx-anki-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 18px;
}
.wx-anki-face {
  padding: 16px 18px;
  border-left: 2px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
}
.wx-anki-face-back {
  border-left-color: color-mix(in srgb, var(--wx-color-yanqing) 50%, transparent);
  background: color-mix(in srgb, var(--wx-color-yanqing) 6%, transparent);
}
.wx-anki-face-label {
  margin-bottom: 8px;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--wx-text-muted);
}
.wx-anki-face-text {
  font-size: 15px;
  line-height: 1.7;
  color: var(--wx-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.wx-anki-reveal { display: flex; justify-content: center; padding-top: 6px; }
.wx-anki-show {
  padding: 9px 34px;
  font-size: 13px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
}
.wx-anki-show:hover { background: color-mix(in srgb, var(--wx-color-primary) 24%, transparent); }

.wx-anki-grades {
  display: flex;
  gap: 10px;
}
.wx-anki-grade {
  flex: 1;
  padding: 11px 0;
  font-size: 13px;
  border-radius: var(--wx-radius-sm);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  color: var(--wx-text-secondary);
}
.wx-anki-grade:hover { border-color: var(--wx-border-glow); color: var(--wx-text-primary); }
.wx-anki-grade.is-again { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent); }
.wx-anki-grade.is-hard { color: var(--wx-color-amber); border-color: color-mix(in srgb, var(--wx-color-amber) 35%, transparent); }
.wx-anki-grade.is-good { color: var(--wx-color-primary-soft); border-color: color-mix(in srgb, var(--wx-color-primary) 45%, transparent); background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent); }
.wx-anki-grade.is-easy { color: var(--wx-color-yanqing); border-color: color-mix(in srgb, var(--wx-color-yanqing) 35%, transparent); }

/* 空态 */
.wx-anki-done {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.wx-anki-done-mark { font-size: 30px; color: var(--wx-color-primary-soft); }
.wx-anki-done-title { font-size: 15px; color: var(--wx-text-primary); }
.wx-anki-done-sub { font-size: 12px; color: var(--wx-text-muted); }
</style>
