<script setup lang="ts">
// 反馈中心：左侧提交反馈（写入后端 md 存档），右侧查看历史反馈列表（时间倒序）
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { industries } from '@/data/industries'
import { http } from '@/services/http'

interface FeedbackItem {
  industry: string
  time: string
  source: string
  content: string
}

const router = useRouter()

// ===== 提交表单 =====
const industry = ref('通用')
const content = ref('')
const sending = ref(false)
const sent = ref(false)
const failText = ref('')

async function submit() {
  const text = content.value.trim()
  if (!text || sending.value) return
  sending.value = true
  failText.value = ''
  try {
    await http('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: industry.value, content: text, source: 'feedback-center' })
    })
    sent.value = true
    content.value = ''
    window.setTimeout(() => { sent.value = false }, 2000)
    await loadList()
  } catch {
    failText.value = '提交失败，请确认后端已启动（server 目录运行 npm run dev）'
  } finally {
    sending.value = false
  }
}

// ===== 历史反馈列表 =====
const list = ref<FeedbackItem[]>([])
const listLoading = ref(true)
const listError = ref(false)

async function loadList() {
  listLoading.value = true
  listError.value = false
  try {
    const data = await http<{ items: FeedbackItem[] }>('/api/feedback')
    list.value = Array.isArray(data.items) ? data.items : []
  } catch {
    listError.value = true
  } finally {
    listLoading.value = false
  }
}

const sourceLabel: Record<string, string> = {
  atlas: '知识星图',
  'feedback-center': '反馈中心'
}

onMounted(loadList)
</script>

<template>
  <div class="wx-fb">
    <div class="wx-fb-head">
      <button class="wx-fb-back wx-pressable" title="返回" @click="router.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div class="wx-fb-head-main">
        <h1 class="wx-fb-title">反馈中心</h1>
        <p class="wx-fb-sub">提交建议或缺失能力点，我们会持续完善行业知识图谱</p>
      </div>
    </div>

    <div class="wx-fb-body">
      <!-- 左：提交表单 -->
      <section class="wx-fb-form wx-glass">
        <div class="wx-fb-form-title">提交反馈</div>
        <label class="wx-fb-field">
          <span class="wx-fb-label">所属行业</span>
          <select v-model="industry" class="wx-fb-select">
            <option value="通用">通用</option>
            <option v-for="i in industries" :key="i.id" :value="i.name">{{ i.name }}</option>
          </select>
        </label>
        <label class="wx-fb-field">
          <span class="wx-fb-label">反馈内容</span>
          <textarea
            v-model="content"
            class="wx-fb-textarea"
            rows="6"
            maxlength="2000"
            placeholder="例如：在「信息技术与软件」下缺少「鸿蒙 ArkTS」能力项；或对产品体验的建议…"
          ></textarea>
        </label>
        <div v-if="failText" class="wx-fb-fail">⚠ {{ failText }}</div>
        <button
          class="wx-btn-gradient wx-pressable wx-fb-submit"
          :disabled="sending || !content.trim()"
          @click="submit"
        >
          <span v-if="sending">提交中…</span>
          <span v-else-if="sent">已收到 ✓</span>
          <span v-else>提交反馈</span>
        </button>
      </section>

      <!-- 右：历史反馈列表 -->
      <section class="wx-fb-list wx-glass">
        <div class="wx-fb-list-head">
          <span class="wx-fb-form-title">历史反馈</span>
          <button class="wx-fb-refresh" :disabled="listLoading" @click="loadList">刷新</button>
        </div>

        <div v-if="listLoading" class="wx-fb-list-tip">加载中…</div>
        <div v-else-if="listError" class="wx-fb-list-tip">
          加载失败，请确认后端已启动
          <button class="wx-fb-retry wx-pressable" @click="loadList">重试</button>
        </div>
        <div v-else-if="!list.length" class="wx-fb-list-tip">暂无反馈记录，来提交第一条吧</div>

        <div v-else class="wx-fb-items">
          <div v-for="(it, i) in list" :key="i" class="wx-fb-item">
            <div class="wx-fb-item-meta">
              <span class="wx-fb-item-industry">{{ it.industry }}</span>
              <span class="wx-fb-item-source">{{ sourceLabel[it.source] ?? it.source }}</span>
              <span class="wx-fb-item-time">{{ it.time }}</span>
            </div>
            <p class="wx-fb-item-content">{{ it.content }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.wx-fb {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 24px;
  overflow: hidden;
}
.wx-fb-head {
  padding: 0 8px 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.wx-fb-back {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-fb-back svg { width: 18px; height: 18px; }
.wx-fb-back:hover {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-fb-title {
  font-family: var(--wx-font-serif);
  font-size: 26px;
  font-weight: 600;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-fb-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

.wx-fb-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
  overflow: hidden;
}

/* 左：表单 */
.wx-fb-form {
  width: 34%;
  min-width: 300px;
  padding: 20px;
  border-radius: var(--wx-glass-radius);
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.wx-fb-form-title { font-size: 15px; font-weight: 600; }
.wx-fb-field { display: flex; flex-direction: column; gap: 6px; }
.wx-fb-label { font-size: 12px; color: var(--wx-text-secondary); }
.wx-fb-select,
.wx-fb-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-fb-select:focus,
.wx-fb-textarea:focus { border-color: var(--wx-border-glow); }
.wx-fb-textarea { resize: vertical; min-height: 120px; line-height: 1.6; }
.wx-fb-fail {
  padding: 8px 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
  font-size: 12px;
  color: var(--wx-text-primary);
}
.wx-fb-submit { padding: 10px; font-size: 13px; font-weight: 600; }
.wx-fb-submit:disabled { opacity: 0.5; cursor: not-allowed; }

/* 右：列表 */
.wx-fb-list {
  flex: 1;
  min-width: 0;
  padding: 20px;
  border-radius: var(--wx-glass-radius);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wx-fb-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.wx-fb-refresh {
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 999px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-fb-refresh:hover:not(:disabled) { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-fb-refresh:disabled { opacity: 0.4; }
.wx-fb-list-tip {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
}
.wx-fb-retry {
  font-size: 12px;
  padding: 4px 14px;
  border-radius: 999px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
}
.wx-fb-items {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wx-fb-item {
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-fb-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  margin-bottom: 6px;
}
.wx-fb-item-industry {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  color: var(--wx-color-primary-soft);
}
.wx-fb-item-source {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent);
  color: var(--wx-color-yanqing);
}
.wx-fb-item-time { color: var(--wx-text-muted); margin-left: auto; }
.wx-fb-item-content {
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--wx-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
