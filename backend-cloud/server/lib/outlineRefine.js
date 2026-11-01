// 学习大纲 AI 精细拆解：一次 DeepSeek JSON 调用
// 输出：技能组 + 每个任务的四字段（预计时长/脚手架/步骤/资源/产出/验收/常见错误）+ 需补充星图的新节点
// 失败由调用方降级为第 1 步推荐结果，不阻塞流程
import { deepseek, takeLastUsage } from './ai.js'

/** 从模型输出里稳健提取 JSON（兼容 ```json 围栏与前后杂字符） */
function parseJson(raw) {
  let text = String(raw || '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  return JSON.parse(text)
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const arr = (v) => (Array.isArray(v) ? v : [])

/** 规范化 AI 返回的任务项；标题为空的丢弃 */
function normalizeItem(raw) {
  const title = str(raw?.title)
  if (!title) return null
  const scaffold = num(raw?.scaffoldLevel, 2)
  return {
    title,
    description: str(raw?.description),
    kp: str(raw?.kp) || undefined,
    // 任务粒度硬约束：20-45 分钟，AI 越界时钳制回带内（默认 30）
    estMinutes: Math.min(45, Math.max(20, Math.round(num(raw?.estMinutes, 30)))),
    scaffoldLevel: [0, 1, 2, 3].includes(scaffold) ? scaffold : 2,
    isCriticalPath: Boolean(raw?.isCriticalPath),
    onboardingNote: str(raw?.onboardingNote) || undefined,
    steps: arr(raw?.steps).map(str).filter(Boolean).slice(0, 8),
    resources: arr(raw?.resources)
      .map((r) => ({
        type: str(r?.type) || '文档',
        title: str(r?.title),
        url: str(r?.url) || undefined,
        durationMin: Number.isFinite(Number(r?.durationMin)) ? Number(r.durationMin) : undefined,
        anchor: str(r?.anchor) || undefined
      }))
      .filter((r) => r.title)
      .slice(0, 5),
    deliverable: str(raw?.deliverable) || undefined,
    acceptance: arr(raw?.acceptance).map(str).filter(Boolean).slice(0, 6),
    commonErrors: arr(raw?.commonErrors)
      .map((e) => ({ error: str(e?.error), diagnose: str(e?.diagnose) }))
      .filter((e) => e.error || e.diagnose)
      .slice(0, 4)
  }
}

/**
 * @param {object} input { domain, categories, questionnaire, baseline, skillGroups }
 * @param {{ userApiKey?: string }} opts
 */
export async function refineOutline(input = {}, { userApiKey = '' } = {}) {
  const domain = str(input.domain) || '未指定'
  const categories = arr(input.categories)
  const qa = input.questionnaire ?? {}
  const baseline = str(input.baseline)
  const groups = arr(input.skillGroups)

  const groupText = groups
    .map((g, i) => {
      const items = arr(g?.items).map((x) => `  - ${str(x?.title)}${str(x?.kp) ? `（知识点：${str(x.kp)}）` : ''}`)
      return `技能组 ${i + 1}：${str(g?.name) || '未命名'}（${str(g?.description) || '无描述'}）\n${items.join('\n')}`
    })
    .join('\n\n')

  const qaText = [
    `目的：${str(qa.sopPath) || '未指定'}`,
    `30 天目标：${str(qa.goal30) || '未指定'}`,
    `基线：${str(qa.baseline) || '未指定'}`,
    `时间投入：${str(qa.timeCommitment) || '未指定'}`,
    `障碍：${str(qa.obstacle) || '未指定'}`
  ].join('；')

  // 项目锚点：由技能推荐阶段产出，贯穿到每个任务的产出物与验收
  const project = input.project ?? null
  const projectText = project && str(project.name)
    ? `项目锚点：${str(project.name)}；交付物：${str(project.deliverable) || '未指定'}；验收：${str(project.acceptance) || '未指定'}`
    : '项目锚点：未指定（请按 30 天目标反推一个可运行的真实交付物，并让每个任务产出它的一部分）'

  const messages = [
    {
      role: 'system',
      content: `你是「问星」的技能大纲拆解器。把已有技能组细化成可以「打开就能上手」的任务卡，任务必须服务于用户要交付的真实项目。

硬规则：
1. 只返回 JSON，不要解释，不要 Markdown 围栏。
2. 不新增与给出技能组无关的学科；但若发现完成目标必须依赖某个缺失的能力项/学科，可以放进 newNodes。
3. 任务标题必须具体可执行（动词开头），禁止「了解 XX」「熟悉 XX」这类空泛表述。
4. acceptance 必须是可检验的结果（能截图、能运行、能说出），每条 40 字内，并尽量对齐项目总体验收。
5. steps 3-6 步，每步是具体动作，禁止写「学习相关知识」。
6. resources 只写能找到的中文文档/视频/工具名，不确定网址时 url 留空，禁止编造链接。
7. estMinutes 是硬约束：每个任务必须落在 20-45 分钟。预计超过 45 分钟的任务必须拆成多个任务；不足 20 分钟的合并进相邻任务，禁止输出带外时长。时间碎片化 → 任务可独立完成、可中断。
8. 按用户基线定脚手架：完全没接触过 → 前几个任务 scaffoldLevel=3（给完整样例），estMinutes 取 20-30；有基础 → 2（补全）；禁止对零基础用户直接给 0（独立完成）。
9. deliverable 必须写这是项目的哪个部件（如「项目的登录页」「设备的采集固件」），不允许留空。
10. 输出 JSON 结构：
{"groups":[{"name":"技能组名","description":"一句话","items":[{"title":"","description":"","kp":"","estMinutes":30,"scaffoldLevel":2,"isCriticalPath":true,"onboardingNote":"","steps":[""],"resources":[{"type":"文档","title":"","url":"","durationMin":10}],"deliverable":"","acceptance":[""],"commonErrors":[{"error":"","diagnose":""}]}]}],
"newNodes":[{"leixing":"技能类","zu":"族","xiang":"项","kp":["知识点"],"reason":"为什么必须补充"}]}
11. 保持输入技能组的数量与名称不变，只细化 items；每个技能组 2-4 个任务。
12. newNodes 最多 5 条，没有就返回空数组。`
    },
    {
      role: 'user',
      content: `行业：${domain}
已选知识大类：${categories.join('、') || '未指定'}
${projectText}
学习合同：${qaText}
${baseline ? `学前测评薄弱点：${baseline}` : '学前测评：已跳过'}

当前技能组（需要细化）：
${groupText || '（无，请按学习合同自行给出 3 个技能组）'}`
    }
  ]

  const raw = await deepseek(messages, true, userApiKey)
  const tokens = takeLastUsage().total_tokens
  const data = parseJson(raw)

  const refined = arr(data?.groups)
    .map((g, gi) => {
      const items = arr(g?.items).map(normalizeItem).filter(Boolean)
      if (items.length === 0) return null
      return {
        name: str(g?.name) || str(groups[gi]?.name) || `技能组 ${gi + 1}`,
        description: str(g?.description) || str(groups[gi]?.description) || '',
        reason: str(g?.reason) || str(groups[gi]?.reason) || '',
        items
      }
    })
    .filter(Boolean)

  const newNodes = arr(data?.newNodes)
    .map((n) => ({
      leixing: str(n?.leixing),
      zu: str(n?.zu),
      xiang: str(n?.xiang),
      kp: arr(n?.kp).map(str).filter(Boolean),
      reason: str(n?.reason)
    }))
    .filter((n) => n.xiang && n.kp.length > 0)
    .slice(0, 5)

  if (refined.length === 0) throw new Error('精细拆解未返回有效任务')
  return { groups: refined, newNodes, tokens }
}
