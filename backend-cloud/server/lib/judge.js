// 问星 v1.1 — 判题工具（服务端版，逻辑对齐旧前端 quizStore）
// 选择题：纯字母答案直接比对；非字母答案映射回选项文本包含判定
const norm = (s) => s.trim().toUpperCase().split('').sort().join('')

export function isChoiceCorrect(userAnswer, q) {
  const user = norm(userAnswer)
  if (!user) return false
  const ansRaw = (q.answer || '').trim()
  const opts = Array.isArray(q.options) ? q.options : []
  const isLetterAns = /^[A-Za-z]+$/.test(ansRaw) && ansRaw.length <= opts.length
  if (isLetterAns) return user === norm(ansRaw)
  return userAnswer
    .toUpperCase()
    .split('')
    .filter(Boolean)
    .every((l) => {
      const idx = l.charCodeAt(0) - 65
      const text = (opts[idx] ?? '').trim()
      return text.length >= 2 && ansRaw.includes(text)
    })
}

/** 简答/编程：关键词命中（P6 将由 LLM 语义判分取代，保留兜底） */
export function keywordCorrect(userAnswer, standardAnswer) {
  const a = (userAnswer || '').trim()
  if (!a) return false
  const keys = (standardAnswer || '')
    .split(/[，,。.；;、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
  return keys.length > 0 && keys.some((k) => a.includes(k))
}

export function judgeAnswer(userAnswer, q) {
  if (q.type === 'single' || q.type === 'multiple') return isChoiceCorrect(userAnswer, q)
  return keywordCorrect(userAnswer, q.answer)
}

/** 百分制（题数口径） */
export function scoreOf(correct, total) {
  return total === 0 ? 0 : Math.round((correct / total) * 100)
}
