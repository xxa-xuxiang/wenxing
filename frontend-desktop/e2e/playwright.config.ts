/**
 * 问星桌面端 — 真窗口 E2E（Playwright + WebView2 CDP）
 *
 * 前置：应用必须已由 npm run dev:debug 启动（调试配置开放 9222），
 * 测试进程只连接、不负责启停。
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  // 真窗口共享同一套原生窗口/焦点状态，必须单 worker 串行
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: './test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './report', open: 'never' }]
  ],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // 失败保留截图（support/fixtures.ts 还会对所有已连接窗口补拍）
    screenshot: 'only-on-failure',
    trace: 'off'
  }
})
