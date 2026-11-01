import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useThemeStore } from './stores/theme'

// 复用桌面端全局样式：设计令牌 / 基础 / 毛玻璃 / 动效
import '@/styles/variables.css'
import '@/styles/base.css'
import '@/styles/glass.css'
import '@/styles/animations.css'
import './styles/admin.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
// 挂载前先应用主题，避免首屏闪烁
useThemeStore(pinia).apply()
app.use(router)
app.mount('#app')
