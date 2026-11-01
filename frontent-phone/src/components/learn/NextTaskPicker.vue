<script setup lang="ts">
// 定制下一个任务（移动端全屏）：从当前行业知识点树中级联挑选（大类 → 领域 → 技术栈 → 知识点）
// 已在大纲中的知识点显示状态色且不可重复添加〔自桌面端 NextTaskPicker.vue 移植，双栏改单栏〕
import { computed, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { industryByName } from '@/data/industries'
import { parseIndustryMd } from '@/utils/learnMd'
import type { IndustryNode } from '@/utils/learnMd'
import type { KpPath, LearnStatus } from '@/types'

const props = defineProps<{ preselect?: KpPath | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const learnStore = useLearnStore()

// 当前行业知识点树
const industryRoot = computed<IndustryNode>(() => {
  const ind = industryByName(learnStore.selectedDomain?.name ?? '信息技术与软件')
  return parseIndustryMd(ind?.md ?? '')
})
const categories = computed(() => industryRoot.value.children)

// 级联状态：默认选中问卷所选大类 / 预选大类 / 第一个大类
const selCategory = ref<string>(
  props.preselect?.category ??
    learnStore.questionnaireAnswers?.categories?.[0] ??
    categories.value[0]?.name ??
    ''
)
const openDomains = ref<Set<string>>(new Set(props.preselect ? [props.preselect.domain] : []))
const openStacks = ref<Set<string>>(new Set(props.preselect ? [props.preselect.stack] : []))
const selected = ref<KpPath | null>(props.preselect ?? null)

const activeCategory = computed(() => categories.value.find((c) => c.name === selCategory.value) ?? null)

// 已在大纲中的知识点 → 状态（不可重复添加）
const kpTaken = computed<Map<string, LearnStatus>>(() => {
  const map = new Map<string, LearnStatus>()
  const domainId = learnStore.selectedDomain?.id
  for (const t of learnStore.outline) {
    if (t.domainId === domainId && t.kp) map.set(t.kp.name, t.status)
  }
  return map
})

const statusLabel: Record<LearnStatus, string> = { unknown: '待学', light: '轻掌握', deep: '深度掌握' }

function pickCategory(name: string) {
  if (selCategory.value === name) return
  selCategory.value = name
  openDomains.value = new Set()
  openStacks.value = new Set()
}

function toggleIn(set: { value: Set<string> }, key: string) {
  const next = new Set(set.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  set.value = next
}
function toggleDomain(key: string) {
  toggleIn(openDomains, key)
}
function toggleStack(key: string) {
  toggleIn(openStacks, key)
}

function pickKp(domain: string, stack: string, name: string) {
  if (kpTaken.value.has(name)) return
  selected.value = { category: selCategory.value, domain, stack, name }
}

function confirm() {
  if (!selected.value) return
  learnStore.addTaskFromKp(selected.value)
  emit('close')
}
</script>

<template>
  <div class="wx-picker-mask" @click.self="emit('close')">
    <div class="wx-picker">
      <div class="wx-picker-head">
        <div class="wx-picker-title">定制下一个任务</div>
        <div class="wx-picker-sub">从「{{ learnStore.selectedDomain?.name }}」知识点树中挑选下一个能力项</div>
        <button class="wx-picker-close" @click="emit('close')">✕</button>
      </div>

      <div class="wx-picker-body">
        <!-- 大类：横向 chips -->
        <div class="wx-picker-cats">
          <button
            v-for="cat in categories"
            :key="cat.name"
            class="wx-picker-cat wx-pressable"
            :class="{ active: selCategory === cat.name }"
            @click="pickCategory(cat.name)"
          >{{ cat.name }}</button>
        </div>

        <!-- 领域 → 技术栈 → 知识点 -->
        <div class="wx-picker-tree">
          <div v-for="dom in activeCategory?.children ?? []" :key="dom.name" class="wx-tree-domain">
            <button class="wx-tree-row wx-tree-l2 wx-pressable" @click="toggleDomain(dom.name)">
              <span class="wx-tree-arrow" :class="{ open: openDomains.has(dom.name) }">▸</span>
              <span>{{ dom.name }}</span>
            </button>
            <template v-if="openDomains.has(dom.name)">
              <div v-for="stack in dom.children" :key="stack.name" class="wx-tree-stack">
                <button class="wx-tree-row wx-tree-l3 wx-pressable" @click="toggleStack(dom.name + '/' + stack.name)">
                  <span class="wx-tree-arrow" :class="{ open: openStacks.has(dom.name + '/' + stack.name) }">▸</span>
                  <span>{{ stack.name }}</span>
                </button>
                <template v-if="openStacks.has(dom.name + '/' + stack.name)">
                  <button
                    v-for="kp in stack.children"
                    :key="kp.name"
                    class="wx-tree-row wx-tree-kp wx-pressable"
                    :class="{ selected: selected?.name === kp.name, taken: kpTaken.has(kp.name) }"
                    :disabled="kpTaken.has(kp.name)"
                    @click="pickKp(dom.name, stack.name, kp.name)"
                  >
                    <span v-if="kpTaken.has(kp.name)" class="wx-kp-dot" :class="`wx-dot-${kpTaken.get(kp.name)}`"></span>
                    <span class="wx-kp-name">{{ kp.name }}</span>
                    <span v-if="kpTaken.has(kp.name)" class="wx-kp-taken">{{ statusLabel[kpTaken.get(kp.name)!] }}</span>
                  </button>
                </template>
              </div>
            </template>
          </div>
          <div v-if="!activeCategory" class="wx-tree-empty">该行业暂无知识点数据</div>
        </div>
      </div>

      <div class="wx-picker-foot">
        <div class="wx-picker-sel">
          <template v-if="selected">
            已选：{{ selected.category }} / {{ selected.domain }} / {{ selected.stack }} / <strong>{{ selected.name }}</strong>
          </template>
          <template v-else>请选择一个知识点</template>
        </div>
        <div class="wx-picker-actions">
          <button class="wx-btn-ghost" @click="emit('close')">取消</button>
          <button class="wx-btn-gradient wx-pressable" :disabled="!selected" @click="confirm">
            添加为大纲任务
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wx-picker-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: stretch;
  background: color-mix(in srgb, var(--wx-bg-deep) 72%, transparent);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.wx-picker {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: calc(12px + env(safe-area-inset-top)) 14px 0;
  background: color-mix(in srgb, var(--wx-bg-deep) 97%, transparent);
}
.wx-picker-head {
  position: relative;
  flex-shrink: 0;
  text-align: center;
  padding: 2px 36px 10px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-picker-title {
  font-family: var(--wx-font-serif);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--wx-text-primary);
}
.wx-picker-sub {
  margin-top: 4px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
.wx-picker-close {
  position: absolute;
  top: 0;
  right: 0;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  background: transparent;
}

.wx-picker-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 9px;
}

/* 大类 chips */
.wx-picker-cats {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.wx-picker-cats::-webkit-scrollbar {
  display: none;
}
.wx-picker-cat {
  flex-shrink: 0;
  padding: 7px 12px;
  border-radius: var(--wx-radius-pill);
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  white-space: nowrap;
}
.wx-picker-cat.active {
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  border-color: var(--wx-border-glow);
  color: var(--wx-text-primary);
  font-weight: 600;
}

/* 右区树 */
.wx-picker-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 12px;
}
.wx-tree-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  text-align: left;
  border-radius: var(--wx-radius-md);
  border: 1px solid transparent;
  color: var(--wx-text-secondary);
  background: transparent;
}
.wx-tree-l2 {
  padding: 8px 11px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
  border-color: var(--wx-border-soft);
}
.wx-tree-l3 {
  padding: 7px 11px;
  font-size: 12px;
  margin: 4px 0 0 14px;
  width: calc(100% - 14px);
}
.wx-tree-arrow {
  font-size: 10px;
  color: var(--wx-text-muted);
  transition: transform var(--wx-duration-fast) var(--wx-ease-spring);
  flex-shrink: 0;
}
.wx-tree-arrow.open {
  transform: rotate(90deg);
}
.wx-tree-kp {
  padding: 7px 11px;
  font-size: 11.5px;
  margin: 3px 0 0 28px;
  width: calc(100% - 28px);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border-color: var(--wx-border-soft);
}
.wx-tree-kp.selected {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
  color: var(--wx-text-primary);
}
.wx-tree-kp.taken {
  opacity: 0.55;
}
.wx-kp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wx-kp-name {
  flex: 1;
  min-width: 0;
}
.wx-kp-taken {
  font-size: 9.5px;
  color: var(--wx-text-muted);
  font-family: var(--wx-font-mono);
}
.wx-tree-empty {
  padding: 20px;
  text-align: center;
  font-size: 11.5px;
  color: var(--wx-text-muted);
}

/* 底部 */
.wx-picker-foot {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px 0 calc(9px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--wx-border-soft);
}
.wx-picker-sel {
  font-size: 11px;
  color: var(--wx-text-tertiary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-picker-sel strong {
  color: var(--wx-color-primary-soft);
}
.wx-picker-actions {
  display: flex;
  gap: 8px;
}
.wx-btn-ghost {
  flex-shrink: 0;
  padding: 9px 16px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  background: transparent;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}
.wx-picker-actions .wx-btn-gradient {
  flex: 1;
  padding: 9px 12px;
  font-size: 12.5px;
}
</style>
