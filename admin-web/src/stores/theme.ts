import { defineStore } from 'pinia'

export type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'wenxing:admin:theme'

function readMode(): ThemeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: readMode() as ThemeMode
  }),
  actions: {
    /** 把当前模式写到 <html data-theme>：仅 midnight / dawn 两档 */
    apply() {
      document.documentElement.dataset.theme = this.mode === 'dark' ? 'midnight' : 'dawn'
    },
    toggle() {
      this.mode = this.mode === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, this.mode)
      } catch {
        /* 持久化失败不影响本次切换 */
      }
      this.apply()
    }
  }
})
