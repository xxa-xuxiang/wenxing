// 问星 v4 — 学习工作台 Store
// 管理：多套学习计划方案（激活方案 + 归档方案）、已选领域、问卷答案、AI 技能推荐、
// 待办任务、学习计划（分块）、学习文档（本地展示 + 后端 md 存档）
// 状态自动判定：验收标准 = 看完，读完文档 → 深度掌握（绿灯）
// 排期纯逻辑已抽到 @/services/planScheduler（独立模块）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { BaselineResult, Domain, KpPath, LearnStatus, LearningDoc, OutlineTask, PlanAgentPhase, PlanAgentRun, PlanAgentValidation, PlanBlock, PlanScheme, QuestionnaireAnswers } from '@/types'
import type { TextbookNode, TextbookTree } from '@/types/textbook'
import type { SkillGroup, PlanBlockDraft, ProjectAnchor } from '@/services/aiService'
import { storage } from '@/utils/storage'
import { domains as domainList } from '@/data/domains'
import { industryMetaByName as industryByName } from '@/data/industriesMeta'
import { parseIndustryMd, findKpPath } from '@/utils/industryMd'
import { loadIndustryMd } from '@/data/industriesLazy'
import { generateDoc, generatePlanAgentStream, generatePlanBlocks, recommendSkills, reviseDoc } from '@/services/aiService'
import {
  buildPlanMarkdown,
  fallbackDrafts,
  fmtDate,
  groupsFromOutline as groupsFromOutlineFn,
  parseDay,
  scheduleBlocks
} from '@/services/planScheduler'
import { useMasteryStore } from './masteryStore'
import { http } from '@/services/http'
import { apiUrl } from '@/services/apiBase'
import { FLAGS } from '@/config/flags'

export const useLearnStore = defineStore('learn', () => {
  // 已选领域（首次进入为空，触发弹窗）
  // 迁移：旧存档按 id 重新映射到最新 domains 数据（如「计算机」→「信息技术与软件」）
  const _rawDomain = storage.get<Domain | null>('domain', null)
  const selectedDomain = ref<Domain | null>(
    _rawDomain ? domainList.find((d) => d.id === _rawDomain.id) ?? _rawDomain : null
  )
  // 问卷答案（SOP 学习合同；旧存档缺 categories 字段 → 失效重答）
  const _rawQa = storage.get<QuestionnaireAnswers | null>('questionnaire', null)
  const questionnaireAnswers = ref<QuestionnaireAnswers | null>(
    _rawQa && Array.isArray(_rawQa.categories) ? _rawQa : null
  )
  // AI 推荐的技能组（确认后才变成待办任务）
  const skillGroups = ref<SkillGroup[] | null>(storage.get<SkillGroup[] | null>('skillGroups', null))
  // 大纲任务
  const outline = ref<OutlineTask[]>(storage.get<OutlineTask[]>('outline', []))
  // 学习文档（按 skillId 索引）
  const docs = ref<LearningDoc[]>(storage.get<LearningDoc[]>('docs', []))
  // 学习计划模块（确认技能组后按块生成：目标/期限/验收标准；本地 + 云快照 + 后端 md 存档）
  const plan = ref<PlanBlock[]>(storage.get<PlanBlock[]>('plan', []))
  // 学习计划skill 五件套完整文档（Agent 生成；旧存档为空，展示时回退 buildPlanMarkdown）
  const planDoc = ref<string>(storage.get<string>('planDoc', ''))
  // 是否正在生成学习计划
  const generatingPlan = ref(false)
  /** 计划生成失败原因（展示在计划确认页，成功后清空） */
  const planError = ref('')
  /** 30 天真实项目锚点（技能推荐阶段由 AI 产出，旧存档为空） */
  const planProject = ref<ProjectAnchor | null>(storage.get<ProjectAnchor | null>('planProject', null))
  // 学习计划 Agent 运行轨迹（不持久化）
  const planAgent = ref<PlanAgentRun | null>(null)
  // Agent 抽屉是否展开
  const agentDrawerOpen = ref(false)
  // ===== 多套学习计划方案 =====
  /** 归档方案（非激活）：激活方案直接使用上面的顶层字段，切走时打包进来 */
  const planSchemes = ref<PlanScheme[]>(storage.get<PlanScheme[]>('planSchemes', []))
  /** 当前激活方案在 planSchemes 中的 id（null = 激活方案尚未归档） */
  const activePlanId = ref<string | null>(storage.get<string | null>('activePlanId', null))
  /** 学习向导（阶段1-3）开关，不持久化 */
  const wizardOpen = ref(false)
  // 当前聚焦的任务 id（前端只维护"聚焦"，可同时打开多个任务标签）
  const activeTaskId = ref<string | null>(storage.get<string | null>('activeTaskId', null))
  // 已打开的任务标签（顺序即标签顺序；关闭标签 ≠ 从大纲删除任务）
  const openTaskIds = ref<string[]>(
    storage.get<string[]>('openTaskIds', []).filter((id) => outline.value.some((t) => t.id === id))
  )
  // activeTaskId 悬挂校验：存档指向的任务已不存在（旧数据/被替换）→ 落回第一个任务
  if (activeTaskId.value && !outline.value.some((t) => t.id === activeTaskId.value)) {
    activeTaskId.value = outline.value[0]?.id ?? null
  }
  // 聚焦任务必须出现在标签列表中（旧存档迁移）
  if (activeTaskId.value && !openTaskIds.value.includes(activeTaskId.value)) {
    openTaskIds.value = [activeTaskId.value, ...openTaskIds.value]
  }
  // ===== 五阶段流程状态 =====
  /** 阶段2：资源（文档 / 题库覆盖）是否已确认就绪 */
  const resourcesConfirmed = ref<boolean>(storage.get<boolean>('resourcesConfirmed', false))
  /** 阶段3：学习计划是否已确认（未确认时计划可继续编辑） */
  const planConfirmed = ref<boolean>(storage.get<boolean>('planConfirmed', false))
  /** 学前测评结果（null = 未测评；跳过测评时保持 null，但计划已生成即视为阶段1完成） */
  const baselineResult = ref<BaselineResult | null>(storage.get<BaselineResult | null>('baselineResult', null))
  /** 学前测评是否已完成（含跳过）；旧存档按「已有大纲/计划/测评结果」推断 */
  const baselineDone = ref<boolean>(
    storage.get<boolean | null>('baselineDone', null) ??
      (outline.value.length > 0 || plan.value.length > 0 || baselineResult.value !== null)
  )
  /** 待测评的技能组（确认技能组后暂存，测评结束/跳过后才生成计划） */
  const pendingPlanGroups = ref<SkillGroup[] | null>(null)
  // 是否首次进入（用于触发领域弹窗）
  const onboarded = ref<boolean>(storage.get<boolean>('onboarded', false))
  // 是否正在推荐技能
  const generatingRecommend = ref(false)
  // 推荐错误信息（如后端未启动）
  const recommendError = ref<string | null>(null)
  // 正在生成文档的 skillId
  const generatingDocId = ref<string | null>(null)
  // 正在完善（反馈修订）文档的 skillId
  const revisingDocId = ref<string | null>(null)
  // 文档生成/完善的错误信息（界面展示，可关闭）
  const docError = ref<string | null>(null)
  function clearDocError() {
    docError.value = null
  }

  // 领域名变更（如「计算机」→「信息技术与软件」）时立即写回存档
  if (_rawDomain && selectedDomain.value && _rawDomain.name !== selectedDomain.value.name) {
    storage.set('domain', selectedDomain.value)
  }

  /** 从 localStorage 重读全部状态（登录/退出切换用户命名空间后调用） */
  function reload() {
    const rawDomain = storage.get<Domain | null>('domain', null)
    selectedDomain.value = rawDomain ? domainList.find((d) => d.id === rawDomain.id) ?? rawDomain : null
    const rawQa = storage.get<QuestionnaireAnswers | null>('questionnaire', null)
    questionnaireAnswers.value = rawQa && Array.isArray(rawQa.categories) ? rawQa : null
    skillGroups.value = storage.get<SkillGroup[] | null>('skillGroups', null)
    planProject.value = storage.get<ProjectAnchor | null>('planProject', null)
    outline.value = storage.get<OutlineTask[]>('outline', [])
    docs.value = storage.get<LearningDoc[]>('docs', [])
    plan.value = storage.get<PlanBlock[]>('plan', [])
    planDoc.value = storage.get<string>('planDoc', '')
    planAgent.value = null
    agentDrawerOpen.value = false
    activeTaskId.value = storage.get<string | null>('activeTaskId', null)
    openTaskIds.value = storage
      .get<string[]>('openTaskIds', [])
      .filter((id) => outline.value.some((t) => t.id === id))
    // 悬挂校验：存档指向的任务已不存在（旧数据/被替换）→ 落回第一个任务
    if (activeTaskId.value && !outline.value.some((t) => t.id === activeTaskId.value)) {
      activeTaskId.value = outline.value[0]?.id ?? null
    }
    if (activeTaskId.value && !openTaskIds.value.includes(activeTaskId.value)) {
      openTaskIds.value = [activeTaskId.value, ...openTaskIds.value]
    }
    resourcesConfirmed.value = storage.get<boolean>('resourcesConfirmed', false)
    planConfirmed.value = storage.get<boolean>('planConfirmed', false)
    baselineResult.value = storage.get<BaselineResult | null>('baselineResult', null)
    baselineDone.value =
      storage.get<boolean | null>('baselineDone', null) ??
      (outline.value.length > 0 || plan.value.length > 0 || baselineResult.value !== null)
    planSchemes.value = storage.get<PlanScheme[]>('planSchemes', [])
    activePlanId.value = storage.get<string | null>('activePlanId', null)
    wizardOpen.value = false
    onboarded.value = storage.get<boolean>('onboarded', false)
  }

  const availableDomains = computed(() => domainList.filter((d) => d.available))

  /**
   * 从 localStorage 重读「计划相关快照」——供学习日历等独立窗口在收到 storage 事件后跟随刷新
   * 只读取赋值，不写回，避免 storage 事件回环
   */
  function reloadPlanSnapshotFromStorage() {
    outline.value = storage.get<OutlineTask[]>('outline', [])
    plan.value = storage.get<PlanBlock[]>('plan', [])
    planDoc.value = storage.get<string>('planDoc', '')
    planProject.value = storage.get<ProjectAnchor | null>('planProject', null)
    planConfirmed.value = storage.get<boolean>('planConfirmed', false)
    resourcesConfirmed.value = storage.get<boolean>('resourcesConfirmed', false)
    baselineResult.value = storage.get<BaselineResult | null>('baselineResult', null)
    baselineDone.value = storage.get<boolean | null>('baselineDone', null) ?? false
    planSchemes.value = storage.get<PlanScheme[]>('planSchemes', [])
    activePlanId.value = storage.get<string | null>('activePlanId', null)
  }

  const PLAN_SNAPSHOT_KEYS = [
    'outline',
    'plan',
    'planDoc',
    'planProject',
    'planConfirmed',
    'resourcesConfirmed',
    'baselineResult',
    'baselineDone',
    'planSchemes',
    'activePlanId'
  ]
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      const k = e.key ?? ''
      if (!PLAN_SNAPSHOT_KEYS.some((suffix) => k === suffix || k.endsWith(`:${suffix}`))) return
      reloadPlanSnapshotFromStorage()
    })
  }

  const activeTask = computed<OutlineTask | null>(() =>
    outline.value.find((t) => t.id === activeTaskId.value) ?? null
  )

  const activeDoc = computed<LearningDoc | null>(() => {
    if (!activeTaskId.value) return null
    return docs.value.find((d) => d.skillId === activeTaskId.value) ?? null
  })

  // 学习状态计数（个人中心 / 工作台摘要）
  const statusCount = computed(() => {
    const c = { unknown: 0, light: 0, deep: 0 }
    for (const t of outline.value) c[t.status] += 1
    return c
  })

  // ===== 多套学习计划方案：归档 / 切换 =====
  /** 激活方案的默认命名 */
  function activePlanNameDefault(): string {
    const d = selectedDomain.value?.name?.trim()
    return d ? `${d} 学习计划` : '我的学习计划'
  }

  /** 把当前顶层字段打包成一套方案（大纲为空时视为无可归档内容） */
  function packActive(): PlanScheme | null {
    if (outline.value.length === 0) {
      if (activePlanId.value) {
        planSchemes.value = planSchemes.value.filter((s) => s.id !== activePlanId.value)
        activePlanId.value = null
      }
      return null
    }
    const prev = planSchemes.value.find((s) => s.id === activePlanId.value)
    const scheme: PlanScheme = {
      id: activePlanId.value ?? `plan-${Date.now()}`,
      name: prev?.name ?? activePlanNameDefault(),
      createdAt: prev?.createdAt ?? Date.now(),
      domain: selectedDomain.value,
      questionnaire: questionnaireAnswers.value,
      outline: outline.value,
      plan: plan.value,
      planDoc: planDoc.value,
      planConfirmed: planConfirmed.value,
      resourcesConfirmed: resourcesConfirmed.value,
      baselineResult: baselineResult.value,
      baselineDone: baselineDone.value,
      activeTaskId: activeTaskId.value,
      openTaskIds: openTaskIds.value
    }
    const idx = planSchemes.value.findIndex((s) => s.id === scheme.id)
    if (idx >= 0) planSchemes.value.splice(idx, 1, scheme)
    else planSchemes.value.push(scheme)
    activePlanId.value = scheme.id
    return scheme
  }

  /** 把某套方案解包到顶层字段（含悬挂校验） */
  function unpackActive(s: PlanScheme) {
    selectedDomain.value = s.domain
    questionnaireAnswers.value = s.questionnaire
    outline.value = s.outline
    plan.value = s.plan
    planDoc.value = s.planDoc ?? ''
    planConfirmed.value = s.planConfirmed
    resourcesConfirmed.value = s.resourcesConfirmed
    baselineResult.value = s.baselineResult
    baselineDone.value =
      s.baselineDone ?? (s.outline.length > 0 || s.plan.length > 0 || s.baselineResult !== null)
    activeTaskId.value = s.activeTaskId
    openTaskIds.value = [...(s.openTaskIds ?? [])]
    skillGroups.value = null
    pendingPlanGroups.value = null
    if (activeTaskId.value && !outline.value.some((t) => t.id === activeTaskId.value)) {
      activeTaskId.value = outline.value[0]?.id ?? null
    }
    openTaskIds.value = openTaskIds.value.filter((id) => outline.value.some((t) => t.id === id))
    if (activeTaskId.value && !openTaskIds.value.includes(activeTaskId.value)) {
      openTaskIds.value = [activeTaskId.value, ...openTaskIds.value]
    }
  }

  /** 切换到另一套方案 */
  function switchPlan(id: string) {
    if (id === (activePlanId.value ?? '__active__')) return
    packActive()
    const target = planSchemes.value.find((s) => s.id === id)
    if (!target) return
    unpackActive(target)
    activePlanId.value = id
    persist()
  }

  /** 新建一套学习计划：归档当前方案 → 清空 → 打开向导 */
  function createPlan() {
    packActive()
    selectedDomain.value = null
    questionnaireAnswers.value = null
    skillGroups.value = null
    outline.value = []
    plan.value = []
    clearPlanAgent()
    activeTaskId.value = null
    openTaskIds.value = []
    resourcesConfirmed.value = false
    planConfirmed.value = false
    baselineResult.value = null
    baselineDone.value = false
    pendingPlanGroups.value = null
    onboarded.value = false
    activePlanId.value = null
    wizardOpen.value = true
    persist()
  }

  /**
   * 从教材导入生成学习计划（并行入口，不走问卷/测评链路）
   * 每节一条大纲任务 + 一篇文档，每章一个计划模块；导入后直达向导第 5 步「计划确认」
   */
  function importTextbookPlan(payload: {
    tree: TextbookTree
    sections: Record<string, string>
    selectedIds: string[]
  }): { taskCount: number; blockCount: number } {
    const { tree, sections, selectedIds } = payload
    // 1) 归档当前方案（大纲为空时无副作用）
    packActive()
    // 2) 清空中间态（教材不经过问卷/测评）
    questionnaireAnswers.value = null
    skillGroups.value = null
    pendingPlanGroups.value = null
    baselineResult.value = null
    baselineDone.value = true
    planConfirmed.value = false
    activePlanId.value = null
    clearPlanAgent()
    // 3) 合成领域（id 直接用教材 slug，避免双前缀）
    selectedDomain.value = {
      id: tree.slug,
      name: tree.title,
      tagline: `教材导入 · ${tree.nodeCount} 节`,
      tags: ['教材'],
      available: true
    }
    // 4) 展平并按勾选过滤（按 ordinal 升序）
    const wanted = new Set(selectedIds)
    const flat: TextbookNode[] = []
    const walk = (list: TextbookNode[]) => {
      for (const node of list) {
        if (wanted.has(node.id)) flat.push(node)
        walk(node.children)
      }
    }
    walk(tree.nodes)
    flat.sort((a, b) => a.ordinal - b.ordinal)
    if (flat.length === 0) return { taskCount: 0, blockCount: 0 }

    const prefix = `tb-${tree.slug}`
    const tasks: OutlineTask[] = flat.map((node) => ({
      id: `${prefix}-${node.id}`,
      title: node.title,
      domainId: tree.slug,
      status: 'unknown' as LearnStatus,
      description: `${node.chapter} · 教材第 ${node.ordinal} 节`
    }))
    outline.value = tasks
    // 5) 文档：改写图片地址为可访问的绝对路径（Web 走 Vite 代理，桌面走云端/本地基地址）
    const base = apiUrl('')
    const newDocs: LearningDoc[] = []
    for (const [i, node] of flat.entries()) {
      const raw = sections[node.id]
      if (!raw) continue
      newDocs.push({
        id: `doc-${tasks[i].id}`,
        skillId: tasks[i].id,
        content: base ? raw.split('](/uploads/').join(`](${base}/uploads/`) : raw,
        generatedAt: Date.now(),
        source: 'manual'
      })
    }
    docs.value = newDocs
    // 6) 计划：每章一个模块（章内选中节全部归入该块）
    const blockByChapter = new Map<string, string[]>()
    for (const [i, node] of flat.entries()) {
      const chapter = node.chapter || tree.title
      const list = blockByChapter.get(chapter) ?? []
      list.push(tasks[i].id)
      blockByChapter.set(chapter, list)
    }
    const blocks: PlanBlock[] = []
    let cursor = new Date()
    cursor.setHours(0, 0, 0, 0)
    for (const [chapter, taskIds] of blockByChapter) {
      const durationDays = Math.max(1, Math.ceil(taskIds.length / 2))
      const end = new Date(cursor)
      end.setDate(end.getDate() + durationDays - 1)
      blocks.push({
        id: `block-${prefix}-${blocks.length}`,
        name: chapter,
        goal: `读完「${chapter}」全部小节，能复述每节核心概念`,
        durationDays,
        startDate: fmtDate(cursor),
        endDate: fmtDate(end),
        acceptance: '读完全部小节，并能用自己的话复述要点',
        taskIds
      })
      cursor = new Date(end)
      cursor.setDate(cursor.getDate() + 1)
    }
    plan.value = blocks
    // 7) 教材正文即资源，直接视为资源就绪
    resourcesConfirmed.value = true
    // 8) 聚焦第一节
    activeTaskId.value = tasks[0].id
    openTaskIds.value = [tasks[0].id]
    // 9) 打开向导（字段已满足 → 直达第 5 步「计划确认」）
    onboarded.value = true
    wizardOpen.value = true
    persist()
    void savePlanToServer(blocks)
    return { taskCount: tasks.length, blockCount: blocks.length }
  }

  /** 重命名某套方案 */
  function renameScheme(id: string, name: string) {
    const n = name.trim()
    if (!n) return
    const s = planSchemes.value.find((x) => x.id === id)
    if (!s) return
    s.name = n
    persist()
  }

  /** 删除某套方案（删的是激活方案时回到空态） */
  function deleteScheme(id: string) {
    planSchemes.value = planSchemes.value.filter((s) => s.id !== id)
    if (activePlanId.value === id) {
      activePlanId.value = null
      selectedDomain.value = null
      questionnaireAnswers.value = null
      skillGroups.value = null
      outline.value = []
      plan.value = []
      clearPlanAgent()
      activeTaskId.value = null
      openTaskIds.value = []
      resourcesConfirmed.value = false
      planConfirmed.value = false
      baselineResult.value = null
      baselineDone.value = false
      pendingPlanGroups.value = null
    }
    persist()
  }

  /** 当前方案名 */
  const activePlanName = computed(() => {
    const s = planSchemes.value.find((x) => x.id === activePlanId.value)
    if (s) return s.name
    return outline.value.length > 0 ? activePlanNameDefault() : '未命名学习计划'
  })

  /** 全部方案（含当前激活方案的即时视图），供切换下拉展示 */
  const allSchemes = computed<PlanScheme[]>(() => {
    const list = planSchemes.value.map((s) => ({ ...s }))
    if (outline.value.length > 0 && !planSchemes.value.some((s) => s.id === activePlanId.value)) {
      list.unshift({
        id: activePlanId.value ?? '__active__',
        name: activePlanNameDefault(),
        createdAt: Date.now(),
        domain: selectedDomain.value,
        questionnaire: questionnaireAnswers.value,
        outline: outline.value,
        plan: plan.value,
        planDoc: planDoc.value,
        planConfirmed: planConfirmed.value,
        resourcesConfirmed: resourcesConfirmed.value,
        baselineResult: baselineResult.value,
        baselineDone: baselineDone.value,
        activeTaskId: activeTaskId.value,
        openTaskIds: openTaskIds.value
      })
    }
    return list
  })

  // ===== 持久化 =====
  function persist() {
    storage.set('domain', selectedDomain.value)
    storage.set('questionnaire', questionnaireAnswers.value)
    storage.set('skillGroups', skillGroups.value)
    storage.set('planProject', planProject.value)
    storage.set('outline', outline.value)
    storage.set('docs', docs.value)
    storage.set('plan', plan.value)
    storage.set('planDoc', planDoc.value)
    storage.set('activeTaskId', activeTaskId.value)
    storage.set('openTaskIds', openTaskIds.value)
    storage.set('resourcesConfirmed', resourcesConfirmed.value)
    storage.set('planConfirmed', planConfirmed.value)
    storage.set('baselineResult', baselineResult.value)
    storage.set('baselineDone', baselineDone.value)
    storage.set('onboarded', onboarded.value)
    storage.set('planSchemes', planSchemes.value)
    storage.set('activePlanId', activePlanId.value)
    scheduleServerSync()
  }

  // ===== v0.6 云同步：学习状态 JSON 快照整存整取（防抖 2s，未登录/失败静默降级） =====
  let syncTimer: number | null = null

  /** 当前学习状态序列化为快照字符串（v3：+ 多套方案） */
  function snapshotJson(): string {
    return JSON.stringify({
      v: 3,
      domain: selectedDomain.value,
      questionnaire: questionnaireAnswers.value,
      skillGroups: skillGroups.value,
      outline: outline.value,
      docs: docs.value,
      plan: plan.value,
      planDoc: planDoc.value,
      activeTaskId: activeTaskId.value,
      openTaskIds: openTaskIds.value,
      resourcesConfirmed: resourcesConfirmed.value,
      planConfirmed: planConfirmed.value,
      baselineResult: baselineResult.value,
      baselineDone: baselineDone.value,
      onboarded: onboarded.value,
      planSchemes: planSchemes.value,
      activePlanId: activePlanId.value
    })
  }

  function scheduleServerSync() {
    if (syncTimer !== null) return
    syncTimer = window.setTimeout(() => {
      syncTimer = null
      void syncLearningToServer()
    }, 2000)
  }

  async function syncLearningToServer(): Promise<void> {
    try {
      const { putLearning } = await import('@/services/progressService')
      await putLearning(snapshotJson())
    } catch {
      /* 未登录或后端不可用：静默降级为纯本地 */
    }
  }

  /** 应用服务端快照覆盖本地（登录引导 / 多端拉取；字段校验失败整体忽略） */
  function loadFromServer(json: string) {
    try {
      const snap = JSON.parse(json) as {
        domain?: Domain
        questionnaire?: QuestionnaireAnswers
        skillGroups?: SkillGroup[] | null
        outline?: OutlineTask[]
        docs?: LearningDoc[]
        plan?: PlanBlock[]
        activeTaskId?: string | null
        openTaskIds?: string[]
        resourcesConfirmed?: boolean
        planConfirmed?: boolean
        baselineResult?: BaselineResult | null
        baselineDone?: boolean
        onboarded?: boolean
        planSchemes?: PlanScheme[]
        activePlanId?: string | null
        planDoc?: string
      }
      if (snap.domain) {
        selectedDomain.value = domainList.find((d) => d.id === snap.domain?.id) ?? snap.domain
      }
      if (snap.questionnaire && Array.isArray(snap.questionnaire.categories)) {
        questionnaireAnswers.value = snap.questionnaire
      }
      if (snap.skillGroups === null || Array.isArray(snap.skillGroups)) {
        skillGroups.value = snap.skillGroups ?? null
      }
      if (Array.isArray(snap.outline)) {
        outline.value = snap.outline
      }
      if (Array.isArray(snap.docs)) docs.value = snap.docs
      if (Array.isArray(snap.plan)) plan.value = snap.plan
      planDoc.value = typeof snap.planDoc === 'string' ? snap.planDoc : ''
      planAgent.value = null
      agentDrawerOpen.value = false
      activeTaskId.value = typeof snap.activeTaskId === 'string' ? snap.activeTaskId : null
      // 悬挂校验：快照指向的任务不存在 → 落回第一个任务
      if (activeTaskId.value && !outline.value.some((t) => t.id === activeTaskId.value)) {
        activeTaskId.value = outline.value[0]?.id ?? null
      }
      openTaskIds.value = Array.isArray(snap.openTaskIds)
        ? snap.openTaskIds.filter((id) => outline.value.some((t) => t.id === id))
        : []
      if (activeTaskId.value && !openTaskIds.value.includes(activeTaskId.value)) {
        openTaskIds.value = [activeTaskId.value, ...openTaskIds.value]
      }
      if (typeof snap.resourcesConfirmed === 'boolean') resourcesConfirmed.value = snap.resourcesConfirmed
      if (typeof snap.planConfirmed === 'boolean') planConfirmed.value = snap.planConfirmed
      if (snap.baselineResult === null || (snap.baselineResult && Array.isArray(snap.baselineResult.items))) {
        baselineResult.value = snap.baselineResult ?? null
      }
      // 旧快照无 baselineDone：已有大纲/计划/测评结果即视为测评已完成
      baselineDone.value =
        typeof snap.baselineDone === 'boolean'
          ? snap.baselineDone
          : outline.value.length > 0 || plan.value.length > 0 || baselineResult.value !== null
      onboarded.value = Boolean(snap.onboarded)
      // v3：多套方案（旧 v2 快照无该字段 → 仅保留当前激活方案）
      if (Array.isArray(snap.planSchemes)) planSchemes.value = snap.planSchemes
      activePlanId.value = typeof snap.activePlanId === 'string' ? snap.activePlanId : null
      persist()
    } catch {
      console.warn('[问星] 学习快照解析失败，已保留本地数据')
    }
  }

  // ===== 动作 =====
  function selectDomain(domain: Domain) {
    const changed = selectedDomain.value?.id !== domain.id
    selectedDomain.value = domain
    onboarded.value = true
    questionnaireAnswers.value = null
    skillGroups.value = null
    if (changed) {
      // 切换行业：清空旧行业的大纲/文档/计划/选中任务，防串行业
      outline.value = []
      docs.value = []
      plan.value = []
      clearPlanAgent()
      activeTaskId.value = null
      openTaskIds.value = []
      resourcesConfirmed.value = false
      planConfirmed.value = false
      baselineResult.value = null
      baselineDone.value = false
      pendingPlanGroups.value = null
    }
    persist()
  }

  /** 打开（并把焦点切到）某个任务；单文档模式：切换时自动关闭上一个 */
  function openTask(id: string) {
    if (!outline.value.some((t) => t.id === id)) return
    openTaskIds.value = [id]
    activeTaskId.value = id
    persist()
  }

  /** 关闭任务标签：从标签栏移除；若关的是当前聚焦标签，焦点落到最后一个已打开标签 */
  function closeTask(id: string) {
    openTaskIds.value = openTaskIds.value.filter((x) => x !== id)
    if (activeTaskId.value === id) {
      activeTaskId.value =
        openTaskIds.value.length > 0 ? openTaskIds.value[openTaskIds.value.length - 1] : null
    }
    persist()
  }

  function setActiveTask(id: string | null) {
    if (id) {
      openTask(id)
      return
    }
    activeTaskId.value = null
    persist()
  }

  /** 提交学习合同问卷 → 调 AI 推荐技能组（任务锚定所选大类知识点） */
  async function requestRecommend(answers: QuestionnaireAnswers & { categoryTrees?: string[] }) {
    const domain = selectedDomain.value
    if (!domain) return
    const { categoryTrees, ...qa } = answers
    questionnaireAnswers.value = qa
    generatingRecommend.value = true
    recommendError.value = null
    try {
      const res = await recommendSkills({
        domain: domain.name,
        ...qa,
        categoryTrees: categoryTrees ?? []
      })
      skillGroups.value = res.skills
      planProject.value = res.project
      persist()
    } catch (e) {
      recommendError.value = e instanceof Error ? e.message : 'AI 调用失败'
    } finally {
      generatingRecommend.value = false
    }
  }

  /** 确认技能组 → 展平为待办任务表（继承旧任务进度/文档，解析知识点路径，联动星图状态球） */
  async function confirmSkills(groups: SkillGroup[]) {
    const domain = selectedDomain.value
    if (!domain || groups.length === 0) return
    // 已选大类树（用于把 AI 返回的 kp 原名解析为完整路径）
    const qa = questionnaireAnswers.value
    const ind = industryByName(domain.name)
    // 行业分类 md 按需加载（避免 20 份 md 进首屏）；仅在有问卷大类时才需要
    const root = ind && qa ? parseIndustryMd(await loadIndustryMd(domain.name)) : null
    const catTrees = root && qa
      ? qa.categories
          .map((c) => root.children.find((x) => x.name === c))
          .filter((x): x is NonNullable<typeof x> => !!x)
      : []
    // 旧任务索引：重新推荐确认时按 kp.name / title 继承旧任务的 id/状态/计数（文档按 id 关联，不丢）
    const oldByKp = new Map<string, OutlineTask>()
    const oldByTitle = new Map<string, OutlineTask>()
    for (const t of outline.value) {
      if (t.kp?.name) oldByKp.set(t.kp.name, t)
      oldByTitle.set(t.title, t)
    }
    const usedOld = new Set<string>()
    const tasks: OutlineTask[] = []
    for (const g of groups) {
      for (const item of g.items) {
        let kp: KpPath | undefined
        if (item.kp) {
          for (const cat of catTrees) {
            kp = findKpPath(cat, item.kp) ?? undefined
            if (kp) break
          }
        }
        const description = `${g.name} · ${item.description || g.description}`
        // AI 精细拆解出的四字段（缺省时保持 undefined，由任务卡降级渲染）
        const detail = {
          estMinutes: item.estMinutes,
          scaffoldLevel: item.scaffoldLevel,
          isCriticalPath: item.isCriticalPath,
          onboardingNote: item.onboardingNote,
          steps: item.steps,
          resources: item.resources,
          deliverable: item.deliverable,
          acceptance: item.acceptance,
          commonErrors: item.commonErrors
        }
        const old = (kp?.name ? oldByKp.get(kp.name) : undefined) ?? oldByTitle.get(item.title)
        if (old && !usedOld.has(old.id)) {
          // 命中旧任务：复用 id/status（关联文档不失联），内容用新值
          usedOld.add(old.id)
          tasks.push({ ...old, title: item.title, description, kp: kp ?? old.kp, ...detail })
        } else {
          tasks.push({
            id: `skill-${Date.now()}-${tasks.length}`,
            title: item.title,
            domainId: domain.id,
            status: 'unknown' as LearnStatus,
            description,
            kp,
            ...detail
          })
        }
      }
    }
    if (tasks.length === 0) return
    outline.value = tasks
    skillGroups.value = null
    // 五阶段：确认技能组后进入「学前测评」，测评结束/跳过后再生成计划
    pendingPlanGroups.value = groups
    plan.value = []
    planDoc.value = ''
    planConfirmed.value = false
    resourcesConfirmed.value = false
    // 新流程：测评在确认大纲之前已完成，不能把测评结果清空；旧流程仍在此处清空
    if (!FLAGS.PLAN_FLOW_V2) {
      baselineResult.value = null
      baselineDone.value = false
    }
    openTaskIds.value = []
    activeTaskId.value = null
    openTask(tasks[0].id)
    persist()
  }

  /**
   * 把第 1 步推荐/精细拆解后的技能组按所选大类解析成可用知识点项
   * （供学前测评抽题使用，不改变大纲）
   */
  async function resolveGroupItems(groups: SkillGroup[] | null = skillGroups.value) {
    const domain = selectedDomain.value
    if (!domain || !groups || groups.length === 0) return []
    const qa = questionnaireAnswers.value
    const ind = industryByName(domain.name)
    const root = ind && qa ? parseIndustryMd(await loadIndustryMd(domain.name)) : null
    const catTrees = root && qa
      ? qa.categories
          .map((c) => root.children.find((x) => x.name === c))
          .filter((x): x is NonNullable<typeof x> => !!x)
      : []
    const out: Array<{ id: string; title: string; description: string; kp?: KpPath }> = []
    groups.forEach((g, gi) => {
      g.items.forEach((item, ii) => {
        let kp: KpPath | undefined
        if (item.kp) {
          for (const cat of catTrees) {
            kp = findKpPath(cat, item.kp) ?? undefined
            if (kp) break
          }
        }
        out.push({
          id: `sg:${gi}:${ii}`,
          title: item.title,
          description: item.description || g.description || '',
          kp
        })
      })
    })
    return out
  }

  // ===== 学习计划：分块生成（深度掌握导向）=====
  // 排期纯逻辑（fmtDate / parseDay / scheduleBlocks / fallbackDrafts / groupsFromOutline / buildPlanMarkdown）
  // 已抽到 @/services/planScheduler —— 见文件顶部 import。

  /** 无待测评技能组时 → 用大纲任务反向拼出分块输入 */
  function groupsFromOutline(): SkillGroup[] {
    return groupsFromOutlineFn(outline.value)
  }

  // ===== 学习计划 Agent 运行轨迹（学习计划skill 五阶段 + 校验）=====
  const AGENT_PHASES: Array<{ id: string; title: string }> = [
    { id: 'requirement', title: '学习需求确认' },
    { id: 'resources', title: '学习资源准备' },
    { id: 'framework', title: '学习计划制定' },
    { id: 'visualization', title: '学习计划可视化' },
    { id: 'followup', title: '学习跟进计划' },
    { id: 'validate', title: '五阶段校验' }
  ]

  function openAgentDrawer() {
    agentDrawerOpen.value = true
  }
  function closeAgentDrawer() {
    agentDrawerOpen.value = false
  }
  /** 清空计划文档与 Agent 轨迹（切换/新建/删除方案时调用） */
  function clearPlanAgent() {
    planDoc.value = ''
    planAgent.value = null
    agentDrawerOpen.value = false
  }
  function startPlanAgent() {
    planAgent.value = {
      active: true,
      startedAt: Date.now(),
      phases: AGENT_PHASES.map((p) => ({
        ...p,
        status: 'pending' as const,
        artifacts: [],
        logs: []
      }))
    }
    agentDrawerOpen.value = true
  }
  /** 不可变更新某个阶段（保证抽屉响应式刷新） */
  function patchAgentPhase(id: string, patch: Partial<PlanAgentPhase>) {
    const run = planAgent.value
    if (!run) return
    planAgent.value = {
      ...run,
      phases: run.phases.map((p) => (p.id === id ? { ...p, ...patch } : p))
    }
  }
  function appendAgentArtifact(id: string, artifact: PlanAgentPhase['artifacts'][number]) {
    const run = planAgent.value
    if (!run) return
    planAgent.value = {
      ...run,
      phases: run.phases.map((p) =>
        p.id === id ? { ...p, artifacts: [...p.artifacts, artifact] } : p
      )
    }
  }
  function appendAgentLog(id: string, text: string) {
    const run = planAgent.value
    if (!run) return
    planAgent.value = {
      ...run,
      phases: run.phases.map((p) =>
        p.id === id ? { ...p, logs: [...p.logs, text].slice(-3) } : p
      )
    }
  }
  function setAgentValidation(result: PlanAgentValidation) {
    if (!planAgent.value) return
    planAgent.value = { ...planAgent.value, validation: result }
  }

  /** 学习计划存档到后端（后端未启动时静默降级为仅本地） */
  async function savePlanToServer(blocks: PlanBlock[]) {
    try {
      await http('/api/plans/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: selectedDomain.value?.name ?? '通用',
          title: `学习计划-${fmtDate(new Date())}`,
          // 优先存档 skill 五件套文档；旧数据/教材导入无文档时回退模块 Markdown
          content: planDoc.value.trim() || buildPlanMarkdown(blocks, selectedDomain.value, outline.value)
        })
      })
    } catch {
      /* 后端未启动：仅保留本地 */
    }
  }

  /** 生成学习计划：优先走 skill 五阶段 Agent（流式），失败回退旧接口与确定性分块 */
  async function generatePlan(groups: SkillGroup[], tasks: OutlineTask[]) {
    const domain = selectedDomain.value
    if (!domain || tasks.length === 0) {
      planError.value = '缺少学习领域或大纲任务，无法生成计划'
      return
    }
    generatingPlan.value = true
    planError.value = ''
    startPlanAgent()
    planDoc.value = ''
    try {
      // 学前测评结果文本化（薄弱技能点清单，供规划师优先安排薄弱模块）
      const baselineText = (baselineResult.value?.items ?? [])
        .filter((i) => i.total > 0)
        .sort((a, b) => a.rate - b.rate)
        .map((i) => `${i.title}：掌握率 ${Math.round(i.rate * 100)}%（答对 ${i.correct}/${i.total}）`)
        .join('；')
      const input = {
        domain: domain.name,
        project: planProject.value,
        groups: groups.map((g) => ({
          name: g.name,
          description: g.description,
          items: g.items.map((i) => i.title)
        })),
        questionnaire: questionnaireAnswers.value,
        baseline: baselineText,
        skillType: questionnaireAnswers.value?.skillType,
        groupType: questionnaireAnswers.value?.groupType
      }
      let drafts: PlanBlockDraft[] = []
      try {
        drafts = await generatePlanAgentStream(input, {
          onPhase: (id, status, ms, summary) =>
            patchAgentPhase(id, ms === undefined ? { status, summary } : { status, ms, summary }),
          onArtifact: (id, title, markdown) => appendAgentArtifact(id, { id, title, markdown }),
          onLog: (phase, text) => appendAgentLog(phase, text),
          onValidation: (result) => setAgentValidation(result),
          onPlanDoc: (markdown) => {
            planDoc.value = markdown
            if (planAgent.value) planAgent.value = { ...planAgent.value, planDoc: markdown }
          }
        })
        if (!Array.isArray(drafts) || drafts.length === 0) throw new Error('empty')
      } catch (e) {
        // Agent 失败：保留轨迹与错误，回退旧接口 → 确定性分块（保证功能不丢）
        const message = e instanceof Error ? e.message : '计划 Agent 运行失败'
        if (planAgent.value) planAgent.value = { ...planAgent.value, error: message }
        try {
          drafts = await generatePlanBlocks(input)
          if (!Array.isArray(drafts) || drafts.length === 0) throw new Error('empty')
        } catch {
          drafts = fallbackDrafts(groups, baselineResult.value)
        }
      }
      const blocks = scheduleBlocks(drafts, tasks)
      if (blocks.length === 0) {
        planError.value = 'AI 未返回可用模块，请重试或调整大纲后重新生成'
        return
      }
      plan.value = blocks
      planConfirmed.value = false
      persist()
      await savePlanToServer(blocks)
    } catch (e) {
      // 这里捕获的是流/排期之外的意外错误（Agent 内部已有降级）
      planError.value = e instanceof Error ? e.message : '学习计划生成失败'
    } finally {
      generatingPlan.value = false
      if (planAgent.value) planAgent.value = { ...planAgent.value, active: false }
    }
  }

  /** 学前测评结束（result = null 表示跳过）→ 新流程仅置完成标志；旧流程继续生成计划 */
  async function finishBaseline(result: BaselineResult | null) {
    baselineResult.value = result
    baselineDone.value = true
    persist()
    if (!FLAGS.PLAN_FLOW_V2) {
      const groups = pendingPlanGroups.value ?? groupsFromOutline()
      await generatePlan(groups, outline.value)
      pendingPlanGroups.value = null
    }
  }

  /** 阶段3：重新生成学习计划（AI 调用，调用方需先确认） */
  async function regeneratePlan() {
    const groups = pendingPlanGroups.value ?? groupsFromOutline()
    await generatePlan(groups, outline.value)
  }

  /** 阶段2 → 3：资源（文档/题库覆盖）已就绪 */
  function confirmResources() {
    resourcesConfirmed.value = true
    persist()
  }

  /** 阶段3 → 4：学习计划确认 */
  function confirmPlan() {
    // 1) 按今天重排：确认后日历当天就能看到进度
    if (plan.value.length > 0) {
      const blocks = plan.value.map((b) => ({ ...b }))
      let cursor = new Date()
      cursor.setHours(0, 0, 0, 0)
      for (const b of blocks) {
        const end = new Date(cursor)
        end.setDate(end.getDate() + Math.max(1, b.durationDays) - 1)
        b.startDate = fmtDate(cursor)
        b.endDate = fmtDate(end)
        cursor = new Date(end)
        cursor.setDate(cursor.getDate() + 1)
      }
      plan.value = blocks
    }
    planConfirmed.value = true
    // 2) 归档为方案并激活（学习日历按方案聚合展示）
    packActive()
    persist()
  }

  /** 阶段3：修改计划块（天数/优先级）→ 从该块起顺序重排日期 */
  function updateBlock(id: string, patch: { durationDays?: number; priority?: 'S' | 'A' | 'B' }) {
    const idx = plan.value.findIndex((b) => b.id === id)
    if (idx < 0) return
    const blocks = plan.value.map((b) => ({ ...b }))
    const cur = blocks[idx]
    if (patch.durationDays !== undefined) {
      cur.durationDays = Math.max(1, Math.round(patch.durationDays))
    }
    if (patch.priority !== undefined) cur.priority = patch.priority
    let cursor = parseDay(cur.startDate)
    for (let i = idx; i < blocks.length; i++) {
      const b = blocks[i]
      const end = new Date(cursor)
      end.setDate(end.getDate() + b.durationDays - 1)
      b.startDate = fmtDate(cursor)
      b.endDate = fmtDate(end)
      cursor = new Date(end)
      cursor.setDate(cursor.getDate() + 1)
    }
    plan.value = blocks
    planConfirmed.value = false
    persist()
  }

  /** 验收 = 看完：读完后标记该任务为已掌握（绿灯） */
  function markTaskDone(taskId: string) {
    const task = outline.value.find((t) => t.id === taskId)
    if (!task || task.status === 'deep') return
    task.status = 'deep'
    persist()
  }

  /** 定制下一个任务：从行业知识点树中挑选，追加到大纲末尾并选中 */
  function addTaskFromKp(kp: KpPath) {
    const domain = selectedDomain.value
    if (!domain) return
    if (outline.value.some((t) => t.kp?.name === kp.name)) return
    const task: OutlineTask = {
      id: `skill-${Date.now()}-${outline.value.length}`,
      title: kp.name,
      domainId: domain.id,
      status: 'unknown' as LearnStatus,
      description: `${kp.category} · ${kp.domain} · ${kp.stack}`,
      kp
    }
    outline.value.push(task)
    openTask(task.id)
    persist()
  }

  /** 返回学习合同：清空推荐结果与测评，确保向导回到第 1 步 */
  function restartContract() {
    skillGroups.value = null
    pendingPlanGroups.value = null
    questionnaireAnswers.value = null
    baselineResult.value = null
    baselineDone.value = false
    planProject.value = null
    persist()
  }

  /** 文档存档到后端：data/docs/<行业>/<标题>.md（后端未启动时静默降级为仅本地） */
  async function saveDocToServer(domain: Domain | null, task: OutlineTask, content: string) {
    try {
      await http('/api/docs/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: domain?.name ?? '通用',
          title: task.title,
          tags: [domain?.name ?? '', task.title],
          content
        })
      })
    } catch {
      /* 后端未启动：仅保留本地 */
    }
  }

  /**
   * 生成学习文档（默认当前聚焦任务，可传 taskId 指定 → 资源准备阶段逐个生成）
   * 注意：生成文档 ≠ 已掌握，「验收 = 看完」由 markTaskDone 显式标记
   */
  async function requestDoc(taskId?: string) {
    const task = (taskId ? outline.value.find((t) => t.id === taskId) : activeTask.value) ?? null
    if (!task) return
    const id = task.id
    // 已存在则跳过
    if (docs.value.some((d) => d.skillId === id)) return
    generatingDocId.value = id
    docError.value = null
    try {
      const domain = selectedDomain.value
      const qa = questionnaireAnswers.value
      // context：知识点完整路径（有 kp 时）+ 学习合同要素
      const kpPath = task.kp
        ? `${domain?.name ?? ''} / ${task.kp.category} / ${task.kp.domain} / ${task.kp.stack} / ${task.kp.name}`
        : ''
      const qaText = qa
        ? `目的：${qa.sopPath}；30天目标：${qa.goal30}；基线：${qa.baseline}；时间：${qa.timeCommitment}；障碍：${qa.obstacle}`
        : ''
      const context = [kpPath, qaText].filter(Boolean).join('；') || `${domain?.name ?? ''} 方向`
      const content = await generateDoc(task.title, context)
      docs.value.push({
        id: `doc-${Date.now()}`,
        skillId: id,
        content,
        generatedAt: Date.now(),
        source: 'ai'
      })
      // 存档到后端（按行业分文件夹，frontmatter 打标签）
      await saveDocToServer(domain, task, content)
      persist()
    } catch (e) {
      docError.value = e instanceof Error ? e.message : '文档生成失败'
    } finally {
      generatingDocId.value = null
    }
  }

  /** 用户反馈 → 调 AI 完善文档 → 更新本地并存档 */
  async function requestRevise(taskId: string, feedback: string) {
    const task = outline.value.find((t) => t.id === taskId)
    const doc = docs.value.find((d) => d.skillId === taskId)
    if (!task || !doc || !feedback.trim()) return
    revisingDocId.value = taskId
    docError.value = null
    try {
      const content = await reviseDoc(task.title, doc.content, feedback)
      doc.content = content
      doc.updatedAt = Date.now()
      await saveDocToServer(selectedDomain.value, task, content)
      persist()
    } catch (e) {
      docError.value = e instanceof Error ? e.message : '文档完善失败'
    } finally {
      revisingDocId.value = null
    }
  }

  function resetAll() {
    selectedDomain.value = null
    questionnaireAnswers.value = null
    skillGroups.value = null
    outline.value = []
    docs.value = []
    plan.value = []
    clearPlanAgent()
    activeTaskId.value = null
    openTaskIds.value = []
    resourcesConfirmed.value = false
    planConfirmed.value = false
    baselineResult.value = null
    baselineDone.value = false
    pendingPlanGroups.value = null
    planSchemes.value = []
    activePlanId.value = null
    wizardOpen.value = false
    onboarded.value = false
    // v0.5：清空全部进度包含知识点掌握度
    useMasteryStore().reset()
    persist()
    // v0.6：已登录时同步清空云端学习数据（失败静默）
    void (async () => {
      try {
        const { deleteProgress } = await import('@/services/progressService')
        await deleteProgress()
      } catch {
        /* 未登录或后端不可用：忽略 */
      }
    })()
  }

  return {
    // state
    selectedDomain,
    questionnaireAnswers,
    skillGroups,
    outline,
    docs,
    plan,
    planDoc,
    planProject,
    generatingPlan,
    planError,
    planAgent,
    agentDrawerOpen,
    activeTaskId,
    openTaskIds,
    resourcesConfirmed,
    planConfirmed,
    baselineResult,
    baselineDone,
    onboarded,
    generatingRecommend,
    recommendError,
    generatingDocId,
    revisingDocId,
    docError,
    // 多套学习计划方案
    planSchemes,
    activePlanId,
    activePlanName,
    allSchemes,
    wizardOpen,
    // getters
    availableDomains,
    activeTask,
    activeDoc,
    statusCount,
    // actions
    selectDomain,
    openTask,
    closeTask,
    setActiveTask,
    switchPlan,
    createPlan,
    importTextbookPlan,
    renameScheme,
    deleteScheme,
    requestRecommend,
    confirmSkills,
    resolveGroupItems,
    finishBaseline,
    confirmResources,
    confirmPlan,
    updateBlock,
    markTaskDone,
    generatePlan,
    regeneratePlan,
    openAgentDrawer,
    closeAgentDrawer,
    addTaskFromKp,
    restartContract,
    requestDoc,
    requestRevise,
    clearDocError,
    persist,
    snapshotJson,
    loadFromServer,
    reload,
    resetAll
  }
})
