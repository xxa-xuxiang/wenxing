/**
 * 场景：悬浮窗（桌宠）置顶 + 圆角 + 透明 + 拖动接线。
 * 约束：不测点击穿透；拖拽只验证「移动超过阈值后调用 Tauri startDragging」的接线，
 *      不触发真实原生拖拽（CDP 无法驱动 OS 光标，且原生拖拽会阻塞消息循环）。
 */
import { test, expect } from '../support/fixtures'
import {
  clickTest,
  waitForWindow,
  windowFlags,
  windowGeometry
} from '../support/app'
import type { Page } from '@playwright/test'

/** 给 pet 页面打桩：记录 invoke 调用，并短路 start_dragging，避免进入原生拖拽循环 */
async function instrumentPet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__
    internals.__e2eCalls = []
    internals.__e2eOrigInvoke = internals.invoke
    internals.invoke = (cmd: string, args?: unknown, opts?: unknown) => {
      internals.__e2eCalls.push(cmd)
      if (cmd === 'plugin:window|start_dragging') return Promise.resolve()
      return internals.__e2eOrigInvoke(cmd, args, opts)
    }
  })
}

async function readCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__TAURI_INTERNALS__.__e2eCalls ?? [])
}

async function restorePet(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const internals = (window as any).__TAURI_INTERNALS__
      if (internals.__e2eOrigInvoke) internals.invoke = internals.__e2eOrigInvoke
    })
    .catch(() => {})
}

test.describe('桌宠悬浮窗', () => {
  let pet: Page

  test.beforeEach(async ({ app, main }) => {
    await clickTest(main, 'titlebar-pet')
    pet = await waitForWindow(app, 'pet')
    await expect(pet.locator('[data-test="pet-root"]')).toBeVisible()
  })

  test('悬浮窗置顶、圆角、透明背景', async ({ main }) => {
    const flags = await windowFlags(pet)
    expect(flags.label).toBe('pet')
    expect(flags.visible, '桌宠窗口应已显示').toBe(true)
    expect(flags.alwaysOnTop, '桌宠窗口应置顶').toBe(true)

    // 初始 idle 尺寸为 48×48 逻辑像素；Tauri 返回物理像素，按 DPR 折算
    const geometry = await windowGeometry(pet)
    // 已知局限：Windows 存在最小窗口追踪宽度（实测约 122 逻辑像素），无边框透明窗口的
    // 宽度会被系统抬到该下限，因此宽度只校验「不小于 idle 尺寸」，高度精确校验。
    const idle = 48 * geometry.dpr
    expect(geometry.width).toBeGreaterThanOrEqual(idle - 4)
    expect(Math.abs(geometry.height - 48 * geometry.dpr)).toBeLessThanOrEqual(4)

    const style = await pet.evaluate(() => {
      const orb = document.querySelector('[data-test="pet-orb"]') as HTMLElement | null
      if (!orb) return null
      return {
        radius: getComputedStyle(orb).borderRadius,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        petWindowClass: document.documentElement.classList.contains('wx-pet-window')
      }
    })
    expect(style, '未找到悬浮球').not.toBeNull()
    expect(style!.radius).toContain('50%')
    expect(style!.petWindowClass, '桌宠窗口应带 wx-pet-window 标记').toBe(true)
    // 透明：html / body 背景 alpha 必须为 0
    expect(style!.htmlBg).toBe('rgba(0, 0, 0, 0)')
    expect(style!.bodyBg).toBe('rgba(0, 0, 0, 0)')

    // 悬浮窗依附主窗口存在，主窗口仍在
    await expect(main.locator('[data-test="app-shell"]')).toBeVisible()
  })

  test('悬浮球拖动超过阈值后调用 Tauri startDragging（不触发点击展开）', async () => {
    await instrumentPet(pet)
    try {
      const orb = pet.locator('[data-test="pet-orb"]')
      const box = await orb.boundingBox()
      expect(box).not.toBeNull()
      const startX = box!.x + box!.width / 2
      const startY = box!.y + box!.height / 2

      await pet.mouse.move(startX, startY)
      await pet.mouse.down()
      await pet.mouse.move(startX + 16, startY + 14, { steps: 5 })
      await pet.mouse.up()
      await pet.waitForTimeout(300)

      const calls = await readCalls(pet)
      expect(calls).toContain('plugin:window|start_dragging')
      // 拖动不是点击，聊天面板不应被展开
      await expect(pet.locator('[data-test="pet-chat-panel"]')).toHaveCount(0)
    } finally {
      await restorePet(pet)
    }
  })
})
