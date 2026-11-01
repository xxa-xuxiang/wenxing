<script setup lang="ts">
// 星图 · 文档抽屉（移动端，由桌面端 AtlasDocPanel 改造）
// 匹配：本地按标题 / 标签 / 祖先路径做 token + 中文 bigram 打分，不依赖向量服务
// 未命中：空态展示「手动生成」，由用户确认后调用后端生成并落盘
// 移动端形态：底部抽屉（78vh），先展示目录，选中文档后切到正文；可随时返回目录
import { computed, ref, watch } from 'vue'
import { renderMarkdown } from '@/utils/markdown'
import {
  listDocs,
  fetchVectorDoc,
  generateSkillDoc,
  type DocListItem
} from '@/services/vectorService'

interface DocTarget {
  title: string
  path: string[]
}

const props = defineProps<{
  open: boolean
  target: DocTarget | null
  targets?: DocTarget[]
  detailLabel?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'detail'): void
}>()

type Phase = 'idle' | 'loading' | 'done' | 'error'

const phase = ref<Phase>('idle')
const errorMsg = ref('')
const allDocs = ref<DocListItem[]>([])
const selected = ref<DocListItem | null>(null)
const view = ref<'catalog' | 'content'>('catalog')

const contentHtml = ref('')
const contentLoading = ref(false)
const contentError = ref('')

const generating = ref(false)
const genError = ref('')

// ===== 本地匹配：标题 / 标签 / 祖先路径 =====
function bigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2))
  return out
}

function scoreText(q: string, hay: string): number {
  const t = q.toLowerCase().trim()
  const h = hay.toLowerCase()
  if (!t || !h) return 0
  if (h === t) return 60
  let score = h.includes(t) ? 24 : 0
  const bg = bigrams(t)
  if (bg.length) {
    let hit = 0
    for (const b of bg) if (h.includes(b)) hit += 1
    score += (hit / bg.length) * 10
  }
  return score
}

function scoreDoc(t: DocTarget, d: DocListItem): number {
  const title = d.title
  const tags = d.tags.join(' ')
  let score = scoreText(t.title, title) * 1.5 + scoreText(t.title, tags)
  for (const seg of t.path.slice(-4)) {
    score += scoreText(seg, title) * 0.8 + scoreText(seg, tags) * 0.6
  }
  return score
}

const MATCH_THRESHOLD = 14

const targetList = computed<DocTarget[]>(() => {
  if (props.targets?.length) return props.targets
  return props.target ? [props.target] : []
})

const matched = computed(() => {
  const list = targetList.value
  if (!list.length) return []
  const best = new Map<string, { doc: DocListItem; score: number }>()
  for (const d of allDocs.value) {
    let s = 0
    for (const t of list) {
      const v = scoreDoc(t, d)
      if (v > s) s = v
    }
    if (s >= MATCH_THRESHOLD) best.set(`${d.industry}/${d.file}`, { doc: d, score: s })
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map((x) => x.doc)
})

const catalog = computed(() => (matched.value.length ? matched.value : allDocs.value.slice(0, 200)))
const isEmptyMatch = computed(() => phase.value === 'done' && matched.value.length === 0)

function relFile(d: DocListItem): string {
  return d.industry ? `${d.industry}/${d.file}` : d.file
}

async function loadContent(doc: DocListItem) {
  selected.value = doc
  view.value = 'content'
  contentHtml.value = ''
  contentError.value = ''
  contentLoading.value = true
  try {
    const data = await fetchVectorDoc(relFile(doc))
    contentHtml.value = renderMarkdown(data.content)
  } catch (e) {
    contentError.value = e instanceof Error ? e.message : '文档加载失败'
  } finally {
    contentLoading.value = false
  }
}

async function load() {
  const t = props.target
  if (!t) return
  phase.value = 'loading'
  errorMsg.value = ''
  genError.value = ''
  selected.value = null
  view.value = 'catalog'
  contentHtml.value = ''
  contentError.value = ''
  try {
    const data = await listDocs()
    allDocs.value = data.docs
    phase.value = 'done'
    const best = matched.value[0]
    if (best) await loadContent(best)
  } catch (e) {
    phase.value = 'error'
    errorMsg.value = e instanceof Error ? e.message : '文档清单加载失败'
  }
}

/** 手动生成：明确由用户点击触发，成功后直接展示并加入目录 */
async function generate() {
  const t = props.target
  if (!t || generating.value) return
  generating.value = true
  genError.value = ''
  try {
    const res = await generateSkillDoc({ title: t.title, path: t.path })
    const file = res.file.includes('/') ? res.file.split('/').pop() ?? res.file : res.file
    const item: DocListItem = {
      industry: res.industry,
      file,
      title: res.title,
      tags: t.path
    }
    allDocs.value = [
      item,
      ...allDocs.value.filter((d) => !(d.industry === item.industry && d.file === item.file))
    ]
    selected.value = item
    view.value = 'content'
    contentHtml.value = renderMarkdown(res.content)
    contentError.value = ''
  } catch (e) {
    genError.value = e instanceof Error ? e.message : '生成失败，请确认后端已启动'
  } finally {
    generating.value = false
  }
}

function rerun() {
  void load()
}

watch(
  () => [props.open, props.target, props.targets] as const,
  ([open]) => {
    if (open) void load()
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ds-layer">
      <div class="ds-mask" @click.self="emit('close')"></div>

      <section class="ds-panel">
        <header class="ds-grab" @click="emit('close')">
          <span class="ds-grab-bar"></span>
        </header>

        <header class="ds-head">
          <div class="ds-head-main">
            <div class="ds-title">
              {{ view === 'content' ? selected?.title ?? target?.title ?? '文档' : '文档目录' }}
            </div>
            <div class="ds-sub">
              <template v-if="view === 'content'">{{ (target?.path ?? []).join(' / ') }}</template>
              <template v-else>
                {{ target?.title ?? '' }}
                <span v-if="targetList.length > 1"> · {{ targetList.length }} 个细目 / 条目</span>
              </template>
            </div>
          </div>
          <button
            v-if="view === 'content'"
            class="ds-back"
            title="返回目录"
            @click="view = 'catalog'"
          >目录</button>
          <button class="ds-close" title="关闭" @click="emit('close')">×</button>
        </header>

        <!-- 目录 -->
        <div v-if="view === 'catalog'" class="ds-catalog">
          <div v-if="phase === 'loading'" class="ds-state">正在加载文档清单…</div>
          <div v-else-if="phase === 'error'" class="ds-state err">{{ errorMsg }}</div>
          <div v-else-if="!catalog.length" class="ds-state">暂无已存档文档</div>
          <template v-else>
            <button
              v-for="d in catalog"
              :key="`${d.industry}/${d.file}`"
              class="ds-item"
              :class="{ active: selected?.file === d.file && selected?.industry === d.industry }"
              @click="loadContent(d)"
            >
              <span class="ds-item-title">{{ d.title }}</span>
              <span class="ds-item-meta">{{ d.industry || '未分类' }}</span>
            </button>
          </template>
          <div v-if="isEmptyMatch" class="ds-tip">
            {{ targetList.length > 1 ? '该节点子树下暂无已存档文档，以上为全部文档' : '未匹配到同名文档，以上为全部文档' }}
          </div>
          <button v-if="detailLabel" class="ds-detail" @click="emit('detail')">
            {{ detailLabel }}
          </button>
        </div>

        <!-- 正文 -->
        <div v-else class="ds-main">
          <div v-if="contentLoading" class="ds-state">
            <div class="ds-state-mark">✦</div>
            <div>正在加载正文…</div>
          </div>
          <div v-else-if="contentError" class="ds-state">
            <div class="ds-state-mark err">⚠</div>
            <div>{{ contentError }}</div>
            <button class="ds-retry" @click="rerun">重新加载</button>
          </div>
          <div v-else-if="!selected" class="ds-state">
            <div class="ds-state-mark">✧</div>
            <div>暂无与「{{ target?.title }}」匹配的文档</div>
            <div class="ds-hint">可由 AI 生成一份该主题的学习文档并存入文档库</div>
            <button class="ds-generate" :disabled="generating" @click="generate">
              {{ generating ? '正在生成…' : '✦ 生成该文档' }}
            </button>
            <div v-if="genError" class="ds-gen-error">{{ genError }}</div>
          </div>
          <article v-else class="ds-md" v-html="contentHtml"></article>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ds-layer {
  position: fixed;
  inset: 0;
  z-index: 140;
}
.ds-mask {
  position: absolute;
  inset: 0;
  background: transparent;
}
.ds-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 78vh;
  display: flex;
  flex-direction: column;
  border-radius: 18px 18px 0 0;
  border-top: 1px solid var(--wx-glass-border);
  background: color-mix(in srgb, var(--wx-bg-deep) 94%, transparent);
  backdrop-filter: blur(calc(var(--wx-glass-blur) + 4px)) saturate(160%);
  -webkit-backdrop-filter: blur(calc(var(--wx-glass-blur) + 4px)) saturate(160%);
  box-shadow: var(--wx-shadow-lg);
  overflow: hidden;
  animation: ds-in var(--wx-duration-mid) var(--wx-ease-out-soft);
  color: var(--wx-text-primary);
}
@keyframes ds-in {
  from { transform: translateY(40px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.ds-grab {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 8px 0 2px;
}
.ds-grab-bar {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 22%, transparent);
}
.ds-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.ds-head-main { flex: 1; min-width: 0; }
.ds-title {
  font-family: var(--wx-font-serif);
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds-sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds-back,
.ds-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  color: var(--wx-text-secondary);
  font-size: 12px;
}
.ds-back { width: auto; padding: 0 12px; }
.ds-close { font-size: 18px; }

.ds-catalog,
.ds-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ds-catalog {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 10px 12px calc(16px + env(safe-area-inset-bottom));
  gap: 4px;
}
.ds-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  border-radius: var(--wx-radius-md);
  border: 1px solid transparent;
  background: transparent;
}
.ds-item.active {
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  border-color: var(--wx-border-glow);
}
.ds-item-title {
  font-size: 13px;
  color: var(--wx-text-primary);
  line-height: 1.45;
}
.ds-item-meta { font-size: 10.5px; color: var(--wx-text-tertiary); }
.ds-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--wx-text-secondary);
}
.ds-state.err { color: var(--wx-color-vermilion); }
.ds-state-mark {
  font-size: 34px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 14px var(--wx-color-primary));
}
.ds-state-mark.err {
  color: var(--wx-color-vermilion);
  filter: drop-shadow(0 0 10px var(--wx-color-vermilion));
}
.ds-hint { font-size: 12px; color: var(--wx-text-tertiary); }
.ds-retry,
.ds-generate {
  margin-top: 6px;
  padding: 9px 22px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  border: 1px solid var(--wx-border-glow);
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
}
.ds-generate:disabled { opacity: 0.6; }
.ds-gen-error { font-size: 12px; color: var(--wx-color-vermilion); }
.ds-tip {
  padding: 10px 4px;
  font-size: 10.5px;
  color: var(--wx-text-muted);
  border-top: 1px dashed var(--wx-border-soft);
}
.ds-detail {
  margin: 10px 0 0;
  padding: 9px 0;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  font-size: 12px;
  color: var(--wx-text-secondary);
  background: transparent;
}

.ds-md {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px 18px calc(28px + env(safe-area-inset-bottom));
  color: var(--wx-text-secondary);
}
.ds-md :deep(h1),
.ds-md :deep(h2),
.ds-md :deep(h3),
.ds-md :deep(h4) {
  color: var(--wx-text-primary);
  font-family: var(--wx-font-serif);
  margin: 16px 0 10px;
  line-height: 1.4;
}
.ds-md :deep(h1) { font-size: 19px; }
.ds-md :deep(h2) { font-size: 16.5px; }
.ds-md :deep(h3) { font-size: 15px; }
.ds-md :deep(h4) { font-size: 13.5px; }
.ds-md :deep(h1:first-child),
.ds-md :deep(h2:first-child) { margin-top: 0; }
.ds-md :deep(p) { font-size: 13.5px; line-height: 1.9; margin: 10px 0; }
.ds-md :deep(ul),
.ds-md :deep(ol) { margin: 10px 0; padding-left: 22px; font-size: 13.5px; line-height: 1.9; }
.ds-md :deep(li::marker) { color: var(--wx-color-primary-soft); }
.ds-md :deep(blockquote) {
  margin: 12px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 7%, transparent);
  border-radius: 0 var(--wx-radius-sm) var(--wx-radius-sm) 0;
  font-size: 13px;
  line-height: 1.75;
}
.ds-md :deep(code) {
  font-family: var(--wx-font-mono);
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  color: var(--wx-color-primary-soft);
}
.ds-md :deep(pre.wx-code-block) {
  margin: 12px 0;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--wx-bg-deep) 85%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  overflow-x: auto;
}
.ds-md :deep(pre.wx-code-block code) {
  padding: 0;
  background: transparent;
  color: var(--wx-text-secondary);
}
.ds-md :deep(table.wx-md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 12px;
}
.ds-md :deep(.wx-md-table th),
.ds-md :deep(.wx-md-table td) {
  padding: 7px 10px;
  border: 1px solid var(--wx-border-soft);
  text-align: left;
}
.ds-md :deep(.wx-md-table th) {
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  color: var(--wx-text-primary);
}
.ds-md :deep(a) {
  color: var(--wx-color-primary-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.ds-md :deep(hr.wx-md-hr) {
  border: none;
  height: 1px;
  background: var(--wx-border-soft);
  margin: 16px 0;
}
</style>
