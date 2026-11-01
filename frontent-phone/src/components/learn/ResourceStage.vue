<script setup lang="ts">
// 资源准备（向导第 4 步）：A) AI 生成教科书级目录树；B) 检索开放教材并按许可下载入库；C) 已入库书籍
// 移动端单栏版。硬约束：所有 AI/检索按钮均需用户点击并二次确认
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useLearnStore } from '@/stores/learnStore'
import { generateTextbookOutline, type TextbookOutlineModule } from '@/services/aiService'
import { listBooks, searchBooks, importBookByUrl, type BookCandidate } from '@/services/bookService'
import type { BookItem, TextbookOutlineNode } from '@/types'

const learnStore = useLearnStore()
const router = useRouter()

// ===== 模块来源：优先计划模块；未生成计划时按大纲技能组归并 =====
const moduleList = computed<Array<{ name: string; goal?: string; items: string[] }>>(() => {
  if (learnStore.plan.length > 0) {
    const byId = new Map(learnStore.outline.map((t) => [t.id, t]))
    return learnStore.plan.map((b) => ({
      name: b.name,
      goal: b.goal,
      items: b.taskIds.map((id) => byId.get(id)?.title ?? '').filter(Boolean)
    }))
  }
  const map = new Map<string, string[]>()
  for (const t of learnStore.outline) {
    const g = (t.description ?? '').split(' · ')[0] || '学习任务'
    map.set(g, [...(map.get(g) ?? []), t.title])
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }))
})

// ===== A) 教科书目录树 =====
const outline = ref<TextbookOutlineModule[] | null>(null)
const outlineSummary = ref('')
const treeLoading = ref(false)
const treeError = ref('')
const openPaths = ref<Set<string>>(new Set())

function togglePath(p: string) {
  const next = new Set(openPaths.value)
  if (next.has(p)) next.delete(p)
  else next.add(p)
  openPaths.value = next
}

async function genTree() {
  if (treeLoading.value || moduleList.value.length === 0) return
  try {
    await showConfirmDialog({
      title: '生成目录树',
      message: '将调用 AI 生成教科书级目录树，是否继续？'
    })
  } catch {
    return
  }
  treeLoading.value = true
  treeError.value = ''
  try {
    const res = await generateTextbookOutline({
      domain: learnStore.selectedDomain?.name ?? '',
      goal30: learnStore.questionnaireAnswers?.goal30,
      timeBudget: learnStore.questionnaireAnswers?.timeCommitment,
      modules: moduleList.value
    })
    outline.value = res.modules
    outlineSummary.value = res.summary ?? ''
  } catch (e) {
    treeError.value = e instanceof Error ? e.message : '目录树生成失败'
  } finally {
    treeLoading.value = false
  }
}

function nodeStats(nodes: TextbookOutlineNode[]) {
  let pages = 0
  let hours = 0
  const walk = (list: TextbookOutlineNode[]) => {
    for (const n of list) {
      pages += n.pages ?? 0
      hours += n.hours ?? 0
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return { pages, hours: Number(hours.toFixed(1)) }
}

// ===== B) 开放教材检索 =====
const results = ref<Record<string, BookCandidate[]>>({})
const searching = ref<string | null>(null)
const searchError = ref<Record<string, string>>({})
const importError = ref<Record<string, string>>({})
const importing = ref<string | null>(null)

async function searchModule(name: string) {
  if (searching.value) return
  try {
    await showConfirmDialog({
      title: '检索开放教材',
      message: `将检索「${name}」的开放电子教材（仅合法开放来源），是否继续？`
    })
  } catch {
    return
  }
  searching.value = name
  searchError.value = { ...searchError.value, [name]: '' }
  try {
    const res = await searchBooks({
      query: name,
      module: name,
      industry: learnStore.selectedDomain?.name ?? ''
    })
    results.value = { ...results.value, [name]: res.items }
  } catch (e) {
    searchError.value = {
      ...searchError.value,
      [name]: e instanceof Error ? e.message : '检索失败'
    }
  } finally {
    searching.value = null
  }
}

function canDownload(c: BookCandidate): boolean {
  return (c.format === 'pdf' || c.format === 'epub') && Boolean(c.license)
}

async function download(c: BookCandidate) {
  const key = c.url
  if (importing.value) return
  if (!c.license) {
    window.open(c.url, '_blank', 'noopener')
    return
  }
  try {
    await showConfirmDialog({
      title: '下载并入库',
      message: `将下载《${c.title}》并加入书架（许可：${c.license}），是否继续？`
    })
  } catch {
    return
  }
  importing.value = key
  try {
    const res = await importBookByUrl({
      url: c.url,
      license: c.license,
      title: c.title,
      author: c.author,
      industry: learnStore.selectedDomain?.name ?? '',
      tags: c.format
    })
    addedBooks.value = [res.item, ...addedBooks.value.filter((b) => b.id !== res.item.id)]
  } catch (e) {
    importError.value = {
      ...importError.value,
      [c.url]: e instanceof Error ? e.message : '下载入库失败'
    }
  } finally {
    importing.value = null
  }
}

// ===== C) 已入库书籍 =====
const addedBooks = ref<BookItem[]>([])
const booksLoading = ref(false)
const booksLoaded = ref(false)
async function loadBooks() {
  if (booksLoading.value) return
  try {
    await showConfirmDialog({
      title: '读取书架',
      message: '将从后端读取当前行业已入库的书籍，是否继续？'
    })
  } catch {
    return
  }
  booksLoading.value = true
  try {
    const res = await listBooks({ industry: learnStore.selectedDomain?.name ?? undefined })
    addedBooks.value = res.items
    booksLoaded.value = true
  } catch {
    /* 书架不可用不影响资源准备 */
  } finally {
    booksLoading.value = false
  }
}

function goShelf() {
  router.push('/community')
}

function confirmResources() {
  learnStore.confirmResources()
}
</script>

<template>
  <div class="wx-res">
    <div class="wx-res-head">
      <div class="wx-res-title">
        <span class="wx-res-mark">✦</span>
        <span>资源准备</span>
        <span class="wx-res-title-sub">{{ learnStore.selectedDomain?.name }}</span>
      </div>
      <div class="wx-res-badge">{{ moduleList.length }} 模块 · 入库 {{ addedBooks.length }} 本</div>
    </div>

    <div class="wx-res-body">
      <!-- A) 教科书目录树 -->
      <section class="wx-res-card">
        <div class="wx-res-card-head">
          <span class="wx-res-card-title">教科书目录树</span>
          <button class="wx-res-check wx-pressable" :disabled="treeLoading || moduleList.length === 0" @click="genTree">
            {{ treeLoading ? '生成中…' : (outline ? '重新生成' : '生成目录树') }}
          </button>
        </div>
        <p v-if="treeError" class="wx-res-err">{{ treeError }}</p>
        <p v-if="!outline && !treeLoading" class="wx-res-hint">
          按学习模块生成「卷 → 章 → 节」三级目录，作为后续找教材与读教材的结构。
        </p>
        <div v-if="outline" class="wx-res-tree">
          <div v-for="(m, mi) in outline" :key="mi" class="wx-res-tree-module">
            <div class="wx-res-tree-module-head">
              <b>{{ m.module }}</b>
              <span class="wx-res-tree-stat">{{ nodeStats(m.tree).pages }} 页 · {{ nodeStats(m.tree).hours }} 学时</span>
            </div>
            <div v-if="m.goal" class="wx-res-tree-goal">{{ m.goal }}</div>
            <ul class="wx-res-tree-lv1">
              <li v-for="(v, vi) in m.tree" :key="vi">
                <button class="wx-res-tree-row" @click="togglePath(`${mi}-${vi}`)">
                  <span class="wx-res-tree-caret">{{ openPaths.has(`${mi}-${vi}`) ? '▾' : '▸' }}</span>
                  <span class="wx-res-tree-title">{{ v.title }}</span>
                  <span class="wx-res-tree-meta">{{ v.pages }} 页 · {{ v.hours }} 时</span>
                </button>
                <ul v-if="openPaths.has(`${mi}-${vi}`)" class="wx-res-tree-lv2">
                  <li v-for="(c, ci) in v.children ?? []" :key="ci">
                    <button class="wx-res-tree-row" @click="togglePath(`${mi}-${vi}-${ci}`)">
                      <span class="wx-res-tree-caret">{{ openPaths.has(`${mi}-${vi}-${ci}`) ? '▾' : '▸' }}</span>
                      <span class="wx-res-tree-title">{{ c.title }}</span>
                      <span class="wx-res-tree-meta">{{ c.pages }} 页 · {{ c.hours }} 时</span>
                    </button>
                    <ul v-if="openPaths.has(`${mi}-${vi}-${ci}`)" class="wx-res-tree-lv3">
                      <li v-for="(s, si) in c.children ?? []" :key="si" class="wx-res-tree-leaf">
                        <span>{{ s.title }}</span>
                        <span class="wx-res-tree-meta">{{ s.pages }} 页 · {{ s.hours }} 时</span>
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
          <p v-if="outlineSummary" class="wx-res-note">{{ outlineSummary }}</p>
        </div>
      </section>

      <!-- B) 开放教材检索 -->
      <section class="wx-res-card">
        <div class="wx-res-card-head">
          <span class="wx-res-card-title">开放教材</span>
        </div>
        <div class="wx-res-card-sub">仅检索开放许可 / 官方免费来源；许可不明只提供链接</div>
        <div v-for="m in moduleList" :key="m.name" class="wx-res-search-module">
          <div class="wx-res-search-head">
            <span class="wx-res-search-name">{{ m.name }}</span>
            <span class="wx-res-search-items">{{ m.items.length }} 点</span>
            <button class="wx-res-gen wx-pressable" :disabled="searching !== null" @click="searchModule(m.name)">
              {{ searching === m.name ? '检索中…' : '搜索' }}
            </button>
          </div>
          <p v-if="searchError[m.name]" class="wx-res-err">{{ searchError[m.name] }}</p>
          <ul v-if="results[m.name]?.length" class="wx-res-books">
            <li v-for="c in results[m.name]" :key="c.url" class="wx-res-book">
              <div class="wx-res-book-main">
                <div class="wx-res-book-title">{{ c.title }}</div>
                <div class="wx-res-book-meta">
                  <span v-if="c.license" class="wx-res-license">{{ c.license }}</span>
                  <span class="wx-res-fmt">{{ c.format.toUpperCase() }}</span>
                </div>
              </div>
              <button
                v-if="canDownload(c)"
                class="wx-res-book-btn wx-pressable"
                :disabled="importing !== null"
                @click="download(c)"
              >{{ importing === c.url ? '下载中…' : '下载入库' }}</button>
              <a v-else :href="c.url" target="_blank" rel="noopener" class="wx-res-book-link">打开</a>
              <p v-if="importError[c.url]" class="wx-res-err wx-res-book-err">{{ importError[c.url] }}</p>
            </li>
          </ul>
          <p v-else-if="results[m.name] && results[m.name].length === 0 && searching === null" class="wx-res-hint">
            没有检索到可用的开放教材，可换模块名再试。
          </p>
        </div>
        <p v-if="moduleList.length === 0" class="wx-res-hint">先确认学习大纲，才会有可检索的模块。</p>
      </section>

      <!-- C) 已入库书籍 -->
      <section class="wx-res-card">
        <div class="wx-res-card-head">
          <span class="wx-res-card-title">已入库书籍</span>
          <button class="wx-res-check wx-pressable" @click="goShelf">书架 →</button>
        </div>
        <button v-if="!booksLoaded" class="wx-res-load wx-pressable" :disabled="booksLoading" @click="loadBooks">
          {{ booksLoading ? '读取中…' : '读取已入库书籍' }}
        </button>
        <div v-else-if="addedBooks.length === 0" class="wx-res-hint">当前行业还没有入库书籍。</div>
        <ul v-else class="wx-res-shelf">
          <li v-for="b in addedBooks" :key="b.id" class="wx-res-shelf-item">
            <span class="wx-res-shelf-fmt">{{ b.format.toUpperCase() }}</span>
            <span class="wx-res-shelf-title">{{ b.title }}</span>
          </li>
        </ul>
      </section>
    </div>

    <div class="wx-res-foot">
      <button class="wx-btn-gradient wx-pressable wx-res-go" @click="confirmResources">
        资源就绪，开始制定计划 →
      </button>
    </div>
  </div>
</template>

<style scoped>
.wx-res {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 14px 0;
  gap: 10px;
}
.wx-res-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px 10px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-res-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-family: var(--wx-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-primary);
  letter-spacing: 0.04em;
}
.wx-res-mark {
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 6px var(--wx-color-primary));
}
.wx-res-title-sub {
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--wx-text-tertiary);
  padding: 1px 8px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
}
.wx-res-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-primary-soft);
  padding: 3px 9px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
}
.wx-res-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 2px 14px;
}
.wx-res-card {
  padding: 12px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 32%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-res-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--wx-border-soft);
}
.wx-res-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-res-card-sub {
  padding-top: 8px;
  font-size: 10.5px;
  color: var(--wx-text-muted);
  line-height: 1.5;
}
.wx-res-hint {
  margin: 9px 0 0;
  font-size: 11.5px;
  color: var(--wx-text-muted);
  line-height: 1.55;
}
.wx-res-note {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
.wx-res-err {
  margin: 7px 0 0;
  font-size: 11.5px;
  color: var(--wx-color-vermilion);
}
.wx-res-check,
.wx-res-gen,
.wx-res-load {
  flex-shrink: 0;
  padding: 5px 11px;
  border-radius: var(--wx-radius-pill);
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
}
.wx-res-gen {
  color: var(--wx-color-primary-soft);
  border-color: var(--wx-border-glow);
}
.wx-res-load {
  margin-top: 9px;
  width: 100%;
}
.wx-res-check:disabled,
.wx-res-gen:disabled {
  opacity: 0.55;
}

/* 目录树 */
.wx-res-tree {
  margin-top: 9px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wx-res-tree-module {
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
  padding: 9px 10px;
}
.wx-res-tree-module-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--wx-text-primary);
}
.wx-res-tree-stat {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-res-tree-goal {
  margin-top: 3px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
.wx-res-tree-lv1,
.wx-res-tree-lv2,
.wx-res-tree-lv3 {
  list-style: none;
  margin: 6px 0 0;
  padding-left: 12px;
}
.wx-res-tree-row {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 0;
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  background: transparent;
  border: none;
  text-align: left;
}
.wx-res-tree-caret {
  width: 12px;
  flex-shrink: 0;
  color: var(--wx-text-muted);
}
.wx-res-tree-title {
  flex: 1;
  min-width: 0;
}
.wx-res-tree-meta {
  flex-shrink: 0;
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-text-muted);
}
.wx-res-tree-leaf {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0 4px 17px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}

/* 检索结果 */
.wx-res-search-module {
  padding: 9px 0;
  border-top: 1px dashed var(--wx-border-soft);
}
.wx-res-search-module:first-of-type {
  border-top: 0;
  padding-top: 8px;
}
.wx-res-search-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wx-res-search-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-res-search-items {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--wx-text-muted);
}
.wx-res-books {
  list-style: none;
  margin: 7px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wx-res-book {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--wx-border-soft);
  border-radius: 6px;
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
}
.wx-res-book-err {
  width: 100%;
  margin: 3px 0 0;
}
.wx-res-book-main {
  flex: 1;
  min-width: 0;
}
.wx-res-book-title {
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  line-height: 1.45;
}
.wx-res-book-meta {
  display: flex;
  gap: 7px;
  margin-top: 2px;
  font-size: 10px;
  color: var(--wx-text-muted);
}
.wx-res-license {
  color: var(--wx-color-yanqing);
}
.wx-res-fmt {
  font-family: var(--wx-font-mono);
}
.wx-res-book-btn {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: var(--wx-radius-pill);
  font-size: 11px;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border: none;
}
.wx-res-book-btn:disabled {
  opacity: 0.5;
}
.wx-res-book-link {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--wx-color-primary-soft);
}

/* 已入库 */
.wx-res-shelf {
  list-style: none;
  margin: 9px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.wx-res-shelf-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 9px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  font-size: 11px;
  color: var(--wx-text-secondary);
}
.wx-res-shelf-fmt {
  flex-shrink: 0;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-primary-soft);
}
.wx-res-shelf-title {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wx-res-foot {
  flex-shrink: 0;
  padding: 10px 0 calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--wx-border-soft);
}
.wx-res-go {
  width: 100%;
  padding: 11px 14px;
  font-size: 13.5px;
}
</style>
