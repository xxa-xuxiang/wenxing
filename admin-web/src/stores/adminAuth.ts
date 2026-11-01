import { defineStore } from 'pinia'
import { getToken, setToken, clearToken, ApiError } from '../services/http'
import { loginAdmin, getAdminMe, logoutAdmin } from '../services/adminApi'

export const useAdminAuthStore = defineStore('adminAuth', {
  state: () => ({
    token: '',
    username: '',
    initialized: false
  }),
  actions: {
    async login(username: string, password: string) {
      const res = await loginAdmin(username, password)
      setToken(res.token)
      this.token = res.token
      this.username = res.username
      try {
        const me = await getAdminMe()
        this.username = me.username
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          clearToken()
          this.token = ''
          this.username = ''
          throw e
        }
      }
      this.initialized = true
    },
    async init() {
      if (this.initialized) {
        // 其他请求收到 401 会清除本地 token，这里同步状态，避免守卫误判为已登录
        if (!getToken() && this.token) {
          this.token = ''
          this.username = ''
        }
        return
      }
      const token = getToken()
      if (!token) {
        this.token = ''
        this.initialized = true
        return
      }
      this.token = token
      try {
        const me = await getAdminMe()
        this.username = me.username
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          clearToken()
          this.token = ''
          this.username = ''
        }
      }
      this.initialized = true
    },
    async logout() {
      // 先通知服务端吊销 jti（尽力而为：失败也不阻塞本地登出）
      try {
        await logoutAdmin()
      } catch {
        // 网络失败 / token 已失效时忽略，本地照常清理
      }
      clearToken()
      this.token = ''
      this.username = ''
      this.initialized = true
      const { default: router } = await import('../router')
      if (router.currentRoute.value.path !== '/login') {
        await router.push('/login')
      }
    }
  }
})
