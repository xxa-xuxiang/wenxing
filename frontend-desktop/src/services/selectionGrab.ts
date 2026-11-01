// 问星 v1.5 — Tauri 取词通道封装
// 非 Tauri 环境（浏览器开发）全部降级为空格 / 空操作，调用方无需判断环境
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/composables/useTauriWindow'

/** 抓取当前应用外的选区文本（模拟 Ctrl+C + 剪贴板比对）；失败返回空串 */
export async function grabSelection(): Promise<string> {
  if (!isTauri()) return ''
  try {
    return (await invoke<string>('grab_selection')) ?? ''
  } catch {
    return ''
  }
}

/** 读取系统剪贴板 */
export async function readClipboard(): Promise<string> {
  if (!isTauri()) return ''
  try {
    return (await invoke<string>('read_clipboard')) ?? ''
  } catch {
    return ''
  }
}

/** 写入系统剪贴板 */
export async function writeClipboard(text: string): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke('write_clipboard', { text })
  } catch (e) {
    console.warn('[translate] 写剪贴板失败：', e)
  }
}
