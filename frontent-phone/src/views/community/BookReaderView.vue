<!-- 社区书籍阅读器（移动端）：EPUB 分节 + 目录抽屉 / MD 标题树 / TXT 章节 / PDF 内嵌预览 -->
<script setup lang="ts">
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
/** 目录高亮项：与 activeId 分离——EPUB 章节点（无正文）点击也要高亮，但不切换正文 */
const tocActiveId = ref('')
const plainText = ref('')
const tocNodes = ref<TocNode[]>([])
/** TXT 章节分段（识别到 ≥2 章时启用滚动定位） */
const txtChapters = ref<Array<{ id: string; title: string; text: string }>>([])

const tocOpen = ref(false)
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
const TXT_CHAPTER_RE =
  /^\s*(第[0-9零一二三四五六七八九十百千]+[章回节部卷集][^\n]{0,40}|Chapter\s+\d+[^\n]{0,40}|CHAPTER\s+\d+[^\n]{0,40})\s*$/

/** TXT 按章节行切分；不足 2 章视为无章节书，返回空数组 */
function splitTxtChapters(text: string): Array<{ id: string; title: string; text: string }> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const marks: number[] = []
  lines.forEach((l, i) => {
    if (TXT_CHAPTER_RE.test(l)) marks.push(i)
  })
  if (marks.length < 2) return []
  const out: Array<{ id: string; title: string; text: string }> = []
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

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const id = String(route.params.id ?? '')
    const res = await getBook(id)
    book.value = res.item
    const b = res.item
    if (b.format === 'epub' && b.textbookSlug) {
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

/** 目录点击：更新高亮；EPUB 有正文才切节，MD/TXT 关闭抽屉后滚动定位 */
function onTocSelect(id: string): void {
  tocActiveId.value = id
  const fmt = book.value?.format
  if (fmt === 'epub') {
    if (sections.value.some((s) => s.id === id)) activeId.value = id
    tocOpen.value = false
    return
  }
  activeId.value = id
  tocOpen.value = false
  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 320)
}

function back(): void {
  router.push('/community?books=1')
}
function downloadCurrent(): void {
  if (book.value?.hasFile) window.open(fileUrl.value, '_blank', 'noopener')
}
const hasToc = computed(() => tocNodes.value.length > 0)
</script>

<template>
  <div class="reader-page">
    <van-nav-bar fixed placeholder left-arrow @click-left="back">
      <template #title>
        <div class="nav-title">
          <span class="nav-book">{{ book?.title ?? '阅读' }}</span>
          <span v-if="book?.author" class="nav-author">{{ book.author }}</span>
        </div>
      </template>
      <template #right>
        <div class="nav-actions">
          <span v-if="hasToc" class="nav-btn" @click="tocOpen = true">目录</span>
          <span class="nav-btn" :class="{ disabled: !book?.hasFile }" @click="downloadCurrent">下载</span>
        </div>
      </template>
    </van-nav-bar>

    <van-loading v-if="loading" class="reader-tip" vertical>正在加载…</van-loading>

    <div v-else-if="error" class="reader-tip">
      <p>⚠ {{ error }}</p>
      <van-button size="small" round @click="load">重新加载</van-button>
    </div>

    <van-empty v-else-if="!book" description="书籍不存在">
      <van-button round type="primary" size="small" @click="back">回到书架</van-button>
    </van-empty>

    <!-- PDF：内嵌预览（浏览器不支持时提供下载） -->
    <template v-else-if="book.format === 'pdf'">
      <iframe :src="fileUrl" class="pdf-frame" title="PDF 预览"></iframe>
      <div class="pdf-hint">
        <span>若无法预览，请下载后使用本地阅读器打开。</span>
        <van-button size="mini" round plain type="primary" @click="downloadCurrent">下载 PDF</van-button>
      </div>
    </template>

    <!-- EPUB / MD / TXT -->
    <template v-else-if="book.format === 'epub' || book.format === 'md' || book.format === 'txt'">
      <div v-if="book.format === 'epub'" class="reader-meta">
        <span class="fmt-chip">{{ book.format.toUpperCase() }}</span>
        <span v-if="hasToc" class="chapter-name">
          {{ tocNodes.find((n) => n.id === tocActiveId)?.title ?? '' }}
        </span>
      </div>

      <!-- EPUB：单节阅读 -->
      <article
        v-if="book.format === 'epub'"
        class="reader-body markdown"
        v-html="renderMarkdown(activeText)"
      ></article>

      <!-- MD：全文渲染，标题锚点滚动定位 -->
      <article
        v-else-if="book.format === 'md'"
        class="reader-body markdown"
        v-html="renderMarkdown(plainText)"
      ></article>

      <!-- TXT：识别到章节 → 分段渲染滚动定位；否则整段 -->
      <template v-else>
        <div v-if="txtChapters.length" class="reader-body plain-wrap">
          <pre v-for="c in txtChapters" :key="c.id" :id="c.id" class="plain-seg">{{ c.text }}</pre>
        </div>
        <pre v-else class="reader-body plain">{{ plainText }}</pre>
      </template>

      <div class="reader-foot">
        <van-button block round plain type="primary" @click="downloadCurrent">下载原书文件</van-button>
      </div>
    </template>

    <!-- 其他格式 -->
    <van-empty v-else description="该格式暂不支持在线阅读，请下载后使用本地阅读器">
      <van-button round type="primary" size="small" @click="downloadCurrent">下载文件</van-button>
    </van-empty>

    <!-- 目录抽屉 -->
    <van-popup v-model:show="tocOpen" position="bottom" round :style="{ height: '62%' }">
      <div class="toc-panel">
        <div class="toc-head">
          <span class="toc-title">目录</span>
          <span class="toc-count">{{ tocCount }} 项</span>
          <van-icon name="cross" class="toc-close" @click="tocOpen = false" />
        </div>
        <div class="toc-scroll">
          <BookTocTree :nodes="tocNodes" :active-id="tocActiveId" @select="onTocSelect" />
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.reader-page {
  min-height: 100vh;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  background: #f7f8fa;
}

.nav-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.25;
}

.nav-book {
  max-width: 180px;
  font-size: 14.5px;
  font-weight: 600;
  color: #323233;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-author {
  max-width: 180px;
  font-size: 10.5px;
  color: #969799;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-btn {
  font-size: 13px;
  color: #1989fa;
}

.nav-btn.disabled {
  color: #c8c9cc;
}

.reader-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 90px 20px;
  color: #969799;
  font-size: 13px;
}

.reader-tip p {
  margin: 0;
}

.pdf-frame {
  display: block;
  width: 100%;
  height: calc(100vh - 46px - env(safe-area-inset-bottom));
  border: none;
  background: #fff;
}

.pdf-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  font-size: 11.5px;
  color: #969799;
  background: #fff;
  border-top: 1px solid #f2f3f5;
}

.reader-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 0;
}

.fmt-chip {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  color: #1989fa;
  background: rgba(25, 137, 250, 0.1);
}

.chapter-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #969799;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-body {
  margin: 10px 12px;
  padding: 18px 16px;
  background: #fff;
  border-radius: 14px;
}

/* Markdown 正文（浅色移动阅读样式） */
.markdown {
  font-size: 15px;
  line-height: 1.9;
  color: #3a3a3a;
  word-break: break-word;
}

.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4) {
  color: #323233;
  font-weight: 600;
  line-height: 1.45;
  scroll-margin-top: 56px;
}

.markdown :deep(h1) {
  margin: 22px 0 12px;
  font-size: 21px;
}

.markdown :deep(h2) {
  margin: 22px 0 10px;
  padding-bottom: 6px;
  font-size: 18px;
  border-bottom: 1px solid #f2f3f5;
}

.markdown :deep(h3) {
  margin: 18px 0 8px;
  font-size: 16px;
}

.markdown :deep(h4) {
  margin: 14px 0 6px;
  font-size: 15px;
  color: #646566;
}

.markdown :deep(p) {
  margin: 10px 0;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 10px 0;
  padding-left: 22px;
}

.markdown :deep(li) {
  margin: 5px 0;
}

.markdown :deep(a) {
  color: #1989fa;
  text-decoration: none;
}

.markdown :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 12.5px;
  background: #f7f8fa;
  color: #c7254e;
}

.markdown :deep(.wx-code-block) {
  margin: 12px 0;
  padding: 12px;
  border-radius: 10px;
  background: #f7f8fa;
  overflow-x: auto;
}

.markdown :deep(.wx-code-block code) {
  padding: 0;
  background: none;
  color: #3a3a3a;
  line-height: 1.7;
  white-space: pre;
}

.markdown :deep(blockquote) {
  margin: 12px 0;
  padding: 8px 12px;
  border-left: 3px solid #1989fa;
  background: rgba(25, 137, 250, 0.06);
  border-radius: 0 8px 8px 0;
  color: #646566;
}

.markdown :deep(.wx-md-hr) {
  margin: 18px 0;
  border: none;
  border-top: 1px solid #f2f3f5;
}

.markdown :deep(.wx-md-table) {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
  font-size: 12.5px;
}

.markdown :deep(.wx-md-table th),
.markdown :deep(.wx-md-table td) {
  padding: 7px 8px;
  border: 1px solid #ebedf0;
  text-align: left;
}

.markdown :deep(.wx-md-table th) {
  background: #f7f8fa;
  color: #323233;
}

.markdown :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}

.markdown :deep(.wx-mark) {
  background: rgba(255, 213, 79, 0.45);
  padding: 0 2px;
  border-radius: 3px;
}

.plain-wrap {
  padding: 16px;
}

.plain-seg {
  margin: 0 0 22px;
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.9;
  color: #3a3a3a;
  scroll-margin-top: 56px;
}

.plain {
  margin: 10px 12px;
  padding: 16px;
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.9;
  color: #3a3a3a;
  overflow-x: auto;
}

.reader-foot {
  padding: 4px 16px 0;
}

.toc-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}

.toc-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid #f2f3f5;
}

.toc-title {
  font-size: 16px;
  font-weight: 600;
  color: #323233;
}

.toc-count {
  flex: 1;
  font-size: 11.5px;
  color: #969799;
}

.toc-close {
  font-size: 17px;
  color: #969799;
  padding: 4px;
}

.toc-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px calc(12px + env(safe-area-inset-bottom));
  -webkit-overflow-scrolling: touch;
}
</style>
