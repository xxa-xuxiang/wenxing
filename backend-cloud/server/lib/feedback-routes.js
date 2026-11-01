// 微反馈归因闭环 + 学习埋点（灰度）
// 挂载：app.use('/api', feedbackRouter)
// 铁律：上报/埋点失败永不阻塞用户，统一降级为 200 + 兜底文案；写操作一律走 serializeWrite 串行队列
import express from 'express'
import { db, serializeWrite } from './db.js'
import { optionalAuth } from './auth.js'
import { createLogger } from './logger.js'
import { createRateLimit } from './rate-limit.js'

const router = express.Router()
const log = createLogger('feedback')

// 反馈/埋点均为匿名可写接口，按 IP/用户限流，防止刷库
const feedbackLimit = createRateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '反馈过于频繁，请稍后再试'
})
const eventLimit = createRateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: '上报过于频繁'
})

/* ---------------- 归因 → 干预映射（与前端 FeedbackBar 一一对应） ---------------- */
export const REASON_MAP = {
  environment: {
    action: 'env_selfcheck',
    // 环境问题不是用户学不会，必须排除出能力评估
    reply: '已把这条记为环境问题（不是你的问题）。已附上环境自检清单，今天的产出目标不变。',
    planChanged: false,
    qualityBonus: 0.2
  },
  unclear: {
    action: 'swap_resource_and_descend_scaffold',
    reply: '已换成更基础的讲解资源，并把提示升级为完整样例。今天的目标缩减为 2 步。',
    planChanged: true,
    qualityBonus: 0.3
  },
  cannot_do: {
    action: 'completion_problem_and_error_list',
    reply: '已切到补全式练习：你只需填空关键几行，并附上这条任务的常见错误清单。',
    planChanged: true,
    qualityBonus: 0.3
  },
  no_time: {
    action: 'shrink_scope_and_reschedule',
    reply: '已砍掉非关键路径任务，今天只需完成 1 步即可打卡，后续已重新排期。',
    planChanged: true,
    qualityBonus: 0.2
  },
  other: {
    action: 'log_only',
    reply: '已记录，会纳入这条任务的优化。',
    planChanged: false,
    qualityBonus: 0.0
  }
}

/* ---------------- 反馈质量分：重复「太难了」降权，避免淹没真实缺陷 ---------------- */
function score({ reasonTag, detail, context, recentSameCount }) {
  let s = 0
  if (reasonTag && REASON_MAP[reasonTag]) s += 0.4
  if (detail && String(detail).trim().length >= 8) s += 0.2
  if (context && Object.keys(context).length >= 3) s += 0.2
  if (recentSameCount > 2) s -= 0.3
  s += REASON_MAP[reasonTag]?.qualityBonus ?? 0
  return Math.max(0, Math.min(1, Number(s.toFixed(2))))
}

/* ---------------- POST /api/feedback ---------------- */
router.post('/feedback', optionalAuth, feedbackLimit, async (req, res) => {
  try {
    const { task_id, user_given, reason_tag, detail, context } = req.body || {}
    const userId = req.user?.id ?? req.user?.userId ?? null

    if (!user_given || !['smooth', 'stuck', 'abandon'].includes(user_given)) {
      return res.status(400).json({ ok: false, error: 'user_given 必须是 smooth|stuck|abandon' })
    }

    const map = REASON_MAP[reason_tag] || REASON_MAP.other

    let recentSameCount = 0
    try {
      if (task_id && userId) {
        recentSameCount = await db.feedbackEvent.count({ where: { taskId: String(task_id), userId } })
      }
    } catch {
      /* 统计失败不影响主流程 */
    }

    const row = await serializeWrite(() =>
      db.feedbackEvent.create({
        data: {
          userGiven: user_given,
          reasonTag: reason_tag || null,
          detail: detail ? String(detail).slice(0, 200) : null,
          taskId: task_id ? String(task_id) : null,
          userId,
          contextJson: context ? JSON.stringify(context) : null,
          qualityScore: score({ reasonTag: reason_tag, detail, context, recentSameCount }),
          actionTaken: map.action,
          planChanged: map.planChanged
        }
      })
    )

    // 同步埋一条 stuck 事件，方便后台热力图直接看
    if (user_given === 'stuck') {
      try {
        await serializeWrite(() =>
          db.learnerEvent.create({
            data: {
              userId,
              taskId: task_id ? String(task_id) : null,
              type: 'task_stuck',
              payloadJson: JSON.stringify({ reason_tag, context })
            }
          })
        )
      } catch {
        /* 埋点失败不影响反馈主流程 */
      }
    }

    return res.json({
      ok: true,
      id: row.id,
      plan_changed: map.planChanged,
      action: map.action,
      reply: map.reply
    })
  } catch (e) {
    log.error('反馈上报失败:', e?.message || e)
    return res.status(200).json({ ok: false, plan_changed: false, reply: '已记录，感谢反馈。' })
  }
})

/* ---------------- GET /api/feedback/impact?task_id=xxx ---------------- */
router.get('/feedback/impact', async (req, res) => {
  try {
    const { task_id } = req.query
    if (!task_id) return res.status(400).json({ ok: false, error: 'task_id required' })

    const rows = await db.feedbackEvent.findMany({
      where: { taskId: String(task_id) },
      orderBy: { createdAt: 'desc' },
      take: 20
    })

    const byReason = {}
    for (const r of rows) {
      const k = r.reasonTag || 'other'
      byReason[k] = (byReason[k] || 0) + 1
    }

    const top = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0]
    const map = REASON_MAP[top?.[0]] || REASON_MAP.other

    return res.json({
      ok: true,
      total: rows.length,
      by_reason: byReason,
      top_reason: top?.[0] || null,
      reply: map.reply,
      plan_changed: map.planChanged
    })
  } catch (e) {
    log.error('影响统计失败:', e?.message || e)
    return res.status(200).json({ ok: false, reply: '已记录，感谢反馈。', plan_changed: false })
  }
})

/* ---------------- POST /api/events（四个必埋事件） ---------------- */
router.post('/events', optionalAuth, eventLimit, async (req, res) => {
  try {
    const { task_id, type, payload } = req.body || {}
    const allow = ['task_start', 'task_complete', 'task_stuck', 'artifact_submit']
    if (!allow.includes(type)) return res.status(400).json({ ok: false, error: 'unsupported type' })

    await serializeWrite(() =>
      db.learnerEvent.create({
        data: {
          userId: req.user?.id ?? req.user?.userId ?? null,
          taskId: task_id ? String(task_id) : null,
          type,
          payloadJson: payload ? JSON.stringify(payload) : null
        }
      })
    )
    return res.json({ ok: true })
  } catch (e) {
    log.error('埋点事件记录失败:', e?.message || e)
    return res.status(200).json({ ok: false })
  }
})

export default router
