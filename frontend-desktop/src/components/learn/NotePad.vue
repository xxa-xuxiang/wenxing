<script setup lang="ts">
// 问星 v4 — 学习笔记面板（右侧抽屉）
// 存储与社区草稿同命名空间：community:notes:<noteId>（见 services/noteService）
// 硬约束：全程本地存储，挂载不发任何网络请求；新建/删除均为纯本地操作（删除前 window.confirm）
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useLearnStore } from '@/stores/learnStore'
import { useOverlay } from '@/composables/useOverlay'
import BlockEditorCore from '@/components/community/BlockEditorCore.vue'
import type { NoteDoc } from '@/services/noteService'
import { createNote, deleteNote, getNote, listNotes, saveNote } from '@/services/noteService'

const props = defineProps<{ noteId?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const learnStore = useLearnStore()

// 统一浮层行为：Esc / 点击抽屉外任意处 → 关闭（关闭前先落盘）
const { overlayRef } = useOverlay({ onClose: () => close() })

// ===== 笔记集合与当前编辑项 =====
const notes = ref<NoteDoc[]>(listNotes())
const current = ref<NoteDoc | null>(null)

/** 新建笔记归属当前学习领域 */
function industryId(): string {
  return learnStore.selectedDomain?.id ?? 'general'
}

// ===== 自动保存（900ms debounce → saveNote） =====
type SaveState = 'idle' | 'dirty' | 'saved'
const saveState = ref<SaveState>('idle')
const savedAt = ref('')
let saveTimer: number | undefined

/** 内容快照：用于判定「是否真的改过」，避免切换笔记 / 关闭时误触发保存 */
function snapshotOf(n: NoteDoc | null): string | null {
  return n ? JSON.stringify({ t: n.title, b: n.blocks }) : null
}
let baseline: string | null = null

function setCurrent(n: NoteDoc | null) {
  current.value = n
  baseline = snapshotOf(n)
}

const saveLabel = computed(() => {
  if (saveState.value === 'dirty') return '未保存'
  if (saveState.value === 'saved') return savedAt.value ? `已保存 ${savedAt.value}` : '已保存'
  return ''
})

function flush() {
  const c = current.value
  if (!c) return
  if (snapshotOf(c) === baseline) return // 无实质改动：不落盘、不刷新排序
  window.clearTimeout(saveTimer)
  c.updatedAt = Date.now()
  saveNote(c)
  notes.value = [...notes.value].sort((a, b) => b.updatedAt - a.updatedAt)
  baseline = snapshotOf(c)
  savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  saveState.value = 'saved'
}

function markDirty() {
  saveState.value = 'dirty'
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flush, 900)
}

function onContentChange() {
  const c = current.value
  if (!c) return
  if (snapshotOf(c) === baseline) return // 程序化切换，非用户编辑
  markDirty()
}

// 块编辑器不经 v-model，就地变更 blocks → 深度监听触发自动保存
watch(() => current.value?.title, onContentChange)
watch(() => current.value?.blocks, onContentChange, { deep: true })

// ===== 列表操作 =====
function selectNote(id: string) {
  if (current.value?.id === id) return
  window.clearTimeout(saveTimer)
  flush() // 切换前先保存旧笔记
  setCurrent(notes.value.find((n) => n.id === id) ?? null)
}

function createAndOpen() {
  const n = createNote(industryId())
  saveNote(n)
  notes.value = [n, ...notes.value]
  // 用列表中的响应式代理引用（勿用原始对象，否则编辑不会触发响应）
  setCurrent(notes.value[0] ?? null)
}

function addNote() {
  window.clearTimeout(saveTimer)
  flush()
  createAndOpen()
}

function removeNote(id: string) {
  const n = notes.value.find((x) => x.id === id)
  if (!n) return
  const label = n.title?.trim() || '未命名笔记'
  if (!window.confirm(`确定删除笔记「${label}」吗？删除后不可恢复。`)) return
  window.clearTimeout(saveTimer)
  deleteNote(id)
  notes.value = notes.value.filter((x) => x.id !== id)
  if (current.value?.id === id) setCurrent(notes.value[0] ?? null)
}

/** 时间：当天时分 / 一周内相对 / 更早日期 */
function timeText(ts: number): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ===== 编辑器提示消息 =====
const notice = ref('')
let noticeTimer: number | undefined
function showNotice(text: string) {
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 3000)
}

// ===== 关闭：先落盘再 emit =====
function close() {
  window.clearTimeout(saveTimer)
  flush()
  emit('close')
}

// ===== 初始选中：props.noteId 有效 → 选它；否则最近一篇；为空 → 自动新建 =====
function init() {
  const pick =
    notes.value.find((n) => n.id === props.noteId) ?? notes.value[0] ?? null
  if (pick) {
    setCurrent(pick)
    return
  }
  createAndOpen()
}
init()

// 外部（如社区侧跳转）再次指定笔记时切换
watch(
  () => props.noteId,
  (id) => {
    if (!id) return
    const fresh = getNote(id)
    if (!fresh) return
    if (!notes.value.some((n) => n.id === id)) notes.value = [fresh, ...notes.value]
    selectNote(id)
  }
)

onBeforeUnmount(() => {
  window.clearTimeout(saveTimer)
  window.clearTimeout(noticeTimer)
  flush()
})
</script>

<template>
  <aside ref="overlayRef" class="wx-note" data-test="panel-notes">
    <!-- 左栏：笔记列表 -->
    <div class="wx-note-side">
      <div class="wx-note-side-head">
        <span class="wx-note-side-title">笔记</span>
        <span class="wx-note-side-count">{{ notes.length }}</span>
        <button class="wx-note-add wx-pressable" @click="addNote">＋ 新建笔记</button>
      </div>
      <div class="wx-note-list">
        <p v-if="!notes.length" class="wx-note-list-empty">还没有笔记，点「＋ 新建笔记」开始记录。</p>
        <button
          v-for="n in notes"
          :key="n.id"
          class="wx-note-item"
          :class="{ active: n.id === current?.id }"
          :title="n.title"
          @click="selectNote(n.id)"
        >
          <span class="wx-note-item-title">{{ n.title?.trim() || '未命名笔记' }}</span>
          <span class="wx-note-item-time">{{ timeText(n.updatedAt) }}</span>
          <span class="wx-note-item-del wx-pressable" title="删除笔记" @click.stop="removeNote(n.id)">✕</span>
        </button>
      </div>
    </div>

    <!-- 右栏：标题 + 块编辑器 -->
    <section class="wx-note-main">
      <template v-if="current">
        <header class="wx-note-top">
          <input
            v-model="current.title"
            class="wx-note-title"
            type="text"
            maxlength="60"
            placeholder="笔记标题"
            @input="markDirty"
          />
          <span v-if="saveLabel" class="wx-note-save" :class="saveState">{{ saveLabel }}</span>
          <button class="wx-note-close wx-pressable" title="关闭" @click="close">✕</button>
        </header>
        <div class="wx-note-editor">
          <BlockEditorCore
            :blocks="current.blocks"
            placeholder="记录你的学习要点，按下 / 呼出块菜单，@ 引用日期…"
            @notify="showNotice"
          />
        </div>
      </template>
      <div v-else class="wx-note-blank">
        <p class="wx-note-blank-text">还没有笔记</p>
        <button class="wx-note-blank-btn wx-pressable" @click="addNote">＋ 新建笔记</button>
      </div>

      <div v-if="notice" class="wx-note-notice">✎ {{ notice }}</div>
    </section>
  </aside>
</template>

<style scoped>
.wx-note {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: min(980px, 92vw);
  z-index: 60;
  display: flex;
  background: var(--wx-glass-bg-strong);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  border-left: 1px solid var(--wx-border-soft);
  box-shadow: var(--wx-shadow-lg);
  animation: wx-note-in var(--wx-duration-mid) var(--wx-ease-out-soft);
}
@keyframes wx-note-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

/* ===== 左栏：笔记列表 ===== */
.wx-note-side {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--wx-border-soft);
}
.wx-note-side-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-note-side-title {
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--wx-text-tertiary);
}
.wx-note-side-count {
  font-family: var(--wx-font-mono);
  font-size: 10.5px;
  color: var(--wx-text-muted);
}
.wx-note-add {
  margin-left: auto;
  padding: 5px 12px;
  font-size: 11.5px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
}
.wx-note-add:hover { background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent); }

.wx-note-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0;
  scrollbar-width: thin;
}
.wx-note-list-empty {
  padding: 20px 16px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--wx-text-muted);
}
.wx-note-item {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 30px 9px 14px;
  text-align: left;
  border-left: 2px solid transparent;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-note-item:hover { background: color-mix(in srgb, var(--wx-ink) 4%, transparent); }
.wx-note-item.active {
  border-left-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
}
.wx-note-item-title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--wx-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-note-item-time {
  font-size: 10.5px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-note-item-del {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--wx-text-muted);
  border-radius: var(--wx-radius-sm);
  opacity: 0;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-note-item:hover .wx-note-item-del { opacity: 1; }
.wx-note-item-del:hover { color: var(--wx-color-vermilion); background: color-mix(in srgb, var(--wx-color-vermilion) 14%, transparent); }

/* ===== 右栏：编辑区 ===== */
.wx-note-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.wx-note-top {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-note-title {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--wx-font-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-note-title::placeholder { color: var(--wx-text-muted); font-weight: 400; font-size: 14px; }
.wx-note-save {
  flex-shrink: 0;
  font-size: 11px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-note-save.dirty { color: var(--wx-color-amber); }
.wx-note-save.saved { color: var(--wx-color-yanqing); }
.wx-note-close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  background: transparent;
}
.wx-note-close:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }

.wx-note-editor {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 20px 60px;
  scrollbar-width: thin;
}

.wx-note-blank {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.wx-note-blank-text { font-size: 13px; color: var(--wx-text-muted); }
.wx-note-blank-btn {
  padding: 8px 20px;
  font-size: 12.5px;
  color: var(--wx-color-primary-soft);
  border: 1px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
}
.wx-note-blank-btn:hover { background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent); }

.wx-note-notice {
  position: absolute;
  bottom: 18px;
  right: 20px;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-color-yanqing) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-yanqing) 35%, transparent);
  border-radius: var(--wx-radius-sm);
}
</style>
