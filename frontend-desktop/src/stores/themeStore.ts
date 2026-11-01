// 问星 — 全局主题 Store
// 两套主题：极夜黑（默认，纯黑高对比）/ 曙光白（浅色日间）
// 主题存设备级（getGlobal/setGlobal），不随用户切换；多窗口经 window 'storage' 事件实时同步
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { storage } from '@/utils/storage'

export type ThemeName = 'midnight' | 'dawn'

const STORAGE_KEY = 'wx:theme'
export const THEMES: { id: ThemeName; name: string; hint: string }[] = [
  { id: 'midnight', name: '极夜黑', hint: '纯黑底 · 高对比' },
  { id: 'dawn', name: '曙光白', hint: '浅色底 · 日间模式' }
]

const VALID: ThemeName[] = ['midnight', 'dawn']

/** 旧版「星空紫」存档统一迁移到极夜黑 */
function normalize(raw: unknown): ThemeName {
  return raw === 'dawn' ? 'dawn' : 'midnight'
}

function apply(name: ThemeName) {
  document.documentElement.setAttribute('data-theme', name)
}

/** 首帧后再启用主题过渡：双 rAF 保证首屏样式已稳定，避免出现场动画 */
function enableTransitionAfterFirstPaint() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add('wx-theme-ready')
    })
  })
}

/**
 * 各窗口挂载前先行应用主题（主窗口 / 桌宠 / 功能独立窗口）。
 * 直接读设备级 localStorage，避免依赖 Pinia 实例化时机导致首屏闪回极夜黑。
 */
export function applyStoredThemeEarly(): void {
  try {
    const raw = localStorage.getItem(`wenxing:v01:${STORAGE_KEY}`)
    apply(normalize(raw === null ? null : JSON.parse(raw)))
  } catch {
    apply('midnight')
  }
  enableTransitionAfterFirstPaint()
}

export const useThemeStore = defineStore('theme', () => {
  // 设备级读取；兼容旧版用户隔离键作为迁移兜底
  const legacy = storage.get<ThemeName | 'nebula'>(STORAGE_KEY, 'midnight')
  const name = ref<ThemeName>(normalize(storage.getGlobal<ThemeName | 'nebula'>(STORAGE_KEY, legacy)))

  // 初始化时立即应用（首屏无过渡），首帧后启用过渡
  apply(name.value)
  enableTransitionAfterFirstPaint()

  watch(name, (v) => {
    apply(v)
    storage.setGlobal(STORAGE_KEY, v)
  })

  // 跨窗口同步：其他窗口（工具窗/桌宠）切换主题时，本窗口跟随
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.endsWith(STORAGE_KEY) || e.newValue === null) return
    try {
      const v = normalize(JSON.parse(e.newValue))
      if (VALID.includes(v) && v !== name.value) name.value = v
    } catch {
      /* 非法值忽略 */
    }
  })

  function set(n: ThemeName) { name.value = n }

  return { name, set }
})
