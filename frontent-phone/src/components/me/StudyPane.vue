<!-- 学习情况分区：统计 / 正确率趋势 / 复习提醒 / 领域雷达（纯 SVG，无第三方图表库） -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useMasteryStore } from '@/stores/masteryStore'
import { useLearnStore } from '@/stores/learnStore'
import { useQuizStore } from '@/stores/quizStore'
import { fetchWrongQuestions } from '@/services/wrongBookService'
import { fetchProgress } from '@/services/progressService'
import type { WrongItem } from '@/types'

const mastery = useMasteryStore()
const learn = useLearnStore()
const quiz = useQuizStore()

// ===== 6 项统计（与桌面端计算逻辑一致） =====
const masteryStats = computed(() => {
  let mastered = 0
  let learning = 0
  let answers = 0
  let correct = 0
  for (const key of Object.keys(mastery.map)) {
    const e = mastery.map[key]
    if (e.state === 'mastered') mastered += 1
    else if (e.state === 'learning') learning += 1
    for (const r of e.records) {
      answers += 1
      if (r.ok) correct += 1
    }
  }
  return {
    mastered,
    learning,
    answers,
    accuracy: answers === 0 ? 0 : Math.round((correct / answers) * 100)
  }
})

const outlineStats = computed(() => {
  const c = learn.statusCount
  const total = learn.outline.length
  return {
    total,
    done: c.light + c.deep,
    docs: learn.docs.length
  }
})

// ===== 答题表现（近 10 题正确率对比前 10 题） =====
const allRecords = computed<{ ok: boolean; t: number }[]>(() => {
  const list: { ok: boolean; t: number }[] = []
  for (const key of Object.keys(mastery.map)) list.push(...mastery.map[key].records)
  list.sort((a, b) => a.t - b.t)
  return list
})

const perf = computed(() => {
  const all = allRecords.value
  const acc = (list: { ok: boolean }[]) =>
    list.length === 0 ? null : Math.round((list.filter((r) => r.ok).length / list.length) * 100)
  const recent = acc(all.slice(-10))
  const prev = acc(all.slice(-20, -10))
  const diff = recent === null || prev === null ? null : recent - prev
  return { recent, prev, diff, total: all.length }
})

/** 正确率趋势：最近若干组、每组最多 10 题 */
const trend = computed<{ label: string; acc: number }[]>(() => {
  const all = allRecords.value
  if (all.length === 0) return []
  const points: { label: string; acc: number }[] = []
  for (let k = 0; k < 5; k++) {
    const end = all.length - k * 10
    if (end <= 0) break
    const slice = all.slice(Math.max(0, end - 10), end)
    if (slice.length === 0) break
    points.unshift({
      label: k === 0 ? '最近' : `前${k * 10}题`,
      acc: Math.round((slice.filter((r) => r.ok).length / slice.length) * 100)
    })
  }
  return points
})

/** quizStore 中最近一次已交卷答题的成绩（仅当次会话，离开页面后清空） */
const recentQuiz = computed(() =>
  quiz.submitted
    ? { title: quiz.skillTitle || '练习', score: quiz.score, correct: quiz.correctCount, total: quiz.total }
    : null
)

// ===== 复习提醒：≥2 天未练习且已有记录的知识点 =====
const reviewList = computed(() => {
  const now = Date.now()
  const DAY = 86400000
  const items: { name: string; state: 'learning' | 'mastered'; days: number; acc: number }[] = []
  for (const name of Object.keys(mastery.map)) {
    const e = mastery.map[name]
    if (e.state === 'unlearned' || e.records.length === 0) continue
    const days = Math.floor((now - e.records[e.records.length - 1].t) / DAY)
    if (days < 2) continue
    const recent = e.records.slice(-10)
    items.push({
      name,
      state: e.state as 'learning' | 'mastered',
      days,
      acc: Math.round((recent.filter((r) => r.ok).length / recent.length) * 100)
    })
  }
  return items.sort((a, b) => b.days - a.days).slice(0, 6)
})

// ===== 云端答题记录同步（点击并确认后才请求） =====
const syncing = ref(false)

async function syncRecords() {
  if (syncing.value) return
  try {
    await showConfirmDialog({
      title: '同步云端答题记录',
      message: '将向后端发起一次请求拉取云端答题记录并合并到本机，是否继续？'
    })
  } catch {
    return
  }
  syncing.value = true
  try {
    const remote = await fetchProgress()
    mastery.replayRecords(remote.mastery)
    showToast(`已同步 ${remote.mastery.length} 条云端记录`)
  } catch (e) {
    showToast((e as Error).message || '同步失败，请稍后重试')
  } finally {
    syncing.value = false
  }
}

// ===== 错题本（点击并确认后才请求） =====
const wrongItems = ref<WrongItem[] | null>(null)
const wrongLoading = ref(false)
const wrongError = ref('')

async function loadWrongBook() {
  if (wrongLoading.value) return
  try {
    await showConfirmDialog({
      title: '加载错题本',
      message: '将向后端发起一次请求拉取你的错题记录，是否继续？'
    })
  } catch {
    return
  }
  wrongLoading.value = true
  wrongError.value = ''
  try {
    const res = await fetchWrongQuestions()
    wrongItems.value = res.items
    showToast(`已加载 ${res.items.length} 道错题`)
  } catch (e) {
    wrongError.value = (e as Error).message || '加载失败，请稍后重试'
  } finally {
    wrongLoading.value = false
  }
}

/** 错题按知识点聚合（最近答错时间倒序，最多 8 条） */
const wrongKpRows = computed(() => {
  const items = wrongItems.value
  if (!items) return []
  const agg = new Map<string, { count: number; last: number }>()
  for (const it of items) {
    for (const kp of it.question.knowledgePoints ?? []) {
      const e = agg.get(kp) ?? { count: 0, last: 0 }
      e.count += 1
      e.last = Math.max(e.last, it.lastWrongAt)
      agg.set(kp, e)
    }
  }
  return [...agg.entries()]
    .map(([name, v]) => ({
      name,
      count: v.count,
      lastText: v.last ? new Date(v.last).toLocaleDateString('zh-CN') : '—'
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
})

// ===== 领域雷达：按学习大纲中的知识大类聚合掌握度 =====
const categoryRows = computed(() => {
  const agg = new Map<string, { total: number; mastered: number }>()
  for (const task of learn.outline) {
    const kp = task.kp
    if (!kp) continue
    const category = kp.category?.trim() || '未分类'
    const e = agg.get(category) ?? { total: 0, mastered: 0 }
    e.total += 1
    if (mastery.getState(kp.name) === 'mastered') e.mastered += 1
    agg.set(category, e)
  }
  return [...agg.entries()]
    .map(([name, v]) => ({
      name,
      total: v.total,
      mastered: v.mastered,
      percent: v.total === 0 ? 0 : Math.round((v.mastered / v.total) * 100)
    }))
    .sort((a, b) => b.total - a.total)
})

const RADAR_MAX_AXES = 8
const radarAxes = computed(() => categoryRows.value.slice(0, RADAR_MAX_AXES))
const radarUsable = computed(() => radarAxes.value.length >= 3)

const RADAR_SIZE = 260
const RADAR_CX = 130
const RADAR_CY = 128
const RADAR_R = 82

interface RadarPoint {
  x: number
  y: number
}

function radarPoint(index: number, ratio: number): RadarPoint {
  const n = radarAxes.value.length
  const ang = (-90 + (360 * index) / n) * (Math.PI / 180)
  return {
    x: RADAR_CX + RADAR_R * ratio * Math.cos(ang),
    y: RADAR_CY + RADAR_R * ratio * Math.sin(ang)
  }
}

const radarGrid = computed(() => {
  if (!radarUsable.value) return []
  return [0.25, 0.5, 0.75, 1].map((ratio) =>
    radarAxes.value.map((_, i) => {
      const p = radarPoint(i, ratio)
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    }).join(' ')
  )
})

const radarValuePoly = computed(() => {
  if (!radarUsable.value) return ''
  return radarAxes.value
    .map((a, i) => {
      const p = radarPoint(i, a.percent / 100)
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    .join(' ')
})

const radarVertices = computed(() => {
  if (!radarUsable.value) return []
  const n = radarAxes.value.length
  return radarAxes.value.map((a, i) => {
    const outer = radarPoint(i, 1)
    const label = radarPoint(i, 1.28)
    const ang = (-90 + (360 * i) / n) * (Math.PI / 180)
    const cos = Math.cos(ang)
    return {
      x: outer.x,
      y: outer.y,
      lx: label.x,
      ly: label.y,
      anchor: Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end',
      label: a.name.length > 6 ? `${a.name.slice(0, 6)}…` : a.name,
      title: `${a.name}：${a.mastered}/${a.total}`
    }
  })
})
</script>

<template>
  <div class="pane">
    <section class="stats">
      <div class="stat">
        <div class="stat-value">{{ masteryStats.mastered }}</div>
        <div class="stat-label">已掌握知识点</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ masteryStats.learning }}</div>
        <div class="stat-label">在学知识点</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ masteryStats.answers }}</div>
        <div class="stat-label">累计答题数</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ masteryStats.accuracy }}<span class="unit">%</span></div>
        <div class="stat-label">总正确率</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ outlineStats.done }}<span class="unit">/{{ outlineStats.total }}</span></div>
        <div class="stat-label">大纲任务进度</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ outlineStats.docs }}</div>
        <div class="stat-label">已生成文档</div>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">最近正确率趋势</h3>
      <div v-if="perf.recent === null" class="empty">还没有答题记录，去题库练几题吧</div>
      <template v-else>
        <div class="perf-num">
          <span class="val">{{ perf.recent }}</span>
          <span class="unit-text">% 近 10 题正确率</span>
        </div>
        <div class="perf-diff" :class="{ up: (perf.diff ?? 0) > 0, down: (perf.diff ?? 0) < 0 }">
          <template v-if="perf.diff === null">暂无对比数据</template>
          <template v-else-if="perf.diff > 0">↑ 较前 10 题 +{{ perf.diff }}%</template>
          <template v-else-if="perf.diff < 0">↓ 较前 10 题 {{ perf.diff }}%</template>
          <template v-else>— 与前 10 题持平</template>
        </div>

        <div class="trend">
          <div v-for="(p, i) in trend" :key="i" class="trend-col">
            <span class="trend-val">{{ p.acc }}%</span>
            <div class="trend-track">
              <div class="trend-bar" :style="{ height: `${p.acc}%` }"></div>
            </div>
            <span class="trend-label">{{ p.label }}</span>
          </div>
        </div>

        <p v-if="recentQuiz" class="quiz-score">
          最近一次答题：{{ recentQuiz.title }} · {{ recentQuiz.score }} 分（{{ recentQuiz.correct }}/{{ recentQuiz.total }}）
        </p>
        <p class="tip">正确率跌破 60% 的知识点会退回「在学」，持续练习保持记忆活性。</p>
      </template>
    </section>

    <section class="card">
      <h3 class="card-title">复习提醒</h3>
      <div v-if="reviewList.length === 0" class="empty">近 2 天练习过的知识点都在记忆活跃期，保持节奏 ✓</div>
      <ul v-else class="review">
        <li v-for="r in reviewList" :key="r.name" class="review-row">
          <span class="dot" :class="r.state"></span>
          <span class="review-name">{{ r.name }}</span>
          <span class="review-meta">{{ r.days }} 天未练 · 近 10 题 {{ r.acc }}%</span>
        </li>
      </ul>

      <div class="cloud-actions">
        <van-button size="small" round plain type="primary" :loading="syncing" @click="syncRecords">
          同步云端答题记录
        </van-button>
        <van-button size="small" round plain type="primary" :loading="wrongLoading" @click="loadWrongBook">
          加载错题本
        </van-button>
      </div>

      <div v-if="wrongLoading" class="center"><van-loading size="20">加载中…</van-loading></div>
      <p v-else-if="wrongError" class="err">{{ wrongError }}</p>
      <template v-else-if="wrongItems">
        <div v-if="wrongKpRows.length" class="wrong-list">
          <div class="wrong-title">错题知识点（按错题数排序）</div>
          <div v-for="w in wrongKpRows" :key="w.name" class="wrong-row">
            <span class="wrong-name">{{ w.name }}</span>
            <span class="wrong-meta">{{ w.count }} 题 · 最近 {{ w.lastText }}</span>
          </div>
        </div>
        <div v-else class="empty">错题本为空，继续保持 ✓</div>
      </template>
    </section>

    <section class="card">
      <h3 class="card-title">领域雷达</h3>
      <div v-if="categoryRows.length === 0" class="empty">
        暂无学习大纲知识点，先在学习页建立计划后这里会展示各大类掌握率
      </div>
      <template v-else>
        <svg v-if="radarUsable" class="radar" :viewBox="`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`">
          <polygon v-for="(p, i) in radarGrid" :key="'g' + i" :points="p" class="grid" />
          <line
            v-for="(v, i) in radarVertices"
            :key="'l' + i"
            :x1="RADAR_CX"
            :y1="RADAR_CY"
            :x2="v.x"
            :y2="v.y"
            class="axis"
          />
          <polygon :points="radarValuePoly" class="value" />
          <circle v-for="(v, i) in radarVertices" :key="'d' + i" :cx="v.x" :cy="v.y" r="3" class="dot" />
          <text
            v-for="(v, i) in radarVertices"
            :key="'t' + i"
            :x="v.lx"
            :y="v.ly"
            :text-anchor="v.anchor"
            class="label"
          >{{ v.label }}</text>
        </svg>
        <p v-else class="tip">该方向的知识大类不足 3 个，暂以列表呈现掌握率。</p>

        <div class="cat-list">
          <div v-for="r in categoryRows" :key="r.name" class="cat-row">
            <span class="cat-name">{{ r.name }}</span>
            <div class="cat-track">
              <div class="cat-fill" :style="{ width: `${r.percent}%` }"></div>
            </div>
            <span class="cat-val">{{ r.mastered }}/{{ r.total }} · {{ r.percent }}%</span>
          </div>
        </div>
        <p class="tip">掌握率 = 大纲中该大类已掌握知识点 / 该大类全部知识点（答对 5 题且近 10 题 ≥80% 即点亮）。</p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 14px 12px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 4px 14px rgba(25, 137, 250, 0.06);
}

.stat {
  text-align: center;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #1989fa;
}

.stat-value .unit {
  font-size: 12px;
  font-weight: 400;
  color: #969799;
}

.stat-label {
  margin-top: 2px;
  font-size: 10.5px;
  color: #969799;
}

.card {
  background: #fff;
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 4px 14px rgba(25, 137, 250, 0.06);
}

.card-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.empty {
  padding: 16px;
  font-size: 12px;
  line-height: 1.6;
  color: #969799;
  text-align: center;
  border: 1px dashed #ebedf0;
  border-radius: 10px;
}

.perf-num {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.perf-num .val {
  font-size: 34px;
  font-weight: 700;
  color: #1989fa;
}

.unit-text {
  font-size: 11.5px;
  color: #969799;
}

.perf-diff {
  margin-top: 4px;
  font-size: 12.5px;
  color: #646566;
}

.perf-diff.up {
  color: #07c160;
}

.perf-diff.down {
  color: #ee0a24;
}

.trend {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6px;
  margin: 14px 0 8px;
  height: 90px;
}

.trend-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 100%;
}

.trend-val {
  font-size: 10px;
  color: #646566;
}

.trend-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  background: #f7f8fa;
  border-radius: 6px;
  overflow: hidden;
}

.trend-bar {
  width: 100%;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, #1989fa, #6366f1);
  transition: height 0.3s ease;
}

.trend-label {
  font-size: 10px;
  color: #969799;
}

.quiz-score {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(25, 137, 250, 0.06);
  font-size: 11.5px;
  color: #1989fa;
}

.tip {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #969799;
}

.review {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.review-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f8fa;
  font-size: 11.5px;
}

.dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
}

.dot.learning {
  background: #1989fa;
}

.dot.mastered {
  background: #07c160;
}

.review-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #323233;
}

.review-meta {
  flex-shrink: 0;
  color: #969799;
}

.cloud-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.center {
  padding: 12px 0;
  text-align: center;
}

.err {
  margin: 8px 0 0;
  font-size: 12px;
  color: #ee0a24;
}

.wrong-list {
  margin-top: 10px;
}

.wrong-title {
  font-size: 11.5px;
  color: #969799;
  margin-bottom: 6px;
}

.wrong-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  font-size: 11.5px;
  border-bottom: 1px solid #f2f3f5;
}

.wrong-row:last-child {
  border-bottom: none;
}

.wrong-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #323233;
}

.wrong-meta {
  flex-shrink: 0;
  color: #969799;
}

.radar {
  display: block;
  width: 100%;
  max-width: 320px;
  margin: 0 auto 10px;
}

.radar .grid {
  fill: none;
  stroke: #ebedf0;
  stroke-width: 1;
}

.radar .axis {
  stroke: #f2f3f5;
  stroke-width: 1;
}

.radar .value {
  fill: rgba(25, 137, 250, 0.18);
  stroke: #1989fa;
  stroke-width: 2;
}

.radar .dot {
  fill: #1989fa;
}

.radar .label {
  fill: #646566;
  font-size: 9px;
}

.cat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
}

.cat-name {
  width: 78px;
  flex-shrink: 0;
  color: #323233;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-track {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: #f2f3f5;
  overflow: hidden;
}

.cat-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #1989fa, #6366f1);
}

.cat-val {
  width: 86px;
  flex-shrink: 0;
  text-align: right;
  color: #969799;
}
</style>
