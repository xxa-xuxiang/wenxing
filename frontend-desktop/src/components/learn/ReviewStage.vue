<script setup lang="ts">
// 阶段5 跟进复盘：A) 本周概览 B) 周复盘表单 C) 历史复盘 D) 入口卡片
// 硬约束：挂载不发网络请求；历史复盘与云端打卡同步仅由用户显式点击触发
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCheckinStore, weekStartKey } from '@/stores/checkinStore'
import { useMasteryStore } from '@/stores/masteryStore'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const checkin = useCheckinStore()
const mastery = useMasteryStore()
const authStore = useAuthStore()

/** 解析 YYYY-MM-DD → 本地 0 点时间戳 */
function parseKeyMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime()
}
/** 本周一 0 点（本地） */
const WEEK_START_MS = parseKeyMs(weekStartKey(new Date()))

// ===== A) 本周概览 =====
// 打卡天数 / 时长 / 任务数：来自 checkinStore.weekStats（本地缓存）
// 答题数 / 正确率：遍历掌握度记录，筛出 t 落在本周一 0 点之后的记录
const weekAnswers = computed(() => {
  let total = 0
  let correct = 0
  for (const entry of Object.values(mastery.map)) {
    for (const r of entry.records) {
      if (r.t >= WEEK_START_MS) {
        total += 1
        if (r.ok) correct += 1
      }
    }
  }
  return { total, correct, rate: total === 0 ? 0 : Math.round((correct / total) * 100) }
})

const syncing = ref(false)
/** 显式点击才拉取云端打卡（挂载不自动请求） */
async function onSync() {
  if (syncing.value) return
  syncing.value = true
  try {
    await checkin.loadRecent(120)
  } finally {
    syncing.value = false
  }
}

// ===== B) 周复盘表单 =====
const good = ref('')
const bad = ref('')
const improve = ref('')
// weekReview 存在时预填（同步云端补齐本周后同样生效）
watch(
  () => checkin.weekReview,
  (r) => {
    if (!r) return
    good.value = r.good
    bad.value = r.bad
    improve.value = r.improve
  },
  { immediate: true }
)

const savingReview = ref(false)
const reviewSaved = ref('')
async function onSaveReview() {
  if (savingReview.value) return
  savingReview.value = true
  reviewSaved.value = ''
  try {
    await checkin.saveWeekly(checkin.weekKey, { good: good.value, bad: bad.value, improve: improve.value })
    reviewSaved.value = `已保存（周起始 ${checkin.weekKey}）`
  } catch (e) {
    reviewSaved.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    savingReview.value = false
  }
}

// ===== C) 历史复盘（默认不加载） =====
const historyLoaded = ref(false)
const loadingHistory = ref(false)
const historyError = ref('')
async function onLoadHistory() {
  if (loadingHistory.value) return
  loadingHistory.value = true
  historyError.value = ''
  try {
    await checkin.loadReviews(8)
    historyLoaded.value = true
  } catch (e) {
    historyError.value = e instanceof Error ? e.message : '历史复盘加载失败'
  } finally {
    loadingHistory.value = false
  }
}
const historyList = computed(() => {
  if (!historyLoaded.value) return []
  return Object.values(checkin.reviews).slice().sort((a, b) => b.weekStart.localeCompare(a.weekStart))
})

// ===== D) 入口卡片 =====
function goWrong() { void router.push('/questions?tab=wrong') }
function goWeak() { void router.push('/questions?tab=weak') }
</script>

<template>
  <div class="wx-review">
    <!-- A) 本周概览 -->
    <section class="wx-review-card wx-glass">
      <div class="wx-review-head">
        <div class="wx-review-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="20" x2="6" y2="11" />
            <line x1="12" y1="20" x2="12" y2="5" />
            <line x1="18" y1="20" x2="18" y2="14" />
          </svg>
          <span>本周概览</span>
        </div>
        <div class="wx-review-sync">
          <button class="wx-review-link wx-pressable" :disabled="syncing" @click="onSync">
            {{ syncing ? '同步中…' : '同步云端打卡记录' }}
          </button>
          <span v-if="checkin.pendingLocal" class="wx-review-note">本地有未同步记录</span>
          <span v-if="!authStore.user" class="wx-review-note">未登录：数据仅保存在本地</span>
          <span v-if="checkin.error" class="wx-review-err">{{ checkin.error }}</span>
        </div>
      </div>

      <div class="wx-review-stats">
        <div class="wx-review-stat">
          <div class="wx-review-stat-num">{{ checkin.weekStats.days }}</div>
          <div class="wx-review-stat-label">本周打卡天数</div>
        </div>
        <div class="wx-review-stat">
          <div class="wx-review-stat-num">{{ checkin.weekStats.minutes }}</div>
          <div class="wx-review-stat-label">学习时长（分钟）</div>
        </div>
        <div class="wx-review-stat">
          <div class="wx-review-stat-num">{{ checkin.weekStats.taskCount }}</div>
          <div class="wx-review-stat-label">涉及任务数</div>
        </div>
        <div class="wx-review-stat">
          <div class="wx-review-stat-num">{{ weekAnswers.total }}</div>
          <div class="wx-review-stat-label">本周答题数 · 正确率 {{ weekAnswers.rate }}%</div>
        </div>
      </div>
    </section>

    <!-- B) 周复盘表单 -->
    <section class="wx-review-card wx-glass">
      <div class="wx-review-head">
        <div class="wx-review-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M9 13h6M9 17h4" />
          </svg>
          <span>周复盘</span>
        </div>
        <span class="wx-review-note">周起始 {{ checkin.weekKey }}</span>
      </div>

      <div class="wx-review-form">
        <label class="wx-review-field">
          <span class="wx-review-field-label">本周高效的做法</span>
          <textarea class="wx-review-textarea" rows="2" v-model="good" placeholder="哪些做法帮你推进最快…"></textarea>
        </label>
        <label class="wx-review-field">
          <span class="wx-review-field-label">本周低效的行为</span>
          <textarea class="wx-review-textarea" rows="2" v-model="bad" placeholder="哪些行为拖慢了节奏…"></textarea>
        </label>
        <label class="wx-review-field">
          <span class="wx-review-field-label">下周改进计划</span>
          <textarea class="wx-review-textarea" rows="2" v-model="improve" placeholder="具体的下一步调整…"></textarea>
        </label>
        <div class="wx-review-form-foot">
          <button class="wx-btn-gradient wx-pressable wx-review-save" :disabled="savingReview" @click="onSaveReview">
            {{ savingReview ? '保存中…' : '保存周复盘' }}
          </button>
          <span v-if="reviewSaved" class="wx-review-note">{{ reviewSaved }}</span>
        </div>
      </div>
    </section>

    <!-- C) 历史复盘 -->
    <section class="wx-review-card wx-glass">
      <div class="wx-review-head">
        <div class="wx-review-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
          <span>历史复盘</span>
        </div>
        <button class="wx-review-link wx-pressable" :disabled="loadingHistory" @click="onLoadHistory">
          {{ loadingHistory ? '加载中…' : historyLoaded ? '刷新历史复盘' : '加载历史复盘' }}
        </button>
      </div>

      <div v-if="!historyLoaded" class="wx-review-empty">点击「加载历史复盘」查看往期复盘（默认不加载）</div>
      <div v-else-if="historyList.length === 0" class="wx-review-empty">暂无历史复盘</div>
      <div v-else class="wx-review-history">
        <div v-for="r in historyList" :key="r.weekStart" class="wx-review-history-card">
          <div class="wx-review-history-week">周起始 {{ r.weekStart }}</div>
          <div class="wx-review-history-seg"><span class="wx-review-history-tag good">高效做法</span><span>{{ r.good || '—' }}</span></div>
          <div class="wx-review-history-seg"><span class="wx-review-history-tag bad">低效行为</span><span>{{ r.bad || '—' }}</span></div>
          <div class="wx-review-history-seg"><span class="wx-review-history-tag improve">改进计划</span><span>{{ r.improve || '—' }}</span></div>
        </div>
      </div>
      <div v-if="historyError" class="wx-review-err">{{ historyError }}</div>
    </section>

    <!-- D) 入口卡片 -->
    <div class="wx-review-entries">
      <button class="wx-review-entry wx-glass wx-pressable" @click="goWrong">
        <div class="wx-review-entry-main">
          <span class="wx-review-entry-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 4h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" />
              <path d="M9 8l4 6M13 8l-4 6" />
            </svg>
            错题本
          </span>
          <span class="wx-review-entry-desc">集中回顾最近答错的题目，逐题看解析与错因</span>
        </div>
        <span class="wx-review-entry-arrow">→</span>
      </button>
      <button class="wx-review-entry wx-glass wx-pressable" @click="goWeak">
        <div class="wx-review-entry-main">
          <span class="wx-review-entry-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l8 4v5c0 4.4-3.2 7.8-8 9-4.8-1.2-8-4.6-8-9V7z" />
              <path d="M12 8v4M12 15h.01" />
            </svg>
            薄弱专项
          </span>
          <span class="wx-review-entry-desc">针对掌握度最低的知识点定向补强，按薄弱点凑题</span>
        </div>
        <span class="wx-review-entry-arrow">→</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wx-review {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px;
  animation: wx-review-in 0.28s var(--wx-ease-spring);
}
@keyframes wx-review-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.wx-review-card { padding: 14px 16px; border-radius: var(--wx-glass-radius); }
.wx-review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--wx-border-soft);
}
.wx-review-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-review-title svg { width: 16px; height: 16px; color: var(--wx-color-primary-soft); }
.wx-review-sync { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wx-review-link {
  font-size: 11.5px;
  color: var(--wx-color-primary-soft);
  padding: 4px 12px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-review-link:hover { background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); }
.wx-review-link:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.wx-review-note { font-size: 11px; color: var(--wx-text-muted); }
.wx-review-err { font-size: 11px; color: var(--wx-color-vermilion); padding-top: 6px; }

/* A) 统计卡 */
.wx-review-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding-top: 12px;
}
.wx-review-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 8px;
  text-align: center;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-review-stat-num {
  font-family: var(--wx-font-serif);
  font-size: 22px;
  font-weight: 700;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  line-height: 1.2;
}
.wx-review-stat-label { font-size: 11px; color: var(--wx-text-tertiary); }

/* B) 复盘表单 */
.wx-review-form { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }
.wx-review-field { display: flex; flex-direction: column; gap: 6px; }
.wx-review-field-label { font-size: 12px; color: var(--wx-text-tertiary); }
.wx-review-textarea {
  padding: 8px 10px;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  outline: none;
  resize: vertical;
}
.wx-review-textarea:focus { border-color: var(--wx-border-glow); }
.wx-review-textarea::placeholder { color: var(--wx-text-muted); }
.wx-review-form-foot { display: flex; align-items: center; gap: 12px; }
.wx-review-save { padding: 8px 20px; font-size: 12.5px; }
.wx-review-save:disabled { opacity: 0.45; cursor: not-allowed; transform: none; filter: none; }

/* C) 历史复盘 */
.wx-review-empty { padding: 14px 4px 4px; font-size: 12px; color: var(--wx-text-muted); }
.wx-review-history { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
.wx-review-history-card {
  padding: 10px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wx-review-history-week {
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-primary-soft);
}
.wx-review-history-seg {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--wx-text-secondary);
}
.wx-review-history-tag {
  flex-shrink: 0;
  align-self: flex-start;
  padding: 1px 8px;
  border-radius: var(--wx-radius-pill);
  font-size: 10px;
}
.wx-review-history-tag.good { color: var(--wx-color-yanqing); background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent); }
.wx-review-history-tag.bad { color: var(--wx-color-vermilion); background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent); }
.wx-review-history-tag.improve { color: var(--wx-color-primary-soft); background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent); }

/* D) 入口卡片 */
.wx-review-entries { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.wx-review-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  text-align: left;
  border-radius: var(--wx-glass-radius);
}
.wx-review-entry:hover { border-color: var(--wx-border-glow); }
.wx-review-entry-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.wx-review-entry-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-review-entry-title svg { width: 17px; height: 17px; color: var(--wx-color-primary-soft); }
.wx-review-entry-desc { font-size: 11.5px; line-height: 1.5; color: var(--wx-text-tertiary); }
.wx-review-entry-arrow { flex-shrink: 0; font-size: 16px; color: var(--wx-color-primary-soft); }
</style>
