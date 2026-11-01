/**
 * 场景：主窗口最小化 / 最大化；最大化后图标同步为「还原」态并再次点击还原。
 * 说明：主窗口关闭按钮会结束整个应用进程，与「测试不负责启停」冲突，
 *      因此这里只校验按钮存在；真正的关闭/重开流程在工具窗用例中覆盖。
 */
import { test, expect } from '../support/fixtures'
import { clickTest, resetMainWindow, tauriInvoke, windowFlags, windowLabel } from '../support/app'

test.afterEach(async ({ main }) => {
  if (main.isClosed()) return
  await resetMainWindow(main).catch(() => {})
})

test.describe('窗口控制', () => {
  test('最小化主窗口', async ({ main }) => {
    await resetMainWindow(main)
    await clickTest(main, 'titlebar-minimize')
    await expect
      .poll(async () => (await windowFlags(main)).minimized, { timeout: 8_000 })
      .toBe(true)

    await tauriInvoke(main, 'plugin:window|unminimize', { label: await windowLabel(main) })
    await expect
      .poll(async () => (await windowFlags(main)).minimized, { timeout: 8_000 })
      .toBe(false)
  })

  test('最大化后图标同步还原态，再次点击还原', async ({ main }) => {
    await resetMainWindow(main)
    const maxBtn = main.locator('[data-test="titlebar-maximize"]')
    await expect(maxBtn).toHaveAttribute('data-test-state', 'maximize')

    await maxBtn.click()
    await expect
      .poll(async () => (await windowFlags(main)).maximized, { timeout: 8_000 })
      .toBe(true)
    await expect(maxBtn).toHaveAttribute('data-test-state', 'restore')

    await maxBtn.click()
    await expect
      .poll(async () => (await windowFlags(main)).maximized, { timeout: 8_000 })
      .toBe(false)
    await expect(maxBtn).toHaveAttribute('data-test-state', 'maximize')
  })

  test('主窗口关闭按钮存在（不执行，执行会退出应用）', async ({ main }) => {
    await expect(main.locator('[data-test="titlebar-close"]')).toBeVisible()
  })
})
