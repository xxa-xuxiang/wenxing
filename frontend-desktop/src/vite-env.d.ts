/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 从 package.json 注入，与安装包版本保持一致 */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** 云端后端地址（打包注入；留空则桌面端探测本机 3001-3003） */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
