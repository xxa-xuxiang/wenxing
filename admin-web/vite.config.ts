import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// dev 与 preview 共用：把相对路径的 /api、/uploads 转发到本地后端
const backendProxy = {
  '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
  '/uploads': { target: 'http://127.0.0.1:3001', changeOrigin: true }
}

export default defineConfig({
  plugins: [vue()],
  base: './',
  // 跳过 esbuild 语法降级与压缩：规避 Windows 安全软件与 esbuild 临时文件的句柄竞态
  build: {
    target: 'esnext',
    minify: 'terser'
  },
  resolve: {
    // 只指向 admin-web 自身源码：不再依赖 ../frontend-desktop/src
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5176,
    host: '0.0.0.0',
    open: false,
    proxy: backendProxy
  },
  preview: {
    port: 4176,
    host: '0.0.0.0',
    proxy: backendProxy
  }
})
