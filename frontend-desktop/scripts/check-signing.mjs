// 签名构建预检：证书指纹未配置时直接失败，避免构建到打包阶段才报错
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const confPath = path.join(root, 'src-tauri', 'tauri.signing.conf.json')
const examplePath = path.join(root, 'src-tauri', 'tauri.signing.conf.json.example')

function fail(message) {
  console.error(`[signing] ${message}`)
  console.error('[signing] 签名构建已中止；如需未签名安装包请执行：npm run build:desktop')
  process.exit(1)
}

if (!fs.existsSync(confPath)) {
  fail(`未找到 src-tauri/tauri.signing.conf.json。请先复制 ${path.basename(examplePath)} 为 tauri.signing.conf.json，并填入证书 SHA1 指纹。`)
}

let conf
try {
  conf = JSON.parse(fs.readFileSync(confPath, 'utf8'))
} catch (err) {
  fail(`tauri.signing.conf.json 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`)
}

const thumbprint = String(conf?.bundle?.windows?.certificateThumbprint ?? '')
  .replace(/\s+/g, '')
  .toUpperCase()

if (!thumbprint || /在这里填|填代码签名|PLACEHOLDER/.test(thumbprint)) {
  fail('certificateThumbprint 仍是占位文本，请在 certmgr.msc 中查看证书指纹并填入。')
}
if (!/^[0-9A-F]{40}$/.test(thumbprint)) {
  fail(`certificateThumbprint 应为 40 位十六进制 SHA1 指纹，当前为 ${thumbprint.length} 位。`)
}

console.log(`[signing] 已检测到代码签名证书指纹：${thumbprint.slice(0, 8)}…`)
