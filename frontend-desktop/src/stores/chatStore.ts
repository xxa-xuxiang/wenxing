// 问星 v0.1 — AI 悬浮球聊天 Store
// v0.11: 跨窗口同步（主窗口 ↔ 桌宠窗口）：localStorage + storage 事件广播
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ChatMessage } from '@/types'
import { storage } from '@/utils/storage'
import { chat as aiChat, chatStream } from '@/services/aiService'
import { useLearnStore } from './learnStore'
import { useMasteryStore } from './masteryStore'

/** 发送给 AI 的最大消息数（滑动窗口，避免 token 超限；约 6 轮对话） */
const MAX_CONTEXT_MESSAGES = 12

export const useChatStore = defineStore('chat', () => {
  const open = ref(false)
  const messages = ref<ChatMessage[]>(storage.get<ChatMessage[]>('orbMsgs', []))
  const loading = ref(false)
  // v0.10 语音通话模式
  const voiceMode = ref(false)
  // 流式接收时实时拼接的 AI 回复
  const streamingContent = ref('')

  function persist() {
    storage.set('orbMsgs', messages.value)
  }

  // ===== v0.11 — 跨窗口同步 =====
  // storage 事件：其他窗口写入 localStorage 时自动 reload
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'orbMsgs') {
        messages.value = storage.get<ChatMessage[]>('orbMsgs', [])
      }
    })
  }
  // 本地 watch：本窗口 messages 变化 → 写入 localStorage（persist 已做，这里兜底）
  watch(messages, () => persist(), { deep: true })

  function toggle(v?: boolean) {
    open.value = v ?? !open.value
    if (open.value && messages.value.length === 0) {
      messages.value = [
        {
          id: 'sys-0',
          role: 'assistant',
          content: '你好，我是问星 AI 学习伙伴。当前页遇到问题随时问我～',
          createdAt: Date.now()
        }
      ]
      persist()
    }
  }

  /** 构建学习上下文（注入当前在学知识点/掌握度/目标，供定制化 Agent 使用） */
  function buildContext(): string | undefined {
    // 延迟引入避免 pinia 循环依赖
    const learn = useLearnStore()
    const mastery = useMasteryStore()

    const parts: string[] = []

    // 1. 在学行业
    const domain = learn.selectedDomain?.name
    if (domain) parts.push(`在学行业：${domain}`)

    // 2. 当前任务
    const task = learn.activeTask
    if (task) {
      const statusText = task.status === 'deep' ? '深度掌握' : task.status === 'light' ? '轻掌握' : '未学'
      parts.push(`当前任务：${task.title}（${statusText}）`)
    }

    // 3. 掌握度统计
    const s = mastery.stats
    parts.push(`进度：已掌握 ${s.masteredCount} 个知识点，已点亮 ${s.litCount} 个，累计答题 ${s.totalAnswers} 道`)

    // 4. 30 天目标
    const goal = learn.questionnaireAnswers?.goal30
    if (goal) parts.push(`30天目标：${goal}`)

    // 5. 最近已掌握的知识点（最多 3 个，让 Agent 知道用户最近学了什么）
    const recentMastered = Object.entries(mastery.map)
      .filter(([, e]) => e.state === 'mastered')
      .slice(-3)
      .map(([k]) => k)
    if (recentMastered.length) parts.push(`最近掌握：${recentMastered.join('、')}`)

    return parts.length ? parts.join('；') : undefined
  }

  /** 取最近 N 条消息作为 AI 上下文（滑动窗口，控制 token） */
  function recentMessages() {
    return messages.value.slice(-MAX_CONTEXT_MESSAGES)
  }

  async function send(content: string) {
    if (!content.trim()) return
    messages.value.push({
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      createdAt: Date.now()
    })
    persist()
    loading.value = true
    try {
      const reply = await aiChat(
        recentMessages().map((m) => ({ role: m.role, content: m.content })),
        buildContext()
      )
      messages.value.push({
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: reply.content,
        options: reply.options?.length ? reply.options : undefined,
        createdAt: Date.now()
      })
    } catch (e) {
      messages.value.push({
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: `AI 调用失败：${e instanceof Error ? e.message : '未知错误'}。请确认后端已启动（server 目录运行 npm run dev）。`,
        createdAt: Date.now()
      })
    } finally {
      loading.value = false
      persist()
    }
  }

  /**
   * v0.10 流式发送（语音通话用）：边接收边更新 streamingContent，结束后落库
   * @param signal 中断信号（用户打断时 abort，此时不写入错误消息）
   * @returns 完整回复文本（被中断时返回空串）
   */
  async function sendStream(content: string, signal?: AbortSignal): Promise<string> {
    if (!content.trim()) return ''
    messages.value.push({
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      createdAt: Date.now()
    })
    persist()
    loading.value = true
    streamingContent.value = ''
    let reply = ''
    let interrupted = false
    try {
      reply = await chatStream(
        recentMessages().map((m) => ({ role: m.role, content: m.content })),
        buildContext(),
        (chunk) => { streamingContent.value += chunk },
        signal
      )
    } catch (e) {
      if (signal?.aborted || e instanceof DOMException && e.name === 'AbortError') {
        interrupted = true
      } else {
        reply = `AI 调用失败：${e instanceof Error ? e.message : '未知错误'}`
      }
    } finally {
      if (!interrupted && reply) {
        messages.value.push({
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: reply,
          createdAt: Date.now()
        })
      }
      streamingContent.value = ''
      loading.value = false
      persist()
    }
    return interrupted ? '' : reply
  }

  function clear() {
    messages.value = []
    persist()
  }

  /** 选择题：标记用户选择并把该选项作为新消息发出 */
  function choose(messageId: string, option: string) {
    const target = messages.value.find((m) => m.id === messageId)
    if (!target || target.chosen) return
    target.chosen = option
    persist()
    void send(option)
  }

  function reload() {
    messages.value = storage.get<ChatMessage[]>('orbMsgs', [])
  }

  return { open, messages, loading, voiceMode, streamingContent, toggle, send, sendStream, choose, clear, reload }
})
