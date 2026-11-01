// 问星 — localStorage 封装（命名空间 + 用户隔离 + 降级）〔自桌面端移植〕
// 普通键随当前登录用户隔离：登录后键名变为 wenxing:v01:u:<userId>:<key>，
// 未登录（legacy/guest）时为 wenxing:v01:<key>；token 等设备级凭证走 global 方法，不随用户切换
const NS = 'wenxing:v01:'

/** 当前用户命名空间（null = 未登录，走 legacy 前缀） */
let userScope: string | null = null

function scopedKey(key: string): string {
  return userScope ? `${NS}u:${userScope}:${key}` : NS + key
}

export const storage = {
  /** 切换用户命名空间（登录成功传 userId，退出传 null）；调用方需随后 reload 各 store */
  setUserScope(id: string | null): void {
    userScope = id
  },
  getUserScope(): string | null {
    return userScope
  },
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(scopedKey(key))
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(scopedKey(key), JSON.stringify(value))
    } catch {
      /* 容量超限或不可用 — 静默降级 */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(scopedKey(key))
    } catch {
      /* noop */
    }
  },
  has(key: string): boolean {
    try {
      return localStorage.getItem(scopedKey(key)) !== null
    } catch {
      return false
    }
  },
  /**
   * 列出当前用户命名空间下、以 prefix 开头（去掉命名空间前缀后）的键名。
   * 用于「学习笔记」这类一个键一条记录的集合型数据。
   */
  keys(prefix: string): string[] {
    const full = scopedKey(prefix)
    const out: string[] = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(full)) out.push(k.slice(full.length))
      }
    } catch {
      /* 不可用 — 返回空 */
    }
    return out
  },

  // ===== 设备级存储（不随用户切换，token 等凭证专用） =====
  getGlobal<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(NS + key)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  setGlobal<T>(key: string, value: T): void {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value))
    } catch {
      /* noop */
    }
  },
  removeGlobal(key: string): void {
    try {
      localStorage.removeItem(NS + key)
    } catch {
      /* noop */
    }
  }
}
