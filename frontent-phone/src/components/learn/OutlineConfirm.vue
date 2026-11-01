<script setup lang="ts">
// 技能组确认（向导第 3 步）：技能列表 → 选中技能的任务树（技能 → 任务）
// 移动端单栏版：技能横向切换、任务纵向展开；可删除/添加，AI 精细拆解先确认
import { ref, computed } from 'vue'
import { showConfirmDialog } from 'vant'
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

async function startRefine() {
  if (refining.value || groups.value.length === 0) return
  try {
    await showConfirmDialog({
      title: 'AI 精细拆解',
      message: '将调用 AI 精细拆解技能与大纲（含任务四字段），是否继续？'
    })
  } catch {
    return
  }
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
  try {
    await showConfirmDialog({
      title: '补充知识星图',
      message: `将向知识星图补充 ${newNodes.value.length} 个新节点，是否继续？`
    })
  } catch {
    return
  }
  try {
    await addAtlasExtra(learnStore.selectedDomain?.name ?? '', newNodes.value)
    nodeAdded.value = true
  } catch {
    refineError.value = '星图补充失败，可稍后重试；不影响大纲确认'
  }
}

// 当前选中的技能
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

function cancel() {
  learnStore.cancelRecommend()
}
</script>

<template>
  <div class="wx-oc">
    <div class="wx-oc-head">
      <div class="wx-oc-title">确认技能与大纲</div>
      <div class="wx-oc-sub">先选技能，再看任务。可让 AI 精细拆解成四字段任务，也可自行增删。</div>
      <button class="wx-oc-refine wx-pressable" :disabled="refining || groups.length === 0" @click="startRefine">
        {{ refining ? 'AI 拆解中…' : (refined ? '重新精细拆解' : 'AI 精细拆解大纲') }}
      </button>
    </div>

    <div class="wx-oc-scroll">
      <!-- 30 天项目锚点 -->
      <div v-if="learnStore.planProject" class="wx-oc-project">
        <span class="wx-oc-project-label">30 天交付项目</span>
        <span class="wx-oc-project-name">{{ learnStore.planProject.name }}</span>
        <span class="wx-oc-project-detail">{{ learnStore.planProject.deliverable }}</span>
        <span class="wx-oc-project-accept">验收：{{ learnStore.planProject.acceptance }}</span>
      </div>

      <p v-if="refineError" class="wx-oc-err">{{ refineError }}</p>

      <!-- 星图新节点提示 -->
      <div v-if="newNodes.length > 0 && !nodeAdded" class="wx-oc-newnodes">
        <div class="wx-oc-newnodes-head">
          <span>AI 发现 {{ newNodes.length }} 个星图还没有的学科/能力</span>
          <button class="wx-oc-newnodes-btn" @click="applyNewNodes">补充进星图</button>
        </div>
        <ul class="wx-oc-newnodes-list">
          <li v-for="(n, i) in newNodes" :key="i">
            {{ n.leixing ? n.leixing + ' / ' : '' }}{{ n.zu ? n.zu + ' / ' : '' }}{{ n.xiang }}：{{ n.kp.join('、') }}
          </li>
        </ul>
      </div>
      <div v-else-if="nodeAdded" class="wx-oc-newnodes done">已补充进知识星图</div>

      <!-- 技能切换：横向 chips -->
      <div class="wx-oc-chips">
        <button
          v-for="(g, gi) in groups"
          :key="gi"
          class="wx-oc-chip wx-pressable"
          :class="{ active: gi === selectedIdx }"
          @click="selectGroup(gi)"
        >
          <span class="wx-oc-chip-name">{{ g.name }}</span>
          <span class="wx-oc-chip-count">{{ g.items.length }}</span>
        </button>
        <div v-if="groups.length === 0" class="wx-oc-chip-empty">已清空，可在下方添加技能</div>
      </div>

      <!-- 当前技能任务树 -->
      <section v-if="current" class="wx-oc-tree">
        <div class="wx-oc-node-root">
          <span class="wx-oc-node-dot"></span>
          <div class="wx-oc-node-main">
            <div class="wx-oc-node-title">{{ current.name }}</div>
            <div v-if="current.description" class="wx-oc-node-label">{{ current.description }}</div>
          </div>
          <button class="wx-oc-skill-del" title="删除该技能" @click="removeGroup(selectedIdx)">✕</button>
        </div>

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
            <button class="wx-oc-child-del" title="删除该任务" @click="removeItem(ii)">✕</button>
          </li>
          <li v-if="current.items.length === 0" class="wx-oc-child-empty">该技能下暂无任务</li>
        </ul>

        <!-- 向当前技能添加任务 -->
        <div class="wx-oc-add">
          <input v-model="newItemTitle" type="text" placeholder="补充任务标题" />
          <input v-model="newItemDesc" type="text" placeholder="一句话说明（可选）" />
          <button class="wx-oc-add-btn wx-pressable" :disabled="!newItemTitle.trim()" @click="addItem">＋ 添加任务</button>
        </div>
      </section>
      <div v-else class="wx-oc-right-empty">请先在上方选择一个技能</div>

      <!-- 添加自定义技能 -->
      <div class="wx-oc-skill-add">
        <input v-model="newSkillName" type="text" placeholder="自定义技能名（如 Python）" />
        <input v-model="newSkillDesc" type="text" placeholder="一句话描述（可选）" />
        <button class="wx-oc-add-btn wx-pressable" :disabled="!newSkillName.trim()" @click="addCustomSkill">＋ 添加技能</button>
      </div>
    </div>

    <div class="wx-oc-foot">
      <button class="wx-oc-cancel wx-pressable" @click="cancel">← 返回问卷</button>
      <button class="wx-btn-gradient" :disabled="totalItems === 0" @click="confirm">
        确认生成待办表（{{ totalItems }}）
      </button>
    </div>
  </div>
</template>

<style scoped>
.wx-oc {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px 0;
}
.wx-oc-head {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 2px 10px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-oc-title {
  font-family: var(--wx-font-serif);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--wx-text-primary);
  text-align: center;
}
.wx-oc-sub {
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
  text-align: center;
}
.wx-oc-refine {
  align-self: center;
  padding: 7px 16px;
  border-radius: var(--wx-radius-pill);
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.wx-oc-refine:disabled {
  opacity: 0.5;
}

.wx-oc-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 2px 14px;
}

.wx-oc-project {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 34%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  font-size: 12px;
}
.wx-oc-project-label {
  font-size: 10.5px;
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
  font-size: 11px;
}

.wx-oc-err {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--wx-color-vermilion);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 35%, transparent);
  background: color-mix(in srgb, var(--wx-color-vermilion) 8%, transparent);
  border-radius: 6px;
}
.wx-oc-newnodes {
  padding: 9px 10px;
  border: 1px dashed var(--wx-border-glow);
  border-radius: 6px;
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
  gap: 10px;
  font-size: 12px;
  color: var(--wx-text-secondary);
}
.wx-oc-newnodes-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11.5px;
  border-radius: 4px;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border: none;
}
.wx-oc-newnodes-list {
  margin: 7px 0 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}

/* 技能 chips */
.wx-oc-chips {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.wx-oc-chips::-webkit-scrollbar {
  display: none;
}
.wx-oc-chip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: var(--wx-radius-pill);
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  white-space: nowrap;
}
.wx-oc-chip.active {
  color: var(--wx-text-primary);
  font-weight: 600;
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
}
.wx-oc-chip-count {
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-oc-chip-empty {
  padding: 8px 4px;
  font-size: 11.5px;
  color: var(--wx-text-muted);
}

/* 任务树 */
.wx-oc-tree {
  padding: 10px 12px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 30%, transparent);
}
.wx-oc-node-root {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
}
.wx-oc-node-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--wx-gradient-primary);
}
.wx-oc-node-main {
  flex: 1;
  min-width: 0;
}
.wx-oc-node-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-oc-node-label {
  margin-top: 2px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
.wx-oc-skill-del,
.wx-oc-child-del {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--wx-text-muted);
  border: 1px solid transparent;
  background: transparent;
}
.wx-oc-children {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.wx-oc-child {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 0 7px 16px;
  border-left: 1px solid var(--wx-border-soft);
}
.wx-oc-child-main {
  flex: 1;
  min-width: 0;
}
.wx-oc-child-title {
  font-size: 12.5px;
  color: var(--wx-text-primary);
  line-height: 1.5;
}
.wx-oc-child-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
.wx-oc-child-empty {
  padding: 8px 0 8px 16px;
  font-size: 11.5px;
  color: var(--wx-text-muted);
  border-left: 1px solid var(--wx-border-soft);
}
.wx-oc-right-empty {
  padding: 18px;
  text-align: center;
  font-size: 12px;
  color: var(--wx-text-muted);
}
.wx-oc-mini {
  margin-left: 5px;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 500;
  border-radius: 3px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
}
.wx-oc-mini.crit {
  color: var(--wx-color-vermilion);
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent);
}
.wx-oc-more {
  margin-top: 4px;
  padding: 0;
  font-size: 10.5px;
  color: var(--wx-color-primary-soft);
  background: transparent;
  border: none;
}
.wx-oc-detail {
  margin-top: 6px;
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 2px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
}
.wx-oc-detail p {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--wx-text-tertiary);
}
.wx-oc-detail b {
  margin-right: 5px;
  color: var(--wx-text-secondary);
  font-weight: 600;
}

/* 添加任务 / 添加技能 */
.wx-oc-add,
.wx-oc-skill-add {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-oc-skill-add {
  border-top: 0;
  padding: 10px;
  border: 1px dashed var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  margin-top: 0;
}
.wx-oc-add input,
.wx-oc-skill-add input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
  outline: none;
}
.wx-oc-add-btn {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
}
.wx-oc-add-btn:disabled {
  opacity: 0.4;
}

.wx-oc-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0 calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--wx-border-soft);
}
.wx-oc-cancel {
  flex-shrink: 0;
  padding: 10px 14px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  border-radius: 6px;
  border: 1px solid var(--wx-border-soft);
  background: transparent;
}
.wx-oc-foot .wx-btn-gradient {
  flex: 1;
  padding: 10px 12px;
  font-size: 13px;
}
</style>
