// 问星 — 账号状态 Store〔自桌面端移植〕
// 登录态管理 + 本地数据按用户隔离（storage 用户命名空间）+ 云端同步：
//   登录成功 → 切换到该用户的本地命名空间 → 拉云端进度
//     云端有数据 → 覆盖本地缓存（多端一致 / 换设备）
//     云端为空   → 迁移本机遗留数据（legacy 命名空间）一次性上库
//   退出登录 → 清 token → 切回 legacy 命名空间 → 各界面数据随 reload 清空
// 同步失败静默降级：本地缓存照常可用，答题记录留在队列等待重试
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
import { fetchProgress, pushMastery, putLearning } from '@/services/progressService'
import { storage } from '@/utils/storage'
import { useMasteryStore } from './masteryStore'
import { useLearnStore } from './learnStore'
import { useChatStore } from './chatStore'
import { usePaperStore } from './paperStore'

const LEGACY_NS = 'wenxing:v01:'
/** 无账号时代的业务数据键（迁移到用户命名空间后从 legacy 删除，防止下个账号误继承） */
const LEGACY_DATA_KEYS = [
  'domain',
  'questionnaire',
  'skillGroups',
  'outline',
  'docs',
  'activeTaskId',
  'mastery',
  'masteryPending',
  'onboarded'
]

function readLegacyRaw(key: string): string | null {
  try {
    return localStorage.getItem(LEGACY_NS + key)
  } catch {
    return null
  }
}

/** 判断 legacy 命名空间是否有真实业务数据（非空 mastery / 非空 outline / 已选 domain） */
function legacyHasData(): boolean {
  const m = readLegacyRaw('mastery')
  if (m !== null && m !== '{}') return true
  const o = readLegacyRaw('outline')
  if (o !== null && o !== '[]') return true
  const d = readLegacyRaw('domain')
  if (d !== null && d !== 'null' && d !== '') return true
  return false
}

/** 把 legacy 数据原样拷贝到用户命名空间，并清空 legacy 业务数据（一次性迁移） */
function migrateLegacyToUserScope(userId: string): void {
  const userNs = `${LEGACY_NS}u:${userId}:`
  for (const k of LEGACY_DATA_KEYS) {
    const raw = readLegacyRaw(k)
    if (raw === null) continue
    try {
      localStorage.setItem(userNs + k, raw)
    } catch {
      /* 容量超限：跳过该键 */
    }
  }
  for (const k of LEGACY_DATA_KEYS) {
    try {
      localStorage.removeItem(LEGACY_NS + k)
    } catch {
      /* noop */
    }
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  /** init 是否已执行过（幂等，路由守卫每跳转调用） */
  const initialized = ref(false)
  /** 后端不可达：放行进入本地模式（有 token 但 fetchMe 网络失败时置位） */
  const offline = ref(false)

  /** 切换用户命名空间并重载全部常驻 store（登录/退出/init 恢复时调用，各界面数据随之切换） */
  function switchScopeAndReload(userId: string | null): void {
    storage.setUserScope(userId)
    useMasteryStore().reload()
    useLearnStore().reload()
    useChatStore().reload()
    usePaperStore().reload()
  }

  /** 应用启动 / 首次路由守卫：用本地 token 恢复登录态并切到该用户的命名空间 */
  async function init(): Promise<void> {
    if (initialized.value) return
    initialized.value = true
    if (!getToken()) return
    try {
      const u = await fetchMe()
      user.value = u
      switchScopeAndReload(u.id)
    } catch (e) {
      const status = (e as Error & { status?: number }).status
      if (status === 401) {
        // token 过期/无效：清除后走登录页
        clearToken()
      } else {
        // 后端不可达：本地模式放行（沿用本地缓存数据）
        offline.value = true
      }
    }
  }

  /**
   * 登录/注册成功后的数据同步：
   * 云端有数据 → replay 覆盖本地缓存；云端空 → 迁移 legacy 本机数据一次性上库
   */
  async function syncOnEnter(): Promise<void> {
    if (!user.value) return
    const learn = useLearnStore()
    const mastery = useMasteryStore()
    try {
      const remote = await fetchProgress()
      const remoteEmpty = remote.learning === null && remote.mastery.length === 0
      if (remoteEmpty) {
        // 云端空：迁移本机遗留数据（仅首次），迁移后按当前命名空间推送上库
        if (legacyHasData()) {
          migrateLegacyToUserScope(user.value.id)
          mastery.reload()
          learn.reload()
        }
        const hasLocal =
          learn.outline.length > 0 || learn.selectedDomain !== null || mastery.stats.totalAnswers > 0
        if (hasLocal) {
          await putLearning(learn.snapshotJson())
          const all: { kp: string; ok: boolean; t: number }[] = []
          for (const name of Object.keys(mastery.map)) {
            for (const r of mastery.map[name].records) {
              all.push({ kp: name, ok: r.ok, t: r.t })
            }
          }
          if (all.length > 0) await pushMastery(all)
          // 全量已推送，清空增量队列防止 flush 重推造成云端重复
          mastery.clearPending()
        }
      } else {
        // 云端有数据：覆盖本地缓存（多端一致），云端为全量真源，增量队列作废
        mastery.replayRecords(remote.mastery)
        mastery.clearPending()
        if (remote.learning) learn.loadFromServer(remote.learning)
      }
    } catch {
      /* 同步失败静默：本地缓存照常可用，答题队列会自动重试 */
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const u = await apiLogin(username, password)
    user.value = u
    offline.value = false
    switchScopeAndReload(u.id)
    await syncOnEnter()
  }

  async function register(username: string, password: string, nickname: string, inviteCode = ''): Promise<void> {
    const u = await apiRegister(username, password, nickname, inviteCode)
    user.value = u
    offline.value = false
    switchScopeAndReload(u.id)
    await syncOnEnter()
  }

  /** 保存学习档案（个人中心/引导窗提交后调用） */
  async function saveProfile(profile: UserProfile): Promise<void> {
    user.value = await apiUpdateProfile(profile)
  }

  /** 退出登录：清 token、切回 legacy 命名空间并重载（用户数据留在其专属命名空间与云端） */
  function logout(): void {
    clearToken()
    user.value = null
    switchScopeAndReload(null)
  }

  return { user, initialized, offline, init, login, register, saveProfile, logout }
})
