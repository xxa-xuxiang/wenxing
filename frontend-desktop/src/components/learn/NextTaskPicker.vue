<script setup lang="ts">
// 定制下一个任务：从当前行业知识点树中级联挑选（大类 → 领域 → 技术栈 → 知识点）
// 已在大纲中的知识点显示状态色且不可重复添加
import { computed, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { industryByName } from '@/data/industries'
import { parseIndustryMd } from '@/utils/industryMd'
import type { IndustryNode } from '@/utils/industryMd'
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
function toggleDomain(key: string) { toggleIn(openDomains, key) }
function toggleStack(key: string) { toggleIn(openStacks, key) }

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
    <div class="wx-picker wx-glass-strong">
      <div class="wx-picker-head">
        <div class="wx-picker-title">定制下一个任务</div>
        <div class="wx-picker-sub">从「{{ learnStore.selectedDomain?.name }}」知识点树中挑选下一个要学习的能力项</div>
      </div>

      <div class="wx-picker-body">
        <!-- 左列：大类 -->
        <div class="wx-picker-cats">
          <button
            v-for="cat in categories"
            :key="cat.name"
            class="wx-picker-cat wx-pressable"
            :class="{ active: selCategory === cat.name }"
            @click="pickCategory(cat.name)"
          >{{ cat.name }}</button>
        </div>

        <!-- 右区：领域 → 技术栈 → 知识点 -->
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
                    <span
                      v-if="kpTaken.has(kp.name)"
                      class="wx-kp-dot"
                      :class="`wx-dot-${kpTaken.get(kp.name)}`"
                    ></span>
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
            ✓ 添加为大纲任务
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
  z-index: 40;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.wx-picker {
  width: 760px;
  max-width: 100%;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  padding: 24px 24px 18px;
  gap: 14px;
}
.wx-picker-head { text-align: center; }
.wx-picker-title {
  font-family: var(--wx-font-serif);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.08em;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-picker-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

.wx-picker-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}

/* 左列：大类 */
.wx-picker-cats {
  width: 180px;
  flex-shrink: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.wx-picker-cat {
  text-align: left;
  padding: 9px 12px;
  border-radius: var(--wx-radius-md);
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-picker-cat:hover {
  border-color: var(--wx-border-glow);
  color: var(--wx-text-primary);
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
  min-width: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 4px;
}
.wx-tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border-radius: var(--wx-radius-md);
  border: 1px solid transparent;
  color: var(--wx-text-secondary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-tree-l2 {
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
  border-color: var(--wx-border-soft);
}
.wx-tree-l3 {
  padding: 6px 12px;
  font-size: 12.5px;
  margin: 4px 0 0 16px;
  width: calc(100% - 16px);
}
.wx-tree-l2:hover, .wx-tree-l3:hover { border-color: var(--wx-border-glow); }
.wx-tree-arrow {
  font-size: 11px;
  color: var(--wx-text-muted);
  transition: transform var(--wx-duration-fast) var(--wx-ease-spring);
  flex-shrink: 0;
}
.wx-tree-arrow.open { transform: rotate(90deg); }

.wx-tree-kp {
  padding: 6px 12px;
  font-size: 12px;
  margin: 3px 0 0 32px;
  width: calc(100% - 32px);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border-color: var(--wx-border-soft);
}
.wx-tree-kp:hover:not(:disabled) {
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  color: var(--wx-text-primary);
}
.wx-tree-kp.selected {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
  color: var(--wx-text-primary);
}
.wx-tree-kp.taken {
  opacity: 0.55;
  cursor: not-allowed;
}
.wx-kp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: none;
}
.wx-kp-name { flex: 1; min-width: 0; }
.wx-kp-taken {
  font-size: 10px;
  color: var(--wx-text-muted);
  font-family: var(--wx-font-mono);
}
.wx-tree-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--wx-text-muted);
}

/* 底部 */
.wx-picker-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-picker-sel {
  font-size: 12px;
  color: var(--wx-text-tertiary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-picker-sel strong { color: var(--wx-color-primary-soft); }
.wx-picker-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}
.wx-btn-ghost {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--wx-text-secondary);
  background: transparent;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-btn-ghost:hover {
  color: var(--wx-text-primary);
  border-color: var(--wx-border-glow);
}
</style>
