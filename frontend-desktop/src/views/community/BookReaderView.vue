<script setup lang="ts">
// 书籍阅读器：EPUB → 后端章节 Markdown + 层级目录树；MD → 标题树 + 滚动定位；TXT → 章节识别 + 滚动定位；PDF → 内嵌预览；MOBI/AZW3 → 仅下载
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { bookFileUrl, getBook } from '@/services/bookService'
import { getSections, getTree } from '@/services/textbookService'
import { extractHeadings, renderMarkdown, type MdHeading } from '@/utils/markdown'
import BookTocTree, { type TocNode } from '@/components/community/BookTocTree.vue'
import type { BookItem } from '@/types'
import type { TextbookNode } from '@/types/textbook'

const route = useRoute()
const router = useRouter()

const book = ref<BookItem | null>(null)
const loading = ref(true)
const error = ref('')
const sections = ref<Array<{ id: string; text: string }>>([])
const activeId = ref('')
/** 目录树高亮项：与 activeId 分离——EPUB 章节点（无正文）点击也要高亮，但不切换正文 */
const tocActiveId = ref('')
const plainText = ref('')
/** 左侧目录树（三种可预览文本格式统一映射） */
const tocNodes = ref<TocNode[]>([])
/** TXT 章节分段（识别到 ≥2 章时启用滚动定位） */
const txtChapters = ref<Array<{ id: string; title: string; text: string }>>([])

const activeText = computed(() => sections.value.find((s) => s.id === activeId.value)?.text ?? '')
const fileUrl = computed(() => (book.value ? bookFileUrl(book.value.id) : ''))

function countNodes(list: TocNode[]): number {
  return list.reduce((n, x) => n + 1 + (x.children?.length ? countNodes(x.children) : 0), 0)
}
const tocCount = computed(() => countNodes(tocNodes.value))

/** 节标题：正文首个 # 行（EPUB 目录树缺失时的回退显示） */
function sectionTitle(s: { id: string; text: string }): string {
  return s.text.split('\n').find((l) => l.trim().startsWith('#'))?.replace(/^#+\s*/, '') || s.id
}

/** EPUB tree.json 节点 → TocNode */
function mapEpubNodes(list: TextbookNode[]): TocNode[] {
  return list.map((n) => ({
    id: n.id,
    title: n.title,
    children: n.children?.length ? mapEpubNodes(n.children) : undefined
  }))
}

/** MD 标题扁平列表 → 按级别嵌套的 TocNode 树 */
function nestHeadings(list: MdHeading[]): TocNode[] {
  const root: TocNode[] = []
  const stack: Array<{ node: TocNode; level: number }> = []
  for (const h of list) {
    const node: TocNode = { id: h.id, title: h.text }
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop()
    if (stack.length) {
      const parent = stack[stack.length - 1].node
      parent.children = [...(parent.children ?? []), node]
    } else {
      root.push(node)
    }
    stack.push({ node, level: h.level })
  }
  return root
}

/** TXT 章节行（第X章/回/节/部/卷/集、Chapter N） */
const TXT_CHAPTER_RE = /^\s*(第[0-9零一二三四五六七八九十百千]+[章回节部卷集][^\n]{0,40}|Chapter\s+\d+[^\n]{0,40}|CHAPTER\s+\d+[^\n]{0,40})\s*$/

/** TXT 按章节行切分；不足 2 章视为无章节书，返回空数组 */
function splitTxtChapters(text: string): Array<{ id: string; title: string; text: string }> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const marks: number[] = []
  lines.forEach((l, i) => {
    if (TXT_CHAPTER_RE.test(l)) marks.push(i)
  })
  if (marks.length < 2) return []
  const out: Array<{ id: string; title: string; text: string }> = []
  // 第 1 章之前的开篇内容（非空才保留）
  if (marks[0] > 0) {
    const preface = lines.slice(0, marks[0]).join('\n').trim()
    if (preface) out.push({ id: 'txt-ch-0', title: '开篇', text: preface })
  }
  marks.forEach((at, i) => {
    const end = i + 1 < marks.length ? marks[i + 1] : lines.length
    out.push({
      id: `txt-ch-${out.length}`,
      title: lines[at].trim().slice(0, 42),
      text: lines.slice(at, end).join('\n').trim()
    })
  })
  return out
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const id = String(route.params.id ?? '')
    const res = await getBook(id)
    book.value = res.item
    const b = res.item
    if (b.format === 'epub' && b.textbookSlug) {
      // 章节正文 + 目录树并行；tree 失败（旧书无 slug/解析前导入）回退扁平节列表
      const [map, nodes] = await Promise.all([
        getSections(b.textbookSlug),
        getTree(b.textbookSlug).catch(() => null)
      ])
      sections.value = Object.entries(map)
        .sort((a, b2) => a[0].localeCompare(b2[0], 'zh-Hans-CN', { numeric: true }))
        .map(([sid, text]) => ({ id: sid, text }))
      activeId.value = sections.value[0]?.id ?? ''
      tocActiveId.value = activeId.value
      tocNodes.value = nodes?.length
        ? mapEpubNodes(nodes)
        : sections.value.map((s) => ({ id: s.id, title: sectionTitle(s) }))
    } else if (b.format === 'md' || b.format === 'txt') {
      const resp = await fetch(fileUrl.value)
      if (!resp.ok) throw new Error(`文件读取失败 ${resp.status}`)
      plainText.value = await resp.text()
      if (b.format === 'md') {
        tocNodes.value = nestHeadings(extractHeadings(plainText.value, [1, 2, 3, 4]))
      } else {
        txtChapters.value = splitTxtChapters(plainText.value)
        tocNodes.value = txtChapters.value.map((c) => ({ id: c.id, title: c.title }))
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '书籍加载失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 目录点击：任何节点都更新高亮；EPUB 有正文才切节，MD/TXT 滚动定位 */
function onTocSelect(id: string) {
  tocActiveId.value = id
  const fmt = book.value?.format
  if (fmt === 'epub') {
    if (sections.value.some((s) => s.id === id)) activeId.value = id
    return
  }
  activeId.value = id
  nextTick(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function back() {
  router.push('/community?books=1')
}
function downloadCurrent() {
  if (book.value?.hasFile) window.open(fileUrl.value, '_blank', 'noopener')
}
</script>

<template>
  <div class="wx-reader">
    <header class="wx-reader-head">
      <button class="wx-reader-back" @click="back">← 书架</button>
      <div class="wx-reader-title">
        <b>{{ book?.title ?? '阅读' }}</b>
        <span v-if="book?.author" class="wx-reader-author">{{ book.author }}</span>
      </div>
      <span v-if="book" class="wx-reader-fmt">{{ book.format.toUpperCase() }}</span>
      <button class="wx-reader-dl" :disabled="!book?.hasFile" @click="downloadCurrent">下载</button>
    </header>

    <div v-if="loading" class="wx-reader-center">正在加载…</div>
    <div v-else-if="error" class="wx-reader-center err">{{ error }}</div>
    <div v-else-if="!book" class="wx-reader-center">书籍不存在</div>

    <!-- PDF：WebView2 自带预览（大纲用查看器内置侧边栏） -->
    <div v-else-if="book.format === 'pdf'" class="wx-reader-body">
      <iframe :src="fileUrl" class="wx-reader-pdf" title="PDF 预览"></iframe>
    </div>

    <!-- EPUB / MD / TXT：左目录树 + 右正文 -->
    <div v-else-if="book.format === 'epub' || book.format === 'md' || book.format === 'txt'" class="wx-reader-body wx-reader-split">
      <aside v-if="tocNodes.length" class="wx-reader-toc">
        <div class="wx-reader-toc-title">目录（{{ tocCount }} 项）</div>
        <BookTocTree :nodes="tocNodes" :active-id="tocActiveId" @select="onTocSelect" />
      </aside>

      <!-- EPUB：单节阅读 -->
      <article v-if="book.format === 'epub'" class="wx-reader-text" v-html="renderMarkdown(activeText)"></article>

      <!-- MD：全文渲染，标题锚点滚动定位 -->
      <article v-else-if="book.format === 'md'" class="wx-reader-text" v-html="renderMarkdown(plainText)"></article>

      <!-- TXT：识别到章节 → 分段渲染滚动定位；否则整段 -->
      <div v-else-if="txtChapters.length" class="wx-reader-plain-wrap">
        <pre v-for="c in txtChapters" :key="c.id" :id="c.id" class="wx-reader-plain-seg">{{ c.text }}</pre>
      </div>
      <pre v-else class="wx-reader-plain">{{ plainText }}</pre>
    </div>

    <!-- 其他格式 -->
    <div v-else class="wx-reader-center">
      该格式暂不支持在线阅读，请下载后使用本地阅读器。
    </div>
  </div>
</template>

<style scoped>
.wx-reader { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.wx-reader-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-reader-back, .wx-reader-dl {
  padding: 5px 12px;
  font-size: 12px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}
.wx-reader-dl:disabled { opacity: 0.4; }
.wx-reader-title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.wx-reader-title b { font-size: 14px; color: var(--wx-text-primary); }
.wx-reader-author { font-size: 11.5px; color: var(--wx-text-muted); }
.wx-reader-fmt { font-size: 10.5px; font-family: var(--wx-font-mono); color: var(--wx-color-primary-soft); }
.wx-reader-body { flex: 1; min-height: 0; display: flex; }
.wx-reader-split { display: flex; }
.wx-reader-pdf { width: 100%; height: 100%; border: none; background: #fff; }
.wx-reader-toc {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--wx-border-soft);
  overflow-y: auto;
  padding: 10px 8px;
}
.wx-reader-toc-title { font-size: 11.5px; color: var(--wx-text-muted); padding: 0 8px 8px; }
.wx-reader-text {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 28px 60px;
  font-size: 14px;
  line-height: 1.85;
  color: var(--wx-text-secondary);
}
.wx-reader-text :deep(h1) { font-size: 22px; color: var(--wx-text-primary); scroll-margin-top: 12px; }
.wx-reader-text :deep(h2) { margin-top: 22px; font-size: 17px; color: var(--wx-text-primary); scroll-margin-top: 12px; }
.wx-reader-text :deep(h3), .wx-reader-text :deep(h4) { scroll-margin-top: 12px; }
.wx-reader-text :deep(p) { margin: 10px 0; }
.wx-reader-text :deep(img) { max-width: 100%; border-radius: 6px; }
.wx-reader-plain-wrap {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 28px;
}
.wx-reader-plain-seg {
  margin: 0 0 20px;
  white-space: pre-wrap;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--wx-text-secondary);
  scroll-margin-top: 12px;
}
.wx-reader-plain {
  flex: 1;
  margin: 0;
  overflow: auto;
  padding: 20px 28px;
  white-space: pre-wrap;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--wx-text-secondary);
}
.wx-reader-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--wx-text-tertiary);
}
.wx-reader-center.err { color: var(--wx-color-vermilion); }
</style>
