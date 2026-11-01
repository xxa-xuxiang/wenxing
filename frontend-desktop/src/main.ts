// 问星 v0.1 — 应用入口
// 主窗口 / 桌宠窗口 / 功能独立窗口共用此文件，通过 URL 参数 ?window= 分流入口
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import AppPet from './AppPet.vue'
import AppPetChat from './AppPetChat.vue'
import AppTool from './AppTool.vue'
import router from './router'
import { apiReady, initApiBase, retryInitApiBase } from './services/apiBase'
import { applyStoredThemeEarly, useThemeStore } from './stores/themeStore'
import { applyFlagsOverride } from './config/flags'
import { applyStoredNightEarly } from './stores/nightUi'

import './styles/variables.css'
import './styles/base.css'
import './styles/glass.css'
import './styles/animations.css'
import './styles/night-theme.css'

// 特性开关：先应用 localStorage.flags_override，再渲染任何窗口与组件
applyFlagsOverride()

// 夜间 UI：独立属性 data-night，必须在主题应用前读取
applyStoredNightEarly()

// 所有窗口（主窗 / 桌宠 / 功能独立窗口）在渲染前统一应用已保存主题
applyStoredThemeEarly()

const windowKind = new URLSearchParams(location.search).get('window')
const isPet = windowKind === 'pet'
const isPetChat = windowKind === 'pet-chat'
const isTool = ['pomodoro', 'notes', 'anki', 'calendar'].includes(windowKind ?? '')

// 桌宠窗口：背景全局透明
if (isPet) {
  document.documentElement.classList.add('wx-pet-window')
}

// 启动期 loading（主窗口 + 桌宠窗口共用，API 就绪后被 Vue 挂载覆盖）
function renderBootLoading(text = '加载中…') {
  const host = document.getElementById('app')
  if (!host) return
  host.innerHTML = `
    <div class="wx-boot-loader">
      <div class="wx-star-rotate"><svg viewBox="0 0 100 100"><polygon points="50,5 61,38 96,38 67,58 78,92 50,72 22,92 33,58 4,38 39,38" fill="url(#g)" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.2"/></svg><span class="wx-star-glow"></span></div>
      <span>${text}</span>
      <style>
        .wx-boot-loader{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--wx-gradient-aurora);color:var(--wx-text-secondary);font-family:inherit;font-size:13px;letter-spacing:.04em}
        .wx-star-rotate{width:48px;height:48px;animation:wx-boot-spin 1.6s linear infinite;position:relative}
        .wx-star-rotate svg{width:100%;height:100%;filter:drop-shadow(0 0 6px var(--wx-color-primary))}
        .wx-star-glow{position:absolute;inset:-20%;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb, var(--wx-color-primary) 30%, transparent) 0%,transparent 65%);animation:wx-boot-pulse 1.6s ease-in-out infinite;pointer-events:none}
        @keyframes wx-boot-spin{to{transform:rotate(360deg)}}
        @keyframes wx-boot-pulse{0%,100%{opacity:.45;transform:scale(.92)}50%{opacity:.9;transform:scale(1.1)}}
      </style>
    </div>`
  // 注入渐变 defs（HTML 里线性 gradient 需要 defs）
  const svgns = 'http://www.w3.org/2000/svg'
  const gradId = 'g'
  const existing = document.getElementById(gradId)
  if (!existing) {
    const svg = document.createElementNS(svgns, 'svg')
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0')
    svg.innerHTML = `<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#a5b4fc"/><stop offset="60%" stop-color="#818cf8"/><stop offset="100%" stop-color="#c084fc"/></linearGradient></defs>`
    document.body.appendChild(svg)
  }
}

function renderBackendError() {
  const host = document.getElementById('app')
  if (!host) return
  host.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--wx-gradient-aurora);color:var(--wx-text-primary);font-family:inherit;">
      <div style="text-align:center;padding:40px 56px;border:1px solid var(--wx-border-soft);border-radius:16px;background:var(--wx-glass-bg);">
        <div style="font-size:40px;margin-bottom:12px;">✦</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:8px;">无法连接服务器</div>
        <div style="font-size:13px;color:var(--wx-text-tertiary);margin-bottom:20px;">请检查网络连接后重试；若服务器地址已变更，请使用新版安装包</div>
        <button id="wx-retry" style="padding:9px 36px;border:none;border-radius:999px;background:var(--wx-color-primary-strong);color:var(--wx-text-on-accent);font-size:14px;cursor:pointer;">重试</button>
      </div>
    </div>`
  document.getElementById('wx-retry')?.addEventListener('click', async (el) => {
    const btn = el.target as HTMLButtonElement
    btn.disabled = true
    btn.textContent = '正在重试…'
    if (await retryInitApiBase()) {
      location.reload()
      return
    }
    btn.disabled = false
    btn.textContent = '重试'
  })
}

async function bootstrap() {
  renderBootLoading('加载中…')
  if (!apiReady()) {
    renderBootLoading('正在连接服务…')
    await initApiBase()
  }
  if (!apiReady()) {
    // 桌宠/聊天/功能窗口即使后端不可达也显示（离线模式），但 API 调用会失败
    if (isPet || isPetChat || isTool) {
      const offlineApp = createApp(isPet ? AppPet : isPetChat ? AppPetChat : AppTool)
      const pinia = createPinia()
      offlineApp.use(pinia)
      useThemeStore(pinia)
      offlineApp.mount('#app')
      return
    }
    renderBackendError()
    return
  }

  const vueApp = createApp(isPet ? AppPet : isPetChat ? AppPetChat : isTool ? AppTool : App)
  const pinia = createPinia()
  vueApp.use(pinia)
  useThemeStore(pinia)
  if (!isPet && !isPetChat && !isTool) vueApp.use(router)
  vueApp.mount('#app')
}

bootstrap()
