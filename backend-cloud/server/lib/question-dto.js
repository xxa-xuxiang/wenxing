// 问星 v1.1 — 题目 DTO 共享（题库路由 / 试卷路由 / 答题会话路由统一输出格式）
export function safeJson(s, fallback) {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

/** Question 行（含 leaf 关联）→ 前端 DTO（knowledgePoints 保持数组形态，兼容现有 UI 与判分） */
export function toQuestionDTO(q) {
  const leaf = q.leaf || {}
  return {
    id: q.id,
    type: q.type,
    difficulty: q.difficulty,
    title: q.title,
    body: q.body,
    options: safeJson(q.options, []),
    answer: q.answer,
    explanation: q.explanation,
    sources: safeJson(q.sources, []),
    knowledgePoints: leaf.name ? [leaf.name] : [],
    leafKey: leaf.leafKey || '',
    leafName: leaf.name || '',
    industry: leaf.industry || '',
    pathText: leaf.pathText || ''
  }
}

