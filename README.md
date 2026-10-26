# 问星 Wenxing

> 面向学生的学习与成长桌面应用 —— 计划、刷题、错题、阅读、AI 对话，全部收进一个桌面端。

## 下载安装

安装包体积较大，统一放在 **Releases** 页面，不随仓库分发：

- 打开仓库右侧的 [Releases](../../releases) 页面
- 下载 `wenxing-1.1.0-win64-setup.exe`（推荐，一键安装）
- 或下载 `wenxing-1.1.0-win64-full.zip`（免安装，解压后双击 `安装.bat`）
- Android 版：`wenxing-1.1.0-android.apk`

下载后可用 Releases 中附带的 `SHA256SUMS.txt` 校验文件完整性：

```powershell
Get-FileHash .\wenxing-1.1.0-win64-setup.exe -Algorithm SHA256
```

### Windows 安装步骤

本应用基于 Tauri 2 构建，需要 WebView2 运行时（Win10/11 通常已内置）。

1. 下载 `wenxing-1.1.0-win64-setup.exe`，双击安装；
2. 若使用「完整包」：**先把 zip 完整解压到一个文件夹**，再双击解压后文件夹里的 `安装.bat`（直接在压缩包预览窗口里双击会提示找不到 `wenxing.exe`）；
3. 安装完成后桌面会出现「问星」快捷方式，右下角同时出现桌宠悬浮球。

## 功能

- **学习计划**：长期目标 → 阶段计划 → 每日任务，支持进度追踪与周复盘
- **刷题 / 错题本**：按科目与知识点组织，自动收集错题并生成复习任务
- **书籍阅读器**：内置 EPUB 阅读器，按格式生成左侧目录树
- **AI 对话**：悬浮球一键唤起独立对话窗口，支持划词翻译（`Ctrl+Shift+T`）
- **番茄钟 / 笔记 / Anki 卡片**：独立窗口，可自由摆放
- **桌宠**：常驻屏幕右下角，鼠标悬停展开状态胶囊（在线状态 / 今日计划 / 签到 / 时间），右键菜单可置顶、固定、隐藏

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面端 | Tauri 2（Rust）+ Vue 3 + TypeScript + Vite |
| 管理后台 | Vue 3 + TypeScript + Vite |
| 移动端 | Android（Capacitor 打包 Web 前端） |
| 服务端 | Node.js + Express + Prisma |
| 数据 | SQLite / PostgreSQL（由 Prisma 管理） |

## 项目结构

```
frontend-desktop/   桌面端（Tauri 壳 + Vue 前端）
frontend-web/       网页端
admin-web/          管理后台
frontent-phone/     移动端（Android）
backend-cloud/      云端服务（Node.js + Prisma）
shared/             前后端共享的类型与工具
```

## 本地开发

```bash
# 桌面端前端
cd frontend-desktop
npm install
npm run dev

# 桌面端（Tauri）
npm run tauri dev

# 服务端
cd backend-cloud/server
npm install
npx prisma migrate dev
npm run dev
```

## 版本

当前版本 **1.1.0**。变更记录见 Releases 页面。

## 说明

本仓库仅保留 README 与版本说明；应用源码为私有，不在本仓库分发。
