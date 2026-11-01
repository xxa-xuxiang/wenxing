<!-- 错题本弹层（van-popup bottom）：挂载即拉取一次 + 手动刷新，不做轮询、不触发后端出题 -->
<!-- 勾选错题 → 重练所选（startWithQuestions → /quiz）；重练答对后服务端自动移出错题本 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useAuthStore } from '@/stores/authStore'
import { useQuizStore } from '@/stores/quizStore'
import { fetchWrongQuestions } from '@/services/wrongBookService'
import type { Question, WrongItem } from '@/types/quiz'

const show = defineModel<boolean>('show', { required: true })

const router = useRouter()
const auth = useAuthStore()
const quiz = useQuizStore()

const items = ref<WrongItem[]>([])
const total = ref(0)
const loading = ref(false)
const errorText = ref('')
const needLogin = ref(false)
const loaded = ref(false)

// 首次打开弹层时拉取（之后由用户显式刷新，避免每次打开都请求）
watch(show, (v) => {
  if (v && !loaded.value && auth.user) void load()
})

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

async function load() {
  if (loading.value) return
  loading.value = true
  errorText.value = ''
  needLogin.value = false
  try {
    const resp = await fetchWrongQuestions(100)
    items.value = resp.items
    total.value = resp.total
    loaded.value = true
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

// ===== 勾选与重练 =====
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

function redoSelected() {
  if (selectedQuestions.value.length === 0) return
  quiz.startWithQuestions('错题重练', selectedQuestions.value, 0)
  show.value = false
  void router.push('/quiz')
}

function goLogin() {
  show.value = false
  showToast('请先登录后再使用错题本')
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round :style="{ height: '86vh' }">
    <div class="wb">
      <div class="wb-head">
        <div class="wb-title">错题本</div>
        <van-button size="small" plain round icon="replay" :loading="loading" @click="load">刷新</van-button>
      </div>
      <p class="wb-note">只记录「最近一次作答为错」的题目，重练答对后自动移出。</p>

      <!-- 未登录 -->
      <van-empty v-if="needLogin" description="登录后即可使用错题本，错题会同步到云端" />
      <!-- 加载失败 -->
      <van-empty v-else-if="errorText" :description="errorText">
        <van-button size="small" round type="primary" @click="load">重试</van-button>
      </van-empty>
      <!-- 加载中 -->
      <div v-else-if="loading && items.length === 0" class="wb-loading">
        <van-loading size="24">错题加载中…</van-loading>
      </div>
      <!-- 空态 -->
      <van-empty v-else-if="items.length === 0" description="还没有错题，答错的题会自动进入错题本" />

      <!-- 错题列表 -->
      <template v-else>
        <div class="wb-summary">共 {{ total }} 道错题</div>
        <div class="wb-list">
          <div
            v-for="it in items"
            :key="it.question.id"
            class="wb-card"
            :class="{ picked: selectedIds.has(it.question.id) }"
            @click="toggleSelect(it.question.id)"
          >
            <div class="wb-top">
              <span class="wb-badge" :class="`d-${it.question.difficulty}`">{{ diffText[it.question.difficulty] }}</span>
              <span class="wb-badge t">{{ typeText[it.question.type] }}</span>
              <span class="wb-wrong">错 {{ it.wrongCount }} 次</span>
              <span class="wb-time">{{ relTime(it.lastWrongAt) }}</span>
            </div>
            <div class="wb-q-title">{{ it.question.title }}</div>
            <p class="wb-q-body">{{ it.question.body }}</p>
            <div class="wb-ans">
              <span class="lab">上次作答</span>
              <span class="val">{{ it.userAnswer || '（未作答）' }}</span>
            </div>
            <div v-if="it.judgeNote" class="wb-ans">
              <span class="lab">错因</span>
              <span class="val note">{{ it.judgeNote }}</span>
            </div>
            <div class="wb-check">
              <van-checkbox :model-value="selectedIds.has(it.question.id)" shape="round" @click.stop="toggleSelect(it.question.id)" />
            </div>
          </div>
        </div>
      </template>

      <!-- 底部多选操作栏 -->
      <div v-if="selectedIds.size > 0 && !needLogin" class="wb-bar">
        <span class="wb-bar-count">已选 <b>{{ selectedQuestions.length }}</b> 题</span>
        <button class="wb-bar-link" @click="selectAll">全选</button>
        <button class="wb-bar-link" @click="clearSelection">清空</button>
        <van-button type="primary" size="small" round class="wb-bar-btn" @click="redoSelected">重练所选 →</van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.wb {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px 14px 0;
  box-sizing: border-box;
}
.wb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wb-title { font-size: 17px; font-weight: 600; }
.wb-note { margin: 6px 0 8px; font-size: 11.5px; color: #969799; }
.wb-loading { padding: 48px 0; display: flex; justify-content: center; }
.wb-summary { font-size: 11.5px; color: #969799; margin-bottom: 8px; }
.wb-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wb-card {
  position: relative;
  padding: 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #ebedf0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wb-card.picked { border-color: #1989fa; background: #f2f6ff; }
.wb-top { display: flex; align-items: center; gap: 8px; font-size: 10.5px; }
.wb-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(74, 222, 128, 0.14);
  color: #16a34a;
}
.wb-badge.d-medium { background: rgba(251, 191, 36, 0.16); color: #d97706; }
.wb-badge.d-hard { background: rgba(248, 113, 113, 0.14); color: #dc2626; }
.wb-badge.t { background: #eef3ff; color: #1989fa; }
.wb-wrong { color: #ee0a24; }
.wb-time { margin-left: auto; color: #c8c9cc; }
.wb-q-title { font-size: 14.5px; font-weight: 600; color: #323233; padding-right: 30px; }
.wb-q-body {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: #646566;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wb-ans { display: flex; gap: 8px; font-size: 11.5px; line-height: 1.5; }
.wb-ans .lab { flex-shrink: 0; color: #969799; }
.wb-ans .val { color: #323233; overflow-wrap: anywhere; }
.wb-ans .val.note { color: #d97706; }
.wb-check { position: absolute; top: 10px; right: 10px; }
.wb-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid #f2f3f5;
  background: #fff;
}
.wb-bar-count { font-size: 12.5px; color: #646566; }
.wb-bar-count b { color: #1989fa; }
.wb-bar-link { font-size: 12px; color: #646566; padding: 2px 6px; }
.wb-bar-btn { margin-left: auto; }
</style>
