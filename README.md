# 问星 Wenxing

> 面向学生的学习与成长应用 —— 学习计划、刷题、错题、阅读、AI 对话与桌宠，集中在一个桌面端 / 移动端 / 云端服务里。

本仓库开放全部应用源码，**仅允许非商业用途**。许可证见 [LICENSE](./LICENSE)。

## 功能

- **学习计划**：长期目标 → 阶段计划 → 每日任务，支持进度追踪与周复盘
- **刷题 / 错题本**：按科目与知识点组织，自动收集错题并生成复习任务
- **星图**：把技能与知识点组织成可点亮的星图，展示掌握度
- **书籍阅读器**：内置 EPUB 阅读器，按格式生成左侧目录树
- **AI 对话**：悬浮球一键唤起独立窗口，支持划词翻译
- **番茄钟 / 笔记 / Anki 卡片**：独立窗口，可自由摆放
- **桌宠**：常驻屏幕右下角，展示在线状态、今日计划、签到与时间
- **管理后台**：用户、题库、审核、计费与审计日志

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面端 | Tauri 2（Rust）+ Vue 3 + TypeScript + Vite |
| 移动端 | Vue 3 + Capacitor（Android） |
| 管理后台 | Vue 3 + TypeScript + Vite |
| 服务端 | Node.js + Express + Prisma |
| 数据 | SQLite（Prisma 管理） |

## 目录结构

```
frontend-desktop/   桌面端（Tauri 壳 + Vue 前端）
frontent-phone/     移动端（Capacitor / Android）
frontend-web/       网页端
admin-web/          管理后台
backend-cloud/      服务端（Node.js + Prisma）、部署脚本
shared/             前后端共享类型与工具
技能分类/            技能与知识点内容
```

## 本地开发

环境要求：Node.js ≥ 20、npm；桌面端另需 Rust 与 Tauri 2 的构建环境；Android 需 JDK 与 Android SDK。

```bash
# 桌面端（前端）
cd frontend-desktop
npm install
npm run dev

# 桌面端（Tauri 窗口）
npm run tauri dev

# 管理后台
cd admin-web
npm install
npm run dev

# 移动端 H5
cd frontent-phone
npm install
npm run dev

# 服务端
cd backend-cloud/server
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev
```

首次启动服务端前，请编辑 `backend-cloud/server/.env`：

- `DEEPSEEK_API_KEY`：填写自己的模型服务 Key，或在管理后台「设置」中录入；
- `JWT_SECRET`、`AI_KEY_ENC_SECRET`：各生成一个 ≥ 32 位的随机串；
- 需要管理后台时，再填写 `ADMIN_USERNAME`、`ADMIN_PASSWORD`（≥ 12 位）与独立的 `ADMIN_JWT_SECRET`。

各前端目录的 `.env.example` 说明了后端地址（`VITE_API_BASE`）的配置方式。

## 部署到自己的服务器

`backend-cloud/deploy/` 提供 Ubuntu 下的初始化与发布脚本：

```bash
sudo SERVER_IP=你的服务器地址 bash backend-cloud/deploy/bootstrap.sh
sudo SERVER_IP=你的服务器地址 bash backend-cloud/deploy/deploy.sh
```

部署前请：

1. 复制 `backend-cloud/server/.env.production.example` 为 `.env`，填入随机密钥与管理员账号；
2. 把 `backend-cloud/deploy/nginx.conf` 中的 `server_name` 改为你的域名或 IP；
3. 把前端打包脚本中的 `VITE_API_BASE` 改为你的后端地址。

## 数据与隐私

仓库不包含任何真实用户数据、数据库、上传文件、教材、题库导出包或签名材料。这些内容只会在本地运行时生成，并已被 `.gitignore` 排除。请勿把自己运行产生的数据提交到公开仓库。

## 许可证

本项目采用 **PolyForm Noncommercial License 1.0.0**：

- 允许个人学习、研究、实验、爱好项目等**非商业用途**的复制、修改与分发；
- 允许非商业组织（教育机构、公益组织、公共研究机构、政府机构等）使用；
- **禁止任何商业用途**。如需商业授权，请与版权方另行联系。

完整条款见 [LICENSE](./LICENSE) 或 <https://polyformproject.org/licenses/noncommercial/1.0.0/>。

第三方依赖、字体与图标仍遵循各自许可证；仓库中的行业分类与技能内容由本项目维护者提供。
