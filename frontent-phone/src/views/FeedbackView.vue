<!-- 反馈中心（全屏二级页）：分类/行业 + 联系方式 + 提交状态 + 反馈记录；请求均由用户点击确认后触发 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { http } from '@/services/http'
import { useAuthStore } from '@/stores/authStore'
import { industries } from '@/data/industries'
import type { FeedbackItem } from '@/types/me'

const router = useRouter()
const auth = useAuthStore()

/**
 * 后端 GET /api/feedback 无用户过滤参数（md 文件存档，无用户字段），
 * 故提交时把用户名写入 source（phone:<username>），「我的」按 source 前端过滤。
 * 用户名经 USERNAME_RE 限制为中文/字母/数字/下划线，不会破坏后端 md 的（来源：xxx）解析。
 */
const mySource = computed(() => `phone:${auth.user?.username ?? ''}`)

// ===== 提交表单：类型 + 行业 + 内容 + 联系方式 =====
// 后端仅接收 industry/content/source：行业写入 industry（与桌面一致作归档分类），
// 类型与联系方式随正文写入，保证 md 存档信息完整。
const TYPE_NAMES = ['功能建议', '内容缺失', '体验问题', '其他']
const TYPE_OPTIONS = TYPE_NAMES.map((t) => ({ text: t, value: t }))
const INDUSTRY_OPTIONS = [
  { text: '通用', value: '通用' },
  ...industries.map((i) => ({ text: i.name, value: i.name }))
]

const type = ref(TYPE_NAMES[0])
const industry = ref('通用')
const contact = ref('')
const content = ref('')
const sending = ref(false)
const sent = ref(false)
const failText = ref('')

const showTypePicker = ref(false)
const showIndustryPicker = ref(false)

function choose(target: { value: string }, selectedValues: string[], fallback: string) {
  target.value = selectedValues[0] ?? fallback
}
function onTypeConfirm({ selectedValues }: { selectedValues: string[] }) {
  choose(type, selectedValues, type.value)
  showTypePicker.value = false
}
function onIndustryConfirm({ selectedValues }: { selectedValues: string[] }) {
  choose(industry, selectedValues, industry.value)
  showIndustryPicker.value = false
}

let sentTimer: number | null = null
function composeContent(text: string): string {
  const lines = [`【${type.value}】${text}`]
  if (contact.value.trim()) lines.push(`联系方式：${contact.value.trim()}`)
  return lines.join('\n')
}

async function submit() {
  const text = content.value.trim()
  if (!text || sending.value) return
  try {
    await showConfirmDialog({
      title: '提交反馈',
      message: '将提交到问星反馈中心，我们会持续跟进完善，是否继续？'
    })
  } catch {
    return
  }
  sending.value = true
  failText.value = ''
  try {
    await http('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: industry.value, content: composeContent(text), source: mySource.value })
    })
    content.value = ''
    sent.value = true
    if (sentTimer) window.clearTimeout(sentTimer)
    sentTimer = window.setTimeout(() => { sent.value = false }, 2000)
    showToast('反馈已提交，感谢你的建议')
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    failText.value = msg && msg !== 'Failed to fetch'
      ? `提交失败：${msg}`
      : '提交失败，请确认后端已启动或网络可用'
  } finally {
    sending.value = false
  }
}

// ===== 反馈记录：确认后 GET /api/feedback，可切换「全部 / 我的」 =====
const recordsOpen = ref(false)
const recordsLoading = ref(false)
const recordsError = ref('')
const records = ref<FeedbackItem[]>([])
const onlyMine = ref(false)

const myRecords = computed(() => records.value.filter((it) => it.source === mySource.value))
const visibleRecords = computed(() => (onlyMine.value ? myRecords.value : records.value))

function sourceLabel(s: string): string {
  if (s === 'atlas') return '知识星图'
  if (s === 'feedback-center') return '反馈中心'
  if (s.startsWith('phone:')) return '手机端'
  return s
}

async function loadRecords() {
  if (recordsLoading.value) return
  recordsLoading.value = true
  recordsError.value = ''
  try {
    const data = await http<{ items: FeedbackItem[] }>('/api/feedback')
    records.value = Array.isArray(data.items) ? data.items : []
  } catch (e) {
    recordsError.value = (e as Error).message || '加载失败，请确认后端已启动'
  } finally {
    recordsLoading.value = false
  }
}

async function openRecords() {
  try {
    await showConfirmDialog({
      title: '查看反馈记录',
      message: '将向后端发起一次请求拉取反馈记录，是否继续？'
    })
  } catch {
    return
  }
  recordsOpen.value = true
  await loadRecords()
}
</script>

<template>
  <div class="fb-page">
    <van-nav-bar title="反馈中心" left-arrow left-text="返回" safe-area-inset-top @click-left="router.back()" />

    <!-- 提交反馈 -->
    <section class="fb-card">
      <h3 class="fb-card-title">提交反馈</h3>
      <p class="fb-card-sub">提交建议或缺失能力点，我们会持续完善行业知识图谱</p>
      <van-cell-group inset>
        <van-field
          v-model="type"
          label="反馈类型"
          placeholder="选择类型"
          readonly
          is-link
          @click="showTypePicker = true"
        />
        <van-field
          v-model="industry"
          label="所属行业"
          placeholder="选择行业"
          readonly
          is-link
          @click="showIndustryPicker = true"
        />
        <van-field
          v-model="content"
          label="反馈内容"
          type="textarea"
          rows="5"
          maxlength="2000"
          show-word-limit
          autosize
          placeholder="例如：在「信息技术与软件」下缺少「鸿蒙 ArkTS」能力项；或对产品体验的建议…"
        />
        <van-field
          v-model="contact"
          label="联系方式"
          placeholder="选填，便于我们回访（手机号 / 微信 / 邮箱）"
          maxlength="60"
          clearable
        />
      </van-cell-group>

      <div v-if="failText" class="fb-fail">⚠ {{ failText }}</div>
      <div v-if="sent" class="fb-sent">✓ 已收到反馈，感谢你的建议</div>

      <div class="fb-submit">
        <van-button
          round
          block
          type="primary"
          :disabled="!content.trim() || sending"
          :loading="sending"
          loading-text="提交中…"
          @click="submit"
        >
          {{ sent ? '已收到 ✓' : '提交反馈' }}
        </van-button>
      </div>
    </section>

    <!-- 反馈记录入口 -->
    <van-cell-group inset class="fb-mine-entry">
      <van-cell title="查看反馈记录" icon="records" is-link @click="openRecords" />
    </van-cell-group>

    <p class="fb-foot">反馈会按行业归档到反馈中心，感谢每一位问星学者</p>

    <!-- 类型选择 -->
    <van-popup v-model:show="showTypePicker" position="bottom" round>
      <van-picker :columns="TYPE_OPTIONS" title="反馈类型" @confirm="onTypeConfirm" @cancel="showTypePicker = false" />
    </van-popup>

    <!-- 行业选择 -->
    <van-popup v-model:show="showIndustryPicker" position="bottom" round>
      <van-picker
        :columns="INDUSTRY_OPTIONS"
        title="所属行业"
        @confirm="onIndustryConfirm"
        @cancel="showIndustryPicker = false"
      />
    </van-popup>

    <!-- 反馈记录列表 -->
    <van-popup v-model:show="recordsOpen" position="bottom" round closeable class="fb-mine-popup">
      <div class="fb-records-head">
        <h3 class="fb-mine-title">反馈记录</h3>
        <div class="fb-records-tabs">
          <button :class="{ active: !onlyMine }" @click="onlyMine = false">全部 {{ records.length }}</button>
          <button :class="{ active: onlyMine }" @click="onlyMine = true">我的 {{ myRecords.length }}</button>
        </div>
      </div>
      <div class="fb-mine-body">
        <div v-if="recordsLoading" class="fb-mine-tip">
          <van-loading size="24">加载中…</van-loading>
        </div>
        <div v-else-if="recordsError" class="fb-mine-tip">
          <p class="fb-mine-error">⚠ {{ recordsError }}</p>
          <p class="fb-mine-hint">请检查网络或服务器地址后重试</p>
          <van-button size="mini" round plain type="primary" @click="loadRecords">重试</van-button>
        </div>
        <div v-else-if="visibleRecords.length === 0" class="fb-mine-tip">
          {{ onlyMine ? '还没有我的反馈记录，来提交第一条吧' : '暂无反馈记录，来提交第一条吧' }}
        </div>
        <div v-else class="fb-mine-list">
          <div v-for="(it, i) in visibleRecords" :key="`${it.time}-${i}`" class="fb-item">
            <div class="fb-item-meta">
              <span class="fb-item-type">{{ it.industry }}</span>
              <span class="fb-item-source">{{ sourceLabel(it.source) }}</span>
              <span class="fb-item-time">{{ it.time }}</span>
            </div>
            <p class="fb-item-content">{{ it.content }}</p>
          </div>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.fb-page {
  min-height: 100vh;
  padding-bottom: calc(20px + env(safe-area-inset-bottom));
  background: #f7f8fa;
}

.fb-card {
  margin-top: 12px;
}

.fb-card-title {
  margin: 0 28px 4px;
  font-size: 16px;
  color: #323233;
}

.fb-card-sub {
  margin: 0 28px 10px;
  font-size: 11px;
  color: #969799;
}

.fb-fail {
  margin: 10px 16px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  font-size: 12px;
  line-height: 1.5;
  color: #ee0a24;
}

.fb-sent {
  margin: 10px 16px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: #e8faf3;
  border: 1px solid #b7ebd8;
  font-size: 12px;
  color: #0fa37f;
}

.fb-submit {
  margin: 16px 16px 0;
}

.fb-mine-entry {
  margin-top: 12px;
}

.fb-foot {
  text-align: center;
  font-size: 11px;
  color: #c8c9cc;
  margin: 20px 0 0;
}

.fb-mine-popup {
  padding-top: 20px;
}

.fb-records-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
}

.fb-mine-title {
  margin: 0;
  font-size: 16px;
  color: #323233;
}

.fb-records-tabs {
  display: flex;
  gap: 6px;
}

.fb-records-tabs button {
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid #ebedf0;
  background: #fff;
  font-size: 11.5px;
  color: #646566;
}

.fb-records-tabs button.active {
  border-color: #1989fa;
  color: #1989fa;
  background: #f2f6ff;
}

.fb-mine-body {
  max-height: 62vh;
  overflow-y: auto;
  padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
}

.fb-mine-tip {
  padding: 32px 0;
  text-align: center;
  color: #969799;
  font-size: 13px;
}

.fb-mine-error {
  margin: 0 0 6px;
  color: #ee0a24;
}

.fb-mine-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #c8c9cc;
}

.fb-mine-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fb-item {
  padding: 12px 14px;
  border-radius: 10px;
  background: #f7f8fa;
  border: 1px solid #f2f3f5;
}

.fb-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.fb-item-type {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(25, 137, 250, 0.1);
  color: #1989fa;
  font-size: 10px;
}

.fb-item-source {
  padding: 2px 8px;
  border-radius: 999px;
  background: #f2f3f5;
  color: #969799;
  font-size: 10px;
}

.fb-item-time {
  margin-left: auto;
  font-size: 10px;
  color: #c8c9cc;
}

.fb-item-content {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: #646566;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
