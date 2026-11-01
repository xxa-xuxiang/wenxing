// 问星移动端 — 全局主题 Store
// 两套主题：极夜黑（深色）/ 曙光白（浅色）；另支持「跟随系统」自动解析。
// 主题存设备级（getGlobal/setGlobal），首次启动默认跟随系统。
// 注意：主题只驱动星图与桌面风面板，其余 Vant 页面保持浅色。
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { storage } from '@/utils/storage'

export type ThemeName = 'midnight' | 'dawn'
export type ThemeChoice = ThemeName | 'auto'

const STORAGE_KEY = 'wx:theme'

export const THEMES: { id: ThemeChoice; name: string; hint: string }[] = [
  { id: 'auto', name: '跟随系统', hint: '随系统深色 / 浅色自动切换' },
  { id: 'midnight', name: '极夜黑', hint: '纯黑底 · 高对比' },
  { id: 'dawn', name: '曙光白', hint: '浅色底 · 日间模式' }
]

function systemDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function normalize(raw: unknown): ThemeChoice {
  return raw === 'dawn' || raw === 'midnight' || raw === 'auto' ? raw : 'auto'
}

function resolve(choice: ThemeChoice): ThemeName {
  if (choice === 'auto') return systemDark() ? 'midnight' : 'dawn'
  return choice
}

function apply(name: ThemeName): void {
  document.documentElement.setAttribute('data-theme', name)
}

/** 首帧后再启用主题过渡，避免启动时闪动 */
function enableTransitionAfterFirstPaint(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add('wx-theme-ready')
    })
  })
}

/** 渲染前应用已保存主题（首屏无过渡） */
export function applyStoredThemeEarly(): void {
  let choice: ThemeChoice = 'auto'
  try {
    const raw = localStorage.getItem(`wenxing:v01:${STORAGE_KEY}`)
    choice = normalize(raw === null ? 'auto' : JSON.parse(raw))
  } catch {
    choice = 'auto'
  }
  apply(resolve(choice))
  enableTransitionAfterFirstPaint()
}

export const useThemeStore = defineStore('theme', () => {
  const choice = ref<ThemeChoice>(normalize(storage.getGlobal<ThemeChoice>(STORAGE_KEY, 'auto')))
  const name = computed<ThemeName>(() => resolve(choice.value))

  apply(name.value)
  enableTransitionAfterFirstPaint()

  watch(
    name,
    (v) => apply(v),
    { immediate: true }
  )

  // 「跟随系统」时监听系统主题变化
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (choice.value === 'auto') apply(resolve('auto'))
    }
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else if (typeof mq.addListener === 'function') mq.addListener(onChange)
  }

  function set(v: ThemeChoice): void {
    choice.value = normalize(v)
    storage.setGlobal(STORAGE_KEY, choice.value)
  }

  return { choice, name, set }
})
