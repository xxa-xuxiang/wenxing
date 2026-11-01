<script setup lang="ts">
// 问星社区 v0.9 — 发布编辑器（Notion 式块编辑器）
// 三区结构：顶部工具栏（返回/标题/预览/保存/发布/AI 开关）+ 中间块编辑区（核心）+ 右侧问星 AI 对话框
// 能力：块拖拽排序与分栏、斜杠命令、@/[[ 引用、Ctrl+/ 块菜单、Tab 缩进、子页面、
//       自动保存（块 JSON 草稿，兼容旧版 Markdown 草稿迁移）、发布时块树 → Markdown
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { visibleIndustries, industryById, DEFAULT_INDUSTRY_ID } from '@/data/communityIndustries'
import { COMMUNITY_TAGS, createPost, uploadImage } from '@/services/communityService'
import { renderMarkdown } from '@/utils/markdown'
import { storage } from '@/utils/storage'
import {
  blocksToMarkdown,
  blocksCharCount,
  blocksImageUrls,
  blocksPageCount,
  defaultDoc,
  loadSubPage,
  markdownToBlocks,
  newBlock,
  saveSubPage,
  type EdBlock,
  type SubPageDoc
} from '@/components/community/blocks'
import BlockEditorCore from '@/components/community/BlockEditorCore.vue'
import AiPanel from '@/components/community/AiPanel.vue'

const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()

// 未登录不允许进入编辑页（路由守卫之外的双保险）
onMounted(() => {
  if (!auth.user) router.replace('/auth')
})

// ===== 发布范围：默认继承当前行业（全站推荐流非真实行业，回退默认行业） =====
const industryId = ref(
  industryById(community.activeIndustryId) ? community.activeIndustryId : DEFAULT_INDUSTRY_ID
)
const industryOptions = computed(() => visibleIndustries())
const currentIndustryName = computed(() => industryById(industryId.value)?.name ?? '')

// ===== 文档数据（块树，就地变更 + 深度监听自动保存） =====
const title = ref('')
const blocks = ref<EdBlock[]>(defaultDoc())
const selectedTags = ref<string[]>([])

const editorRef = ref<InstanceType<typeof BlockEditorCore> | null>(null)
const aiRef = ref<InstanceType<typeof AiPanel> | null>(null)

// ===== 三区结构：左侧目录树 + 中间块编辑区 + 右侧问星 AI 对话框 =====

const docMarkdown = computed(() => blocksToMarkdown(blocks.value))

// ===== 目录树（h1/h2/h3 + 折叠块 + 子页面，随块树实时派生） =====
interface OutlineItem {
  id: string
  kind: 'h1' | 'h2' | 'h3' | 'toggle' | 'page'
  text: string
  level: number
  pageId?: string
  /** 祖先中处于折叠状态的 toggle id（跳转前需先展开，才能定位到 DOM） */
  collapseChain: string[]
}

const OUTLINE_ICON: Record<OutlineItem['kind'], string> = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  toggle: '▸',
  page: '📄'
}

const outline = computed<OutlineItem[]>(() => {
  const out: OutlineItem[] = []
  const walk = (list: EdBlock[], chain: string[]) => {
    for (const b of list) {
      if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
        out.push({
          id: b.id,
          kind: b.type,
          level: Number(b.type[1]),
          text: b.text.replace(/[*_~=`]/g, '').trim() || '未命名标题',
          collapseChain: chain
        })
      } else if (b.type === 'toggle') {
        out.push({ id: b.id, kind: 'toggle', level: 4, text: b.text.trim() || '折叠块', collapseChain: chain })
      } else if (b.type === 'page' && b.pageId) {
        out.push({
          id: b.id,
          kind: 'page',
          level: 4,
          text: b.text.trim() || '无标题页面',
          pageId: b.pageId,
          collapseChain: chain
        })
      }
      // 折叠中的 toggle 子块不在 DOM 中，记下祖先链，跳转前先展开
      const next = b.type === 'toggle' && !b.open ? [...chain, b.id] : chain
      if (b.children) walk(b.children, next)
      if (b.cols) for (const c of b.cols) walk(c, chain)
    }
  }
  walk(blocks.value, [])
  return out
})

/** 当前聚焦块 id（编辑器 @active 回流，用于目录高亮） */
const activeOutlineId = ref<string | null>(null)

/** 折叠块条目的三角：展开 / 收起该折叠块本体 */
function toggleOutlineGroup(it: OutlineItem) {
  const t = editorRef.value?.findDeep(blocks.value, it.id)
  if (t) t.open = !t.open
}

/** 点击目录项：子页面直接打开，标题/折叠块滚动定位并聚焦 */
function gotoOutline(it: OutlineItem) {
  if (it.kind === 'page') {
    openPageRef(it.pageId ?? '', it.text)
    return
  }
  for (const tid of it.collapseChain) {
    const t = editorRef.value?.findDeep(blocks.value, tid)
    if (t) t.open = true
  }
  activeOutlineId.value = it.id
  void nextTick(() => editorRef.value?.focusBlock(it.id, 'end'))
}

/** AI 结果解析为块，追加到文档末尾 */
function insertFromAi(md: string) {
  const parsed = markdownToBlocks(md)
  blocks.value.push(...parsed)
  markDirty()
  showNotice('AI 内容已插入文档末尾')
}

/** 编辑器选中文本 → 右侧 AI 面板 */
function onEditorAi(text: string) {
  void nextTick(() => aiRef.value?.setSelection(text))
}

// ===== 导入完整 MD 文件：解析为块树（空文档直接替换，已有内容追加） =====
const mdInput = ref<HTMLInputElement | null>(null)

function pickMd() {
  mdInput.value?.click()
}

function onMdFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    showNotice('仅支持 .md / .markdown / .txt 文件')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result ?? '')
    if (!text.trim()) {
      showNotice(`「${file.name}」内容为空`)
      return
    }
    const parsed = markdownToBlocks(text)
    if (!docMarkdown.value.trim()) {
      blocks.value = parsed // 空文档：直接替换
      if (!title.value.trim()) title.value = file.name.replace(/\.(md|markdown|txt)$/i, '')
    } else {
      blocks.value.push(...parsed) // 已有内容：追加到文档末尾
    }
    markDirty()
    showNotice(`已导入「${file.name}」`)
    void nextTick(() => {
      const last = blocks.value[blocks.value.length - 1]
      if (last) editorRef.value?.focusBlock(last.id, 'end')
    })
  }
  reader.onerror = () => showNotice('文件读取失败，请重试')
  reader.readAsText(file, 'utf-8')
}

// ===== 页面引用：子页面全屏 overlay / 帖子跳转 =====
const subPage = ref<SubPageDoc | null>(null)

function openPageRef(pageId: string, pageTitle: string) {
  if (pageId.startsWith('sp_')) {
    const doc = loadSubPage(pageId) ?? {
      id: pageId,
      title: pageTitle || '无标题子页面',
      blocks: [newBlock('p', '')],
      updatedAt: Date.now()
    }
    subPage.value = doc
  } else {
    router.push(`/community/${pageId}`)
  }
}

// 子页面内容变化自动落盘
watch(
  () => subPage.value?.blocks,
  () => {
    const sp = subPage.value
    if (!sp) return
    sp.updatedAt = Date.now()
    saveSubPage(sp)
  },
  { deep: true }
)

// 主文档块就地变更 → 触发草稿自动保存（块编辑器不经 v-model，全靠深度监听）
watch(
  blocks,
  () => {
    markDirty()
  },
  { deep: true }
)

function onSubTitleInput() {
  const sp = subPage.value
  if (!sp) return
  sp.updatedAt = Date.now()
  saveSubPage(sp)
}

function closeSubPage() {
  const sp = subPage.value
  if (sp) saveSubPage(sp)
  subPage.value = null
}

// ===== 状态栏统计 =====
const charCount = computed(() => blocksCharCount(blocks.value))
const pageCount = computed(() => blocksPageCount(blocks.value))
const readMinutes = computed(() => Math.max(1, Math.ceil(charCount.value / 400)))
const headingCount = computed(() => {
  let n = 0
  const walk = (list: EdBlock[]) => {
    for (const b of list) {
      if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') n += 1
      if (b.children) walk(b.children)
      if (b.cols) for (const c of b.cols) walk(c)
    }
  }
  walk(blocks.value)
  return n
})

// ===== 自动保存（草稿归属当前行业，停止输入后保存；块 JSON 格式 v2） =====
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved'
const saveState = ref<SaveState>('idle')
const savedAt = ref('')
let saveTimer: number | undefined

function draftKey(id: string) {
  return `community:draft:${id}`
}

function flushDraft() {
  storage.set(draftKey(industryId.value), {
    v: 2,
    industryId: industryId.value,
    title: title.value,
    tags: selectedTags.value,
    images: images.value.map((i) => i.url).filter(Boolean),
    blocks: blocks.value,
    updatedAt: Date.now()
  })
  savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  saveState.value = 'saved'
}

function markDirty() {
  if (saveState.value !== 'saving') saveState.value = 'dirty'
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveState.value = 'saving'
    saveTimer = window.setTimeout(flushDraft, 300)
  }, 900)
}

const saveLabel = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'dirty') return '未保存'
  if (saveState.value === 'saved') return savedAt.value ? `已保存 ${savedAt.value}` : '已保存'
  return '就绪'
})

// 关闭/刷新前：未保存内容强制落盘
function onBeforeUnload() {
  if (saveState.value === 'dirty' || saveState.value === 'saving') {
    window.clearTimeout(saveTimer)
    flushDraft()
  }
}

// ===== 附件图片（选择/拖拽 → 上传 → 附件列表；文内插图走块编辑器粘贴/图片块） =====
interface ImageItem {
  id: number
  preview: string
  url: string // '' = 上传中
}
const images = ref<ImageItem[]>([])
let imgSeq = 0
const uploadingImg = computed(() => images.value.some((i) => !i.url))

const notice = ref('')
let noticeTimer: number | undefined
function showNotice(text: string) {
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 3000)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

async function addImageFile(f: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
    showNotice(`「${f.name}」仅支持 JPG / PNG / WebP 格式`)
    return
  }
  if (f.size > 3 * 1024 * 1024) {
    showNotice(`「${f.name}」超过 3MB，已跳过`)
    return
  }
  if (images.value.length >= 9) {
    showNotice('最多上传 9 张图片')
    return
  }
  let item: ImageItem | null = null
  try {
    const dataUrl = await readAsDataUrl(f)
    item = { id: ++imgSeq, preview: dataUrl, url: '' }
    images.value.push(item)
    markDirty()
    const { url } = await uploadImage(dataUrl)
    const target = images.value.find((x) => x.id === item?.id)
    if (target) {
      target.url = url
      markDirty()
    }
  } catch {
    const failedId = item ? item.id : -1
    images.value = images.value.filter((x) => x.id !== failedId)
    showNotice(`「${f.name}」上传失败，请重试`)
  }
}

async function onPickImages(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  for (const f of files) await addImageFile(f)
}

function onDropImages(e: DragEvent) {
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (!files.length) return
  e.preventDefault()
  for (const f of files) void addImageFile(f)
}

function removeImage(id: number) {
  images.value = images.value.filter((i) => i.id !== id)
  markDirty()
}

// ===== 标签 =====
function toggleTag(tag: string) {
  const i = selectedTags.value.indexOf(tag)
  if (i >= 0) selectedTags.value.splice(i, 1)
  else if (selectedTags.value.length >= 6) showNotice('最多选择 6 个标签')
  else selectedTags.value.push(tag)
  markDirty()
}

// ===== 预览（块树 → Markdown → 渲染） =====
const previewOn = ref(false)
const previewHtml = computed(() => renderMarkdown(docMarkdown.value))

// ===== 发布 =====
const submitting = ref(false)
const failText = ref('')

/** 无标题时自动取首个标题块/首段正文作为标题 */
function deriveTitle(): string {
  const find = (list: EdBlock[]): string => {
    for (const b of list) {
      if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
        const t = b.text.replace(/[*_~=]/g, '').trim()
        if (t) return t
      }
      if (b.children) {
        const t = find(b.children)
        if (t) return t
      }
      if (b.cols) {
        for (const c of b.cols) {
          const t = find(c)
          if (t) return t
        }
      }
    }
    return ''
  }
  const h = find(blocks.value)
  if (h) return h.slice(0, 40)
  const firstP = blocks.value.find((b) => b.type === 'p' && b.text.trim())
  return firstP ? firstP.text.replace(/[*_~=]/g, '').trim().slice(0, 40) : ''
}

async function publish() {
  if (submitting.value) return
  if (!industryById(industryId.value)) {
    failText.value = '当前行业无效，请重新选择行业'
    return
  }
  const md = blocksToMarkdown(blocks.value)
  if (!md.trim()) {
    failText.value = '正文不能为空，写点什么再发布吧'
    return
  }
  if (uploadingImg.value) {
    failText.value = '图片正在上传，请稍候'
    return
  }
  const attachImgs = images.value.map((i) => i.url).filter(Boolean)
  const allImgs = [...new Set([...attachImgs, ...blocksImageUrls(blocks.value)])]
  if (allImgs.length > 9) {
    failText.value = `图片共 ${allImgs.length} 张（附件 + 文内插图），最多 9 张，请删减后再发布`
    return
  }
  const t = (title.value.trim() || deriveTitle()).slice(0, 60)
  if (!t) {
    failText.value = '请补充标题，或让正文首个标题作为标题'
    return
  }
  submitting.value = true
  failText.value = ''
  try {
    await createPost({
      industryId: industryId.value,
      title: t,
      content: md,
      tags: selectedTags.value,
      images: allImgs
    })
    window.clearTimeout(saveTimer)
    storage.remove(draftKey(industryId.value))
    community.loadCounts()
    router.replace('/community/mine') // 发布成功 → 个人文章管理界面
  } catch (err) {
    failText.value = (err as Error).message || '发布失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}

// ===== 初始化：恢复草稿（v2 块 JSON；旧版 Markdown 草稿自动迁移为块） =====
onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  const d = storage.get<{
    title?: string
    content?: string
    tags?: string[]
    images?: string[]
    blocks?: EdBlock[]
  } | null>(draftKey(industryId.value), null)
  if (d && (d.blocks?.length || d.content || d.title)) {
    title.value = d.title ?? ''
    blocks.value =
      Array.isArray(d.blocks) && d.blocks.length
        ? d.blocks
        : d.content
          ? markdownToBlocks(d.content)
          : defaultDoc()
    selectedTags.value = Array.isArray(d.tags) ? d.tags : []
    images.value = (d.images ?? []).map((url) => ({ id: ++imgSeq, preview: url, url }))
    saveState.value = 'saved'
    savedAt.value = '已恢复'
    showNotice('已恢复本行业未发布的草稿')
  } else {
    // 空文档：光标聚焦首块
    void nextTick(() => {
      const first = blocks.value[0]
      if (first) editorRef.value?.focusBlock(first.id, 'end')
    })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.clearTimeout(saveTimer)
  if (saveState.value === 'dirty' || saveState.value === 'saving') flushDraft()
})
</script>

<template>
  <div class="wx-ed">
    <!-- ===== 顶部工具栏 ===== -->
    <header class="wx-ed-top">
      <button class="wx-ed-back wx-pressable" title="返回" @click="router.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <input v-model="title" class="wx-ed-title" type="text" maxlength="60" placeholder="文档标题（留空则取正文首个标题）" @input="markDirty" />

      <button class="wx-ed-act wx-pressable" :class="{ active: previewOn }" @click="previewOn = !previewOn">
        {{ previewOn ? '继续编辑' : '预览' }}
      </button>
      <button class="wx-ed-act wx-pressable" @click="pickMd" title="导入完整 Markdown 文件（空文档替换 / 已有内容追加）">
        导入 MD
      </button>
      <input ref="mdInput" type="file" accept=".md,.markdown,.txt" style="display: none" @change="onMdFile" />
      <button class="wx-ed-act wx-pressable" @click="flushDraft">保存</button>
      <button
        class="wx-btn-gradient wx-pressable wx-ed-publish"
        :disabled="submitting || uploadingImg"
        @click="publish"
      >
        <span v-if="submitting">发布中…</span>
        <span v-else-if="uploadingImg">图片上传中…</span>
        <span v-else>发布</span>
      </button>
    </header>

    <!-- ===== 发布设置：行业 / 标签 / 附件图片 ===== -->
    <div class="wx-ed-meta" @drop="onDropImages" @dragover.prevent>
      <label class="wx-ed-field">
        <span class="wx-ed-field-label">行业</span>
        <select v-model="industryId" class="wx-ed-select">
          <option v-for="ind in industryOptions" :key="ind.id" :value="ind.id">{{ ind.icon }} {{ ind.name }}</option>
        </select>
      </label>

      <div class="wx-ed-field wx-ed-field-grow">
        <span class="wx-ed-field-label">标签（≤6）</span>
        <div class="wx-ed-tags">
          <button
            v-for="t in COMMUNITY_TAGS"
            :key="t"
            type="button"
            class="wx-ed-tag"
            :class="{ active: selectedTags.includes(t) }"
            @click="toggleTag(t)"
          >
            {{ t }}
          </button>
        </div>
      </div>

      <div class="wx-ed-field">
        <span class="wx-ed-field-label">附件图（≤9）</span>
        <div class="wx-ed-imgs">
          <div v-for="img in images" :key="img.id" class="wx-ed-img">
            <img :src="img.url ? apiUrl(img.url) : img.preview" alt="预览" />
            <span v-if="!img.url" class="wx-ed-img-loading">上传中</span>
            <button v-else type="button" class="wx-ed-img-remove" title="移除" @click="removeImage(img.id)">✕</button>
          </div>
          <label v-if="images.length < 9" class="wx-ed-img-add" title="添加图片（可直接拖入）">
            <span>＋</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" class="wx-ed-file" @change="onPickImages" />
          </label>
        </div>
      </div>
    </div>

    <div v-if="notice" class="wx-ed-notice">✎ {{ notice }}</div>
    <div v-if="failText" class="wx-ed-fail">⚠ {{ failText }}</div>

    <!-- ===== 三区主体：左侧目录树 + 中间块编辑区 + 右侧问星 AI 对话框 ===== -->
    <div class="wx-ed-body">
      <!-- 左侧：目录树（点击定位聚焦） -->
      <aside class="wx-ed-side">
        <div class="wx-ed-side-head">目录<span v-if="outline.length" class="wx-ed-side-count">{{ outline.length }}</span></div>
        <div class="wx-ed-outline">
          <p v-if="!outline.length" class="wx-ed-outline-empty">
            暂无目录。添加标题块、折叠块或子页面后自动生成。
          </p>
          <ul v-else class="wx-ed-outline-list">
            <li
              v-for="it in outline"
              :key="it.id"
              class="wx-ed-oi"
              :class="[`lv${it.level}`, `k-${it.kind}`, { active: activeOutlineId === it.id }]"
            >
              <button
                v-if="it.kind === 'toggle'"
                class="wx-ed-oi-fold"
                title="展开 / 收起该折叠块"
                @click.stop="toggleOutlineGroup(it)"
              >
                ▸
              </button>
              <button class="wx-ed-oi-main" :title="it.text" @click="gotoOutline(it)">
                <span class="wx-ed-oi-icon">{{ OUTLINE_ICON[it.kind] }}</span>
                <span class="wx-ed-oi-text">{{ it.text }}</span>
              </button>
            </li>
          </ul>
        </div>
      </aside>

      <section class="wx-ed-main">
        <BlockEditorCore
          v-show="!previewOn"
          ref="editorRef"
          :blocks="blocks"
          placeholder="按下 / 呼出块菜单，@ 引用日期与名片，[[ 链接页面…"
          @open-page="openPageRef"
          @notify="showNotice"
          @active="activeOutlineId = $event"
          @ai="onEditorAi"
        />

        <!-- Markdown 预览 -->
        <div v-if="previewOn" class="wx-ed-preview">
          <div v-if="!docMarkdown.trim()" class="wx-ed-preview-empty">暂无内容</div>
          <div v-else class="wx-ed-md" v-html="previewHtml"></div>
        </div>
      </section>

      <!-- 右侧：问星 AI 对话框（常驻） -->
      <aside class="wx-ed-ai-side">
        <div class="wx-ed-side-head ai"><span class="wx-ed-ai-mark">✦</span> 问星 AI</div>
        <AiPanel ref="aiRef" class="wx-ed-ai" :doc-title="title" :doc-text="docMarkdown" @insert="insertFromAi" />
      </aside>
    </div>

    <!-- ===== 底部状态栏 ===== -->
    <footer class="wx-ed-status">
      <span class="wx-ed-status-save" :class="saveState">{{ saveLabel }}</span>
      <span class="wx-ed-status-item">{{ charCount }} 字</span>
      <span class="wx-ed-status-item">{{ headingCount }} 个标题</span>
      <span class="wx-ed-status-item">{{ pageCount }} 个子页面</span>
      <span class="wx-ed-status-item">附件 {{ images.length }} 张</span>
      <span class="wx-ed-status-item">约 {{ readMinutes }} 分钟读完</span>
      <span class="wx-ed-status-scope">发布于「{{ currentIndustryName }}」· 仅本行业可见</span>
    </footer>

    <!-- ===== 子页面全屏编辑 overlay ===== -->
    <div v-if="subPage" class="wx-ed-submask">
      <div class="wx-ed-sub">
        <header class="wx-ed-sub-top">
          <span class="wx-ed-sub-badge">子页面</span>
          <input v-model="subPage.title" class="wx-ed-sub-title" type="text" maxlength="60" placeholder="子页面标题" @input="onSubTitleInput" />
          <button class="wx-ed-act wx-pressable" @click="closeSubPage">完成并返回</button>
        </header>
        <div class="wx-ed-sub-body">
          <BlockEditorCore
            :blocks="subPage.blocks"
            placeholder="子页面内容，同样支持 / 块菜单与 [[ 链接…"
            @open-page="openPageRef"
            @notify="showNotice"
            @ai="onEditorAi"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wx-ed {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px 20px 0;
  overflow: hidden;
}

/* ===== 顶部工具栏 ===== */
.wx-ed-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-ed-back {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-ed-back svg { width: 17px; height: 17px; }
.wx-ed-back:hover { color: var(--wx-color-primary-soft); border-color: var(--wx-border-glow); }
.wx-ed-title {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--wx-font-serif);
  font-size: 18px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-ed-title::placeholder { color: var(--wx-text-muted); font-weight: 400; font-size: 15px; }

.wx-ed-act {
  flex-shrink: 0;
  padding: 7px 14px;
  border-radius: var(--wx-radius-pill);
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-ed-act:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-ed-act.active { color: var(--wx-color-primary-soft); border-color: var(--wx-border-glow); background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent); }
.wx-ed-publish { flex-shrink: 0; padding: 8px 22px; font-size: 13px; font-weight: 600; border-radius: var(--wx-radius-pill); }
.wx-ed-publish:disabled { opacity: 0.5; cursor: not-allowed; }

/* ===== 发布设置 ===== */
.wx-ed-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 2px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-ed-field { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.wx-ed-field-grow { flex: 1; min-width: 0; }
.wx-ed-field-label { font-size: 11.5px; color: var(--wx-text-muted); white-space: nowrap; }
.wx-ed-select {
  padding: 6px 10px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 60%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-primary);
  font-size: 12.5px;
  outline: none;
}
.wx-ed-tags { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.wx-ed-tag {
  padding: 4px 11px;
  border-radius: var(--wx-radius-pill);
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-ed-tag:hover { color: var(--wx-text-primary); border-color: var(--wx-border-glow); }
.wx-ed-tag.active { color: var(--wx-text-on-accent); background: var(--wx-gradient-primary); border-color: transparent; }

.wx-ed-imgs { display: flex; align-items: center; gap: 6px; }
.wx-ed-img, .wx-ed-img-add {
  width: 34px;
  height: 34px;
  border-radius: var(--wx-radius-sm);
  overflow: hidden;
  position: relative;
  border: 1px solid var(--wx-border-soft);
}
.wx-ed-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wx-ed-img-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-bg-deep) 66%, transparent);
}
.wx-ed-img-remove {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  font-size: 8px;
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-bg-deep) 72%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-ed-img-remove:hover { background: color-mix(in srgb, var(--wx-color-vermilion) 85%, transparent); }
.wx-ed-img-add {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 6%, transparent);
  color: var(--wx-color-primary-soft);
  cursor: pointer;
  font-size: 15px;
}
.wx-ed-img-add:hover { background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent); }
.wx-ed-file { display: none; }

.wx-ed-notice,
.wx-ed-fail {
  margin: 10px 2px 0;
  padding: 8px 12px;
  border-radius: var(--wx-radius-md);
  font-size: 12px;
  color: var(--wx-text-primary);
  flex-shrink: 0;
}
.wx-ed-notice { background: color-mix(in srgb, var(--wx-color-yanqing) 10%, transparent); border: 1px solid color-mix(in srgb, var(--wx-color-yanqing) 35%, transparent); }
.wx-ed-fail { background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent); border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 40%, transparent); }

/* ===== 两区主体 ===== */
.wx-ed-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0;
  padding: 14px 0 0;
}
.wx-ed-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 6px 16px 40px 4px;
  scrollbar-width: thin;
}

/* ===== 左侧目录栏 ===== */
.wx-ed-side {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--wx-border-soft);
  padding-right: 14px;
}
.wx-ed-side-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 10px;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--wx-text-muted);
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-ed-side-head.ai { color: var(--wx-color-primary-soft); }
.wx-ed-ai-mark { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--wx-color-primary) 70%, transparent)); }
.wx-ed-side-count {
  padding: 0 6px;
  border-radius: 8px;
  font-size: 10px;
  color: var(--wx-text-tertiary);
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
}

/* 目录树 */
.wx-ed-outline {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 2px 30px;
  scrollbar-width: thin;
}
.wx-ed-outline-empty { font-size: 11.5px; color: var(--wx-text-muted); line-height: 1.8; padding: 14px 6px; }
.wx-ed-outline-list { display: flex; flex-direction: column; gap: 1px; }
.wx-ed-oi { display: flex; align-items: flex-start; gap: 2px; border-radius: var(--wx-radius-sm); }
.wx-ed-oi.lv2 { padding-left: 14px; }
.wx-ed-oi.lv3 { padding-left: 28px; }
.wx-ed-oi.lv4 { padding-left: 34px; }
.wx-ed-oi:hover { background: color-mix(in srgb, var(--wx-ink) 4%, transparent); }
.wx-ed-oi.active { background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent); }
.wx-ed-oi-fold {
  flex-shrink: 0;
  width: 16px;
  height: 22px;
  font-size: 10px;
  color: var(--wx-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-ed-oi-fold:hover { color: var(--wx-text-primary); }
.wx-ed-oi-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 4px 6px;
  text-align: left;
}
.wx-ed-oi-icon {
  flex-shrink: 0;
  width: 20px;
  font-family: var(--wx-font-mono);
  font-size: 9.5px;
  line-height: 1.9;
  text-align: center;
  color: var(--wx-color-primary-soft);
}
.wx-ed-oi.k-toggle .wx-ed-oi-icon { color: var(--wx-text-muted); }
.wx-ed-oi.k-page .wx-ed-oi-icon { font-size: 11px; font-family: inherit; }
.wx-ed-oi-text {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--wx-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-ed-oi.lv1 .wx-ed-oi-text { font-size: 13px; font-weight: 600; color: var(--wx-text-primary); }
.wx-ed-oi.lv2 .wx-ed-oi-text { font-weight: 500; color: var(--wx-text-primary); }
.wx-ed-oi.active .wx-ed-oi-text { color: var(--wx-text-on-accent); }

/* 右侧 AI 栏（常驻） */
.wx-ed-ai-side {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--wx-border-soft);
  padding-left: 14px;
}
.wx-ed-ai { width: 100%; flex: 1; border-left: none; padding-left: 0; }

/* 预览 */
.wx-ed-preview {
  overflow-y: auto;
  padding: 18px 22px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 30%, transparent);
  max-height: 100%;
}
.wx-ed-preview-empty { font-size: 13px; color: var(--wx-text-muted); text-align: center; padding: 40px 0; }
.wx-ed-md { font-size: 13.5px; line-height: 1.85; color: var(--wx-text-secondary); word-break: break-word; }
.wx-ed-md :deep(h1),
.wx-ed-md :deep(h2),
.wx-ed-md :deep(h3),
.wx-ed-md :deep(h4) { color: var(--wx-text-primary); font-weight: 600; line-height: 1.4; }
.wx-ed-md :deep(h1) { font-size: 19px; margin: 20px 0 10px; }
.wx-ed-md :deep(h2) { font-size: 16px; margin: 18px 0 8px; padding-bottom: 5px; border-bottom: 1px solid var(--wx-border-soft); }
.wx-ed-md :deep(h3) { font-size: 14.5px; margin: 15px 0 6px; }
.wx-ed-md :deep(p) { margin: 9px 0; }
.wx-ed-md :deep(ul),
.wx-ed-md :deep(ol) { margin: 9px 0; padding-left: 22px; }
.wx-ed-md :deep(a) { color: var(--wx-color-primary-soft); }
.wx-ed-md :deep(code) {
  font-family: var(--wx-font-mono);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--wx-bg-deep) 70%, transparent);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-secondary);
}
.wx-ed-md :deep(.wx-code-block) {
  margin: 12px 0;
  padding: 12px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 85%, transparent);
  border: 1px solid var(--wx-border-soft);
  overflow-x: auto;
}
.wx-ed-md :deep(.wx-code-block code) { background: none; border: none; padding: 0; color: var(--wx-text-secondary); }
.wx-ed-md :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 14px;
  border-left: 3px solid var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  color: var(--wx-text-tertiary);
}
.wx-ed-md :deep(.wx-md-hr) { margin: 18px 0; border: none; border-top: 1px solid var(--wx-border-soft); }
.wx-ed-md :deep(.wx-md-table) { width: 100%; margin: 12px 0; border-collapse: collapse; font-size: 12.5px; }
.wx-ed-md :deep(.wx-md-table th),
.wx-ed-md :deep(.wx-md-table td) { padding: 7px 10px; border: 1px solid var(--wx-border-soft); text-align: left; }
.wx-ed-md :deep(.wx-md-table th) { background: color-mix(in srgb, var(--wx-ink) 4%, transparent); color: var(--wx-text-primary); }
.wx-ed-md :deep(img) { max-width: 100%; border-radius: var(--wx-radius-sm); }
.wx-ed-md :deep(.wx-mark) { background: color-mix(in srgb, var(--wx-color-amber) 32%, transparent); color: inherit; padding: 0 2px; border-radius: 3px; }
.wx-ed-md :deep(u) { text-decoration-color: color-mix(in srgb, var(--wx-color-primary) 70%, transparent); text-underline-offset: 3px; }
.wx-ed-md :deep(del) { opacity: 0.7; }

/* ===== 底部状态栏 ===== */
.wx-ed-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 4px 14px;
  border-top: 1px solid var(--wx-border-soft);
  font-size: 11.5px;
  color: var(--wx-text-muted);
}
.wx-ed-status-save { color: var(--wx-text-tertiary); }
.wx-ed-status-save.dirty { color: var(--wx-color-amber); }
.wx-ed-status-save.saved { color: var(--wx-color-yanqing); }
.wx-ed-status-scope { margin-left: auto; }

/* ===== 子页面 overlay ===== */
.wx-ed-submask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: color-mix(in srgb, var(--wx-bg-deep) 72%, transparent);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 40px;
}
.wx-ed-sub {
  width: min(920px, 100%);
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: var(--wx-radius-lg);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-bg-deep) 98%, transparent);
  box-shadow: var(--wx-shadow-lg);
  overflow: hidden;
}
.wx-ed-sub-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--wx-border-soft);
  flex-shrink: 0;
}
.wx-ed-sub-badge {
  padding: 3px 10px;
  border-radius: var(--wx-radius-pill);
  font-size: 11px;
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent);
  flex-shrink: 0;
}
.wx-ed-sub-title {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--wx-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-ed-sub-title::placeholder { color: var(--wx-text-muted); font-weight: 400; }
.wx-ed-sub-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 20px 40px;
  scrollbar-width: thin;
}
</style>
