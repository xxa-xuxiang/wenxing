// 问星移动端 H5 — 应用入口
// 纯 Web 模式（无 Tauri）：/api 走 Vite 代理（开发）或同源部署（生产）
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import App from './App.vue'
import router from './router'
import { applyStoredThemeEarly } from './stores/themeStore'

// Vant 函数式组件样式：auto-import-resolver 只处理模板组件，
// showToast/showDialog/showNotify/showImagePreview 的样式需手动引入
import 'vant/es/toast/style'
import 'vant/es/dialog/style'
import 'vant/es/notify/style'
import 'vant/es/image-preview/style'

// 主题令牌（仅星图 / 桌面风面板使用）先于全局样式载入
import './styles/theme.css'
import './styles/main.css'

// 渲染前应用已保存主题（跟随系统 / 极夜黑 / 曙光白）
applyStoredThemeEarly()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Android 返回键：一级 Tab 再按退出，其余页面回退，避免系统直接杀进程
const ROOT_ROUTE_NAMES = new Set(['learn', 'atlas', 'questions', 'community', 'me'])
if (Capacitor.isNativePlatform()) {
  CapApp.addListener('backButton', ({ canGoBack }) => {
    const name = String(router.currentRoute.value.name ?? '')
    if (!canGoBack || ROOT_ROUTE_NAMES.has(name)) {
      void CapApp.exitApp()
      return
    }
    router.back()
  })
}

// vconsole：仅 DEV 注入真机调试面板，URL 带 ?novconsole=1 可临时关闭
// 生产构建时 import.meta.env.DEV 恒为 false，动态导入被消除，产物不含 vconsole
if (import.meta.env.DEV && !new URLSearchParams(location.search).has('novconsole')) {
  import('vconsole').then(({ default: VConsole }) => {
    new VConsole({ theme: 'dark' })
  })
}
