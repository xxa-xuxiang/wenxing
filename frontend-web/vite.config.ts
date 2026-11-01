import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 桌面端源码根（社区视图 / 服务 / store 的唯一真源）
const desktopSrc = fileURLToPath(new URL('../frontend-desktop/src', import.meta.url))

// dev 与 preview 共用：把相对路径的 /api、/uploads 转发到本地后端
const backendProxy = {
  '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
  '/uploads': { target: 'http://127.0.0.1:3001', changeOrigin: true }
}

export default defineConfig({
  plugins: [vue()],
  // 相对 base：产物可部署到域名根或任意子路径
  base: './',
  resolve: {
    // ⚠ 顺序敏感：具体别名必须排在通用别名之前（先匹配先命中）
    alias: [
      // ⓪ 仓库根共享 service 实现（桌面端与手机端共用）
      {
        find: '@shared',
        replacement: fileURLToPath(new URL('../shared', import.meta.url))
      },
      // ① 网页端专用轻量鉴权 store：覆盖桌面端会拖入学习系统的重依赖版本
      {
        find: /^@\/stores\/authStore$/,
        replacement: fileURLToPath(new URL('./src/stores/authStore.ts', import.meta.url))
      },
      // ② 其余 @ 一律指向桌面端源码 → 社区内容与软件零漂移
      { find: '@', replacement: desktopSrc }
    ]
  },
  server: {
    port: 5175, // 与桌面端 5173、手机端 5174 错开，三端可同时运行
    host: '127.0.0.1',
    open: false,
    fs: { allow: ['..'] }, // 允许 dev 模式读取 ../frontend-desktop/src
    proxy: backendProxy
  },
  // 产物预览同样把 /api、/uploads 转发到本地后端（vite preview 不继承 server.proxy）
  preview: {
    port: 4175,
    proxy: backendProxy
  }
})
