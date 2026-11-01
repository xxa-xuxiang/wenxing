// 个人中心共享：自定义 API Key 状态（设备级，跨「计费 / API 与充值」两个分区同步）
// 保存只写 localStorage，不发请求；后端经 authHeaders 的 X-User-Api-Key 自动读取
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { storage } from '@/utils/storage'

const STORAGE_KEY = 'wx:userApiKey'

const savedKey = ref(storage.getGlobal<string>(STORAGE_KEY, ''))
const keyInput = ref(savedKey.value)

export function useApiKey() {
  /** 当前计费模式：有 Key = 自带 Key（零费用）；留空 = 平台 AI 按次计费 */
  const mode = computed<'byo' | 'platform'>(() => (savedKey.value.trim() ? 'byo' : 'platform'))

  async function saveKey() {
    const v = keyInput.value.trim()
    try {
      await showConfirmDialog({
        title: '保存自定义 API Key',
        message: v
          ? '后续 AI 调用将使用你自己的 Key（不计平台 AI 次数），是否保存？'
          : '将清空自定义 Key，后续 AI 调用走平台 AI 按次计费，是否继续？'
      })
    } catch {
      return
    }
    if (v) storage.setGlobal(STORAGE_KEY, v)
    else storage.removeGlobal(STORAGE_KEY)
    savedKey.value = v
    keyInput.value = v
    showToast(v ? '已保存自定义 Key' : '已清空自定义 Key')
  }

  return { savedKey, keyInput, mode, saveKey }
}
