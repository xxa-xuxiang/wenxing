<script setup lang="ts">
// Notion 式块编辑器核心（递归组件：折叠子块 / 分栏单元格复用同一编辑器）
// 交互：拖拽手柄排序与分栏、斜杠命令、@ 引用、[[ 页面链接、Ctrl+/ 块菜单、
//       Tab/Shift+Tab 缩进、Enter 分块、Shift+Enter 软换行、选中浮动格式栏、Esc 关闭菜单
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { uploadImage, listPosts, type CommunityPostListItem } from '@/services/communityService'
import {
  BLOCK_DEFS,
  newBlock,
  uid,
  setDragCtx,
  takeDragCtx,
  colorLabel,
  type BlockDef,
  type BlockType,
  type EdBlock,
  type SubPageDoc,
  loadSubPage,
  saveSubPage
} from './blocks'

const props = defineProps<{
  blocks: EdBlock[]
  nested?: boolean
  placeholder?: string
  /** 只读查看模式：用于计划文档等只读展示，屏蔽编辑与块菜单 */
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'active', id: string | null): void
  (e: 'open-page', pageId: string, title: string): void
  (e: 'notify', text: string): void
  (e: 'ai', text: string): void
}>()

const auth = useAuthStore()
const community = useCommunityStore()

// ===== 焦点与 DOM 登记 =====
const activeId = ref<string | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const rowEls = new Map<string, HTMLElement>()

function setRowEl(id: string) {
  return (el: unknown) => {
    if (el) rowEls.set(id, el as HTMLElement)
    else rowEls.delete(id)
  }
}

/** 让某块获得焦点（caret: 'start' | 'end' | 偏移） */
function focusBlock(id: string, caret: 'start' | 'end' | number = 'end') {
  void nextTick(() => {
    const el = rowEls.get(id)
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    const textLen = (el.textContent ?? '').length
    const off = caret === 'start' ? 0 : caret === 'end' ? textLen : Math.min(caret, textLen)
    let placed = false
    if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
      try {
        range.setStart(el.firstChild, Math.min(off, (el.firstChild as Text).length))
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        placed = true
      } catch {
        placed = false
      }
    }
    if (!placed) {
      range.selectNodeContents(el)
      range.collapse(caret !== 'start')
      sel.removeAllRanges()
      sel.addRange(range)
    }
  })
}

/** 光标在元素内的字符偏移 */
function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0).cloneRange()
  const pre = document.createRange()
  pre.selectNodeContents(el)
  try {
    pre.setEnd(range.endContainer, range.endOffset)
  } catch {
    return 0
  }
  return pre.toString().length
}

/** 把光标放置在元素内指定偏移 */
function setCaret(el: HTMLElement, off: number) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  const node = el.firstChild
  const len = (el.textContent ?? '').length
  if (node && node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.min(off, (node as Text).length))
  } else {
    range.selectNodeContents(el)
    range.collapse(off === 0)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  void off
  void len
}

// ===== 外部文本变更 → 同步 DOM（聚焦中的块不覆盖，避免打断输入） =====
function* flatIter(list: EdBlock[]): Generator<EdBlock> {
  for (const b of list) {
    yield b
    if (b.children) yield* flatIter(b.children)
    if (b.cols) for (const c of b.cols) yield* flatIter(c)
  }
}

function setElText(el: HTMLElement, text: string) {
  if (el.isContentEditable) {
    el.textContent = text
  } else {
    ;(el as HTMLTextAreaElement).value = text
  }
}

// DOM 文本缓存：同步时用缓存比对代替读 innerText（读 innerText 会强制重排，
// 长文档下"每个块都读一遍"是输入卡顿的主因）。只有元素重建或缓存失配时才触碰 DOM。
const domText = new Map<string, string>()
const domEl = new Map<string, HTMLElement>()

function syncAllText() {
  for (const b of flatIter(props.blocks)) {
    const el = rowEls.get(b.id)
    if (!el) continue
    // 正在聚焦输入的块不覆盖：避免打断输入法与光标
    if (document.activeElement === el) continue
    // 元素被重建（类型转换/模板分支切换）时必须重写
    const elChanged = domEl.get(b.id) !== el
    if (el.isContentEditable) {
      if (!elChanged && domText.get(b.id) === b.text) continue
      if (elChanged || el.innerText.replace(/\n$/, '') !== b.text) setElText(el, b.text)
    } else {
      const ta = el as HTMLTextAreaElement
      if (!elChanged && ta.value === b.text) continue
      if (elChanged || ta.value !== b.text) ta.value = b.text
    }
    domEl.set(b.id, el)
    domText.set(b.id, b.text)
  }
}

// ===== 撤销 / 重做（仅顶层实例持有；结构变更立即落检查点，纯文本输入防抖合并） =====
interface HistEntry {
  data: string
  /** 结构指纹（剥离文本）：用于区分"结构变更"与"纯文本变更" */
  struct: string
}
const history = ref<HistEntry[]>([])
const hIndex = ref(-1)
let hTimer: number | undefined
let applying = false
const MAX_HISTORY = 50

function structSig(list: EdBlock[]): string {
  const strip = (bs: EdBlock[]): unknown[] =>
    bs.map((b) => ({
      t: b.type,
      i: b.indent,
      k: b.checked,
      c: b.children ? strip(b.children) : undefined,
      v: b.cols ? b.cols.map(strip) : undefined
    }))
  return JSON.stringify(strip(list))
}

function commitHistory(data: string, struct: string) {
  if (history.value[hIndex.value]?.data === data) return
  history.value = history.value.slice(0, hIndex.value + 1)
  history.value.push({ data, struct })
  if (history.value.length > MAX_HISTORY) history.value.shift()
  hIndex.value = history.value.length - 1
}

function touchHistory() {
  if (applying || props.nested) return
  const data = JSON.stringify(props.blocks)
  const struct = structSig(props.blocks)
  const tip = history.value[hIndex.value]
  // 结构变更（增删/转换/缩进/移动）立即落检查点，保证 Ctrl+Z 立刻可用
  if (tip && tip.struct !== struct) {
    window.clearTimeout(hTimer)
    commitHistory(data, struct)
    return
  }
  // 纯文本输入：防抖合并，避免每敲一个字就产生一个检查点
  window.clearTimeout(hTimer)
  hTimer = window.setTimeout(() => commitHistory(JSON.stringify(props.blocks), structSig(props.blocks)), 600)
}

function applySnapshot(data: string) {
  applying = true
  const arr = JSON.parse(data) as EdBlock[]
  props.blocks.splice(0, props.blocks.length, ...arr)
  void nextTick(() => {
    domText.clear() // 文本已变，清缓存强制重写 DOM
    syncAllText()
    applying = false
  })
}

/** 仅当"上一检查点的结构"与当前不同才拦截 Ctrl+Z；纯文本编辑交给浏览器原生撤销 */
function historyUndoAvailable(): boolean {
  const prev = history.value[hIndex.value - 1]
  if (!prev) return false
  return prev.struct !== structSig(props.blocks)
}

function undo() {
  if (hIndex.value <= 0) return
  window.clearTimeout(hTimer)
  hIndex.value -= 1
  applySnapshot(history.value[hIndex.value].data)
}

function redo() {
  if (hIndex.value >= history.value.length - 1) return
  window.clearTimeout(hTimer)
  hIndex.value += 1
  applySnapshot(history.value[hIndex.value].data)
}

/** 顶层根节点键盘：捕获冒泡上来的 Ctrl+Z（含嵌套子块内的按键） */
function onRootKeyDown(e: KeyboardEvent) {
  if (props.readonly) return
  if (props.nested) return
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  const k = e.key.toLowerCase()
  if (k === 'z') {
    if (e.shiftKey ? history.value.length > 1 : historyUndoAvailable()) {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    return
  }
  if (k === 'y' && history.value.length > 1) {
    e.preventDefault()
    redo()
  }
}

watch(
  () => props.blocks,
  () => {
    if (!props.nested) touchHistory()
    void nextTick(syncAllText)
  },
  { deep: true }
)

// 点击编辑器外部 → 收起选区浮动栏（仅顶层挂全局监听，避免递归实例各挂一份）
function onDocMousedown() {
  if (selBar.open && !rootEl.value?.contains(document.activeElement)) selBar.open = false
}

onMounted(() => {
  void nextTick(syncAllText)
  if (!props.nested) {
    document.addEventListener('mousedown', onDocMousedown)
    commitHistory(JSON.stringify(props.blocks), structSig(props.blocks))
  }
})
onBeforeUnmount(() => {
  if (!props.nested) document.removeEventListener('mousedown', onDocMousedown)
})

// ===== 列表操作（就地变更，父层深度监听持久化） =====
function idxOf(id: string): number {
  return props.blocks.findIndex((b) => b.id === id)
}

function insertAfter(id: string, nb: EdBlock) {
  const i = idxOf(id)
  props.blocks.splice(i < 0 ? props.blocks.length : i + 1, 0, nb)
  void nextTick(syncAllText)
}

function removeBlock(id: string) {
  const i = idxOf(id)
  if (i >= 0) props.blocks.splice(i, 1)
}

// ===== 文本输入与触发器 =====
const slash = reactive({ open: false, blockId: '', query: '', index: 0, top: 0, left: 0 })
const mention = reactive({ open: false, blockId: '', index: 0, top: 0, left: 0 })
const pageMenu = reactive({ open: false, blockId: '', query: '', index: 0, top: 0, left: 0, results: [] as CommunityPostListItem[] })
const blockMenu = reactive({ open: false, blockId: '', x: 0, y: 0, sub: '' as '' | 'turn' | 'color' })

function closeMenus() {
  slash.open = false
  mention.open = false
  pageMenu.open = false
  blockMenu.open = false
  blockMenu.sub = ''
}

function menuAnchor(b: EdBlock) {
  const el = rowEls.get(b.id)
  const root = rootEl.value
  if (!el || !root) return { top: 0, left: 0 }
  const r = el.getBoundingClientRect()
  const rr = root.getBoundingClientRect()
  return { top: r.bottom - rr.top + 6, left: r.left - rr.left }
}

const isTextual = (t: BlockType) => ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote'].includes(t)

/** 有序列表序号：向前累加连续 ol（ul/todo 打断相邻性） */
function olIndex(i: number): number {
  let n = 1
  for (let j = i - 1; j >= 0; j -= 1) {
    const t = props.blocks[j].type
    if (t === 'ol') n += 1
    else if (t !== 'ul' && t !== 'todo') break
  }
  return n
}

function onTextInput(b: EdBlock, e: Event) {
  const el = e.target as HTMLElement
  b.text = el.innerText.replace(/\n$/, '')
  domText.set(b.id, b.text)
  // 中文输入法组合期间不触发 / @ [[ 菜单，避免拼音候选误弹
  if ((e as InputEvent).isComposing) return
  if (!isTextual(b.type)) return
  // 斜杠命令：文本以 / 开头
  if (b.text.startsWith('/')) {
    const a = menuAnchor(b)
    slash.open = true
    slash.blockId = b.id
    slash.query = b.text.slice(1)
    slash.index = 0
    slash.top = a.top
    slash.left = a.left
    return
  }
  // @ 引用：@ 在行首或空白之后
  if (/(^|\s)@$/.test(b.text)) {
    const a = menuAnchor(b)
    mention.open = true
    mention.blockId = b.id
    mention.index = 0
    mention.top = a.top
    mention.left = a.left
    mentionCloseOthers('mention')
    return
  }
  // [[ 页面链接
  if (b.text.endsWith('[[')) {
    const a = menuAnchor(b)
    pageMenu.open = true
    pageMenu.blockId = b.id
    pageMenu.query = ''
    pageMenu.index = 0
    pageMenu.top = a.top
    pageMenu.left = a.left
    void searchPosts('')
    mentionCloseOthers('page')
    return
  }
  closeMenus()
}

function mentionCloseOthers(keep: 'mention' | 'page') {
  if (keep === 'mention') pageMenu.open = false
  else mention.open = false
}

const filteredDefs = computed<BlockDef[]>(() => {
  const q = slash.query.trim().toLowerCase()
  if (!q) return BLOCK_DEFS
  return BLOCK_DEFS.filter(
    (d) => d.label.includes(slash.query.trim()) || d.type.includes(q) || d.desc.includes(slash.query)
  )
})

function applySlash(d: BlockDef) {
  const b = props.blocks.find((x) => x.id === slash.blockId)
  slash.open = false
  if (!b) return
  // 选中命令后删除行内 / 及查询文本，避免转换后残留「/xxx」
  if (b.text.startsWith('/')) b.text = ''
  convertBlock(b, d.type)
  if (d.type === 'image') pickImage(b.id)
  else focusBlock(b.id, 'end')
}

function convertBlock(b: EdBlock, type: BlockType) {
  if (type === b.type) return
  b.type = type
  if (type === 'divider' || type === 'p') b.text = type === 'divider' ? '' : b.text.replace(/^\/\S*$/, '')
  if (type === 'todo') b.checked = b.checked ?? false
  if (type === 'code') b.lang = b.lang ?? ''
  if (type === 'table' || type === 'db') b.rows = b.rows ?? [['列1', '列2'], ['内容', '内容']]
  if (type === 'toggle') {
    b.open = true
    b.children = b.children ?? []
  }
  if (type === 'mindmap' && !b.text.trim()) b.text = '中心主题\n  分支一'
  if (type === 'columns') b.cols = b.cols ?? [[], []]
  if (type === 'image' || type === 'file' || type === 'embed') b.url = b.url ?? ''
  void nextTick(syncAllText)
}

// ===== @ 引用菜单 =====
interface MentionItem {
  key: string
  label: string
  hint: string
  token: string
}
const mentionItems = computed<MentionItem[]>(() => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = (offset: number) => {
    const t = new Date(now.getTime() + offset * 86400000)
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
  }
  const name = auth.user?.nickname || auth.user?.username || ''
  return [
    { key: 'today', label: '今天', hint: d(0), token: d(0) },
    { key: 'tomorrow', label: '明天', hint: d(1), token: d(1) },
    { key: 'me', label: '我的名片', hint: name || '未登录', token: `@${name || '问星用户'}` }
  ]
})

function applyMention(item: MentionItem) {
  const b = props.blocks.find((x) => x.id === mention.blockId)
  mention.open = false
  if (!b) return
  b.text = b.text.replace(/(^|\s)@$/, `$1${item.token} `)
  void nextTick(() => {
    syncAllText()
    focusBlock(b.id, 'end')
  })
}

// ===== [[ 页面链接菜单 ===== */
let pageSearchTimer: number | undefined
function searchPosts(q: string) {
  window.clearTimeout(pageSearchTimer)
  pageSearchTimer = window.setTimeout(async () => {
    try {
      const res = await listPosts({ q: q || undefined, industry: community.activeIndustryId, pageSize: 5 })
      pageMenu.results = res.items
    } catch {
      pageMenu.results = []
    }
  }, 250)
}

watch(
  () => pageMenu.query,
  (q) => {
    if (pageMenu.open) void searchPosts(q)
  }
)

function applyPagePost(p: CommunityPostListItem) {
  const b = props.blocks.find((x) => x.id === pageMenu.blockId)
  pageMenu.open = false
  if (!b) return
  b.text = ''
  b.type = 'page'
  b.pageId = `post:${p.id}`
  b.text = p.title
  void nextTick(syncAllText)
}

function applyPageNew() {
  const b = props.blocks.find((x) => x.id === pageMenu.blockId)
  pageMenu.open = false
  if (!b) return
  const id = `sp_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`
  const title = pageMenu.query.trim() || '无标题子页面'
  const doc: SubPageDoc = { id, title, blocks: [newBlock('p', '')], updatedAt: Date.now() }
  saveSubPage(doc)
  b.text = ''
  b.type = 'page'
  b.pageId = id
  b.text = title
  void nextTick(syncAllText)
}

// ===== 键盘行为 =====
function onKeyDown(b: EdBlock, e: KeyboardEvent) {
  if (props.readonly) return
  // 菜单打开时优先响应
  if (slash.open && slash.blockId === b.id && filteredDefs.value.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); slash.index = (slash.index + 1) % filteredDefs.value.length; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); slash.index = (slash.index - 1 + filteredDefs.value.length) % filteredDefs.value.length; return }
    if (e.key === 'Enter') { e.preventDefault(); applySlash(filteredDefs.value[slash.index]); return }
    if (e.key === 'Escape') { e.preventDefault(); slash.open = false; return }
  }
  if (mention.open && mention.blockId === b.id) {
    if (e.key === 'ArrowDown') { e.preventDefault(); mention.index = (mention.index + 1) % mentionItems.value.length; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); mention.index = (mention.index - 1 + mentionItems.value.length) % mentionItems.value.length; return }
    if (e.key === 'Enter') { e.preventDefault(); applyMention(mentionItems.value[mention.index]); return }
    if (e.key === 'Escape') { e.preventDefault(); mention.open = false; return }
  }
  if (pageMenu.open && pageMenu.blockId === b.id) {
    const n = pageMenu.results.length + 1
    if (e.key === 'ArrowDown') { e.preventDefault(); pageMenu.index = (pageMenu.index + 1) % n; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); pageMenu.index = (pageMenu.index - 1 + n) % n; return }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (pageMenu.index === 0) applyPageNew()
      else applyPagePost(pageMenu.results[pageMenu.index - 1])
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); pageMenu.open = false; return }
  }

  const el = e.target as HTMLElement
  const mod = e.ctrlKey || e.metaKey

  // Ctrl+/：当前块操作菜单
  if (mod && e.key === '/') {
    e.preventDefault()
    const r = el.getBoundingClientRect()
    blockMenu.open = true
    blockMenu.blockId = b.id
    blockMenu.x = Math.min(r.left, window.innerWidth - 240)
    blockMenu.y = Math.min(r.bottom + 4, window.innerHeight - 320)
    blockMenu.sub = ''
    return
  }
  if (e.key === 'Escape') {
    closeMenus()
    selBar.open = false
    return
  }

  // 代码块 / 思维导图 / 表格：Enter 交给原生（textarea 内换行）
  if (!isTextual(b.type)) return

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    const off = caretOffset(el)
    const before = b.text.slice(0, off)
    const after = b.text.slice(off)
    // 空列表项回车 → 退回正文
    if ((b.type === 'ul' || b.type === 'ol' || b.type === 'todo') && before.trim() === '') {
      b.type = 'p'
      b.text = ''
      void nextTick(syncAllText)
      focusBlock(b.id, 'end')
      return
    }
    b.text = before
    const nb = newBlock(b.type === 'h1' || b.type === 'h2' || b.type === 'h3' ? 'p' : b.type, after)
    nb.indent = b.indent
    void nextTick(syncAllText)
    insertAfter(b.id, nb)
    focusBlock(nb.id, 'start')
    return
  }
  if (e.key === 'Enter' && e.shiftKey) {
    // 块内软换行
    e.preventDefault()
    const off = caretOffset(el)
    b.text = b.text.slice(0, off) + '\n' + b.text.slice(off)
    el.textContent = b.text
    setCaret(el, off + 1)
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    const d = e.shiftKey ? -1 : 1
    b.indent = Math.max(0, Math.min(3, b.indent + d))
    return
  }
  if (e.key === 'Backspace' && caretOffset(el) === 0) {
    const i = idxOf(b.id)
    const prev = i > 0 ? props.blocks[i - 1] : null
    if (b.text === '') {
      e.preventDefault()
      removeBlock(b.id)
      if (prev) focusBlock(prev.id, 'end')
      return
    }
    if (b.indent > 0) {
      e.preventDefault()
      b.indent -= 1
      return
    }
    if (prev && isTextual(prev.type) && !props.nested) {
      e.preventDefault()
      const mergeAt = prev.text.length
      prev.text += b.text
      removeBlock(b.id)
      void nextTick(() => {
        syncAllText()
        focusBlock(prev.id, mergeAt)
      })
    }
  }
}

// ===== 粘贴：图片上传 / 纯文本 =====
const imgInput = ref<HTMLInputElement | null>(null)
let imgTargetId = ''

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('读取失败'))
    r.readAsDataURL(f)
  })
}

function pickImage(id: string) {
  imgTargetId = id
  imgInput.value?.click()
}

async function onPickImage(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  await uploadToBlock(imgTargetId, f)
}

async function uploadToBlock(id: string, f: File) {
  const b = findDeep(props.blocks, id)
  if (!b) return
  try {
    const dataUrl = await readAsDataUrl(f)
    emit('notify', '图片上传中…')
    const { url } = await uploadImage(dataUrl)
    b.type = 'image'
    b.url = url
    b.name = b.name || f.name
    emit('notify', '')
    void nextTick(syncAllText)
  } catch {
    emit('notify', '图片上传失败，请重试')
  }
}

function findDeep(list: EdBlock[], id: string): EdBlock | null {
  for (const b of list) {
    if (b.id === id) return b
    if (b.children) {
      const r = findDeep(b.children, id)
      if (r) return r
    }
    if (b.cols) {
      for (const c of b.cols) {
        const r = findDeep(c, id)
        if (r) return r
      }
    }
  }
  return null
}

function onPaste(b: EdBlock, e: ClipboardEvent) {
  if (props.readonly) {
    e.preventDefault()
    return
  }
  const files = Array.from(e.clipboardData?.files ?? [])
  if (files.length && ['image/jpeg', 'image/png', 'image/webp'].includes(files[0].type)) {
    e.preventDefault()
    void uploadToBlock(b.id, files[0])
    return
  }
  // 纯文本粘贴，避免带入富文本样式
  const text = e.clipboardData?.getData('text/plain')
  if (text && !isTextual(b.type) === false) {
    e.preventDefault()
    const el = e.target as HTMLElement
    const off = caretOffset(el)
    const clean = text.replace(/\r\n?/g, '\n')
    b.text = b.text.slice(0, off) + clean + b.text.slice(off)
    el.textContent = b.text
    setCaret(el, off + clean.length)
  }
}

// ===== 拖拽（手柄排序 + 左右缘分栏） =====
const dropHint = reactive({ id: '', pos: '' })

function onDragStart(b: EdBlock, e: DragEvent) {
  setDragCtx(b, props.blocks)
  e.dataTransfer?.setData('text/plain', b.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function zoneOf(e: DragEvent, el: HTMLElement): string {
  const r = el.getBoundingClientRect()
  const y = e.clientY - r.top
  const h = r.height
  if (!props.nested) {
    const x = e.clientX - r.left
    if (x < r.width * 0.16) return 'col-left'
    if (x > r.width * 0.84) return 'col-right'
  }
  return y < h / 2 ? 'before' : 'after'
}

function onRowDragOver(b: EdBlock, e: DragEvent, el: HTMLElement) {
  if (!takeCheck()) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropHint.id = b.id
  dropHint.pos = zoneOf(e, el)
}

let hasDrag = false
function takeCheck(): boolean {
  return hasDrag
}
// dragenter/dragstart 时机：以 dataTransfer 类型粗判
function onRowDragEnter() {
  hasDrag = true
}
function onRowDragLeave(b: EdBlock) {
  if (dropHint.id === b.id) {
    dropHint.id = ''
    dropHint.pos = ''
  }
}

function onDrop(b: EdBlock, e: DragEvent, el: HTMLElement) {
  e.preventDefault()
  const zone = zoneOf(e, el)
  dropHint.id = ''
  dropHint.pos = ''
  const ctx = takeDragCtx()
  hasDrag = false
  if (!ctx) return
  const { block, list: srcList } = ctx
  if (block.id === b.id) return
  const si = srcList.indexOf(block)
  if (si >= 0) srcList.splice(si, 1)
  if (zone === 'before' || zone === 'after') {
    const ti = props.blocks.indexOf(b)
    if (ti < 0) props.blocks.push(block)
    else props.blocks.splice(zone === 'before' ? ti : ti + 1, 0, block)
  } else {
    const ti = props.blocks.indexOf(b)
    if (b.type === 'columns' && b.cols) {
      const cell = zone === 'col-left' ? b.cols[0] : b.cols[b.cols.length - 1]
      cell.push(block)
    } else if (ti >= 0 && !props.nested) {
      const first: EdBlock[] = zone === 'col-left' ? [block] : [b]
      const second: EdBlock[] = zone === 'col-left' ? [b] : [block]
      props.blocks.splice(ti, 1, { id: uid(), type: 'columns', text: '', indent: 0, cols: [first, second] })
    } else {
      props.blocks.push(block)
    }
  }
  void nextTick(syncAllText)
}

// ===== 选中浮动格式栏 =====
const selBar = reactive({ open: false, x: 0, y: 0, blockId: '', from: 0, to: 0 })

function onDocSelectionChange() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    selBar.open = false
    return
  }
  const anchor = sel.getRangeAt(0).startContainer
  const el = (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as HTMLElement))?.closest?.('.wx-be-content')
  if (!el || !rootEl.value?.contains(el)) {
    selBar.open = false
    return
  }
  const id = [...rowEls.entries()].find(([, v]) => v === el)?.[0]
  if (!id) return
  const b = findDeep(props.blocks, id)
  if (!b || !isTextual(b.type)) return
  const range = sel.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  selBar.open = true
  selBar.x = Math.max(8, Math.min(rect.left + rect.width / 2 - 150, window.innerWidth - 320))
  selBar.y = Math.max(8, rect.top - 46)
  selBar.blockId = id
  selBar.from = caretOffset(el as HTMLElement) // 近似：以 end 计算
  const pre = document.createRange()
  pre.selectNodeContents(el)
  try {
    pre.setEnd(range.startContainer, range.startOffset)
    selBar.from = pre.toString().length
  } catch { /* 保留近似值 */ }
  selBar.to = selBar.from + range.toString().length
}

/** 给选中区间包裹/解除行内记号 */
function wrapSel(token: string, closeToken = token) {
  const b = findDeep(props.blocks, selBar.blockId)
  const el = rowEls.get(selBar.blockId)
  if (!b || !el) return
  const { from, to } = selBar
  const seg = b.text.slice(from, to)
  if (!seg.trim()) return
  const tl = token.length
  const wrapped =
    b.text.slice(Math.max(0, from - tl), from) === token && b.text.slice(to, to + closeToken.length) === closeToken
  if (wrapped) {
    b.text = b.text.slice(0, from - tl) + seg + b.text.slice(to + closeToken.length)
    selBar.from -= tl
    selBar.to -= tl
  } else {
    b.text = b.text.slice(0, from) + token + seg + closeToken + b.text.slice(to)
    selBar.from += tl
    selBar.to += tl
  }
  el.textContent = b.text
  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    const node = el.firstChild
    if (node && node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, Math.min(selBar.from, (node as Text).length))
      range.setEnd(node, Math.min(selBar.to, (node as Text).length))
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
}

function linkSel() {
  const b = findDeep(props.blocks, selBar.blockId)
  if (!b) return
  const seg = b.text.slice(selBar.from, selBar.to)
  const url = window.prompt('链接地址（URL）', 'https://')
  if (!url || url === 'https://') return
  b.text = b.text.slice(0, selBar.from) + `[${seg}](${url})` + b.text.slice(selBar.to)
  const el = rowEls.get(selBar.blockId)
  if (el) el.textContent = b.text
}

const COLOR_SETS = ['amber', 'teal', 'rose', 'violet'] as const
function colorSel(c: string) {
  const b = findDeep(props.blocks, selBar.blockId)
  const el = rowEls.get(selBar.blockId)
  if (!b || !el) return
  if (b.color === c) delete b.color
  else b.color = c
  selBar.open = false
}

/** 选中文本送问星 AI（父组件转发到右侧面板） */
function askAi() {
  const b = findDeep(props.blocks, selBar.blockId)
  if (!b) return
  const seg = b.text.slice(selBar.from, selBar.to)
  if (!seg.trim()) return
  selBar.open = false
  emit('ai', seg)
}

// ===== 块菜单（Ctrl+/） ===== */
function blockMenuItem(action: string) {
  const b = findDeep(props.blocks, blockMenu.blockId)
  if (!b) return
  const i = props.blocks.indexOf(b)
  switch (action) {
    case 'dup': {
      const clone = JSON.parse(JSON.stringify(b)) as EdBlock
      clone.id = uid()
      const walk = (x: EdBlock) => {
        x.id = x.id === clone.id ? x.id : x.id
        if (x.children) {
          x.children = x.children.map((c) => {
            const cc = JSON.parse(JSON.stringify(c)) as EdBlock
            cc.id = uid()
            walk(cc)
            return cc
          })
        }
        if (x.cols) x.cols = x.cols.map((cell) => cell.map((c) => {
          const cc = JSON.parse(JSON.stringify(c)) as EdBlock
          cc.id = uid()
          walk(cc)
          return cc
        }))
      }
      walk(clone)
      props.blocks.splice(i + 1, 0, clone)
      break
    }
    case 'up':
      if (i > 0) props.blocks.splice(i - 1, 0, props.blocks.splice(i, 1)[0])
      break
    case 'down':
      if (i >= 0 && i < props.blocks.length - 1) props.blocks.splice(i + 1, 0, props.blocks.splice(i, 1)[0])
      break
    case 'indent+':
      b.indent = Math.min(3, b.indent + 1)
      break
    case 'indent-':
      b.indent = Math.max(0, b.indent - 1)
      break
    case 'delete':
      removeBlock(b.id)
      break
    case 'insert-below': {
      const nb = newBlock('p')
      props.blocks.splice(i + 1, 0, nb)
      focusBlock(nb.id, 'end')
      break
    }
  }
  blockMenu.open = false
  blockMenu.sub = ''
  void nextTick(syncAllText)
}

function turnInto(t: BlockType) {
  const b = findDeep(props.blocks, blockMenu.blockId)
  if (b) convertBlock(b, t)
  blockMenu.open = false
  blockMenu.sub = ''
}

// ===== 表格编辑 ===== */
function tableInput(b: EdBlock, r: number, c: number, e: Event) {
  if (!b.rows) return
  b.rows[r][c] = (e.target as HTMLElement).innerText.replace(/\n/g, '')
}
function tableKeydown(_b: EdBlock, e: KeyboardEvent) {
  if (e.key === 'Enter') e.preventDefault()
}
function tableAddRow(b: EdBlock) {
  if (!b.rows) return
  b.rows.push(b.rows[0].map(() => ''))
}
function tableAddCol(b: EdBlock) {
  if (!b.rows) return
  for (const r of b.rows) r.push('')
}
function tableDelRow(b: EdBlock) {
  if (!b.rows || b.rows.length <= 1) return
  b.rows.pop()
}
function tableDelCol(b: EdBlock) {
  if (!b.rows || b.rows[0].length <= 1) return
  for (const r of b.rows) r.pop()
}

// ===== 思维导图 SVG ===== */
interface MapNode {
  x: number
  y: number
  w: number
  text: string
  level: number
}
function mindNodes(b: EdBlock): MapNode[] {
  const lines = b.text.split('\n').filter((l) => l.trim())
  const nodes: MapNode[] = []
  lines.forEach((line, i) => {
    const level = Math.min(3, Math.floor((line.length - line.trimStart().length) / 2))
    const text = line.trim().replace(/^-\s*/, '')
    nodes.push({ x: 14 + level * 118, y: 12 + i * 36, w: Math.min(104, 24 + text.length * 12), text, level })
  })
  return nodes
}
function mindParentIndex(nodes: MapNode[], i: number): number {
  for (let j = i - 1; j >= 0; j -= 1) {
    if (nodes[j].level < nodes[i].level) return j
  }
  return -1
}

// ===== 嵌入解析 ===== */
function embedSrc(url: string): string | null {
  const bv = /bilibili\.com\/video\/(BV\w+)/i.exec(url)
  if (bv) return `https://player.bilibili.com/player.html?bvid=${bv[1]}&high_quality=1&danmaku=0`
  const yt = /youtube\.com\/watch\?v=([\w-]+)|youtu\.be\/([\w-]+)/i.exec(url)
  if (yt) return `https://www.youtube.com/embed/${yt[1] || yt[2]}`
  return null
}
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// ===== 其他 ===== */
/** gutter ＋ 按钮：在指定位置后插入段落块 */
function insertBelow(index: number) {
  blockMenu.open = false
  const nb = newBlock('p')
  props.blocks.splice(index + 1, 0, nb)
  focusBlock(nb.id, 'end')
}

/** gutter 拖拽手柄点击：打开块菜单（定位在块下方） */
function openBlockMenuFor(b: EdBlock) {
  const el = rowEls.get(b.id)
  const r = el?.getBoundingClientRect()
  blockMenu.open = true
  blockMenu.blockId = b.id
  blockMenu.x = r ? Math.min(r.left, window.innerWidth - 240) : 40
  blockMenu.y = r ? Math.min(r.bottom + 4, window.innerHeight - 320) : 40
  blockMenu.sub = ''
}

function onCodeInput(b: EdBlock, e: Event) {
  b.text = (e.target as HTMLTextAreaElement).value
}
function codeRows(b: EdBlock): number {
  return Math.max(3, Math.min(16, b.text.split('\n').length + 1))
}
function openPage(b: EdBlock) {
  if (!b.pageId) return
  if (b.pageId.startsWith('post:')) emit('open-page', b.pageId.slice(5), b.text)
  else emit('open-page', b.pageId, b.text)
}
function onOpenPageCard(b: EdBlock) {
  // 子页面卡片：点击标题直接打开
  openPage(b)
}
function subPageCount(b: EdBlock): number {
  if (!b.pageId || b.pageId.startsWith('post:')) return 0
  const d = loadSubPage(b.pageId)
  return d ? d.blocks.length : 0
}

const placeholderText = computed(() => props.placeholder ?? '输入内容，/ 呼出命令，@ 引用，[[ 链接页面')

defineExpose({ focusBlock, findDeep })
</script>

<template>
  <div ref="rootEl" class="wx-be" :class="{ 'wx-be--readonly': readonly }" @dragenter="onRowDragEnter" @keydown="onRootKeyDown">
    <!-- 空列表占位 -->
    <div v-if="!blocks.length && !readonly" class="wx-be-empty" @click="blocks.push(newBlock('p'))">
      空白区域 · 点击开始输入
    </div>
    <div v-else-if="!blocks.length" class="wx-be-empty">暂无内容</div>

    <template v-for="(b, i) in blocks" :key="b.id">
      <div
        class="wx-be-row"
        :class="{ 'drop-before': dropHint.id === b.id && dropHint.pos === 'before', 'drop-after': dropHint.id === b.id && dropHint.pos === 'after', 'drop-coll': dropHint.id === b.id && dropHint.pos.startsWith('col') }"
        :style="{ paddingLeft: `${b.indent * 22}px` }"
        @dragover="onRowDragOver(b, $event, $event.currentTarget as HTMLElement)"
        @dragleave="onRowDragLeave(b)"
        @drop="onDrop(b, $event, $event.currentTarget as HTMLElement)"
      >
        <!-- 左侧 gutter：拖拽手柄 + 插入按钮（只读模式隐藏） -->
        <div v-if="!nested && !readonly" class="wx-be-gutter">
          <button class="wx-be-gutter-btn" title="在此下方插入块" @click.stop="insertBelow(i)">＋</button>
          <button
            class="wx-be-gutter-btn drag"
            title="拖动移动 · 点击打开块菜单"
            draggable="true"
            @dragstart="onDragStart(b, $event)"
            @click.stop="openBlockMenuFor(b)"
          >⠿</button>
        </div>

        <div class="wx-be-main">
          <!-- ===== 分割线 ===== -->
          <div v-if="b.type === 'divider'" class="wx-be-divider"><span>— — —</span></div>

          <!-- ===== 图片 ===== -->
          <div v-else-if="b.type === 'image'" class="wx-be-image">
            <img v-if="b.url" :src="apiUrl(b.url)" :alt="b.name || '图片'" />
            <label v-else class="wx-be-image-empty">
              <span>▣ 点击或拖入上传图片（JPG/PNG/WebP ≤3MB）</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" @change="onPickImage" />
            </label>
            <div v-if="b.url" class="wx-be-image-tools">
              <button class="wx-be-mini" @click="pickImage(b.id)">替换</button>
              <button class="wx-be-mini danger" @click="removeBlock(b.id)">删除</button>
            </div>
          </div>

          <!-- ===== 表格 / 多维表 ===== -->
          <div v-else-if="b.type === 'table' || b.type === 'db'" class="wx-be-tablewrap">
            <table class="wx-be-table" :class="{ db: b.type === 'db' }">
              <thead v-if="b.rows && b.rows.length">
                <tr>
                  <th v-for="(c, ci) in b.rows[0]" :key="ci" contenteditable="true" @input="tableInput(b, 0, ci, $event)" @keydown="tableKeydown(b, $event)">{{ c }}</th>
                </tr>
              </thead>
              <tbody v-if="b.rows && b.rows.length > 1">
                <tr v-for="(row, ri) in b.rows.slice(1)" :key="ri">
                  <td v-for="(c, ci) in row" :key="ci" contenteditable="true" @input="tableInput(b, ri + 1, ci, $event)" @keydown="tableKeydown(b, $event)">{{ c }}</td>
                </tr>
              </tbody>
            </table>
            <div class="wx-be-table-tools">
              <button class="wx-be-mini" @click="tableAddRow(b)">＋ 行</button>
              <button class="wx-be-mini" @click="tableAddCol(b)">＋ 列</button>
              <button class="wx-be-mini" @click="tableDelRow(b)">－ 行</button>
              <button class="wx-be-mini" @click="tableDelCol(b)">－ 列</button>
              <span v-if="b.type === 'db'" class="wx-be-db-tag">多维表 · 首列为主键列</span>
            </div>
          </div>

          <!-- ===== 折叠列表（递归子块） ===== -->
          <div v-else-if="b.type === 'toggle'" class="wx-be-toggle" :class="{ open: b.open }">
            <div class="wx-be-toggle-head">
              <button class="wx-be-toggle-arrow" @click="b.open = !b.open">▸</button>
              <div
                :ref="setRowEl(b.id)"
                class="wx-be-content wx-be-c-h3"
                :contenteditable="!readonly"
                :data-ph="'折叠标题'"
                @input="onTextInput(b, $event)"
                @keydown="onKeyDown(b, $event)"
                @focus="activeId = b.id; emit('active', b.id)"
                @paste="onPaste(b, $event)"
              ></div>
              <span v-if="b.children?.length" class="wx-be-toggle-count">{{ b.children.length }}</span>
            </div>
            <div v-if="b.open" class="wx-be-toggle-body">
              <BlockEditorCore
                :blocks="b.children ?? []"
                nested
                placeholder="输入内容…"
                @active="emit('active', $event)"
                @open-page="(id, t) => emit('open-page', id, t)"
                @notify="(t) => emit('notify', t)"
                @ai="(t) => emit('ai', t)"
              />
            </div>
          </div>

          <!-- ===== 思维导图 ===== -->
          <div v-else-if="b.type === 'mindmap'" class="wx-be-mind">
            <svg class="wx-be-mind-svg" :height="Math.max(90, mindNodes(b).length * 36 + 24)" :viewBox="`0 0 560 ${Math.max(90, mindNodes(b).length * 36 + 24)}`">
              <g v-for="(n, ni) in mindNodes(b)" :key="ni">
                <path
                  v-if="mindParentIndex(mindNodes(b), ni) >= 0"
                  class="wx-be-mind-edge"
                  :d="`M ${mindNodes(b)[mindParentIndex(mindNodes(b), ni)].x + mindNodes(b)[mindParentIndex(mindNodes(b), ni)].w} ${mindNodes(b)[mindParentIndex(mindNodes(b), ni)].y + 13} C ${n.x - 14} ${n.y + 13}, ${n.x - 14} ${n.y + 13}, ${n.x} ${n.y + 13}`"
                />
                <rect
                  :x="n.x"
                  :y="n.y"
                  :width="n.w"
                  height="26"
                  rx="8"
                  :class="`wx-be-mind-node lv${n.level}`"
                />
                <text :x="n.x + n.w / 2" :y="n.y + 17">{{ n.text.slice(0, 8) }}</text>
              </g>
            </svg>
            <textarea
              :ref="setRowEl(b.id)"
              class="wx-be-mind-edit"
              :value="b.text"
              :rows="Math.max(2, b.text.split('\n').length)"
              placeholder="每行一个节点，行首空格两位表示层级"
              @input="onCodeInput(b, $event)"
            ></textarea>
          </div>

          <!-- ===== 文件 ===== -->
          <div v-else-if="b.type === 'file'" class="wx-be-file">
            <template v-if="b.url">
              <a class="wx-be-file-card" :href="apiUrl(b.url)" target="_blank" rel="noopener noreferrer">
                <span class="wx-be-file-icon">📎</span>
                <span class="wx-be-file-name">{{ b.name || '附件' }}</span>
                <span class="wx-be-file-host">{{ hostOf(b.url) }}</span>
              </a>
              <button class="wx-be-mini danger" @click="removeBlock(b.id)">删除</button>
            </template>
            <template v-else>
              <span class="wx-be-file-icon">📎</span>
              <input v-model="b.name" class="wx-be-inline-input" placeholder="附件名称" @keydown.enter.prevent />
              <input v-model="b.url" class="wx-be-inline-input grow" placeholder="粘贴文件链接 URL" @keydown.enter.prevent />
            </template>
          </div>

          <!-- ===== 嵌入内容 ===== -->
          <div v-else-if="b.type === 'embed'" class="wx-be-embed">
            <template v-if="b.url">
              <iframe
                v-if="embedSrc(b.url)"
                :src="embedSrc(b.url) ?? ''"
                class="wx-be-embed-frame"
                allowfullscreen
                scrolling="no"
                frameborder="0"
              ></iframe>
              <a v-else class="wx-be-file-card" :href="b.url" target="_blank" rel="noopener noreferrer">
                <span class="wx-be-file-icon">⧉</span>
                <span class="wx-be-file-name">嵌入链接</span>
                <span class="wx-be-file-host">{{ hostOf(b.url) }}</span>
              </a>
              <div class="wx-be-image-tools">
                <button class="wx-be-mini" @click="b.url = ''">替换</button>
                <button class="wx-be-mini danger" @click="removeBlock(b.id)">删除</button>
              </div>
            </template>
            <template v-else>
              <span class="wx-be-file-icon">⧉</span>
              <input v-model="b.url" class="wx-be-inline-input grow" placeholder="粘贴 B站 / YouTube 或任意链接，回车嵌入" @keydown.enter.prevent />
            </template>
          </div>

          <!-- ===== 页面引用（子页面 / 帖子） ===== -->
          <div v-else-if="b.type === 'page'" class="wx-be-page">
            <button class="wx-be-page-card" @click="onOpenPageCard(b)">
              <span class="wx-be-file-icon">📄</span>
              <span class="wx-be-page-title">{{ b.text || '无标题页面' }}</span>
              <span v-if="b.pageId && !b.pageId.startsWith('post:')" class="wx-be-page-badge">{{ subPageCount(b) }} 块</span>
              <span v-else class="wx-be-page-badge post">帖子</span>
              <span class="wx-be-page-open">打开 →</span>
            </button>
            <button class="wx-be-mini danger" @click="removeBlock(b.id)">删除</button>
          </div>

          <!-- ===== 分栏（递归单元格） ===== -->
          <div v-else-if="b.type === 'columns' && b.cols" class="wx-be-columns">
            <div v-for="(cell, ci) in b.cols" :key="ci" class="wx-be-col">
              <BlockEditorCore
                :blocks="cell"
                nested
                placeholder="分栏内容…"
                @active="emit('active', $event)"
                @open-page="(id, t) => emit('open-page', id, t)"
                @notify="(t) => emit('notify', t)"
                @ai="(t) => emit('ai', t)"
              />
            </div>
          </div>

          <!-- ===== 代码块 ===== -->
          <textarea
            v-else-if="b.type === 'code'"
            :ref="setRowEl(b.id)"
            class="wx-be-code"
            :value="b.text"
            :rows="codeRows(b)"
            placeholder="输入代码…"
            spellcheck="false"
            @input="onCodeInput(b, $event)"
            @focus="activeId = b.id; emit('active', b.id)"
          ></textarea>

          <!-- ===== 文本类块（正文/标题/列表/待办/引用） ===== -->
          <div v-else class="wx-be-line" :class="{ todo: b.type === 'todo', quote: b.type === 'quote' }">
            <button
              v-if="b.type === 'todo'"
              class="wx-be-check"
              :class="{ on: b.checked }"
              title="勾选"
              @click="b.checked = !b.checked"
            >✓</button>
            <span v-else-if="b.type === 'ul'" class="wx-be-marker">•</span>
            <span v-else-if="b.type === 'ol'" class="wx-be-marker">{{ olIndex(i) }}</span>
            <div
              :ref="setRowEl(b.id)"
              class="wx-be-content"
              :class="[`wx-be-c-${b.type}`, b.color ? `wx-be-color-${b.color}` : '']"
              :contenteditable="!readonly"
              spellcheck="false"
              :data-ph="placeholderText"
              @input="onTextInput(b, $event)"
              @keydown="onKeyDown(b, $event)"
              @focus="activeId = b.id; emit('active', b.id)"
              @paste="onPaste(b, $event)"
              @mouseup="onDocSelectionChange"
              @keyup="onDocSelectionChange"
            ></div>
          </div>
        </div>
      </div>
    </template>

    <!-- 隐藏图片选择器 -->
    <input ref="imgInput" type="file" accept="image/jpeg,image/png,image/webp" style="display: none" @change="onPickImage" />

    <!-- ===== 斜杠命令菜单 ===== -->
    <div v-if="slash.open && filteredDefs.length && !readonly" class="wx-be-menu" :style="{ top: `${slash.top}px`, left: `${slash.left}px` }">
      <div class="wx-be-menu-head">块样式 · ↑↓ 选择 · 回车确认 · Esc 关闭</div>
      <ul>
        <li
          v-for="(d, di) in filteredDefs"
          :key="d.type"
          :class="{ active: di === slash.index }"
          @mouseenter="slash.index = di"
          @mousedown.prevent="applySlash(d)"
        >
          <span class="wx-be-menu-hint">{{ d.hint }}</span>
          <span class="wx-be-menu-label">{{ d.label }}</span>
          <span class="wx-be-menu-desc">{{ d.desc }}</span>
        </li>
      </ul>
    </div>

    <!-- ===== @ 引用菜单 ===== -->
    <div v-if="mention.open" class="wx-be-menu slim" :style="{ top: `${mention.top}px`, left: `${mention.left}px` }">
      <div class="wx-be-menu-head">@ 引用 · 回车确认</div>
      <ul>
        <li
          v-for="(m, mi) in mentionItems"
          :key="m.key"
          :class="{ active: mi === mention.index }"
          @mouseenter="mention.index = mi"
          @mousedown.prevent="applyMention(m)"
        >
          <span class="wx-be-menu-hint">@</span>
          <span class="wx-be-menu-label">{{ m.label }}</span>
          <span class="wx-be-menu-desc">{{ m.hint }}</span>
        </li>
      </ul>
    </div>

    <!-- ===== [[ 页面链接菜单 ===== -->
    <div v-if="pageMenu.open" class="wx-be-menu slim" :style="{ top: `${pageMenu.top}px`, left: `${pageMenu.left}px` }">
      <div class="wx-be-menu-head">链接页面 · 输入关键词过滤</div>
      <ul>
        <li :class="{ active: pageMenu.index === 0 }" @mouseenter="pageMenu.index = 0" @mousedown.prevent="applyPageNew">
          <span class="wx-be-menu-hint">＋</span>
          <span class="wx-be-menu-label">新建子页面</span>
          <span class="wx-be-menu-desc">{{ pageMenu.query.trim() || '无标题子页面' }}</span>
        </li>
        <li
          v-for="(p, pi) in pageMenu.results"
          :key="p.id"
          :class="{ active: pageMenu.index === pi + 1 }"
          @mouseenter="pageMenu.index = pi + 1"
          @mousedown.prevent="applyPagePost(p)"
        >
          <span class="wx-be-menu-hint">📄</span>
          <span class="wx-be-menu-label">{{ p.title }}</span>
          <span class="wx-be-menu-desc">{{ p.author.nickname }}</span>
        </li>
      </ul>
      <input v-model="pageMenu.query" class="wx-be-menu-filter" placeholder="搜索本行业帖子或输入子页面标题" @keydown.enter.prevent />
    </div>

    <!-- ===== 块操作菜单（Ctrl+/ 或手柄点击） ===== -->
    <div v-if="blockMenu.open && !readonly" class="wx-be-blockmenu" :style="{ top: `${blockMenu.y}px`, left: `${blockMenu.x}px` }">
      <template v-if="!blockMenu.sub">
        <button @mousedown.prevent="blockMenuItem('insert-below')">⤵ 在下方插入块</button>
        <button @mousedown.prevent="blockMenuItem('dup')">⧉ 复制副本</button>
        <button @mousedown.prevent="blockMenu.sub = 'turn'">⇄ 转换为…</button>
        <button @mousedown.prevent="blockMenu.sub = 'color'">🎨 文字颜色</button>
        <button @mousedown.prevent="blockMenuItem('indent+')">→ 增加缩进（Tab）</button>
        <button @mousedown.prevent="blockMenuItem('indent-')">← 减少缩进</button>
        <button @mousedown.prevent="blockMenuItem('up')">↑ 上移</button>
        <button @mousedown.prevent="blockMenuItem('down')">↓ 下移</button>
        <button class="danger" @mousedown.prevent="blockMenuItem('delete')">✕ 删除块</button>
      </template>
      <template v-else-if="blockMenu.sub === 'turn'">
        <button v-for="d in BLOCK_DEFS" :key="d.type" @mousedown.prevent="turnInto(d.type)">
          {{ d.hint }} {{ d.label }}
        </button>
      </template>
      <template v-else>
        <button v-for="c in COLOR_SETS" :key="c" @mousedown.prevent="colorSel(c)">
          <span class="wx-be-color-dot" :class="`dot-${c}`"></span> {{ colorLabel(c) }}
        </button>
      </template>
    </div>

    <!-- ===== 选中浮动格式栏 ===== -->
    <div
      v-if="selBar.open && !readonly"
      class="wx-be-selbar"
      :style="{ top: `${selBar.y}px`, left: `${selBar.x}px` }"
      @mousedown.prevent
    >
      <button title="加粗" @click="wrapSel('**')"><b>B</b></button>
      <button title="斜体" @click="wrapSel('*')"><i>I</i></button>
      <button title="下划线" @click="wrapSel('__')"><u>U</u></button>
      <button title="删除线" @click="wrapSel('~~')"><s>S</s></button>
      <button title="行内代码" @click="wrapSel('`')"><code>{ }</code></button>
      <button title="高亮颜色" @click="wrapSel('==')">==</button>
      <button title="链接" @click="linkSel()">🔗</button>
      <button title="问星 AI 处理选中内容" @click="askAi()">✦ AI</button>
      <button
        v-for="c in COLOR_SETS"
        :key="c"
        class="wx-be-selbar-color"
        :title="colorLabel(c)"
        @click="colorSel(c)"
      >
        <span class="wx-be-color-dot" :class="`dot-${c}`"></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.wx-be {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 120px;
}
.wx-be-empty {
  padding: 26px 14px;
  border: 1px dashed var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  font-size: 12.5px;
  color: var(--wx-text-muted);
  text-align: center;
  cursor: pointer;
}
.wx-be-empty:hover { border-color: var(--wx-border-glow); color: var(--wx-text-tertiary); }

/* 行 */
.wx-be-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 2px;
  border-radius: var(--wx-radius-sm);
}
.wx-be-row.drop-before::before,
.wx-be-row.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--wx-color-primary);
  box-shadow: 0 0 8px var(--wx-color-primary);
}
.wx-be-row.drop-before::before { top: -2px; }
.wx-be-row.drop-after::after { bottom: -2px; }
.wx-be-row.drop-coll { outline: 1.5px dashed color-mix(in srgb, var(--wx-color-primary) 55%, transparent); outline-offset: 2px; }

.wx-be-gutter {
  display: flex;
  align-items: center;
  gap: 1px;
  width: 44px;
  flex-shrink: 0;
  justify-content: flex-end;
  padding-top: 7px;
  opacity: 0;
  transition: opacity var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-be-row:hover .wx-be-gutter { opacity: 1; }
.wx-be-gutter-btn {
  width: 20px;
  height: 22px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--wx-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-be-gutter-btn:hover { color: var(--wx-text-primary); background: color-mix(in srgb, var(--wx-ink) 8%, transparent); }
.wx-be-gutter-btn.drag { cursor: grab; font-size: 13px; }
.wx-be-gutter-btn.drag:active { cursor: grabbing; }

.wx-be-main { flex: 1; min-width: 0; }

/* 文本行 */
.wx-be-line { display: flex; align-items: flex-start; gap: 8px; }
.wx-be-marker {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  padding-top: 8px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  font-family: var(--wx-font-mono);
}
.wx-be-check {
  flex-shrink: 0;
  margin-top: 7px;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  border: 1.5px solid var(--wx-text-muted);
  color: transparent;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-be-check.on { background: var(--wx-color-primary); border-color: var(--wx-color-primary); color: var(--wx-text-on-accent); }

.wx-be-content {
  flex: 1;
  min-width: 0;
  min-height: 30px;
  padding: 4px 6px;
  border-radius: var(--wx-radius-sm);
  outline: none;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--wx-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-be-content:focus { background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent); }
.wx-be-content:empty::before {
  content: attr(data-ph);
  color: var(--wx-text-muted);
  pointer-events: none;
}
.wx-be-c-h1 { font-size: 22px; font-weight: 700; font-family: var(--wx-font-serif); padding-top: 8px; }
.wx-be-c-h2 { font-size: 18px; font-weight: 600; font-family: var(--wx-font-serif); padding-top: 6px; }
.wx-be-c-h3 { font-size: 15.5px; font-weight: 600; padding-top: 5px; }
.wx-be-line.quote .wx-be-content {
  border-left: 3px solid var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 7%, transparent);
  color: var(--wx-text-secondary);
  border-radius: 0 var(--wx-radius-sm) var(--wx-radius-sm) 0;
}
.wx-be-color-amber { color: var(--wx-color-amber); }
.wx-be-color-teal { color: var(--wx-color-yanqing); }
.wx-be-color-rose { color: var(--wx-color-vermilion); }
.wx-be-color-violet { color: var(--wx-color-zixia); }

/* 代码块 */
.wx-be-code {
  width: 100%;
  resize: vertical;
  background: color-mix(in srgb, var(--wx-bg-deep) 80%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-secondary);
  font-family: var(--wx-font-mono);
  font-size: 12.5px;
  line-height: 1.7;
  padding: 12px 14px;
  outline: none;
}
.wx-be-code:focus { border-color: var(--wx-border-glow); }

/* 分割线 */
.wx-be-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
  color: var(--wx-text-muted);
  letter-spacing: 4px;
  user-select: none;
}

/* 图片 */
.wx-be-image { padding: 2px 0; }
.wx-be-image img {
  max-width: 100%;
  max-height: 420px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  display: block;
}
.wx-be-image-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 92px;
  border: 1px dashed var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  font-size: 12px;
  color: var(--wx-text-muted);
  cursor: pointer;
}
.wx-be-image-empty:hover { border-color: var(--wx-border-glow); color: var(--wx-text-tertiary); }
.wx-be-image-empty input { display: none; }
.wx-be-image-tools { display: flex; gap: 6px; margin-top: 6px; }
.wx-be-mini {
  padding: 3px 10px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-tertiary);
  font-size: 11px;
}
.wx-be-mini:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-be-mini.danger:hover { color: var(--wx-color-vermilion); border-color: color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }

/* 表格 */
.wx-be-tablewrap { overflow-x: auto; padding: 2px 0; }
.wx-be-table {
  border-collapse: collapse;
  min-width: 380px;
  font-size: 12.5px;
}
.wx-be-table th,
.wx-be-table td {
  border: 1px solid var(--wx-border-soft);
  padding: 7px 11px;
  min-width: 90px;
  outline: none;
  color: var(--wx-text-secondary);
}
.wx-be-table th { background: color-mix(in srgb, var(--wx-ink) 5%, transparent); color: var(--wx-text-primary); font-weight: 600; }
.wx-be-table.db th { background: linear-gradient(135deg, color-mix(in srgb, var(--wx-color-primary) 30%, transparent), color-mix(in srgb, var(--wx-color-primary) 24%, transparent)); color: var(--wx-text-on-accent); }
.wx-be-table.db td:first-child { font-weight: 600; color: var(--wx-text-primary); }
.wx-be-table-tools { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.wx-be-db-tag { font-size: 10.5px; color: var(--wx-text-muted); margin-left: 6px; }

/* 折叠 */
.wx-be-toggle-head { display: flex; align-items: flex-start; gap: 4px; }
.wx-be-toggle-arrow {
  flex-shrink: 0;
  margin-top: 6px;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: var(--wx-text-tertiary);
  font-size: 11px;
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-be-toggle.open .wx-be-toggle-arrow { transform: rotate(90deg); }
.wx-be-toggle-head .wx-be-content { font-weight: 600; }
.wx-be-toggle-count {
  flex-shrink: 0;
  margin-top: 9px;
  padding: 0 7px;
  border-radius: 8px;
  font-size: 10px;
  color: var(--wx-text-muted);
  background: color-mix(in srgb, var(--wx-ink) 7%, transparent);
}
.wx-be-toggle-body {
  margin: 2px 0 4px 24px;
  padding-left: 10px;
  border-left: 1px solid var(--wx-border-soft);
}

/* 思维导图 */
.wx-be-mind { display: flex; flex-direction: column; gap: 8px; }
.wx-be-mind-svg {
  width: 100%;
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
}
.wx-be-mind-edge { fill: none; stroke: color-mix(in srgb, var(--wx-color-primary) 40%, transparent); stroke-width: 1.5; }
.wx-be-mind-node { fill: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); stroke: color-mix(in srgb, var(--wx-color-primary) 45%, transparent); }
.wx-be-mind-node.lv0 { fill: color-mix(in srgb, var(--wx-color-primary) 40%, transparent); }
.wx-be-mind-node.lv2 { fill: color-mix(in srgb, var(--wx-color-yanqing) 16%, transparent); stroke: color-mix(in srgb, var(--wx-color-yanqing) 40%, transparent); }
.wx-be-mind-node.lv3 { fill: color-mix(in srgb, var(--wx-color-amber) 14%, transparent); stroke: color-mix(in srgb, var(--wx-color-amber) 40%, transparent); }
.wx-be-mind-svg text {
  fill: #e2e8f0;
  font-size: 11px;
  text-anchor: middle;
  dominant-baseline: middle;
}
.wx-be-mind-edit {
  resize: vertical;
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-secondary);
  font-family: var(--wx-font-mono);
  font-size: 12px;
  padding: 8px 12px;
  outline: none;
}
.wx-be-mind-edit:focus { border-color: var(--wx-border-glow); }

/* 文件 / 嵌入 / 页面 */
.wx-be-file, .wx-be-embed, .wx-be-page { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 2px 0; }
.wx-be-file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  font-size: 12.5px;
  text-decoration: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-be-file-card:hover { border-color: var(--wx-border-glow); color: var(--wx-text-primary); }
.wx-be-file-icon { font-size: 14px; }
.wx-be-file-name { font-weight: 500; color: var(--wx-text-primary); }
.wx-be-file-host { font-size: 11px; color: var(--wx-text-muted); }
.wx-be-inline-input {
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-primary);
  font-size: 12.5px;
  padding: 7px 10px;
  outline: none;
}
.wx-be-inline-input.grow { flex: 1; min-width: 200px; }
.wx-be-inline-input:focus { border-color: var(--wx-border-glow); }
.wx-be-embed-frame {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
}
.wx-be-page-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--wx-radius-md);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  color: var(--wx-text-primary);
  font-size: 13px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-be-page-card:hover { border-color: var(--wx-border-glow); background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent); }
.wx-be-page-title { font-weight: 600; }
.wx-be-page-badge {
  padding: 1px 8px;
  border-radius: 8px;
  font-size: 10px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
}
.wx-be-page-badge.post { color: var(--wx-color-yanqing); background: color-mix(in srgb, var(--wx-color-yanqing) 14%, transparent); }
.wx-be-page-open { font-size: 11px; color: var(--wx-text-muted); }

/* 分栏 */
.wx-be-columns { display: flex; gap: 12px; align-items: stretch; }
.wx-be-col {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px dashed var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-ink) 2%, transparent);
}

/* 菜单（斜杠 / @ / [[） */
.wx-be-menu {
  position: absolute;
  z-index: 40;
  width: 320px;
  max-height: 300px;
  overflow-y: auto;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 96%, transparent);
  border: 1px solid var(--wx-border-glow);
  box-shadow: var(--wx-shadow-lg);
  backdrop-filter: blur(18px);
  padding: 6px;
}
.wx-be-menu.slim { width: 280px; }
.wx-be-menu-head {
  font-size: 10.5px;
  color: var(--wx-text-muted);
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--wx-border-soft);
  margin-bottom: 4px;
}
.wx-be-menu ul { display: flex; flex-direction: column; gap: 1px; }
.wx-be-menu li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: var(--wx-radius-sm);
  cursor: pointer;
}
.wx-be-menu li.active { background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); }
.wx-be-menu-hint {
  width: 26px;
  flex-shrink: 0;
  text-align: center;
  font-family: var(--wx-font-mono);
  font-size: 11px;
  color: var(--wx-color-primary-soft);
}
.wx-be-menu-label { flex-shrink: 0; font-size: 12.5px; color: var(--wx-text-primary); }
.wx-be-menu-desc {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--wx-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.wx-be-menu-filter {
  width: 100%;
  margin-top: 6px;
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  color: var(--wx-text-primary);
  font-size: 12px;
  padding: 6px 9px;
  outline: none;
}
.wx-be-menu-filter:focus { border-color: var(--wx-border-glow); }

/* 块菜单 */
.wx-be-blockmenu {
  position: fixed;
  z-index: 60;
  width: 210px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 97%, transparent);
  border: 1px solid var(--wx-border-glow);
  box-shadow: var(--wx-shadow-lg);
  max-height: 380px;
  overflow-y: auto;
}
.wx-be-blockmenu button {
  text-align: left;
  padding: 7px 10px;
  border-radius: var(--wx-radius-sm);
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-be-blockmenu button:hover { background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent); color: var(--wx-text-on-accent); }
.wx-be-blockmenu button.danger:hover { background: color-mix(in srgb, var(--wx-color-vermilion) 16%, transparent); color: var(--wx-color-vermilion); }
.wx-be-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.wx-be-color-dot.dot-amber { background: var(--wx-color-amber); }
.wx-be-color-dot.dot-teal { background: var(--wx-color-yanqing); }
.wx-be-color-dot.dot-rose { background: var(--wx-color-vermilion); }
.wx-be-color-dot.dot-violet { background: var(--wx-color-zixia); }

/* 浮动格式栏 */
.wx-be-selbar {
  position: fixed;
  z-index: 70;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 7px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 97%, transparent);
  border: 1px solid var(--wx-border-glow);
  box-shadow: var(--wx-shadow-lg);
}
.wx-be-selbar button {
  min-width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-be-selbar button:hover { background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent); color: var(--wx-text-on-accent); }
.wx-be-selbar code { font-size: 11px; }
.wx-be-selbar-color .wx-be-color-dot { width: 14px; height: 14px; }

/* 只读模式：保留排版，去掉编辑态的间距与光标提示 */
.wx-be--readonly .wx-be-row { padding-left: 0 !important; }
.wx-be--readonly .wx-be-main { cursor: default; }
.wx-be--readonly [contenteditable="false"] { outline: none; }
</style>
