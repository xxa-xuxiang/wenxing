/**
 * 场景 1：主窗口加载（真实 exe / WebView2，不是浏览器模拟）
 * 场景 2：标题栏余额框三态渲染
 */
import { test, expect } from '../support/fixtures'
import { setBalanceState } from '../support/app'

test.describe('主窗口', () => {
  test('前置条件：连接真实 Tauri 窗口且已登录', async ({ main }) => {
    expect(
      await main.evaluate(() => '__TAURI_INTERNALS__' in window),
      '当前页面不是 Tauri WebView2 环境，请确认用 npm run dev:debug 启动真实 exe'
    ).toBe(true)

    const hash = await main.evaluate(() => location.hash)
    expect(
      hash,
      '应用停在登录页。请先在调试实例中登录一次，再运行 e2e（测试不负责登录）'
    ).not.toBe('#/auth')
  })

  test('主窗口加载完成：自绘标题栏、工具入口、底部导航均渲染', async ({ main }) => {
    await expect(main.locator('[data-test="app-shell"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar-brand"]')).toContainText('问星')
    await expect(main.locator('[data-test="titlebar-pet"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar-pomodoro"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar-notes"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar-balance"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar-settings"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar-minimize"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar-maximize"]')).toBeVisible()
    await expect(main.locator('[data-test="titlebar-close"]')).toBeVisible()
    await expect(main.locator('[data-test="app-nav"]')).toBeVisible()
  })

  test('余额框三种状态：loading / ok / error', async ({ main }) => {
    const box = main.locator('[data-test="titlebar-balance"]')
    const text = main.locator('[data-test="titlebar-balance-text"]')

    expect(
      await setBalanceState(main, 'loading'),
      '未能定位 TitleBar 的 balanceState（Vue 实例不可达），无法驱动三态'
    ).toBe(true)
    await expect(box).toHaveAttribute('data-test-balance', 'loading')
    await expect(text).toHaveText('加载中…')

    await setBalanceState(main, 'error')
    await expect(box).toHaveAttribute('data-test-balance', 'error')
    await expect(text).toHaveText('--')

    await setBalanceState(main, 'ok')
    await expect(box).toHaveAttribute('data-test-balance', 'ok')
    await expect(text).toHaveText(/^¥\d/)
  })
})
