import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'
import { fileURLToPath, URL } from 'node:url'

// 问星移动端 H5 — Vite 配置
// 调试链路：host 0.0.0.0 供真机局域网访问；/api 与 /uploads 代理到本地后端（代理发生在 PC 侧，手机无跨域问题）
export default defineConfig({
  plugins: [
    vue(),
    Components({ resolvers: [VantResolver()] })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 仓库根共享目录（与桌面端共用的 service 实现）
      '@shared': fileURLToPath(new URL('../shared', import.meta.url))
    }
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
    open: false,
    // dev 需读取仓库根 shared/
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    // esnext：跳过 vite 的 esbuild renderChunk 转译（本机 esbuild 对 >600KB chunk 走临时文件
    // 路径，与安全软件有句柄竞态导致 "Access is denied"）；移动端现代浏览器原生支持 ES2020+
    target: 'esnext',
    // terser 压缩：纯 JS 进内处理，不经过 esbuild
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      output: {
        // 独立分包：Three.js 引擎（仅星图使用）与 Vant 组件库按需缓存，避免拖累应用外壳 chunk
        manualChunks(id: string) {
          if (id.includes('node_modules/three/')) return 'vendor-three'
          if (id.includes('node_modules/vant/')) return 'vendor-vant'
        }
      }
    }
  }
})
