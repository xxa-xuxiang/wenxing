/**
 * Playwright 测试夹具：
 * - 每个用例建立一次 CDP 连接（不关闭应用；绝不调用 browser.close，避免连带关闭 WebView2）
 * - 用例失败时给所有已连接窗口补拍截图，作为失败现场
 */
import { test as base, type Page, type TestInfo } from '@playwright/test'
import {
  connectApp,
  getMainPage,
  pagesOf,
  windowKind,
  type AppConnection
} from './app'

interface Fixtures {
  app: AppConnection
  main: Page
}

export const test = base.extend<Fixtures>({
  app: async ({}, use) => {
    const app = await connectApp()
    // 注意：CDP 连接的 browser.close() 可能关闭宿主 WebView2，故不在此关闭
    await use(app)
  },
  main: async ({ app }, use) => {
    await use(await getMainPage(app))
  }
})

export { expect } from '@playwright/test'

/** 失败现场：逐窗口截图 + 记录 URL 清单 */
test.afterEach(async ({ app }, testInfo: TestInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  const urls: string[] = []
  for (const page of pagesOf(app)) {
    const kind = windowKind(page) ?? 'other'
    urls.push(`${kind} | ${page.url()}`)
    await page
      .screenshot({ path: testInfo.outputPath(`failure-${kind}.png`) })
      .catch(() => {})
  }
  await testInfo.attach('open-windows.txt', {
    body: urls.join('\n') || '(无)',
    contentType: 'text/plain'
  })
})
