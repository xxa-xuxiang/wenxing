<!-- 智能组卷弹层（van-popup bottom）：标题 + 知识点范围（每行一个，最多 6 个）+ 题量 + 每题分值 -->
<!-- 每个知识点匹配后端叶子 → 从 verified 题库凑题（不足时管线自动补题）→ 轮转合并保证覆盖 → 后端落库 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { showDialog, showToast } from 'vant'
import { usePaperStore } from '@/stores/paperStore'
import { questionsByLeaf, searchLeaves } from '@/services/questionService'
import type { Paper, Question } from '@/types/quiz'

const show = defineModel<boolean>('show', { required: true })

const emit = defineEmits<{
  (e: 'created', paper: Paper): void
}>()

const paperStore = usePaperStore()

/** 单卷最多覆盖的知识点数（每项至少 4 题，过多会导致卷面过长且生成变慢） */
const MAX_SCOPE = 6

const title = ref('')
const scopeText = ref('')
const count = ref(20)
const scorePer = ref(5)
const generating = ref(false)
const progress = ref('')
const errorText = ref('')

const scopeList = computed(() =>
  scopeText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
)
const scopeCapped = computed(() => scopeList.value.slice(0, MAX_SCOPE))

async function onSubmit() {
  if (generating.value) return
  const list = scopeCapped.value
  if (list.length === 0) {
    errorText.value = '请至少填写 1 个知识点或主题'
    return
  }
  errorText.value = ''
  try {
    // 组卷为写操作：先确认再调接口
    await showDialog({
      title: '生成试卷',
      message: `将按 ${list.length} 个知识点凑题组卷（${count.value} 题，每题 ${scorePer.value} 分）。\n题量不足时现场补题约需 1 分钟/点，继续？`,
      showCancelButton: true,
      confirmButtonText: '开始组卷'
    })
  } catch {
    return // 用户取消
  }
  generating.value = true
  try {
    const n = Math.max(4, Math.min(40, Math.round(Number(count.value)) || 20))
    const per = Math.max(4, Math.min(40, Math.ceil(n / list.length)))

    progress.value = `正在匹配 ${list.length} 个技能点并从题库凑题…`
    // 每个知识点：先匹配叶子，再取 verified 题（generate=true → 不足时管线补题）
    const settled = await Promise.allSettled(
      list.map(async (item) => {
        const found = await searchLeaves(item)
        const leaf = found.items[0]
        if (!leaf) throw new Error(`未匹配技能点：${item}`)
        const resp = await questionsByLeaf(leaf.leafKey, per, true)
        return { item, list: resp.items }
      })
    )
    const buckets = settled
      .filter((s): s is PromiseFulfilledResult<{ item: string; list: Question[] }> => s.status === 'fulfilled')
      .map((s) => s.value)
      .filter((b) => b.list.length > 0)

    if (buckets.length === 0) throw new Error('这些技能点暂无可组卷题目（可能正在建设中），请换知识点')

    // 轮转合并：每轮各取一题，保证卷面覆盖每个知识点，直到凑够题量
    const cursor = buckets.map(() => 0)
    const merged: Question[] = []
    while (merged.length < n) {
      let picked = false
      for (let b = 0; b < buckets.length && merged.length < n; b += 1) {
        const q = buckets[b].list[cursor[b]]
        if (!q) continue
        cursor[b] += 1
        merged.push({
          ...q,
          knowledgePoints: q.knowledgePoints?.length ? q.knowledgePoints : [buckets[b].item]
        })
        picked = true
      }
      if (!picked) break
    }
    if (merged.length === 0) throw new Error('题库返回题目为空')

    const score = Math.max(1, Math.min(100, Math.round(Number(scorePer.value)) || 5))
    const paper = await paperStore.create({
      title: title.value.trim() || `${list[0]} 测评卷`,
      scope: list,
      scorePer: score,
      questionIds: merged.map((q) => q.id)
    })
    showToast(`试卷已生成：${merged.length} 题`)
    emit('created', paper)
    show.value = false
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '组卷失败，请确认网络后重试'
  } finally {
    progress.value = ''
    generating.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round :style="{ maxHeight: '88vh' }" closeable close-icon-position="top-left">
    <div class="pc">
      <div class="pc-title">智能组卷</div>

      <van-field
        v-model="title"
        label="试卷标题"
        placeholder="例如：Vue 核心能力测评卷"
        maxlength="40"
        :disabled="generating"
      />
      <van-field
        v-model="scopeText"
        label="知识点范围"
        type="textarea"
        rows="3"
        autosize
        maxlength="200"
        :placeholder="`每行一个知识点，例如：\n响应式原理\n组合式 API`"
        :disabled="generating"
      >
        <template #extra>
          <span class="pc-count">{{ scopeCapped.length }} / {{ MAX_SCOPE }} 个</span>
        </template>
      </van-field>

      <div class="pc-row">
        <span class="pc-row-label">题量（4 - 40）</span>
        <van-stepper v-model="count" :min="4" :max="40" integer :disabled="generating" />
      </div>
      <div class="pc-row">
        <span class="pc-row-label">每题分值</span>
        <van-stepper v-model="scorePer" :min="1" :max="100" integer :disabled="generating" />
      </div>

      <p class="pc-tip">难度约按 4:4:2 生成，题型混合单选、多选、简答、编程；生成后在「我的试卷」中整卷作答、导出与复盘。</p>
      <div v-if="progress" class="pc-progress">✦ {{ progress }}</div>
      <div v-if="errorText" class="pc-error">⚠ {{ errorText }}</div>

      <div class="pc-foot">
        <van-button type="primary" round block :loading="generating" :disabled="scopeCapped.length === 0" @click="onSubmit">
          {{ generating ? '组卷中，请稍候…' : '生成试卷' }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.pc {
  padding: 20px 16px calc(16px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.pc-title {
  font-size: 17px;
  font-weight: 600;
  color: #323233;
  text-align: center;
  margin-bottom: 4px;
}
.pc-count { font-size: 11px; color: #969799; margin-left: 8px; white-space: nowrap; }
.pc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}
.pc-row-label { font-size: 13px; color: #646566; }
.pc-tip { margin: 0; font-size: 11.5px; line-height: 1.6; color: #969799; }
.pc-progress {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f2f6ff;
  font-size: 12px;
  color: #1989fa;
}
.pc-error {
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff1f0;
  font-size: 12px;
  color: #ee0a24;
}
.pc-foot { padding-top: 4px; }
</style>
