// 问星社区网页端 — 入口
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// 复用桌面端全局样式：设计令牌 / 基础 / 毛玻璃 / 动效
import '@/styles/variables.css'
import '@/styles/base.css'
import '@/styles/glass.css'
import '@/styles/animations.css'
import './styles/web.css'

createApp(App).use(createPinia()).use(router).mount('#app')
