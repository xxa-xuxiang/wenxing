/**
 * 场景：主题继承 —— 主窗口切换主题后，新开的工具窗继承；
 *      工具窗已打开时主窗口再切主题，工具窗经 storage 事件实时同步。
 */
import { test, expect } from '../support/fixtures'
import { clickTest, closeTool, gotoNav, openTool, waitForWindowClosed } from '../support/app'
import type { Page } from '@playwright/test'

async function setThemeViaUi(main: Page, theme: 'nebula' | 'midnight' | 'dawn') {
  await gotoNav(main, 'me')
  await clickTest(main, 'me-tab-personal')
  await clickTest(main, `theme-${theme}`)
  await expect(main.locator('html')).toHaveAttribute('data-theme', theme)
}

test.describe('主题继承', () => {
  test('工具窗继承主题并实时同步', async ({ app, main }) => {
    await setThemeViaUi(main, 'midnight')

    const notes = await openTool(app, main, 'notes')
    await expect(notes.locator('html')).toHaveAttribute('data-theme', 'midnight')

    // 主窗口切回默认主题 → 已打开的工具窗经 storage 事件同步
    await clickTest(main, 'theme-nebula')
    await expect(main.locator('html')).toHaveAttribute('data-theme', 'nebula')
    await expect(notes.locator('html')).toHaveAttribute('data-theme', 'nebula')

    await closeTool(notes)
    await waitForWindowClosed(notes)
  })

  test('浅色主题下新开窗口同样继承', async ({ app, main }) => {
    await setThemeViaUi(main, 'dawn')

    const pomo = await openTool(app, main, 'pomodoro')
    await expect(pomo.locator('html')).toHaveAttribute('data-theme', 'dawn')
    await closeTool(pomo)
    await waitForWindowClosed(pomo)
  })

  test.afterEach(async ({ main }) => {
    if (main.isClosed()) return
    await setThemeViaUi(main, 'nebula').catch(() => {})
  })
})
