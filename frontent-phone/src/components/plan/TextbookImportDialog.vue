<script setup lang="ts">
// 教材导入（移动端全屏覆盖层）：选 epub → 确认上传解析 → 勾选章节 → 生成学习计划
// 硬约束：不自动发请求；「解析教材」「生成学习计划」均先出内联确认条，用户同意后才执行
import { computed, ref } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { importEpub, getSections } from '@/services/textbookService'
import type { TextbookNode, TextbookTree } from '@/types/textbook'

const emit = defineEmits<{ (e: 'close'): void }>()
const learnStore = useLearnStore()

type Phase = 'pick' | 'tree' | 'generating'
const phase = ref<Phase>('pick')
const busy = ref(false)
const error = ref('')

// ===== 选文件 =====
const file = ref<File | null>(null)
const confirmUpload = ref(false)

const MAX_BYTES = 80 * 1024 * 1024
const MAX_TEXT_CHARS = 2_000_000

function pickFile(f: File | null | undefined) {
  error.value = ''
  confirmUpload.value = false
  if (!f) return
  if (!/\.epub$/i.test(f.name)) {
    error.value = '请选择 .epub 文件'
    file.value = null
    return
  }
  if (f.size > MAX_BYTES) {
    error.value = 'epub 文件过大（上限 80MB）'
    file.value = null
    return
  }
  file.value = f
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  pickFile(input.files?.[0])
  input.value = ''
}

const fileSizeText = computed(() => {
  const size = file.value?.size ?? 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
})

// ===== 解析 =====
async function doImport() {
  if (!file.value) return
  confirmUpload.value = false
  busy.value = true
  error.value = ''
  try {
    const result = await importEpub(file.value)
    tree.value = result.tree
    flat.value = flatten(result.tree.nodes)
    selected.value = new Set(flat.value.map((n) => n.id))
    phase.value = 'tree'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '解析失败'
  } finally {
    busy.value = false
  }
}

// ===== 章节树 =====
const tree = ref<TextbookTree | null>(null)
const flat = ref<TextbookNode[]>([])
const selected = ref<Set<string>>(new Set())
const confirmGenerate = ref(false)
const showWarnings = ref(false)

function flatten(list: TextbookNode[], out: TextbookNode[] = []): TextbookNode[] {
  for (const node of list) {
    out.push(node)
    flatten(node.children, out)
  }
  return out
}

function hasChildren(node: TextbookNode): boolean {
  return node.children.length > 0
}

function branchIds(node: TextbookNode): string[] {
  return flatten([node]).map((n) => n.id)
}

/** 全选 / 半选 / 未选 */
function checkState(node: TextbookNode): 'all' | 'part' | 'none' {
  const ids = branchIds(node)
  const hit = ids.filter((id) => selected.value.has(id)).length
  if (hit === 0) return 'none'
  return hit === ids.length ? 'all' : 'part'
}

function toggleNode(node: TextbookNode) {
  const ids = branchIds(node)
  const next = new Set(selected.value)
  if (checkState(node) === 'all') ids.forEach((id) => next.delete(id))
  else ids.forEach((id) => next.add(id))
  selected.value = next
  confirmGenerate.value = false
}

function selectAll() {
  selected.value = new Set(flat.value.map((n) => n.id))
  confirmGenerate.value = false
}

function selectNone() {
  selected.value = new Set()
  confirmGenerate.value = false
}

const selectedNodes = computed(() => flat.value.filter((n) => selected.value.has(n.id)))
const selectedChars = computed(() => selectedNodes.value.reduce((sum, n) => sum + n.charCount, 0))
const tooLarge = computed(() => selectedChars.value > MAX_TEXT_CHARS)

const charsText = computed(() => {
  const n = selectedChars.value
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万字` : `${n} 字`
})

const warnings = computed(() => tree.value?.warnings ?? [])

// ===== 生成计划 =====
async function doGenerate() {
  const slug = tree.value?.slug
  if (!slug) return
  confirmGenerate.value = false
  busy.value = true
  error.value = ''
  phase.value = 'generating'
  try {
    const ids = selectedNodes.value.map((n) => n.id)
    const sections = await getSections(slug, ids)
    learnStore.importTextbookPlan({ tree: tree.value as TextbookTree, sections, selectedIds: ids })
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '生成学习计划失败'
    phase.value = 'tree'
  } finally {
    busy.value = false
  }
}

function reset() {
  phase.value = 'pick'
  file.value = null
  tree.value = null
  flat.value = []
  selected.value = new Set()
  error.value = ''
  confirmUpload.value = false
  confirmGenerate.value = false
}
</script>

<template>
  <div class="tbk-mask">
    <div class="tbk">
      <header class="tbk-head">
        <div class="tbk-title">
          <span class="tbk-mark">✦</span>
          <span>从教材导入</span>
          <span v-if="tree" class="tbk-sub">{{ tree.title }}</span>
        </div>
        <button class="tbk-close" :disabled="busy" title="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="tbk-body">
        <div v-if="error" class="tbk-error">
          <span>⚠</span>
          <span class="tbk-error-text">{{ error }}</span>
        </div>

        <!-- 第一步：选文件 -->
        <template v-if="phase === 'pick'">
          <div class="tbk-drop">
            <div class="tbk-drop-mark">⇪</div>
            <div class="tbk-drop-title">选择 epub 文件</div>
            <div class="tbk-drop-sub">支持 DRM-free 的 .epub，单个文件不超过 80MB</div>
            <label class="tbk-pick">
              选择文件
              <input type="file" accept=".epub,application/epub+zip" hidden @change="onFileChange" />
            </label>
          </div>

          <div v-if="file" class="tbk-file">
            <span class="tbk-file-name">{{ file.name }}</span>
            <span class="tbk-file-size">{{ fileSizeText }}</span>
            <button class="tbk-file-clear" :disabled="busy" @click="reset">移除</button>
          </div>

          <!-- 确认条：上传前必须确认 -->
          <div v-if="confirmUpload" class="tbk-confirm">
            <span class="tbk-confirm-text">
              将上传《{{ file?.name }}》（约 {{ fileSizeText }}）到后端解析，是否继续？
            </span>
            <div class="tbk-confirm-actions">
              <button class="tbk-btn-ghost" @click="confirmUpload = false">取消</button>
              <button class="tbk-btn" :disabled="busy" @click="doImport">
                {{ busy ? '解析中…' : '开始上传' }}
              </button>
            </div>
          </div>

          <div class="tbk-foot">
            <span class="tbk-hint">
              {{ busy ? '正在上传并解析教材…' : '解析在本地后端完成，不会上传到第三方' }}
            </span>
            <button class="tbk-btn" :disabled="!file || busy" @click="confirmUpload = true">解析教材</button>
          </div>
        </template>

        <!-- 第二步：章节勾选 -->
        <template v-else-if="phase === 'tree'">
          <div class="tbk-bar">
            <span class="tbk-count">已选 {{ selectedNodes.length }}/{{ flat.length }} 节 · 约 {{ charsText }}</span>
            <span class="tbk-bar-actions">
              <button class="tbk-mini" @click="selectAll">全选</button>
              <button class="tbk-mini" @click="selectNone">全不选</button>
              <button v-if="warnings.length" class="tbk-mini" @click="showWarnings = !showWarnings">
                提示 {{ warnings.length }}
              </button>
            </span>
          </div>

          <div v-if="showWarnings && warnings.length" class="tbk-warn">
            <div v-for="(w, i) in warnings.slice(0, 20)" :key="i" class="tbk-warn-item">· {{ w }}</div>
          </div>

          <div class="tbk-tree">
            <div
              v-for="node in flat"
              :key="node.id"
              class="tbk-node"
              :style="{ paddingLeft: `${10 + (node.level - 1) * 14}px` }"
            >
              <span
                class="tbk-check"
                :class="`st-${checkState(node)}`"
                @click.stop="toggleNode(node)"
              >{{ checkState(node) === 'all' ? '✓' : checkState(node) === 'part' ? '−' : '' }}</span>
              <span class="tbk-node-title" @click.stop="toggleNode(node)">{{ node.title }}</span>
              <span v-if="hasChildren(node)" class="tbk-node-meta">{{ branchIds(node).length }} 节</span>
            </div>
          </div>

          <div v-if="tooLarge" class="tbk-warn tbk-warn-strong">
            已选正文约 {{ charsText }}，超过 200 万字上限，请减少勾选后再生成
          </div>

          <!-- 确认条：写入计划前必须确认 -->
          <div v-if="confirmGenerate" class="tbk-confirm">
            <span class="tbk-confirm-text">
              将把 {{ selectedNodes.length }} 节写入学习计划，当前计划会归档，是否继续？
            </span>
            <div class="tbk-confirm-actions">
              <button class="tbk-btn-ghost" @click="confirmGenerate = false">取消</button>
              <button class="tbk-btn" :disabled="busy" @click="doGenerate">确认生成</button>
            </div>
          </div>

          <div class="tbk-foot">
            <button class="tbk-btn-ghost" :disabled="busy" @click="reset">重新选择</button>
            <button
              class="tbk-btn"
              :disabled="busy || selectedNodes.length === 0 || tooLarge"
              @click="confirmGenerate = true"
            >生成学习计划</button>
          </div>
        </template>

        <!-- 第三步：生成中 -->
        <div v-else class="tbk-loading">
          <div class="tbk-loading-mark wx-breathe">✦</div>
          <div class="tbk-loading-text">正在读取章节正文并生成计划模块…</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tbk-mask {
  position: fixed;
  inset: 0;
  z-index: 62;
  display: flex;
  align-items: stretch;
  background: color-mix(in srgb, var(--wx-bg-deep) 82%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.tbk {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  background: color-mix(in srgb, var(--wx-bg-deep) 98%, transparent);
  overflow: hidden;
}
.tbk-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.tbk-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
  font-family: var(--wx-font-serif);
}
.tbk-mark {
  color: var(--wx-color-primary);
}
.tbk-sub {
  min-width: 0;
  font-size: 11px;
  font-weight: 400;
  color: var(--wx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tbk-close {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
  background: transparent;
}
.tbk-close:disabled {
  opacity: 0.4;
}

.tbk-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
  overflow: hidden;
}
.tbk-error {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  font-size: 11.5px;
  color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 32%, transparent);
  border-radius: 6px;
}
.tbk-error-text {
  min-width: 0;
}

/* 选择区 */
.tbk-drop {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 26px 16px;
  text-align: center;
  border: 1px dashed var(--wx-border-soft);
  border-radius: 6px;
}
.tbk-drop-mark {
  font-size: 24px;
  color: var(--wx-color-primary-soft);
}
.tbk-drop-title {
  font-size: 13px;
  color: var(--wx-text-primary);
}
.tbk-drop-sub {
  font-size: 11px;
  color: var(--wx-text-muted);
}
.tbk-pick {
  margin-top: 6px;
  padding: 8px 22px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}
.tbk-file {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  font-size: 12px;
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border-radius: 6px;
}
.tbk-file-name {
  flex: 1;
  min-width: 0;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tbk-file-size {
  flex-shrink: 0;
  color: var(--wx-text-tertiary);
  font-family: var(--wx-font-mono);
}
.tbk-file-clear {
  flex-shrink: 0;
  color: var(--wx-text-muted);
  font-size: 11.5px;
  background: transparent;
}

/* 确认条 */
.tbk-confirm {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px 11px;
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  border: 1px solid var(--wx-border-glow);
  border-radius: 6px;
}
.tbk-confirm-text {
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--wx-text-secondary);
}
.tbk-confirm-actions {
  display: flex;
  gap: 8px;
}
.tbk-confirm-actions .tbk-btn,
.tbk-confirm-actions .tbk-btn-ghost {
  flex: 1;
}

/* 底部操作 */
.tbk-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.tbk-hint {
  flex: 1;
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.tbk-btn {
  padding: 9px 18px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border: none;
  border-radius: var(--wx-radius-pill);
}
.tbk-btn:disabled {
  opacity: 0.45;
}
.tbk-btn-ghost {
  padding: 8px 15px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  background: transparent;
}
.tbk-btn-ghost:disabled {
  opacity: 0.45;
}

/* 章节树 */
.tbk-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
}
.tbk-bar-actions {
  display: flex;
  gap: 6px;
}
.tbk-mini {
  padding: 3px 9px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: 999px;
  background: transparent;
}
.tbk-warn {
  flex-shrink: 0;
  max-height: 100px;
  overflow-y: auto;
  padding: 7px 11px;
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border-radius: 6px;
}
.tbk-warn-item {
  line-height: 1.7;
}
.tbk-warn-strong {
  color: var(--wx-color-vermilion);
  background: color-mix(in srgb, var(--wx-color-vermilion) 10%, transparent);
}
.tbk-tree {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
}
.tbk-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 9px 0;
  font-size: 12px;
  color: var(--wx-text-secondary);
  border-bottom: 1px solid color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.tbk-check {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  color: var(--wx-text-on-accent);
  border: 1px solid var(--wx-border-soft);
  border-radius: 3px;
}
.tbk-check.st-all {
  background: color-mix(in srgb, var(--wx-color-primary) 85%, transparent);
  border-color: var(--wx-border-glow);
}
.tbk-check.st-part {
  background: color-mix(in srgb, var(--wx-color-primary) 40%, transparent);
  border-color: var(--wx-border-glow);
}
.tbk-node-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tbk-node-meta {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}

.tbk-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  color: var(--wx-text-tertiary);
}
.tbk-loading-mark {
  font-size: 34px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 14px var(--wx-color-primary));
}
.tbk-loading-text {
  font-size: 12.5px;
}
</style>
