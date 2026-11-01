// 问星 v4 — Anki 记忆卡片服务（纯函数，无 store 依赖）
// SM-2 间隔复习算法 + 规则式抽卡（学习文档 / 错题本），全部本地运行、不发网络请求
import type { AnkiCard, LearningDoc, OutlineTask, WrongItem } from '@/types'

/** 一天毫秒数 */
const DAY = 86400000
/** 难度因子下限 */
const MIN_EASE = 1.3
/** 抽卡上限 */
const MAX_CARDS = 20
/** 背面文本截断长度 */
const MAX_BACK = 160
/** 正面（错题）截断长度 */
const MAX_FRONT = 120

/** Markdown 标记清理：链接/图片/引用/标题/列表/行内码/粗斜体 → 纯文本单行 */
function stripMd(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>+\s?/, '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/[*_]/g, '')
    .replace(/^[\s:：,，。;；、·\-—]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 截断到 n 字，末尾加省略号 */
function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length > n ? t.slice(0, n).trimEnd() + '…' : t
}

/** 取一段正文的首个有效要点/首句（跳过空行、分隔线、嵌套标题），去掉 Markdown 记号 */
function firstPoint(bodyLines: string[]): string {
  for (const raw of bodyLines) {
    const line = raw.trim()
    if (!line) continue
    if (/^(-{3,}|\*{3,}|_{3,}|={3,})$/.test(line)) continue
    const clean = stripMd(line)
    if (!clean) continue
    const cut = clean.search(/[。！？!?]/)
    if (cut >= 0 && cut < MAX_BACK) return clean.slice(0, cut + 1)
    return truncate(clean, MAX_BACK)
  }
  return ''
}

/** 生成卡片 id（时间戳 + 随机串，避免同批同毫秒重复） */
function nextId(): string {
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 新建一张卡片（SM-2 初始态：ease 2.5 / interval 0 / reps 0 / lapses 0 / 立即到期）
 * @param source 来源字面量联合，勿用 string
 */
export function newCard(
  front: string,
  back: string,
  source: AnkiCard['source'],
  taskId?: string,
  kpName?: string
): AnkiCard {
  const now = Date.now()
  return {
    id: nextId(),
    front,
    back,
    source,
    taskId,
    kpName,
    createdAt: now,
    dueAt: now,
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0
  }
}

/**
 * SM-2 评分推进（纯函数：返回新对象，不修改入参）
 * 0=重来 1=困难 2=良好 3=简单
 */
export function sm2(card: AnkiCard, grade: 0 | 1 | 2 | 3): AnkiCard {
  let interval = card.interval
  let ease = card.ease
  let reps = card.reps
  let lapses = card.lapses

  if (grade === 0) {
    lapses += 1
    interval = 1
    ease = Math.max(MIN_EASE, ease - 0.2)
  } else if (grade === 1) {
    ease = Math.max(MIN_EASE, ease - 0.15)
    interval = Math.max(1, Math.round(interval * 1.2))
  } else if (grade === 2) {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease)
  } else {
    ease = ease + 0.15
    interval = reps === 0 ? 3 : Math.round(interval * ease * 1.3)
  }

  reps += 1
  return {
    ...card,
    interval,
    ease,
    reps,
    lapses,
    dueAt: Date.now() + interval * DAY
  }
}

/**
 * 从学习文档规则式抽卡：
 * 优先按 Markdown `##` 标题切段（`###` 视作同一层），front = 标题、back = 该段首个要点/首句；
 * 无 `##` 标题时退化为按 `**加粗**` 短语或段落首句抽卡，最多 20 张。
 */
export function cardsFromDoc(doc: LearningDoc, task: OutlineTask): AnkiCard[] {
  const content = doc.content ?? ''
  const kpName = task.kp?.name
  const out: AnkiCard[] = []

  // 1) 按 ## 标题切段
  const sections: { title: string; body: string[] }[] = []
  let cur: { title: string; body: string[] } | null = null
  for (const line of content.split('\n')) {
    const h = line.match(/^\s*#{2,6}\s*(.+?)\s*$/)
    if (h) {
      if (cur) sections.push(cur)
      cur = { title: stripMd(h[1]), body: [] }
    } else if (cur) {
      cur.body.push(line)
    }
  }
  if (cur) sections.push(cur)

  for (const sec of sections) {
    if (!sec.title) continue
    const back = firstPoint(sec.body)
    if (!back) continue
    out.push(newCard(sec.title, back, 'doc', task.id, kpName))
    if (out.length >= MAX_CARDS) return out
  }
  if (out.length > 0) return out

  // 2) 无 ## 标题 → 退化为 **加粗** 短语抽卡
  const boldRe = /\*\*([^*]+)\*\*/g
  let m: RegExpExecArray | null
  while ((m = boldRe.exec(content)) !== null && out.length < MAX_CARDS) {
    const front = stripMd(m[1])
    if (!front) continue
    const rest = content.slice(m.index + m[0].length)
    const tail = rest.split('\n')[0].split('**')[0]
    const back = truncate(stripMd(tail), MAX_BACK)
    if (!back) continue
    out.push(newCard(front, back, 'doc', task.id, kpName))
  }
  if (out.length > 0) return out

  // 3) 退化 → 段落首句抽卡（front = 首句，back = 段内其余）
  const paras = content.split(/\n\s*\n/)
  for (const p of paras) {
    if (out.length >= MAX_CARDS) break
    const clean = stripMd(p.replace(/\n/g, ' '))
    if (!clean) continue
    const cut = clean.search(/[。！？!?]/)
    const front = cut >= 0 ? clean.slice(0, cut + 1) : truncate(clean, 60)
    const back = cut >= 0 ? truncate(clean.slice(cut + 1), MAX_BACK) : ''
    if (!back) continue
    out.push(newCard(front, back, 'doc', task.id, kpName))
  }
  return out
}

/** 从错题条目抽卡：front = 题目 title（无则 body），back = 答案（含解析） */
export function cardsFromWrong(item: WrongItem): AnkiCard {
  const q = item.question
  const front = truncate(q.title?.trim() || q.body?.trim() || '错题', MAX_FRONT)
  const back = `${q.answer}${q.explanation ? '\n' + q.explanation : ''}`
  const kpName = q.knowledgePoints && q.knowledgePoints.length > 0 ? q.knowledgePoints[0] : undefined
  return newCard(front, back, 'wrong', undefined, kpName)
}
