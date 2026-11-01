// 问星 — 统一日志：时间戳 + 级别 + 模块名，统一走 stdout/stderr
// LOG_LEVEL=debug|info|warn|error 控制输出阈值（默认 info）
// 后续要落文件或接远端采集，只需改这一处
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function write(level, scope, args) {
  if (LEVELS[level] < threshold) return
  const head = `[${stamp()}] ${level.toUpperCase().padEnd(5)} [${scope}]`
  // warn/error 走 stderr，其余走 stdout；保留原始参数以便 Error 自带堆栈
  if (level === 'warn' || level === 'error') console.error(head, ...args)
  else console.log(head, ...args)
}

/**
 * 创建带模块名的日志器
 * @param {string} scope 模块标识，如 'server' / 'db' / 'community'
 */
export function createLogger(scope) {
  return {
    debug: (...args) => write('debug', scope, args),
    info: (...args) => write('info', scope, args),
    warn: (...args) => write('warn', scope, args),
    error: (...args) => write('error', scope, args)
  }
}
