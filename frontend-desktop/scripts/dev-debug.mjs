// 调试启动器：从调试专用配置读取 WebView2 调试参数，注入环境变量后启动 tauri dev。
//
// 为什么要走环境变量：
//   Tauri 的 app.windows[].additionalBrowserArgs 只作用于配置文件里声明的窗口；
//   运行时用 WebviewWindow 动态创建的番茄钟 / 学习笔记 / Anki 窗口不携带该参数，
//   而它们与主窗口共用同一个 WebView2 用户数据目录 —— 参数不一致时创建会失败
//   （WebView2 error 0x8007139F）。WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 对同进程
//   内所有 WebView2 实例统一生效，静态窗口与动态窗口因此保持一致。
//
// 约束：CDP 端口只写在 src-tauri/tauri.debug.conf.json（plugins.e2e.cdpArgs），
//      主 tauri.conf.json 不含任何调试参数，生产包不会开放调试端口。
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const confPath = resolve(root, 'src-tauri/tauri.debug.conf.json')
const conf = JSON.parse(readFileSync(confPath, 'utf8'))
const args = conf?.plugins?.e2e?.cdpArgs

if (typeof args !== 'string' || !args.trim()) {
  console.error(`[dev:debug] 缺少 plugins.e2e.cdpArgs：${confPath}`)
  process.exit(1)
}

console.log(`[dev:debug] WebView2 调试参数: ${args}`)

const child = spawn('tauri', ['dev', '--config', 'src-tauri/tauri.debug.conf.json'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: args },
  shell: true
})

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
