// 问星社区网页端 — 轻量鉴权 store
// 仅覆盖社区所需表面；不牵连 learnStore / chatStore / paperStore / masteryStore
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  clearToken,
  fetchMe,
  getToken,
  login as apiLogin,
  register as apiRegister,
  updateProfile as apiUpdateProfile,
  type AuthUser,
  type UserProfile
} from '@/services/authService'
import { storage } from '@/utils/storage'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const initialized = ref(false)
  const offline = ref(false)

  /** 用本地 token 恢复登录态；同时切到该用户的存储命名空间（社区草稿等按用户隔离） */
  async function init(): Promise<void> {
    if (initialized.value) return
    initialized.value = true
    if (!getToken()) return
    try {
      const u = await fetchMe()
      user.value = u
      storage.setUserScope(u.id)
    } catch (e) {
      const status = (e as Error & { status?: number }).status
      if (status === 401) clearToken()
      else offline.value = true
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const u = await apiLogin(username, password)
    user.value = u
    offline.value = false
    storage.setUserScope(u.id)
  }

  async function register(username: string, password: string, nickname: string, inviteCode = ''): Promise<void> {
    const u = await apiRegister(username, password, nickname, inviteCode)
    user.value = u
    offline.value = false
    storage.setUserScope(u.id)
  }

  async function saveProfile(profile: UserProfile): Promise<void> {
    user.value = await apiUpdateProfile(profile)
  }

  function logout(): void {
    clearToken()
    user.value = null
    storage.setUserScope(null)
  }

  return { user, initialized, offline, init, login, register, saveProfile, logout }
})
