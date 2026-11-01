<script setup lang="ts">
// 主窗口自绘标题栏（Tauri 无边框窗口：decorations: false）
// 左：Logo + 标题 +【桌宠】【番茄钟】【学习笔记】【学习日历】图标按钮 + API 钱包余额框（均可拖拽区外 no-drag）
// 右：【设置】+ 最小化/最大化/关闭；拖拽区双击 = 切换最大化；关闭用 close 保留退出拦截
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri, openPetWindow } from '@/composables/useTauriWindow'
import { openToolWindow } from '@/services/toolWindowService'

const router = useRouter()
const maximized = ref(false)

// ===== API 钱包余额（占位：暂无真实余额接口；预留加载中/失败两态） =====
type BalanceState = 'loading' | 'ok' | 'error'
const balanceState = ref<BalanceState>('ok')
const balanceText = ref('¥0.00')

async function minimize() {
  if (!isTauri()) return
  await getCurrentWebviewWindow().minimize()
}

async function toggleMax() {
  if (!isTauri()) return
  await getCurrentWebviewWindow().toggleMaximize()
  maximized.value = await getCurrentWebviewWindow().isMaximized()
}

/** 拖拽区双击切换最大化；按钮等 no-drag 区域内的双击不触发 */
function onDragAreaDblclick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.wx-app-no-drag')) return
  toggleMax()
}

async function close() {
  if (!isTauri()) {
    window.close()
    return
  }
  await getCurrentWebviewWindow().close()
}

function openSettings() {
  router.push('/me')
}

onMounted(async () => {
  if (!isTauri()) return
  const w = getCurrentWebviewWindow()
  maximized.value = await w.isMaximized()
  // 监听窗口状态变化切换最大化图标（不只查一次）
  w.listen('maximized', () => { maximized.value = true })
  w.listen('unmaximized', () => { maximized.value = false })
})
</script>

<template>
  <header class="wx-titlebar wx-app-drag" data-test="titlebar" @dblclick="onDragAreaDblclick">
    <div class="wx-titlebar-left">
      <div class="wx-titlebar-brand" data-test="titlebar-brand">
        <span class="wx-titlebar-logo">✦</span>
        <span class="wx-titlebar-title">问星</span>
      </div>

      <div class="wx-titlebar-tools wx-app-no-drag">
        <button class="wx-titlebar-icon-btn" title="AI 桌宠" data-test="titlebar-pet" @click="openPetWindow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="13.2" r="7.3" />
            <path d="M12 5.9V4" />
            <circle cx="12" cy="3.1" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="9.6" cy="12.4" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="14.4" cy="12.4" r="0.9" fill="currentColor" stroke="none" />
            <path d="M9.7 15.2c0.9 0.9 3.7 0.9 4.6 0" />
          </svg>
        </button>
        <button class="wx-titlebar-icon-btn" title="番茄钟（独立窗口）" data-test="titlebar-pomodoro" @click="openToolWindow('pomodoro')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="13.5" r="7.8" />
            <path d="M12 10.2v3.6l2.6 1.5" />
            <path d="M9.6 2.6h4.8" />
            <path d="M18.4 6.6l1.7 1.7" />
          </svg>
        </button>
        <button class="wx-titlebar-icon-btn" title="学习笔记（独立窗口）" data-test="titlebar-notes" @click="openToolWindow('notes')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4.5" y="3.5" width="14" height="17" rx="1.5" />
            <line x1="8.2" y1="3.5" x2="8.2" y2="20.5" />
            <line x1="11.5" y1="8.5" x2="15.8" y2="8.5" />
            <line x1="11.5" y1="12.5" x2="15.8" y2="12.5" />
            <line x1="11.5" y1="16.5" x2="14" y2="16.5" />
          </svg>
        </button>

        <button class="wx-titlebar-icon-btn" title="学习日历（独立窗口）" data-test="titlebar-calendar" @click="openToolWindow('calendar')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4.5" width="18" height="16.5" rx="1.5" />
            <line x1="3" y1="9.5" x2="21" y2="9.5" />
            <line x1="8" y1="2.5" x2="8" y2="6.5" />
            <line x1="16" y1="2.5" x2="16" y2="6.5" />
            <line x1="7" y1="13.5" x2="11" y2="13.5" />
            <line x1="7" y1="17" x2="14" y2="17" />
          </svg>
        </button>

        <span
          class="wx-titlebar-balance"
          :class="`is-${balanceState}`"
          data-test="titlebar-balance"
          :data-test-balance="balanceState"
          :title="balanceState === 'error' ? '余额获取失败' : 'API 钱包余额'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="6.5" width="18" height="13" rx="2" />
            <path d="M3 10.5h18" />
            <path d="M16.5 15h2" />
          </svg>
          <span v-if="balanceState === 'loading'" class="wx-titlebar-balance-text" data-test="titlebar-balance-text">加载中…</span>
          <span v-else-if="balanceState === 'error'" class="wx-titlebar-balance-text" data-test="titlebar-balance-text">--</span>
          <span v-else class="wx-titlebar-balance-text" data-test="titlebar-balance-text">{{ balanceText }}</span>
        </span>
      </div>
    </div>

    <div class="wx-titlebar-actions wx-app-no-drag">
      <button class="wx-titlebar-icon-btn" title="设置" data-test="titlebar-settings" @click="openSettings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.82a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.07 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08c.14.63.7 1.07 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.86-.04-1.42.4-1.51.97z" />
        </svg>
      </button>
      <button class="wx-titlebar-btn" title="最小化" data-test="titlebar-minimize" @click="minimize">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" fill="currentColor"/></svg>
      </button>
      <button
        class="wx-titlebar-btn"
        :title="maximized ? '还原' : '最大化'"
        data-test="titlebar-maximize"
        :data-test-state="maximized ? 'restore' : 'maximize'"
        @click="toggleMax"
      >
        <svg v-if="!maximized" width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/></svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12"><rect x="3" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1"/><rect x="2" y="5" width="2" height="5" fill="currentColor"/><rect x="5" y="2" width="5" height="2" fill="currentColor"/></svg>
      </button>
      <button class="wx-titlebar-btn wx-titlebar-close" title="关闭" data-test="titlebar-close" @click="close">
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.wx-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--wx-titlebar-height, 36px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 200;
  background: linear-gradient(180deg, var(--wx-glass-bg) 0%, transparent 100%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  user-select: none;
}

.wx-titlebar-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.wx-titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--wx-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.wx-titlebar-logo {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--wx-gradient-primary);
  border-radius: 6px;
  font-size: 11px;
  color: var(--wx-text-on-accent);
}

.wx-titlebar-title {
  letter-spacing: 0.04em;
}

/* ===== 左侧工具区：图标按钮（视觉 16-18px，热区 ≥32×32） + 余额框 ===== */
.wx-titlebar-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wx-titlebar-icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wx-text-secondary);
  border-radius: 6px;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft),
              color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-titlebar-icon-btn svg {
  width: 17px;
  height: 17px;
}
.wx-titlebar-icon-btn:hover {
  background: var(--wx-glass-bg-strong);
  color: var(--wx-text-primary);
}

.wx-titlebar-balance {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  margin-left: 2px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  background: var(--wx-glass-bg);
  color: var(--wx-text-tertiary);
  cursor: default;
}
.wx-titlebar-balance svg {
  width: 14px;
  height: 14px;
}
.wx-titlebar-balance-text {
  font-size: 12px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-secondary);
}
.wx-titlebar-balance.is-loading .wx-titlebar-balance-text { color: var(--wx-text-muted); }
.wx-titlebar-balance.is-error .wx-titlebar-balance-text { color: var(--wx-color-vermilion); }

/* ===== 右侧窗口控制 ===== */
.wx-titlebar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.wx-titlebar-btn {
  width: 36px;
  height: var(--wx-titlebar-height, 36px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wx-text-secondary);
  border-radius: 0;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft),
              color var(--wx-duration-fast) var(--wx-ease-out-soft);
}

.wx-titlebar-btn:hover {
  background: var(--wx-glass-bg-strong);
  color: var(--wx-text-primary);
}

.wx-titlebar-close:hover {
  background: var(--wx-color-vermilion) !important;
  color: var(--wx-text-on-accent);
}
</style>
