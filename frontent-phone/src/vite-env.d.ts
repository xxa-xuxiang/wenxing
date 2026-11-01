/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 云端后端地址（打包注入；留空走同源 /api 代理） */
  readonly VITE_API_BASE?: string
}
