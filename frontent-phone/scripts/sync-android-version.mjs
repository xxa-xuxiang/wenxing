// 将 package.json 的 version 同步到 Android 原生工程
// versionCode 规则：major * 10000 + minor * 100 + patch（1.1.0 -> 10100）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(pkg.version || ''))
if (!match) {
  console.error(`[android] package.json version 无法解析：${pkg.version}`)
  process.exit(1)
}

const versionName = pkg.version
const versionCode = Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3])
const gradlePath = path.join(root, 'android', 'app', 'build.gradle')

if (!fs.existsSync(gradlePath)) {
  console.error('[android] 未找到 android/app/build.gradle，请先执行 npx cap add android')
  process.exit(1)
}

const before = fs.readFileSync(gradlePath, 'utf8')
const after = before
  .replace(/(versionCode\s+)\d+/, `$1${versionCode}`)
  .replace(/(versionName\s+)"[^"]*"/, `$1"${versionName}"`)

if (after === before && !before.includes(`versionName "${versionName}"`)) {
  console.error('[android] 未匹配到 versionCode/versionName，请检查 build.gradle 结构')
  process.exit(1)
}

fs.writeFileSync(gradlePath, after)
console.log(`[android] versionName=${versionName} versionCode=${versionCode}`)
