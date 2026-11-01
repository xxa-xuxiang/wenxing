// 问星 v1.4 — 管理后台数据看板
import express from 'express'
import { db } from '../db.js'
import { wrap } from '../ai.js'
import { getUsageTotals } from '../aiUsage.js'
import { DOCS_DIR, listMdFiles } from '../docs-store.js'
import { readFeedback } from '../feedback-store.js'

const router = express.Router()

/** 本地时区今日 0 点 */
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const FILL_STATUS = ['pending', 'materializing', 'filled', 'blocked', 'failed']
const QUESTION_STATUS = ['draft', 'verified', 'rejected']

router.get(
  '/overview',
  wrap(async (req, res) => {
    const today = startOfToday()
    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000)

    const [
      userTotal,
      userNewToday,
      userNew7d,
      userDisabled,
      postTotal,
      post7d,
      commentTotal,
      questionTotal,
      questionGroups,
      leafGroups,
      fillGroups,
      leafRows,
      verifiedByLeaf,
      planTotal,
      planActive,
      checkinTotal,
      checkin7d,
      sessionTotal,
      sessionToday
    ] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: today } } }),
      db.user.count({ where: { createdAt: { gte: since7d } } }),
      db.user.count({ where: { disabled: true } }),
      db.communityPost.count(),
      db.communityPost.count({ where: { createdAt: { gte: since7d } } }),
      db.communityComment.count(),
      db.question.count(),
      db.question.groupBy({ by: ['status'], _count: { _all: true } }),
      db.skillLeaf.groupBy({ by: ['industry'], _count: { _all: true } }),
      db.fillJobItem.groupBy({ by: ['status', 'leafKey'], _count: { _all: true } }),
      db.skillLeaf.findMany({ select: { id: true, industry: true, leafKey: true } }),
      db.question.groupBy({
        by: ['leafId'],
        where: { status: 'verified' },
        _count: { _all: true }
      }),
      db.learningPlan.count(),
      db.learningPlan.count({ where: { status: 'active' } }),
      db.checkin.count(),
      db.checkin.count({ where: { createdAt: { gte: since7d } } }),
      db.quizSession.count(),
      db.quizSession.count({ where: { createdAt: { gte: today } } })
    ])

    // 题目状态分布
    const questionByStatus = Object.fromEntries(QUESTION_STATUS.map((s) => [s, 0]))
    for (const g of questionGroups) {
      if (g.status in questionByStatus) questionByStatus[g.status] = g._count._all
    }

    // 铺题账本状态分布 + 行业覆盖度
    const fillByStatus = Object.fromEntries(FILL_STATUS.map((s) => [s, 0]))
    const industryByLeafId = new Map(leafRows.map((l) => [l.id, l.industry]))
    const industryByLeafKey = new Map(leafRows.map((l) => [l.leafKey, l.industry]))
    const jobsByIndustryStatus = new Map()
    for (const j of fillGroups) {
      if (j.status in fillByStatus) fillByStatus[j.status] += j._count._all
      const industry = industryByLeafKey.get(j.leafKey)
      if (!industry) continue
      const key = `${industry}|${j.status}`
      jobsByIndustryStatus.set(key, (jobsByIndustryStatus.get(key) || 0) + j._count._all)
    }
    const questionsByIndustry = new Map()
    for (const g of verifiedByLeaf) {
      const industry = industryByLeafId.get(g.leafId)
      if (industry) questionsByIndustry.set(industry, (questionsByIndustry.get(industry) || 0) + g._count._all)
    }
    const coverage = leafGroups
      .map((l) => ({
        industry: l.industry,
        leaves: l._count._all,
        pending: jobsByIndustryStatus.get(`${l.industry}|pending`) || 0,
        materializing: jobsByIndustryStatus.get(`${l.industry}|materializing`) || 0,
        filled: jobsByIndustryStatus.get(`${l.industry}|filled`) || 0,
        blocked: jobsByIndustryStatus.get(`${l.industry}|blocked`) || 0,
        failed: jobsByIndustryStatus.get(`${l.industry}|failed`) || 0,
        questions: questionsByIndustry.get(l.industry) || 0
      }))
      .sort((a, b) => b.questions - a.questions || a.industry.localeCompare(b.industry))

    res.json({
      users: { total: userTotal, newToday: userNewToday, new7d: userNew7d, disabled: userDisabled },
      community: { posts: postTotal, comments: commentTotal, posts7d: post7d },
      questions: { total: questionTotal, byStatus: questionByStatus },
      leaves: { total: leafGroups.reduce((sum, l) => sum + l._count._all, 0), byStatus: fillByStatus },
      plans: { total: planTotal, active: planActive },
      checkins: { total: checkinTotal, last7d: checkin7d },
      quizSessions: { total: sessionTotal, today: sessionToday },
      docs: { total: listMdFiles(DOCS_DIR).length },
      feedback: { total: readFeedback().length },
      aiUsage: getUsageTotals(),
      coverage,
      targetPerLeaf: Number(process.env.QUESTION_TARGET_PER_LEAF || 20)
    })
  })
)

export default router
