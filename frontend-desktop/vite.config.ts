import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// 版本号唯一来源：package.json（tauri.conf.json 的 version 也指向该文件）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Vite 配置：路径别名 + /api 代理到本地后端（DeepSeek 代理与文档存档）
// 代理目标可用 VITE_PROXY_TARGET 覆盖：本地后端未启动时指向云端方便预览
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3001'

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 仓库根共享目录（与手机端共用的 service 实现）
      '@shared': fileURLToPath(new URL('../shared', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    open: false,
    // dev 需读取仓库根 shared/（桌面端与手机端共用 service），放开上一级目录
    fs: { allow: ['..'] },
    // 忽略 Tauri 壳层目录：cargo 编译会使 vite watcher 报 EBUSY 崩溃
    // tauri dev 下 cargo 边写 target、vite 原生 watcher 边监听 → 用轮询绕开（仅 tauri dev 生效）
    watch: {
      ignored: (path: string) => path.replace(/\\/g, '/').includes('/src-tauri/'),
      usePolling: Boolean(process.env.TAURI_ENV_PLATFORM),
      interval: 1000
    },
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true
      },
      '/uploads': {
        target: PROXY_TARGET,
        changeOrigin: true
      }
    }
  },
  build: {
    // 用 terser 替代 esbuild 压缩：esbuild 大输出经 Go 临时文件中转，
    // Windows 杀软实时扫描锁文件导致 [vite:esbuild-transpile] remove Access is denied；
    // terser 为纯 JS 实现、无临时文件，可稳定出包（dev 不走压缩不受影响）。
    // target 必须 esnext：否则 Vite 在压缩前还会调 esbuild 做语法降级转译，同样踩锁
    target: 'esnext',
    minify: 'terser',
    rollupOptions: {
      output: {
        // 行业分类 md 正文约 465KB，按需加载、内容稳定可长期缓存，避免拖累应用外壳 chunk
        manualChunks(id: string) {
          if (id.includes('.md')) return 'industry-md'
        }
      }
    }
  }
})
