// 问星 v1.5 — 划词翻译 Store
// 独立于 chatStore：翻译不进聊天记录，直接打 /api/translate，保证响应速度
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { translate as apiTranslate, type TranslateResult } from '@/services/translateService'
import { writeClipboard } from '@/services/selectionGrab'

export const useTranslateStore = defineStore('translate', () => {
  /** 面板/浮层是否展开 */
  const open = ref(false)
  /** 待翻译原文（可在面板中编辑后重译） */
  const sourceText = ref('')
  /** 翻译结果 */
  const result = ref<TranslateResult | null>(null)
  const loading = ref(false)
  const error = ref('')
  /** 术语域（与社区行业 id 对齐；general 表示通用） */
  const domain = ref('general')

  /** 打开并翻译：先清空旧结果，再发起请求 */
  async function openWith(text: string, nextDomain?: string) {
    open.value = true
    sourceText.value = text.trim()
    result.value = null
    error.value = ''
    if (nextDomain) domain.value = nextDomain
    if (sourceText.value) await translate()
  }

  /** 发起翻译（text 缺省用当前原文） */
  async function translate(text?: string) {
    if (text != null) sourceText.value = text
    const src = sourceText.value.trim()
    if (!src) return
    loading.value = true
    error.value = ''
    try {
      result.value = await apiTranslate(src, 'auto', domain.value)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '翻译失败，请重试'
    } finally {
      loading.value = false
    }
  }

  /** 中英互换：把译文作为新原文再翻一次 */
  async function swap() {
    if (!result.value) return
    await translate(result.value.translation)
  }

  /** 复制译文 */
  async function copy() {
    if (result.value) await writeClipboard(result.value.translation)
  }

  function close() {
    open.value = false
    result.value = null
    error.value = ''
  }

  return { open, sourceText, result, loading, error, domain, openWith, translate, swap, copy, close }
})
