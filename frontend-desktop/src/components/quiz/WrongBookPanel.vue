<script setup lang="ts">
// 错题本面板：组件仅在「错题本」Tab 首次激活时才挂载 → 挂载时拉取一次错题；
// 之后由用户显式点「刷新」重新拉取，不做轮询、不触发后端出题
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchWrongQuestions } from '@/services/wrongBookService'
import { useQuizStore } from '@/stores/quizStore'
import type { Question, WrongItem } from '@/types'

const router = useRouter()
const quiz = useQuizStore()

const items = ref<WrongItem[]>([])
const total = ref(0)
const loading = ref(false)
const errorText = ref('')
const needLogin = ref(false)

// ===== 勾选（与题库题卡一致的选中样式） =====
const selectedIds = ref<Set<string>>(new Set())
const selectedQuestions = computed<Question[]>(() =>
  items.value.map((it) => it.question).filter((q) => selectedIds.value.has(q.id))
)

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function selectAll() {
  selectedIds.value = new Set(items.value.map((it) => it.question.id))
}
function clearSelection() {
  selectedIds.value = new Set()
}

// ===== 加载：挂载一次 + 手动刷新 =====
async function load() {
  if (loading.value) return
  loading.value = true
  errorText.value = ''
  needLogin.value = false
  try {
    const resp = await fetchWrongQuestions(100)
    items.value = resp.items
    total.value = resp.total
    // 清理已不在列表中的选中项
    const alive = new Set(resp.items.map((it) => it.question.id))
    selectedIds.value = new Set([...selectedIds.value].filter((id) => alive.has(id)))
  } catch (e) {
    const msg = e instanceof Error ? e.message : '错题本加载失败'
    if (msg.includes('未登录')) needLogin.value = true
    else errorText.value = msg
  } finally {
    loading.value = false
  }
}

onMounted(load)

function redoSelected() {
  if (selectedQuestions.value.length === 0) return
  quiz.startWithQuestions('错题重练', selectedQuestions.value, 0)
  void router.push('/quiz')
}

// 徽章中文显示（与题库一致）
const diffText: Record<Question['difficulty'], string> = { easy: '简单', medium: '中等', hard: '困难' }
const typeText: Record<Question['type'], string> = { single: '单选', multiple: '多选', short: '简答', coding: '编程' }

/** 最近答错时间 → 相对时间 */
function relTime(t: number): string {
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div class="wx-q-wrong">
    <div class="wx-q-wrong-head">
      <p class="wx-q-wrong-note">
        ✦ 错题本只记录「最近一次作答为错」的题目，重练答对后会自动移出。
      </p>
      <button class="wx-q-wrong-refresh wx-pressable" :disabled="loading" @click="load">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 11a8 8 0 1 0-2.3 5.7" />
          <path d="M20 5v6h-6" />
        </svg>
        <span>{{ loading ? '刷新中…' : '刷新' }}</span>
      </button>
    </div>

    <!-- 未登录引导 -->
    <div v-if="needLogin" class="wx-q-wrong-empty">
      <div class="wx-q-wrong-empty-mark">✧</div>
      <div class="wx-q-wrong-empty-title">登录后即可使用错题本</div>
      <div class="wx-q-wrong-empty-sub">错题会同步到云端，换设备也能继续重练</div>
      <button class="wx-btn-gradient wx-pressable wx-q-wrong-empty-btn" @click="router.push('/auth')">
        去登录
      </button>
    </div>

    <!-- 加载失败 + 重试 -->
    <div v-else-if="errorText" class="wx-q-wrong-empty">
      <div class="wx-q-wrong-empty-mark">⚠</div>
      <div class="wx-q-wrong-empty-title">错题本加载失败</div>
      <div class="wx-q-wrong-empty-sub">{{ errorText }}</div>
      <button class="wx-q-wrong-retry wx-pressable" @click="load">重试</button>
    </div>

    <!-- 加载骨架 -->
    <div v-else-if="loading && items.length === 0" class="wx-q-wrong-list">
      <div v-for="i in 4" :key="i" class="wx-q-wrong-card wx-glass wx-q-wrong-skeleton">
        <div class="wx-q-wrong-sk-line w1"></div>
        <div class="wx-q-wrong-sk-line w2"></div>
        <div class="wx-q-wrong-sk-line w3"></div>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="items.length === 0" class="wx-q-wrong-empty">
      <div class="wx-q-wrong-empty-mark">✧</div>
      <div class="wx-q-wrong-empty-title">还没有错题</div>
      <div class="wx-q-wrong-empty-sub">答错的题会自动进入错题本，重练答对后会自动移出</div>
    </div>

    <!-- 错题列表 -->
    <div v-else class="wx-q-wrong-list">
      <div class="wx-q-wrong-summary">共 {{ total }} 道错题</div>
      <div
        v-for="it in items"
        :key="it.question.id"
        class="wx-q-wrong-card wx-glass"
        :class="{ 'is-selected': selectedIds.has(it.question.id) }"
        @click="toggleSelect(it.question.id)"
      >
        <label class="wx-q-check" @click.stop="toggleSelect(it.question.id)">
          <input type="checkbox" :checked="selectedIds.has(it.question.id)" @change="toggleSelect(it.question.id)" />
          <span class="wx-q-check-box">
            <svg v-if="selectedIds.has(it.question.id)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
        </label>

        <div class="wx-q-wrong-card-top">
          <span class="wx-q-diff" :class="`diff-${it.question.difficulty}`">{{ diffText[it.question.difficulty] }}</span>
          <span class="wx-q-type">{{ typeText[it.question.type] }}</span>
          <span class="wx-q-wrong-count">错 {{ it.wrongCount }} 次</span>
          <span class="wx-q-wrong-time">{{ relTime(it.lastWrongAt) }}</span>
        </div>

        <div class="wx-q-wrong-card-main">
          <h3 class="wx-q-wrong-title">{{ it.question.title }}</h3>
          <p class="wx-q-wrong-body">{{ it.question.body }}</p>
          <div v-if="it.question.knowledgePoints.length" class="wx-q-wrong-tags">
            <span v-for="k in it.question.knowledgePoints" :key="k" class="wx-q-tag">{{ k }}</span>
          </div>
          <div class="wx-q-wrong-answers">
            <div class="wx-q-wrong-row">
              <span class="wx-q-wrong-label">上次你的作答</span>
              <span class="wx-q-wrong-answer">{{ it.userAnswer || '（未作答）' }}</span>
            </div>
            <div v-if="it.judgeNote" class="wx-q-wrong-row">
              <span class="wx-q-wrong-label">错因</span>
              <span class="wx-q-wrong-judge">{{ it.judgeNote }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部多选操作栏（有勾选时浮起） -->
    <Transition name="wx-slide-up">
      <div v-if="selectedIds.size > 0" class="wx-q-actionbar wx-glass">
        <div class="wx-q-actionbar-left">
          <span class="wx-q-actionbar-count">已选 <b>{{ selectedQuestions.length }}</b> 题</span>
          <button class="wx-q-actionbar-link" @click="selectAll">全选</button>
          <button class="wx-q-actionbar-link" @click="clearSelection">清空</button>
        </div>
        <button class="wx-btn-gradient wx-pressable wx-q-actionbar-start" @click="redoSelected">
          重练所选 →
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.wx-q-wrong {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 顶部说明 + 刷新 */
.wx-q-wrong-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 28px;
  border-bottom: 1px solid var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-q-wrong-note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--wx-text-tertiary);
}
.wx-q-wrong-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 6px 14px;
  font-size: 12px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-wrong-refresh svg { width: 14px; height: 14px; }
.wx-q-wrong-refresh:hover:not(:disabled) { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-q-wrong-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

/* 列表 / 骨架 */
.wx-q-wrong-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 28px 96px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wx-q-wrong-summary { font-size: 12px; color: var(--wx-text-muted); }
.wx-q-wrong-card {
  position: relative;
  padding: 34px 16px 14px;
  border-radius: var(--wx-glass-radius);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft), box-shadow var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-wrong-card:hover { border-color: var(--wx-border-glow); }
.wx-q-wrong-card.is-selected {
  border-color: var(--wx-color-primary);
  box-shadow: 0 0 16px color-mix(in srgb, var(--wx-color-primary) 28%, transparent);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.wx-q-wrong-skeleton { cursor: default; }
.wx-q-wrong-sk-line {
  height: 10px;
  border-radius: 6px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--wx-ink) 5%, transparent), color-mix(in srgb, var(--wx-ink) 11%, transparent), color-mix(in srgb, var(--wx-ink) 5%, transparent));
  background-size: 200% 100%;
  animation: wx-q-wrong-shimmer 1.4s linear infinite;
}
.wx-q-wrong-sk-line.w1 { width: 42%; }
.wx-q-wrong-sk-line.w2 { width: 82%; }
.wx-q-wrong-sk-line.w3 { width: 60%; }
@keyframes wx-q-wrong-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

/* 卡片内容 */
.wx-q-wrong-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
}
.wx-q-diff,
.wx-q-type {
  padding: 2px 9px;
  border-radius: 999px;
  font-weight: 500;
}
.wx-q-diff.diff-easy { background: color-mix(in srgb, var(--wx-state-deep) 15%, transparent); color: var(--wx-state-deep); }
.wx-q-diff.diff-medium { background: color-mix(in srgb, var(--wx-color-amber) 15%, transparent); color: var(--wx-color-amber); }
.wx-q-diff.diff-hard { background: color-mix(in srgb, var(--wx-color-vermilion) 15%, transparent); color: var(--wx-color-vermilion); }
.wx-q-type { background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent); color: var(--wx-color-primary-soft); }
.wx-q-wrong-count { color: var(--wx-color-vermilion); }
.wx-q-wrong-time { margin-left: auto; color: var(--wx-text-muted); }

.wx-q-wrong-card-main { display: flex; flex-direction: column; gap: 6px; }
.wx-q-wrong-title { font-size: 15px; font-weight: 600; color: var(--wx-text-primary); }
.wx-q-wrong-body {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--wx-text-tertiary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wx-q-wrong-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.wx-q-tag {
  font-size: 10px;
  padding: 2px 8px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  border-radius: 999px;
  color: var(--wx-text-secondary);
}
.wx-q-wrong-answers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--wx-border-soft);
}
.wx-q-wrong-row { display: flex; gap: 8px; font-size: 12px; line-height: 1.55; }
.wx-q-wrong-label { flex-shrink: 0; color: var(--wx-text-muted); }
.wx-q-wrong-answer { color: var(--wx-text-secondary); overflow-wrap: anywhere; }
.wx-q-wrong-judge { color: var(--wx-color-yanqing); overflow-wrap: anywhere; }

/* 卡片勾选框（与题库题卡一致） */
.wx-q-check {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 18px;
  height: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-q-check input { display: none; }
.wx-q-check-box {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid var(--wx-border-soft);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wx-text-on-accent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-q-check-box svg { width: 12px; height: 12px; }
.wx-q-wrong-card.is-selected .wx-q-check-box {
  background: var(--wx-color-primary);
  border-color: var(--wx-color-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--wx-color-primary) 60%, transparent);
}

/* 空态 / 未登录 / 失败 */
.wx-q-wrong-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 28px;
  text-align: center;
}
.wx-q-wrong-empty-mark { font-size: 28px; color: var(--wx-color-primary); opacity: 0.8; }
.wx-q-wrong-empty-title { font-size: 16px; font-family: var(--wx-font-serif); color: var(--wx-text-primary); }
.wx-q-wrong-empty-sub { font-size: 12px; color: var(--wx-text-tertiary); max-width: 420px; line-height: 1.6; }
.wx-q-wrong-empty-btn { margin-top: 10px; padding: 8px 18px; font-size: 12px; }
.wx-q-wrong-retry {
  margin-top: 10px;
  padding: 8px 20px;
  font-size: 12px;
  border-radius: 999px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-q-wrong-retry:hover { background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); }

/* 底部多选操作栏（与题库一致） */
.wx-q-actionbar {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 110;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px 10px 18px;
  min-width: 360px;
  border-radius: 50px;
}
.wx-q-actionbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
}
.wx-q-actionbar-count b { color: var(--wx-color-primary-soft); font-weight: 700; margin: 0 2px; }
.wx-q-actionbar-link {
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 999px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-q-actionbar-link:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-q-actionbar-start { padding: 8px 20px; font-size: 13px; font-weight: 600; }

.wx-slide-up-enter-active,
.wx-slide-up-leave-active { transition: all 0.25s var(--wx-ease-spring); }
.wx-slide-up-enter-from,
.wx-slide-up-leave-to { opacity: 0; transform: translate(-50%, 16px); }
</style>
