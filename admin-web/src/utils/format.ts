// 问星管理后台 — 日期与数字格式化

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 输出 YYYY-MM-DD HH:mm；空值或非法日期返回 — */
export function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const date = new Date(v)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** 千分位数字；空值返回 — */
export function fmtNum(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN')
}
