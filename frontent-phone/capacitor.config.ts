import type { CapacitorConfig } from '@capacitor/cli'

// 问星移动端 — Capacitor 原生壳配置
// appId 与桌面端 Tauri identifier 保持一致；webDir 指向上游 Vite 产物。
// 注意：server.androidScheme 保持 https（安全上下文，Clipboard 等 API 需要）；
// 后端目前是 HTTP，WebView 内需 allowMixedContent 才能请求；后端切 HTTPS 后应移除该项。
const config: CapacitorConfig = {
  appId: 'com.wenxing.app',
  appName: '问星',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0f1115'
  }
}

export default config
