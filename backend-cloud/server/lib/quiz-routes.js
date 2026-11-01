// 问星 v1.1 — 试卷与答题会话路由
// 试卷：Paper + PaperItem（题目以 ID 引用，不再内嵌整题 JSON）
// 会话：交卷时服务端判分并写 QuizSession + QuizAnswer（含题目快照，题目后续修订不影响历史复盘）
// 分析：交卷后 POST /api/quiz/sessions/:id/analyze 生成「关键错题精讲 + 薄弱点 + 总评」并落库
import { db } from './db.js'
import { wrap, deepseek } from './ai.js'
import { takeAiQuota } from './ai-guard.js'
import { auth, optionalAuth } from './auth.js'
import { toQuestionDTO } from './question-dto.js'
import { judgeAnswer, scoreOf } from './judge.js'

/** 组装试卷 DTO（含题目列表，顺序即题序） */
async function paperDTO(paperId) {
  const paper = await db.paper.findUnique({
    where: { id: paperId },
    include: {
      items: {
        orderBy: { order: 'asc' },
        include: { question: { include: { leaf: true } } }
      }
    }
  })
  if (!paper) return null
  return {
    id: paper.id,
    title: paper.title,
    createdAt: paper.createdAt.getTime(),
    scope: safeList(paper.scope),
    scorePer: paper.scorePer,
    totalScore: paper.scorePer * paper.items.length,
    questions: paper.items.map((it) => toQuestionDTO(it.question))
  }
}

function safeList(s) {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export default function registerQuizRoutes(app) {
  // ===== 试卷：创建（题目 ID 引用，仅接受 verified 题） =====
  app.post(
    '/api/papers',
    auth,
    wrap(async (req, res) => {
      const body = req.body ?? {}
      const ids = Array.isArray(body.questionIds) ? body.questionIds.map(String) : []
      if (ids.length === 0) throw new Error('缺少题目（questionIds 为空）')
      const rows = await db.question.findMany({
        where: { id: { in: ids }, status: 'verified' },
        select: { id: true }
      })
      const valid = rows.map((r) => r.id)
      if (valid.length === 0) throw new Error('所选题目均已下架，请重新选题')
      const scorePer = Math.max(1, Math.min(100, Math.round(Number(body.scorePer) || 5)))
      const paper = await db.paper.create({
        data: {
          userId: req.user.id,
          title: String(body.title || '未命名测评卷').slice(0, 80),
          scope: JSON.stringify(Array.isArray(body.scope) ? body.scope : []),
          scorePer
        }
      })
      // 保持用户选题顺序
      await db.paperItem.createMany({
        data: valid.map((qid, i) => ({ paperId: paper.id, questionId: qid, order: i, score: scorePer }))
      })
      res.json({ paper: await paperDTO(paper.id), dropped: ids.length - valid.length })
    })
  )

  // ===== 试卷：我的列表（仅标题与题量，不含题目正文） =====
  app.get(
    '/api/papers',
    auth,
    wrap(async (req, res) => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
      const rows = await db.paper.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { _count: { select: { items: true } } }
      })
      res.json({
        items: rows.map((p) => ({
          id: p.id,
          title: p.title,
          createdAt: p.createdAt.getTime(),
          scope: safeList(p.scope),
          scorePer: p.scorePer,
          questionCount: p._count.items,
          totalScore: p.scorePer * p._count.items
        }))
      })
    })
  )

  // ===== 试卷：详情（含题目） =====
  app.get(
    '/api/papers/:id',
    auth,
    wrap(async (req, res) => {
      const row = await db.paper.findUnique({ where: { id: String(req.params.id) }, select: { id: true, userId: true } })
      if (!row) throw new Error('试卷不存在')
      // 试卷为个人资产，禁止凭 id 越权读取他人试卷
      if (row.userId && row.userId !== req.user.id) {
        res.status(403).json({ error: '无权访问该试卷' })
        return
      }
      const paper = await paperDTO(row.id)
      if (!paper) throw new Error('试卷不存在')
      res.json({ paper })
    })
  )

  // ===== 试卷：删除 =====
  app.delete(
    '/api/papers/:id',
    auth,
    wrap(async (req, res) => {
      const paper = await db.paper.findFirst({ where: { id: String(req.params.id), userId: req.user.id } })
      if (!paper) throw new Error('试卷不存在或无权删除')
      await db.paper.delete({ where: { id: paper.id } })
      res.json({ ok: true })
    })
  )

  // ===== 答题会话：交卷（服务端判分 + 归档明细） =====
  app.post(
    '/api/quiz/sessions',
    optionalAuth,
    wrap(async (req, res) => {
      const body = req.body ?? {}
      const answers = Array.isArray(body.answers) ? body.answers : []
      if (answers.length === 0) throw new Error('缺少作答内容（answers 为空）')
      const ids = answers.map((a) => String(a.questionId))
      const rows = await db.question.findMany({
        where: { id: { in: ids } },
        include: { leaf: true }
      })
      const qMap = new Map(rows.map((q) => [q.id, q]))

      const paper = body.paperId ? await db.paper.findUnique({ where: { id: String(body.paperId) } }) : null
      const scorePer = paper ? paper.scorePer : Math.max(0, Math.round(Number(body.scorePer) || 0))

      const details = []
      for (const a of answers) {
        const q = qMap.get(String(a.questionId))
        if (!q) continue
        const userAnswer = String(a.userAnswer ?? '').slice(0, 4000)
        const correct = judgeAnswer(userAnswer, q)
        details.push({ q, userAnswer, correct })
      }
      if (details.length === 0) throw new Error('作答题目均已下架，无法判分')

      const correctCount = details.filter((d) => d.correct).length
      const kpAgg = new Map()
      for (const d of details) {
        const name = d.q.leaf?.name || '未归类'
        const e = kpAgg.get(name) ?? { name, total: 0, correct: 0 }
        e.total += 1
        if (d.correct) e.correct += 1
        kpAgg.set(name, e)
      }
      const kpReview = [...kpAgg.values()]
        .map((e) => ({ ...e, rate: e.total === 0 ? 0 : Math.round((e.correct / e.total) * 100) }))
        .sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name))

      const session = await db.quizSession.create({
        data: {
          userId: req.user?.id ?? null,
          paperId: paper?.id ?? null,
          leafKey: body.leafKey ? String(body.leafKey) : null,
          title: String(body.title || paper?.title || '练习').slice(0, 80),
          total: details.length,
          correctCount,
          score: scoreOf(correctCount, details.length),
          earnedScore: scorePer * correctCount,
          totalScore: scorePer * details.length,
          kpReview: JSON.stringify(kpReview)
        }
      })
      await db.quizAnswer.createMany({
        data: details.map((d) => ({
          sessionId: session.id,
          questionId: d.q.id,
          questionSnapshot: JSON.stringify(toQuestionDTO(d.q)),
          userAnswer: d.userAnswer,
          correct: d.correct,
          scoreEarned: d.correct ? scorePer : 0
        }))
      })

      res.json({
        session: {
          id: session.id,
          title: session.title,
          total: session.total,
          correctCount,
          score: session.score,
          earnedScore: session.earnedScore,
          totalScore: session.totalScore,
          kpReview,
          createdAt: session.createdAt.getTime()
        },
        results: details.map((d) => ({
          questionId: d.q.id,
          correct: d.correct,
          userAnswer: d.userAnswer,
          question: toQuestionDTO(d.q)
        }))
      })
    })
  )

  // ===== 答题会话：详情（历史复盘） =====
  app.get(
    '/api/quiz/sessions/:id',
    optionalAuth,
    wrap(async (req, res) => {
      const s = await db.quizSession.findUnique({
        where: { id: String(req.params.id) },
        include: { answers: true }
      })
      if (!s) throw new Error('答题记录不存在')
      if (s.userId && s.userId !== req.user?.id) throw new Error('无权查看该答题记录')
      res.json({
        session: {
          id: s.id,
          title: s.title,
          total: s.total,
          correctCount: s.correctCount,
          score: s.score,
          earnedScore: s.earnedScore,
          totalScore: s.totalScore,
          kpReview: safeList(s.kpReview),
          analysis: s.analysis ? JSON.parse(s.analysis) : null,
          createdAt: s.createdAt.getTime()
        },
        answers: s.answers.map((a) => ({
          questionId: a.questionId,
          question: JSON.parse(a.questionSnapshot || '{}'),
          userAnswer: a.userAnswer,
          correct: a.correct,
          judgeNote: a.judgeNote
        }))
      })
    })
  )

  // ===== 答题会话：交卷后深度分析（关键错题精讲 + 薄弱知识点 + 总评） =====
  app.post(
    '/api/quiz/sessions/:id/analyze',
    optionalAuth,
    wrap(async (req, res) => {
      const s = await db.quizSession.findUnique({
        where: { id: String(req.params.id) },
        include: { answers: { include: { question: { include: { leaf: true } } } } }
      })
      if (!s) throw new Error('答题记录不存在')
      if (s.userId && s.userId !== req.user?.id) throw new Error('无权分析该答题记录')
      if (s.analysis) {
        res.json({ analysis: JSON.parse(s.analysis), cached: true })
        return
      }
      const wrong = s.answers.filter((a) => a.correct === false)
      if (wrong.length === 0) {
        const perfect = {
          wrongItems: [],
          keyItems: [],
          weakPoints: [],
          overall: `本次 ${s.total} 题全部答对（${s.score} 分），说明该范围已形成稳定理解。建议把题量提到 20 题以上并覆盖更高难度，检验迁移能力。`,
          nextSteps: ['提高难度档位再测一轮', '尝试不看解析复述关键概念']
        }
        await db.quizSession.update({ where: { id: s.id }, data: { analysis: JSON.stringify(perfect) } })
        res.json({ analysis: perfect, cached: false })
        return
      }

      const Q_MAX = 12 // 控制 prompt 规模：最多分析 12 道错题
      const wrongBrief = wrong.slice(0, Q_MAX).map((a, i) => {
        const q = JSON.parse(a.questionSnapshot || '{}')
        const src = (q.sources || []).map((x) => `${x.title} ${x.url}`).join(' / ') || '（无出处）'
        return `${i + 1}. 【${q.leafName || '未归类'}｜${q.type}】${q.title}
题干：${q.body}
标准答案：${q.answer}
用户作答：${a.userAnswer || '（未作答）'}
原解析：${q.explanation || '（无）'}
出处：${src}`
      })

      // 分析结果有缓存；未命中时才调平台 AI，先过统一闸门
      if (!(await takeAiQuota(req, res, 'chat'))) return
      const raw = await deepseek(
        [
          {
            role: 'system',
            content: `你是「问星」的测评分析师。用户刚交了一份测评卷，你要针对**做错的题**给出可执行的复盘，不要泛泛鼓励。

输出 JSON：
{
  "wrongItems":[{"index":1,"question":"题目标题","diagnosis":"错因（20-40字，指明是概念混淆/审题偏差/知识点缺失/操作顺序错误）","correctThinking":"正确思路（60-150字，讲清为什么这么选/这么做）","knowledgePoint":"涉及技能点"}],
  "keyItems":[{"index":3,"question":"题目标题","deepDive":"精讲（120-250字）：为什么容易错 + 与哪些相邻概念易混 + 一句记忆抓手"}],
  "weakPoints":[{"name":"技能点","advice":"补强建议（40-80字，具体到该学什么/练什么）"}],
  "overall":"总评（80-150字，直接指出主要问题与优先改进方向）",
  "nextSteps":["下一步行动1","下一步行动2","下一步行动3"]
}

规则：
- wrongItems 覆盖每一道提供的错题（index 用给定序号）。
- keyItems 只挑 3-5 道最值得精讲的（优先：多道错题同属一个技能点、或难度为 hard 的题）。
- weakPoints 按错题分布归纳，最多 5 个，按严重程度从高到低。
- 一律基于题目自带的标准答案与解析，不得引入题外事实。`
          },
          {
            role: 'user',
            content: `本次测评：${s.title}｜共 ${s.total} 题，答对 ${s.correctCount} 题，得分 ${s.score} 分。
知识点表现：${s.kpReview}

错题清单（共 ${wrong.length} 道${wrong.length > Q_MAX ? `，本次分析前 ${Q_MAX} 道` : ''}）：
${wrongBrief.join('\n\n')}`
          }
        ],
        true
      )

      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        const m = /\{[\s\S]*\}/.exec(String(raw))
        if (m) {
          try {
            parsed = JSON.parse(m[0])
          } catch {
            /* ignore */
          }
        }
      }
      if (!parsed) throw new Error('分析结果解析失败，请重试')

      const analysis = {
        wrongItems: Array.isArray(parsed.wrongItems) ? parsed.wrongItems.slice(0, Q_MAX) : [],
        keyItems: Array.isArray(parsed.keyItems) ? parsed.keyItems.slice(0, 5) : [],
        weakPoints: Array.isArray(parsed.weakPoints) ? parsed.weakPoints.slice(0, 5) : [],
        overall: String(parsed.overall || '').slice(0, 500),
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.filter((x) => typeof x === 'string').slice(0, 5) : []
      }
      await db.quizSession.update({ where: { id: s.id }, data: { analysis: JSON.stringify(analysis) } })

      // 把逐题错因写回 QuizAnswer.judgeNote，历史复盘直接可读
      for (const item of analysis.wrongItems) {
        const idx = Number(item.index) - 1
        const ans = wrong[idx]
        if (!ans) continue
        await db.quizAnswer.update({
          where: { id: ans.id },
          data: { judgeNote: String(item.diagnosis || '').slice(0, 300) }
        })
      }
      res.json({ analysis, cached: false })
    })
  )

  // ===== 答题会话：我的历史列表 =====
  app.get(
    '/api/quiz/sessions',
    auth,
    wrap(async (req, res) => {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30))
      const rows = await db.quizSession.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: limit
      })
      res.json({
        items: rows.map((s) => ({
          id: s.id,
          title: s.title,
          total: s.total,
          correctCount: s.correctCount,
          score: s.score,
          createdAt: s.createdAt.getTime(),
          hasAnalysis: Boolean(s.analysis)
        }))
      })
    })
  )

  // ===== 错题本：按题目聚合（最近一次作答为错即入选，答对后自然消失） =====
  // 无 resolved 字段：以「最近作答结果」为准，重练答对即移出；wrongCount 记录累计答错次数
  app.get(
    '/api/quiz/wrong-questions',
    auth,
    wrap(async (req, res) => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
      const rows = await db.quizAnswer.findMany({
        where: { session: { userId: req.user.id } },
        orderBy: { createdAt: 'desc' },
        take: 2000,
        include: { question: { include: { leaf: true } } }
      })
      // 内存聚合：每题保留最近一次作答（列表已按时间倒序，首次遇到即最新）
      const agg = new Map()
      for (const a of rows) {
        const isWrong = a.correct === false
        const e = agg.get(a.questionId)
        if (!e) {
          agg.set(a.questionId, {
            latest: a,
            wrongCount: isWrong ? 1 : 0,
            lastWrongAt: isWrong ? a.createdAt.getTime() : null
          })
          continue
        }
        if (isWrong) {
          e.wrongCount += 1
          const t = a.createdAt.getTime()
          if (e.lastWrongAt === null || t > e.lastWrongAt) e.lastWrongAt = t
        }
      }
      const items = [...agg.values()]
        .filter((e) => e.latest.correct === false)
        .sort((a, b) => (b.lastWrongAt ?? 0) - (a.lastWrongAt ?? 0))
        .slice(0, limit)
        .map((e) => ({
          question: toQuestionDTO(e.latest.question),
          userAnswer: e.latest.userAnswer,
          judgeNote: e.latest.judgeNote,
          wrongCount: e.wrongCount,
          lastWrongAt: e.lastWrongAt ?? e.latest.createdAt.getTime()
        }))
      res.json({ items, total: items.length })
    })
  )
}
