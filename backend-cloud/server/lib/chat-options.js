// 问星 v1.5 — 聊天选择题协议
// 模型需要用户拍板时，在回复最后单独一行输出 @@OPTIONS@@["A","B"]；
// 后端解析后把协议行从正文剥离，作为结构化 options 返回（解析失败即当普通回复）。
export const OPTIONS_HINT = `

当需要用户做选择时（确认方向、难度、下一步），在回复最后单独一行输出：
@@OPTIONS@@["选项1","选项2"]
要求：2-4 个选项，每个不超过 12 字，不要加序号；普通回答不要输出该行。`

const MARK = /^@@OPTIONS@@\s*(\[[\s\S]*\])\s*$/m

/**
 * 拆分正文与选项
 * @param {string} text 模型原始输出
 * @returns {{ content: string, options: string[] }}
 */
export function splitOptions(text) {
  const raw = String(text ?? '')
  const m = MARK.exec(raw)
  if (!m) return { content: raw.trim(), options: [] }
  let options = []
  try {
    const parsed = JSON.parse(m[1])
    if (Array.isArray(parsed)) {
      options = parsed
        .map((o) => String(o ?? '').trim())
        .filter(Boolean)
        .slice(0, 4)
    }
  } catch {
    return { content: raw.trim(), options: [] }
  }
  if (!options.length) return { content: raw.trim(), options: [] }
  return { content: raw.replace(m[0], '').trim(), options }
}
