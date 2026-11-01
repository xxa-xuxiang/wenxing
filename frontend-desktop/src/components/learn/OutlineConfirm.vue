<script setup lang="ts">
// 技能组确认（v4 改版）：去圆角框化 —— 左右分栏 + 树状图
// 左栏：技能列表（扁平行 + 竖线选中指示）；右栏：选中技能的树状大纲（技能 → 任务）
// 第一层：技能（如 HTML、CSS、JavaScript）— 可删除
// 第二层：该技能的具体学习大纲 — 可删除/添加
import { ref, computed } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { refineOutline, type SkillGroup, type OutlineItem, type AtlasNewNode } from '@/services/aiService'
import { addAtlasExtra } from '@/services/atlasService'

const learnStore = useLearnStore()
const groups = ref<SkillGroup[]>(
  (learnStore.skillGroups ?? []).map((g) => ({
    name: g.name,
    description: g.description,
    reason: g.reason,
    items: [...g.items]
  }))
)
// ===== AI 精细拆解 =====
const refining = ref(false)
const refineError = ref('')
const refined = ref(false)
const newNodes = ref<AtlasNewNode[]>([])
const nodeAdded = ref(false)
// 任务卡展开（查看四字段/常见错误）
const expanded = ref<Set<string>>(new Set())

function itemKey(gi: number, ii: number): string {
  return `${gi}:${ii}`
}
function toggleExpand(gi: number, ii: number) {
  const k = itemKey(gi, ii)
  const next = new Set(expanded.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  expanded.value = next
}

/** 把学前测评结果文本化，供 AI 优先拆薄弱点 */
function baselineText(): string {
  return (learnStore.baselineResult?.items ?? [])
    .filter((i) => i.total > 0)
    .sort((a, b) => a.rate - b.rate)
    .map((i) => `${i.title}：掌握率 ${Math.round(i.rate * 100)}%（答对 ${i.correct}/${i.total}）`)
    .join('；')
}

function backToContract() {
  if (!window.confirm('返回问卷会清空当前技能组、学习合同与测评结果，并回到第 1 步，是否继续？')) return
  learnStore.restartContract()
}

function handleRefine() {
  if (refining.value) return
  if (groups.value.length === 0) {
    backToContract()
    return
  }
  void startRefine()
}

async function startRefine() {
  if (refining.value || groups.value.length === 0) return
  if (!window.confirm('将调用 AI 精细拆解技能与大纲（含任务四字段），是否继续？')) return
  refining.value = true
  refineError.value = ''
  try {
    const res = await refineOutline({
      domain: learnStore.selectedDomain?.name ?? '',
      categories: learnStore.questionnaireAnswers?.categories ?? [],
      project: learnStore.planProject,
      questionnaire: learnStore.questionnaireAnswers,
      baseline: baselineText(),
      skillGroups: groups.value
    })
    groups.value = res.groups
    selectedIdx.value = 0
    newNodes.value = res.newNodes ?? []
    refined.value = true
    expanded.value = new Set()
  } catch (e) {
    refineError.value = e instanceof Error ? e.message : 'AI 精细拆解失败'
  } finally {
    refining.value = false
  }
}

/** 把 AI 发现的新学科/能力补充进星图（失败不阻塞） */
async function applyNewNodes() {
  if (nodeAdded.value || newNodes.value.length === 0) return
  if (!window.confirm(`将向知识星图补充 ${newNodes.value.length} 个新节点，是否继续？`)) return
  try {
    await addAtlasExtra(learnStore.selectedDomain?.name ?? '', newNodes.value)
    nodeAdded.value = true
  } catch {
    refineError.value = '星图补充失败，可稍后重试；不影响大纲确认'
  }
}
// 当前选中的技能（左栏高亮 + 右栏树状图）
const selectedIdx = ref(0)
// 自定义新技能
const newSkillName = ref('')
const newSkillDesc = ref('')
// 当前技能新增任务
const newItemTitle = ref('')
const newItemDesc = ref('')

const totalItems = computed(() => groups.value.reduce((sum, g) => sum + g.items.length, 0))
const current = computed<SkillGroup | null>(() => groups.value[selectedIdx.value] ?? null)

function selectGroup(i: number) {
  selectedIdx.value = i
}

function removeGroup(i: number) {
  groups.value.splice(i, 1)
  if (selectedIdx.value >= groups.value.length) selectedIdx.value = Math.max(0, groups.value.length - 1)
}

function removeItem(itemIdx: number) {
  current.value?.items.splice(itemIdx, 1)
}

function addCustomSkill() {
  const n = newSkillName.value.trim()
  if (!n) return
  groups.value.push({
    name: n,
    description: newSkillDesc.value.trim() || '自定义技能',
    reason: '用户手动添加',
    items: []
  })
  selectedIdx.value = groups.value.length - 1
  newSkillName.value = ''
  newSkillDesc.value = ''
}

function addItem() {
  const g = current.value
  const t = newItemTitle.value.trim()
  if (!g || !t) return
  const item: OutlineItem = {
    title: t,
    description: newItemDesc.value.trim()
  }
  g.items.push(item)
  newItemTitle.value = ''
  newItemDesc.value = ''
}

function confirm() {
  void learnStore.confirmSkills(groups.value)
}
</script>

<template>
  <div class="wx-oc">
    <div class="wx-oc-head">
      <div class="wx-oc-title">确认学习计划</div>
      <div class="wx-oc-sub">
        左侧选技能，右侧看大纲。可先用 AI 精细拆解成四字段任务，也可自行增删。
      </div>
      <div class="wx-oc-head-actions">
        <button
          class="wx-oc-refine wx-pressable"
          :disabled="refining"
          @click="handleRefine"
        >{{ refining ? 'AI 精细拆解中…' : groups.length === 0 ? '重新生成技能组' : (refined ? '重新精细拆解' : 'AI 精细拆解大纲') }}</button>
      </div>
    </div>

    <!-- 30 天项目锚点：技能组与任务产出都围绕它 -->
    <div v-if="learnStore.planProject" class="wx-oc-project" data-test="outline-project">
      <span class="wx-oc-project-label">30 天交付项目</span>
      <span class="wx-oc-project-name">{{ learnStore.planProject.name }}</span>
      <span class="wx-oc-project-detail">{{ learnStore.planProject.deliverable }}</span>
      <span class="wx-oc-project-accept">验收：{{ learnStore.planProject.acceptance }}</span>
    </div>

    <p v-if="refineError" class="wx-oc-err">{{ refineError }}</p>

    <!-- 星图新节点提示 -->
    <div v-if="newNodes.length > 0 && !nodeAdded" class="wx-oc-newnodes">
      <div class="wx-oc-newnodes-head">
        <span>AI 发现 {{ newNodes.length }} 个知识星图里还没有的学科/能力</span>
        <button class="wx-oc-newnodes-btn" @click="applyNewNodes">补充进星图</button>
      </div>
      <ul class="wx-oc-newnodes-list">
        <li v-for="(n, i) in newNodes" :key="i">
          {{ n.leixing ? n.leixing + ' / ' : '' }}{{ n.zu ? n.zu + ' / ' : '' }}{{ n.xiang }}：{{ n.kp.join('、') }}
        </li>
      </ul>
    </div>
    <div v-else-if="nodeAdded" class="wx-oc-newnodes done">已补充进知识星图</div>

    <div class="wx-oc-body">
      <!-- 左栏：技能列表（扁平分栏，无圆角卡片） -->
      <aside class="wx-oc-left">
        <div class="wx-oc-left-head">技能（{{ groups.length }}）</div>
        <ul class="wx-oc-skill-list">
          <li
            v-for="(g, gi) in groups"
            :key="gi"
            class="wx-oc-skill"
            :class="{ active: gi === selectedIdx }"
            @click="selectGroup(gi)"
          >
            <div class="wx-oc-skill-main">
              <div class="wx-oc-skill-name">{{ g.name }}</div>
              <div class="wx-oc-skill-desc">{{ g.description }}</div>
            </div>
            <span class="wx-oc-skill-meta">{{ g.items.length }}</span>
            <button class="wx-oc-skill-del wx-pressable" title="删除该技能" @click.stop="removeGroup(gi)">✕</button>
          </li>
          <li v-if="groups.length === 0" class="wx-oc-skill-empty">技能组为空：可手动添加技能，或点「重新生成技能组」返回学习合同。</li>
        </ul>
      </aside>

      <!-- 右栏：树状图（技能 → 任务） -->
      <section class="wx-oc-right">
        <template v-if="current">
          <div class="wx-oc-tree">
            <!-- 根节点：技能 -->
            <div class="wx-oc-node-root">
              <span class="wx-oc-node-dot"></span>
              <div class="wx-oc-node-main">
                <div class="wx-oc-node-title">{{ current.name }}</div>
                <div v-if="current.description" class="wx-oc-node-label">{{ current.description }}</div>
              </div>
            </div>
            <!-- 子节点：学习任务 -->
            <ul class="wx-oc-children">
              <li
                v-for="(item, ii) in current.items"
                :key="ii"
                class="wx-oc-child"
                :class="{ last: ii === current.items.length - 1 }"
              >
                <div class="wx-oc-child-main">
                  <div class="wx-oc-child-title">
                    {{ item.title }}
                    <span v-if="item.estMinutes" class="wx-oc-mini">{{ item.estMinutes }} 分钟</span>
                    <span v-if="item.isCriticalPath" class="wx-oc-mini crit">关键路径</span>
                  </div>
                  <div v-if="item.description" class="wx-oc-child-desc">{{ item.description }}</div>
                  <button
                    v-if="item.steps?.length || item.deliverable || item.acceptance?.length || item.commonErrors?.length"
                    class="wx-oc-more"
                    @click="toggleExpand(selectedIdx, ii)"
                  >{{ expanded.has(itemKey(selectedIdx, ii)) ? '收起四字段' : '查看四字段' }}</button>
                  <div v-if="expanded.has(itemKey(selectedIdx, ii))" class="wx-oc-detail">
                    <p v-if="item.steps?.length"><b>怎么做</b>{{ item.steps.join('；') }}</p>
                    <p v-if="item.deliverable"><b>做出什么</b>{{ item.deliverable }}</p>
                    <p v-if="item.acceptance?.length"><b>怎么算会</b>{{ item.acceptance.join('；') }}</p>
                    <p v-if="item.commonErrors?.length"><b>常见错误</b>{{ item.commonErrors.map((e) => `${e.error}→${e.diagnose}`).join('；') }}</p>
                  </div>
                </div>
                <button class="wx-oc-child-del wx-pressable" title="删除该任务" @click="removeItem(ii)">✕</button>
              </li>
              <li v-if="current.items.length === 0" class="wx-oc-child-empty">该技能下暂无任务</li>
            </ul>
          </div>

          <!-- 向当前技能添加任务 -->
          <div class="wx-oc-add">
            <input
              v-model="newItemTitle"
              type="text"
              placeholder="补充任务标题"
              @keydown.enter="addItem"
            />
            <input
              v-model="newItemDesc"
              type="text"
              placeholder="一句话说明（可选）"
              @keydown.enter="addItem"
            />
            <button class="wx-oc-add-btn wx-pressable" :disabled="!newItemTitle.trim()" @click="addItem">＋ 添加任务</button>
          </div>
        </template>
        <div v-else class="wx-oc-right-empty">
          <span>当前没有技能组</span>
          <button class="wx-oc-add-btn wx-pressable" @click="backToContract">返回学习合同重新生成</button>
        </div>
      </section>
    </div>

    <!-- 添加自定义技能 -->
    <div class="wx-oc-skill-add">
      <input v-model="newSkillName" type="text" placeholder="自定义技能名（如 Python）" @keydown.enter="addCustomSkill" />
      <input v-model="newSkillDesc" type="text" placeholder="一句话描述（可选）" @keydown.enter="addCustomSkill" />
      <button class="wx-oc-add-btn wx-pressable" :disabled="!newSkillName.trim()" @click="addCustomSkill">＋ 添加技能</button>
    </div>

    <div class="wx-oc-foot">
      <button class="wx-oc-cancel wx-pressable" @click="backToContract">← 返回问卷</button>
      <button class="wx-btn-gradient" :disabled="totalItems === 0" @click="confirm">
        ✓ 确认生成待办表（{{ totalItems }} 项）
      </button>
    </div>
  </div>
</template>

<style scoped>
.wx-oc {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 18px;
  gap: 12px;
}
.wx-oc-project {
  flex-shrink: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 34%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  font-size: 12.5px;
}
.wx-oc-project-label {
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--wx-text-muted);
}
.wx-oc-project-name {
  font-family: var(--wx-font-serif);
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-oc-project-detail {
  color: var(--wx-text-secondary);
}
.wx-oc-project-accept {
  color: var(--wx-text-tertiary);
  font-size: 11.5px;
}
.wx-oc-head {
  flex-shrink: 0;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
  text-align: center;
}
.wx-oc-title {
  font-family: var(--wx-font-serif);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.08em;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-oc-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

/* 左右分栏 */
.wx-oc-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0;
  border: 1px solid var(--wx-border-soft);
}
.wx-oc-left {
  width: 38%;
  flex-shrink: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wx-border-soft);
}
.wx-oc-left-head {
  flex-shrink: 0;
  padding: 8px 12px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--wx-text-muted);
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-oc-skill-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.wx-oc-skill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-left: 2px solid transparent;
  border-bottom: 1px solid var(--wx-border-soft);
  cursor: pointer;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft),
    border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-oc-skill:hover { background: color-mix(in srgb, var(--wx-ink) 4%, transparent); }
.wx-oc-skill.active {
  border-left-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-oc-skill-main { flex: 1; min-width: 0; }
.wx-oc-skill-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-oc-skill-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-oc-skill-meta {
  flex-shrink: 0;
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-oc-skill-del,
.wx-oc-child-del {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 2px;
  font-size: 11px;
  color: var(--wx-text-muted);
  border: 1px solid transparent;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-oc-skill-del:hover,
.wx-oc-child-del:hover {
  color: var(--wx-color-vermilion);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent);
}
.wx-oc-skill-empty {
  padding: 14px 12px;
  font-size: 12px;
  color: var(--wx-text-muted);
}

/* 右栏：树状图 */
.wx-oc-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  gap: 10px;
}
.wx-oc-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.wx-oc-node-root {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0 8px;
}
.wx-oc-node-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--wx-gradient-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--wx-color-primary) 70%, transparent);
}
.wx-oc-node-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-oc-node-label {
  margin-top: 2px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
.wx-oc-children { display: flex; flex-direction: column; }
.wx-oc-child {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0 7px 18px;
  border-left: 1px solid var(--wx-border-soft);
}
.wx-oc-child::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 12px;
  height: 1px;
  background: var(--wx-border-soft);
}
.wx-oc-child-main { flex: 1; min-width: 0; }
.wx-oc-child-title {
  font-size: 13px;
  color: var(--wx-text-primary);
}
.wx-oc-child-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
.wx-oc-child-empty {
  padding: 8px 0 8px 18px;
  font-size: 12px;
  color: var(--wx-text-muted);
  border-left: 1px solid var(--wx-border-soft);
}
.wx-oc-right-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 12px;
  color: var(--wx-text-muted);
}

/* 添加任务 / 添加技能 */
.wx-oc-add,
.wx-oc-skill-add {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-oc-add { padding-top: 8px; border-top: 1px solid var(--wx-border-soft); }
.wx-oc-add input,
.wx-oc-skill-add input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 2px;
  font-size: 12px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-oc-add-btn {
  flex-shrink: 0;
  padding: 7px 12px;
  border-radius: 2px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-oc-add-btn:hover:not(:disabled) { color: var(--wx-text-on-accent); background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent); }
.wx-oc-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.wx-oc-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-oc-cancel {
  padding: 8px 14px;
  font-size: 13px;
  color: var(--wx-text-secondary);
  border-radius: 2px;
  border: 1px solid var(--wx-border-soft);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-oc-cancel:hover { color: var(--wx-text-primary); background: color-mix(in srgb, var(--wx-ink) 6%, transparent); }

/* ===== AI 精细拆解 / 四字段 / 星图补充 ===== */
.wx-oc-head-actions { margin-left: auto; }
.wx-oc-refine {
  padding: 7px 16px;
  border-radius: 2px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-oc-refine:hover { background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); }
.wx-oc-refine:disabled { opacity: 0.5; cursor: not-allowed; }
.wx-oc-err {
  margin: 0 4px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--wx-color-vermilion);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent);
}
.wx-oc-newnodes {
  margin: 0 4px;
  padding: 10px 12px;
  border: 1px dashed var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
}
.wx-oc-newnodes.done {
  font-size: 12px;
  color: var(--wx-color-yanqing);
  border-color: color-mix(in srgb, var(--wx-color-yanqing) 35%, transparent);
}
.wx-oc-newnodes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
}
.wx-oc-newnodes-btn {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 2px;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border: none;
}
.wx-oc-newnodes-list {
  margin: 8px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
}
.wx-oc-mini {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10.5px;
  font-weight: 500;
  border-radius: 3px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-oc-mini.crit { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }
.wx-oc-more {
  margin-top: 4px;
  padding: 0;
  font-size: 11px;
  color: var(--wx-color-primary-soft);
  background: transparent;
  border: none;
}
.wx-oc-detail {
  margin-top: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 2px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
}
.wx-oc-detail p { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--wx-text-tertiary); }
.wx-oc-detail b { margin-right: 6px; color: var(--wx-text-secondary); font-weight: 600; }
</style>
