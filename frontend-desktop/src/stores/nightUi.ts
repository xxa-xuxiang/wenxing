// 夜间 UI 灰度开关：独立于 midnight/dawn 主题
// 启用时给 <html> 加 data-night="on"，只激活 night-theme.css 的 --nt-* 变量与 .nt-* 组件
// 与 themeStore 的 data-theme（midnight/dawn）互不影响，删属性即可回滚
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { storage } from '@/utils/storage'
import { FLAGS } from '@/config/flags'

const STORAGE_KEY = 'wx:night-ui'
/** 与 storage.setGlobal 的命名空间保持一致，供挂载前直接读取 */
const STORAGE_FULL_KEY = `wenxing:v01:${STORAGE_KEY}`

function apply(enabled: boolean): void {
  const el = document.documentElement
  if (enabled && FLAGS.NIGHT_THEME) el.setAttribute('data-night', 'on')
  else el.removeAttribute('data-night')
}

/** 挂载前先应用，避免首屏从浅色闪到暗色（与 applyStoredThemeEarly 并列） */
export function applyStoredNightEarly(): void {
  if (!FLAGS.NIGHT_THEME) {
    apply(false)
    return
  }
  try {
    const raw = localStorage.getItem(STORAGE_FULL_KEY)
    apply(raw !== null && JSON.parse(raw) === true)
  } catch {
    apply(false)
  }
}

export const useNightUiStore = defineStore('nightUi', () => {
  const enabled = ref(FLAGS.NIGHT_THEME && storage.getGlobal<boolean>(STORAGE_KEY, false))

  apply(enabled.value)

  watch(enabled, (v) => {
    apply(v)
    storage.setGlobal(STORAGE_KEY, v)
  })

  // 跨窗口同步：工具窗/桌宠切换后主窗跟随
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_FULL_KEY || e.newValue === null) return
    try {
      const next = JSON.parse(e.newValue) === true
      if (next !== enabled.value) enabled.value = next
    } catch {
      /* 非法值忽略 */
    }
  })

  function setEnabled(v: boolean): void {
    enabled.value = FLAGS.NIGHT_THEME && v
  }

  return { enabled, setEnabled }
})
