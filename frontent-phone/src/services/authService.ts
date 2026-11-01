// 问星 — 账号服务：注册 / 登录 / 当前用户〔自桌面端移植〕
// JWT Bearer 鉴权；token 是设备级凭证，存 global 命名空间（不随用户 scope 切换）
import { storage } from '@/utils/storage'
import { http } from './http'

export interface AuthUser {
  id: string
  username: string
  nickname: string
  /** 学习档案 JSON 字符串；null = 首次进入未完善 */
  profile: string | null
  /** 我的邀请码（登录/注册/me 返回；未生成为 null） */
  inviteCode?: string | null
  /** 注册时间（publicUser 返回，ISO 字符串或时间戳） */
  createdAt?: string | number
}

/** 认证类型：权威学者 / 学生 / 企业员工 */
export type VerificationType = 'scholar' | 'student' | 'employee'

/** 认证信息（个人中心「认证」入口提交，暂无后台审核，一律 pending） */
export interface VerificationInfo {
  type: VerificationType
  /** 机构 / 学校 / 企业名称 */
  org: string
  status: 'pending' | 'approved'
  submittedAt: number
}

/** 学习档案结构（ProfileDialog 采集，MeView 展示） */
export interface UserProfile {
  identity: string
  stage: string
  /** 以前学习过的领域（行业名列表，多选；为空 = 零基础起步） */
  domains: string[]
  /** 头像图片地址（可选，/uploads/community/ 相对地址） */
  avatar?: string
  /** 认证信息（可选） */
  verification?: VerificationInfo | null
}

export function getToken(): string {
  return storage.getGlobal<string>('token', '')
}

export function setToken(token: string): void {
  storage.setGlobal('token', token)
}

export function clearToken(): void {
  storage.removeGlobal('token')
}

/** 注册 → 成功自动保存 token 并返回用户；inviteCode 选填（填错不阻断注册，由后端忽略） */
export function register(username: string, password: string, nickname: string, inviteCode = ''): Promise<AuthUser> {
  return http<{ token: string; user: AuthUser }>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, nickname, inviteCode })
  }).then((d) => {
    setToken(d.token)
    return d.user
  })
}

/** 登录 → 成功自动保存 token 并返回用户 */
export function login(username: string, password: string): Promise<AuthUser> {
  return http<{ token: string; user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  }).then((d) => {
    setToken(d.token)
    return d.user
  })
}

/**
 * 用 token 换当前用户（401 = token 失效）；Authorization 由 http 自动注入
 * 必须带超时：路由守卫 await 它，后端卡住会让整页一直停在空白主区。
 */
export function fetchMe(): Promise<AuthUser> {
  return http<{ user: AuthUser }>('/api/auth/me', { timeout: 8000 }).then((d) => d.user)
}

/** 保存学习档案，返回更新后的用户；Authorization 由 http 自动注入 */
export function updateProfile(profile: UserProfile): Promise<AuthUser> {
  return http<{ ok: boolean; user: AuthUser }>('/api/auth/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: JSON.stringify(profile) })
  }).then((d) => d.user)
}
