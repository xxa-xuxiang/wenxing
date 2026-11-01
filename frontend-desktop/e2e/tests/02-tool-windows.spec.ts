/**
 * 场景：标题栏图标打开番茄钟 / 学习笔记独立窗口；学习页顶栏打开 Anki；
 *      重复点击聚焦已有窗口而非新建；关闭后可重开。
 * 清理：每个用例结束后关闭本用例打开的独立窗口。
 */
import { test, expect } from '../support/fixtures'
import {
  clickTest,
  closeAllTools,
  closeTool,
  findWindow,
  openTool,
  pagesOf,
  tauriInvoke,
  waitForWindow,
  waitForWindowClosed,
  windowFlags,
  windowKind,
  windowLabel
} from '../support/app'

test.afterEach(async ({ app }) => {
  await closeAllTools(app)
})

test.describe('功能独立窗口', () => {
  test('标题栏图标打开番茄钟与学习笔记窗口', async ({ app, main }) => {
    const pomo = await openTool(app, main, 'pomodoro')
    await expect(pomo.locator('[data-test="tool-window"]')).toHaveAttribute('data-test-tool', 'pomodoro')
    await expect(pomo.locator('[data-test="tool-title"]')).toHaveText('番茄钟')
    await expect(pomo.locator('[data-test="panel-pomodoro"]')).toBeVisible()
    await closeTool(pomo)
    await waitForWindowClosed(pomo)

    const notes = await openTool(app, main, 'notes')
    await expect(notes.locator('[data-test="tool-window"]')).toHaveAttribute('data-test-tool', 'notes')
    await expect(notes.locator('[data-test="tool-title"]')).toHaveText('学习笔记')
    await expect(notes.locator('[data-test="panel-notes"]')).toBeVisible()
  })

  test('学习页顶栏打开 Anki 窗口', async ({ app, main }) => {
    const anki = await openTool(app, main, 'anki')
    await expect(anki.locator('[data-test="tool-window"]')).toHaveAttribute('data-test-tool', 'anki')
    await expect(anki.locator('[data-test="tool-title"]')).toHaveText('Anki 记忆卡片')
    await expect(anki.locator('[data-test="panel-anki"]')).toBeVisible()
  })

  test('重复点击聚焦已有窗口而非新建', async ({ app, main }) => {
    const pomo = await openTool(app, main, 'pomodoro')
    const label = await windowLabel(pomo)
    expect(label).toBe('pomodoro')

    // 先把窗口最小化，制造「再次点击应当还原并聚焦」的初态
    await tauriInvoke(pomo, 'plugin:window|minimize', { label })
    await expect
      .poll(async () => (await windowFlags(pomo)).minimized, { timeout: 5_000 })
      .toBe(true)

    // 让应用处于前台，避免 Windows 前台锁定干扰焦点断言
    await main.bringToFront()
    await tauriInvoke(main, 'plugin:window|set_focus', { label: await windowLabel(main) }).catch(() => {})
    await clickTest(main, 'titlebar-pomodoro')

    await expect
      .poll(async () => (await windowFlags(pomo)).minimized, { timeout: 8_000 })
      .toBe(false)
    // 已知局限：CDP 注入的点击不算 Windows 前台输入，系统会拒绝 SetForegroundWindow，
    // is_focused 恒为 false；改用「已还原且可见」验证聚焦到了已有实例。
    await expect
      .poll(async () => (await windowFlags(pomo)).visible, { timeout: 8_000 })
      .toBe(true)

    // 没有新建：种类相同的窗口只有一个，且仍是同一个 page 实例
    const sameKind = pagesOf(app).filter((p) => windowKind(p) === 'pomodoro')
    expect(sameKind).toHaveLength(1)
    expect(findWindow(app, 'pomodoro')).toBe(pomo)
  })

  test('关闭后可重开（同一 label 重建为新窗口）', async ({ app, main }) => {
    const first = await openTool(app, main, 'pomodoro')
    await closeTool(first)
    await waitForWindowClosed(first)

    await clickTest(main, 'titlebar-pomodoro')
    const second = await waitForWindow(app, 'pomodoro')
    expect(second).not.toBe(first)
    expect(second.isClosed()).toBe(false)
    await expect(second.locator('[data-test="panel-pomodoro"]')).toBeVisible()
  })
})
