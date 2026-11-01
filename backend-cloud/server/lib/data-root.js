// 问星 — 数据根目录统一解析（唯一真源）
// 桌面端打包后由 Tauri 传入 WENXING_DATA_ROOT；开发时默认 backend-cloud/data
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DATA_ROOT = process.env.WENXING_DATA_ROOT || path.resolve(__dirname, '../../data')
