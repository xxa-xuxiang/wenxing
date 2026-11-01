<script setup lang="ts">
// Notion 式块编辑器核心（递归组件：折叠子块 / 分栏单元格复用同一编辑器）
// 移动端适配：去除拖拽手势与桌面快捷键，改为「长按块 / 右侧 ⋮」呼出 van-action-sheet 块操作层
// （类型转换/上移下移/缩进/复制/删除）
// 保留：斜杠命令、@ 引用、[[ 页面链接、Tab 缩进、Enter 分块、选中浮动格式栏、折叠/分栏/表格/思维导图
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { ActionSheetAction } from 'vant'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { uploadImage, listPosts, type CommunityPostListItem } from '@/services/communityService'
import {
  BLOCK_DEFS,
  newBlock,
  uid,
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
  if (node && node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.min(off, (node as Text).length))
  } else {
    range.selectNodeContents(el)
    range.collapse(off === 0)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
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

watch(
  () => props.blocks,
  () => {
    void nextTick(syncAllText)
  },
  { deep: true }
)

// 点击编辑器外部 → 收起选区浮动栏（仅顶层挂全局监听，避免递归实例各挂一份）
function onDocMousedown() {
  if (selBar.open && !rootEl.value?.contains(document.activeElement)) selBar.open = false
}

// 移动端长按选中文字不触发 mouseup/keyup，用 selectionchange 兜底（防抖）
let selTimer: number | undefined
function onSelectionChangeDebounced() {
  window.clearTimeout(selTimer)
  selTimer = window.setTimeout(() => onDocSelectionChange(), 140)
}

onMounted(() => {
  void nextTick(syncAllText)
  if (!props.nested) {
    document.addEventListener('mousedown', onDocMousedown)
    document.addEventListener('selectionchange', onSelectionChangeDebounced)
  }
})
onBeforeUnmount(() => {
  if (!props.nested) {
    document.removeEventListener('mousedown', onDocMousedown)
    document.removeEventListener('selectionchange', onSelectionChangeDebounced)
    window.clearTimeout(selTimer)
  }
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
const blockMenu = reactive({ open: false, blockId: '', sub: '' as '' | 'turn' | 'color' })

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
  return { top: r.bottom - rr.top + 6, left: Math.max(0, r.left - rr.left) }
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

// ===== 选中浮动格式栏 =====
const selBar = reactive({ open: false, x: 0, y: 0, blockId: '', from: 0, to: 0 })
/** 浮动栏打开时刻：触屏点击按钮会先触发 selectionchange 折叠，留宽限避免栏被提前关闭 */
let selBarAt = 0

function onDocSelectionChange() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    if (Date.now() - selBarAt > 400) selBar.open = false
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
  selBarAt = Date.now()
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

/** 选中文字的颜色（浮动栏） */
function colorSel(c: string) {
  const b = findDeep(props.blocks, selBar.blockId)
  const el = rowEls.get(selBar.blockId)
  if (!b || !el) return
  if (b.color === c) delete b.color
  else b.color = c
  selBar.open = false
}

/** 当前块的颜色（块操作弹层） */
function setBlockColor(c: string) {
  const b = findDeep(props.blocks, blockMenu.blockId)
  if (!b) return
  if (b.color === c) delete b.color
  else b.color = c
  blockMenu.open = false
  blockMenu.sub = ''
}

/** 选中文本送问星 AI（父组件转发到 AI 面板） */
function askAi() {
  const b = findDeep(props.blocks, selBar.blockId)
  if (!b) return
  const seg = b.text.slice(selBar.from, selBar.to)
  if (!seg.trim()) return
  selBar.open = false
  emit('ai', seg)
}

// ===== 块操作弹层（触屏主入口：⋮ 按钮 / 长按块） =====
const MAIN_SHEET_ACTIONS: ActionSheetAction[] = [
  { name: '在下方插入块', subname: '在当前块之后新建正文块' },
  { name: '复制副本', subname: '保留格式与子块' },
  { name: '转换为…', subname: '切换块类型' },
  { name: '文字颜色', subname: '为整块应用颜色' },
  { name: '增加缩进' },
  { name: '减少缩进' },
  { name: '上移' },
  { name: '下移' },
  { name: '删除块', color: '#ee0a24' }
]

const blockSheetTitle = computed(() =>
  blockMenu.sub === 'turn' ? '转换为' : blockMenu.sub === 'color' ? '文字颜色' : '块操作'
)

const blockSheetActions = computed<ActionSheetAction[]>(() => {
  if (blockMenu.sub === 'turn') {
    return [
      { name: '← 返回块操作' },
      ...BLOCK_DEFS.map((d) => ({ name: `${d.hint} ${d.label}`, subname: d.desc }))
    ]
  }
  if (blockMenu.sub === 'color') {
    return [{ name: '← 返回块操作' }, ...COLOR_SETS.map((c) => ({ name: colorLabel(c) }))]
  }
  return MAIN_SHEET_ACTIONS
})

function openBlockMenu(b: EdBlock) {
  // 主动收键盘：底部弹出层在软键盘之上不可见
  const active = document.activeElement as HTMLElement | null
  if (active && rootEl.value?.contains(active)) active.blur()
  selBar.open = false
  blockMenu.open = true
  blockMenu.blockId = b.id
  blockMenu.sub = ''
}

function closeBlockMenu() {
  blockMenu.open = false
  blockMenu.sub = ''
}

function onBlockSheetShow(v: boolean) {
  if (!v) closeBlockMenu()
}

function onBlockSheetSelect(action: ActionSheetAction) {
  const name = action.name ?? ''
  if (name === '← 返回块操作') {
    blockMenu.sub = ''
    return
  }
  if (blockMenu.sub === 'turn') {
    const d = BLOCK_DEFS.find((x) => `${x.hint} ${x.label}` === name)
    if (d) turnInto(d.type)
    return
  }
  if (blockMenu.sub === 'color') {
    const c = COLOR_SETS.find((x) => colorLabel(x) === name)
    if (c) setBlockColor(c)
    return
  }
  switch (name) {
    case '转换为…':
      blockMenu.sub = 'turn'
      return
    case '文字颜色':
      blockMenu.sub = 'color'
      return
    case '在下方插入块':
      blockMenuItem('insert-below')
      return
    case '复制副本':
      blockMenuItem('dup')
      return
    case '增加缩进':
      blockMenuItem('indent+')
      return
    case '减少缩进':
      blockMenuItem('indent-')
      return
    case '上移':
      blockMenuItem('up')
      return
    case '下移':
      blockMenuItem('down')
      return
    case '删除块':
      blockMenuItem('delete')
      return
  }
}

// ===== 长按块：呼出同一个块操作弹层（与 ⋮ 按钮等价） =====
let pressTimer: number | undefined
let pressStartX = 0
let pressStartY = 0
let pressMoved = false

function onRowTouchStart(b: EdBlock, e: Event) {
  if (props.readonly) return
  const te = e as TouchEvent
  if (te.touches.length !== 1) return
  const target = e.target as HTMLElement | null
  if (target?.closest('button, a, input')) return
  const t = te.touches[0]
  pressStartX = t.clientX
  pressStartY = t.clientY
  pressMoved = false
  // 阻止外层折叠/分栏行重复计时（递归编辑器的最内层先响应）
  e.stopPropagation()
  window.clearTimeout(pressTimer)
  pressTimer = window.setTimeout(() => {
    pressTimer = undefined
    if (pressMoved) return
    if (navigator.vibrate) navigator.vibrate(12)
    window.getSelection()?.removeAllRanges()
    openBlockMenu(b)
  }, 500)
}

function onRowTouchMove(e: Event) {
  if (pressTimer === undefined) return
  const t = (e as TouchEvent).touches[0]
  if (!t) return
  if (Math.abs(t.clientX - pressStartX) > 8 || Math.abs(t.clientY - pressStartY) > 8) {
    pressMoved = true
    window.clearTimeout(pressTimer)
    pressTimer = undefined
  }
}

function onRowTouchEnd() {
  window.clearTimeout(pressTimer)
  pressTimer = undefined
}

/** 移动端长按会弹系统菜单；块操作统一由底部弹层接管 */
function onRowContextMenu(e: Event) {
  if (!props.readonly) e.preventDefault()
}

function blockMenuItem(action: string) {
  const b = findDeep(props.blocks, blockMenu.blockId)
  if (!b) return
  const i = props.blocks.indexOf(b)
  switch (action) {
    case 'dup': {
      const clone = JSON.parse(JSON.stringify(b)) as EdBlock
      clone.id = uid()
      const walk = (x: EdBlock) => {
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
  closeBlockMenu()
  void nextTick(syncAllText)
}

function turnInto(t: BlockType) {
  const b = findDeep(props.blocks, blockMenu.blockId)
  if (b) convertBlock(b, t)
  closeBlockMenu()
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
function subPageCount(b: EdBlock): number {
  if (!b.pageId || b.pageId.startsWith('post:')) return 0
  const d = loadSubPage(b.pageId)
  return d ? d.blocks.length : 0
}

/** 底部工具栏「插入块」：当前聚焦块之后插入新块并聚焦（无聚焦时追加到末尾） */
function insertNewBlock(type: BlockType) {
  const target = activeId.value ? props.blocks.find((b) => b.id === activeId.value) : null
  const nb = newBlock(type)
  if (target) {
    const i = idxOf(target.id)
    props.blocks.splice(i + 1, 0, nb)
  } else {
    props.blocks.push(nb)
  }
  void nextTick(() => {
    syncAllText()
    focusBlock(nb.id, 'end')
  })
  if (type === 'image') pickImage(nb.id)
}

const placeholderText = computed(() => props.placeholder ?? '输入内容，/ 呼出命令，@ 引用，[[ 链接页面')

defineExpose({ focusBlock, findDeep, insertNewBlock })
</script>

<template>
  <div ref="rootEl" class="wx-be" :class="{ 'wx-be--readonly': readonly }">
    <!-- 空列表占位 -->
    <div v-if="!blocks.length && !readonly" class="wx-be-empty" @click="blocks.push(newBlock('p'))">
      空白区域 · 点击开始输入
    </div>
    <div v-else-if="!blocks.length" class="wx-be-empty">暂无内容</div>

    <template v-for="(b, i) in blocks" :key="b.id">
      <div
        class="wx-be-row"
        :style="{ paddingLeft: `${b.indent * 22}px` }"
        @touchstart.passive="onRowTouchStart(b, $event)"
        @touchmove.passive="onRowTouchMove"
        @touchend="onRowTouchEnd"
        @touchcancel="onRowTouchEnd"
        @contextmenu="onRowContextMenu"
      >
        <div class="wx-be-main">
          <!-- ===== 分割线 ===== -->
          <div v-if="b.type === 'divider'" class="wx-be-divider"><span>— — —</span></div>

          <!-- ===== 图片 ===== -->
          <div v-else-if="b.type === 'image'" class="wx-be-image">
            <img v-if="b.url" :src="apiUrl(b.url)" :alt="b.name || '图片'" />
            <label v-else class="wx-be-image-empty">
              <span>▣ 点击上传图片（JPG/PNG/WebP）</span>
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
                data-ph="折叠标题"
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
            <button class="wx-be-page-card" @click="openPage(b)">
              <span class="wx-be-file-icon">📄</span>
              <span class="wx-be-page-title">{{ b.text || '无标题页面' }}</span>
              <span v-if="b.pageId && !b.pageId.startsWith('post:')" class="wx-be-page-badge">{{ subPageCount(b) }} 块</span>
              <span v-else class="wx-be-page-badge post">帖子</span>
              <span class="wx-be-page-open">打开 →</span>
            </button>
            <button class="wx-be-mini danger" @click="removeBlock(b.id)">删除</button>
          </div>

          <!-- ===== 分栏（移动端单列堆叠） ===== -->
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

        <!-- 右侧触屏手柄：打开块操作弹层（替代桌面拖拽手柄） -->
        <div v-if="!readonly" class="wx-be-gutter">
          <button class="wx-be-gutter-btn" title="块操作" @click.stop="openBlockMenu(b)">⋮</button>
        </div>
      </div>
    </template>

    <!-- 隐藏图片选择器 -->
    <input ref="imgInput" type="file" accept="image/jpeg,image/png,image/webp" style="display: none" @change="onPickImage" />

    <!-- ===== 斜杠命令菜单 ===== -->
    <div v-if="slash.open && filteredDefs.length && !readonly" class="wx-be-menu" :style="{ top: `${slash.top}px`, left: `${slash.left}px` }">
      <div class="wx-be-menu-head">块样式 · 点击选择</div>
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
      <div class="wx-be-menu-head">@ 引用</div>
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

    <!-- ===== 块操作弹层（触屏：⋮ 按钮 / 长按块） ===== -->
    <van-action-sheet
      :show="blockMenu.open && !readonly"
      :actions="blockSheetActions"
      :title="blockSheetTitle"
      cancel-text="完成"
      :close-on-click-action="false"
      round
      safe-area-inset-bottom
      @select="onBlockSheetSelect"
      @update:show="onBlockSheetShow"
    />

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

/* 行 */
.wx-be-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 2px;
  border-radius: var(--wx-radius-sm);
}

/* 触屏手柄（右侧，常显低对比） */
.wx-be-gutter {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  flex-shrink: 0;
  padding-top: 2px;
  opacity: 0.55;
}
.wx-be-gutter-btn {
  width: 32px;
  height: 40px;
  border-radius: 8px;
  font-size: 17px;
  line-height: 1;
  color: var(--wx-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}
.wx-be-gutter-btn:active { background: color-mix(in srgb, var(--wx-ink) 8%, transparent); color: var(--wx-text-primary); }

.wx-be-main { flex: 1; min-width: 0; }

/* 文本行 */
.wx-be-line { display: flex; align-items: flex-start; gap: 8px; }
.wx-be-marker {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  padding-top: 9px;
  font-size: 13px;
  color: var(--wx-text-tertiary);
  font-family: var(--wx-font-mono);
}
.wx-be-check {
  flex-shrink: 0;
  margin-top: 8px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid var(--wx-text-muted);
  color: transparent;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-be-check.on { background: var(--wx-color-primary); border-color: var(--wx-color-primary); color: var(--wx-text-on-accent); }

.wx-be-content {
  flex: 1;
  min-width: 0;
  min-height: 34px;
  padding: 6px 4px;
  border-radius: var(--wx-radius-sm);
  outline: none;
  font-size: 15px;
  line-height: 1.75;
  color: var(--wx-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-user-select: text;
  user-select: text;
}
.wx-be-content:focus { background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent); }
.wx-be-content:empty::before {
  content: attr(data-ph);
  color: var(--wx-text-muted);
  pointer-events: none;
}
.wx-be-c-h1 { font-size: 21px; font-weight: 700; font-family: var(--wx-font-serif); padding-top: 8px; }
.wx-be-c-h2 { font-size: 18px; font-weight: 600; font-family: var(--wx-font-serif); padding-top: 6px; }
.wx-be-c-h3 { font-size: 16px; font-weight: 600; padding-top: 5px; }
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
  font-size: 13px;
  line-height: 1.7;
  padding: 10px 12px;
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
  max-height: 360px;
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
  font-size: 12.5px;
  color: var(--wx-text-muted);
  cursor: pointer;
}
.wx-be-image-empty input { display: none; }
.wx-be-image-tools { display: flex; gap: 6px; margin-top: 6px; }
.wx-be-mini {
  padding: 5px 12px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-tertiary);
  font-size: 12px;
}

/* 表格 */
.wx-be-tablewrap { overflow-x: auto; padding: 2px 0; }
.wx-be-table {
  border-collapse: collapse;
  min-width: 100%;
  font-size: 13px;
}
.wx-be-table th,
.wx-be-table td {
  border: 1px solid var(--wx-border-soft);
  padding: 7px 9px;
  min-width: 72px;
  outline: none;
  color: var(--wx-text-secondary);
}
.wx-be-table th { background: color-mix(in srgb, var(--wx-ink) 5%, transparent); color: var(--wx-text-primary); font-weight: 600; }
.wx-be-table.db th { background: var(--wx-color-primary); color: var(--wx-text-on-accent); }
.wx-be-table.db td:first-child { font-weight: 600; color: var(--wx-text-primary); }
.wx-be-table-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.wx-be-db-tag { font-size: 11px; color: var(--wx-text-muted); }

/* 折叠 */
.wx-be-toggle-head { display: flex; align-items: flex-start; gap: 4px; }
.wx-be-toggle-arrow {
  flex-shrink: 0;
  margin-top: 6px;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--wx-text-tertiary);
  font-size: 12px;
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-be-toggle.open .wx-be-toggle-arrow { transform: rotate(90deg); }
.wx-be-toggle-head .wx-be-content { font-weight: 600; }
.wx-be-toggle-count {
  flex-shrink: 0;
  margin-top: 10px;
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
  fill: var(--wx-text-primary);
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
  font-size: 13px;
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
  padding: 9px 12px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  font-size: 13px;
  text-decoration: none;
}
.wx-be-file-icon { font-size: 14px; }
.wx-be-file-name { font-weight: 500; color: var(--wx-text-primary); }
.wx-be-file-host { font-size: 11px; color: var(--wx-text-muted); }
.wx-be-inline-input {
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-primary);
  font-size: 13px;
  padding: 7px 10px;
  outline: none;
}
.wx-be-inline-input.grow { flex: 1; min-width: 0; }
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
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--wx-radius-md);
  border: 1px solid color-mix(in srgb, var(--wx-color-primary) 30%, transparent);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  color: var(--wx-text-primary);
  font-size: 13px;
  flex: 1;
  min-width: 0;
  text-align: left;
}
.wx-be-page-title { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wx-be-page-badge {
  padding: 1px 8px;
  border-radius: 8px;
  font-size: 10px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
  flex-shrink: 0;
}
.wx-be-page-badge.post { color: var(--wx-color-yanqing); background: color-mix(in srgb, var(--wx-color-yanqing) 14%, transparent); }
.wx-be-page-open { font-size: 11px; color: var(--wx-text-muted); flex-shrink: 0; }

/* 分栏：移动端单列 100% 堆叠 */
.wx-be-columns { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.wx-be-col {
  width: 100%;
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
  width: min(320px, calc(100vw - 24px));
  max-height: 46vh;
  overflow-y: auto;
  border-radius: var(--wx-radius-md);
  background: #ffffff;
  border: 1px solid var(--wx-border-glow);
  box-shadow: var(--wx-shadow-lg);
  backdrop-filter: blur(18px);
  padding: 6px;
}
.wx-be-menu.slim { width: min(280px, calc(100vw - 24px)); }
.wx-be-menu-head {
  font-size: 11px;
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
  padding: 10px 9px;
  border-radius: var(--wx-radius-sm);
  cursor: pointer;
}
.wx-be-menu li.active { background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent); }
.wx-be-menu-hint {
  width: 26px;
  flex-shrink: 0;
  text-align: center;
  font-family: var(--wx-font-mono);
  font-size: 11px;
  color: var(--wx-color-primary);
}
.wx-be-menu-label { flex-shrink: 0; font-size: 13px; color: var(--wx-text-primary); }
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
  background: var(--wx-bg-deep-2);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  color: var(--wx-text-primary);
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
}
.wx-be-menu-filter:focus { border-color: var(--wx-border-glow); }

.wx-be-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
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
  background: #ffffff;
  border: 1px solid var(--wx-border-glow);
  box-shadow: var(--wx-shadow-lg);
  max-width: calc(100vw - 16px);
  overflow-x: auto;
}
.wx-be-selbar button {
  min-width: 30px;
  height: 32px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--wx-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.wx-be-selbar button:active { background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent); color: var(--wx-text-primary); }
.wx-be-selbar code { font-size: 11px; }
.wx-be-selbar-color .wx-be-color-dot { width: 14px; height: 14px; }

/* 只读模式：保留排版，去掉编辑态的间距与光标提示 */
.wx-be--readonly .wx-be-row { padding-left: 0 !important; }
.wx-be--readonly .wx-be-main { cursor: default; }
.wx-be--readonly [contenteditable="false"] { outline: none; }
</style>
