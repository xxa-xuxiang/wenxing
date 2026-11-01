<script setup lang="ts">
// 星图节点文档面板：左侧目录（匹配候选）+ 右侧正文
// 匹配：本地按标题 / 标签 / 祖先路径做 token + 中文 bigram 打分，不依赖向量服务
// 未命中：空态展示「手动生成」，由用户确认后调用后端生成并落盘
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
  /** 聚合候选：点击节点时其子树下的细目 / 条目（为空时按 target 单条匹配） */
  targets?: DocTarget[]
  /** 抽屉底部的附加入口文案（子知识点 → 技能详情） */
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

/** 查询词与候选文本的相似度（精确包含 > bigram 重叠） */
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
  // 只取最近 4 级祖先，避免技能类等公共前缀稀释
  for (const seg of t.path.slice(-4)) {
    score += scoreText(seg, title) * 0.8 + scoreText(seg, tags) * 0.6
  }
  return score
}

const MATCH_THRESHOLD = 14

/** 参与匹配的候选（聚合节点 → 其子树细目 / 条目；单节点 → 自身） */
const targetList = computed<DocTarget[]>(() => {
  if (props.targets?.length) return props.targets
  return props.target ? [props.target] : []
})

const matched = computed(() => {
  const list = targetList.value
  if (!list.length) return []
  // 每篇文档只保留「与任一候选的最高分」，再统一排序
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

/** 无匹配时左侧展示全部文档，用户可自行选择 */
const catalog = computed(() => (matched.value.length ? matched.value : allDocs.value.slice(0, 200)))

const isEmptyMatch = computed(() => phase.value === 'done' && matched.value.length === 0)

// ===== 正文加载 =====
function relFile(d: DocListItem): string {
  return d.industry ? `${d.industry}/${d.file}` : d.file
}

async function loadContent(doc: DocListItem) {
  selected.value = doc
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

// ===== 主流程：打开 → 拉清单 → 自动选中最佳匹配 =====
async function load() {
  const t = props.target
  if (!t) return
  phase.value = 'loading'
  errorMsg.value = ''
  genError.value = ''
  selected.value = null
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
    allDocs.value = [item, ...allDocs.value.filter((d) => !(d.industry === item.industry && d.file === item.file))]
    selected.value = item
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
  <!-- 挂到 body：避免被星图容器的 overflow / 层叠上下文裁剪 -->
  <Teleport to="body">
    <div v-if="open" class="wx-doc-layer">
      <div class="wx-doc-mask" @click.self="emit('close')"></div>

      <!-- 右侧模态框：文档目录 + 正文 -->
      <section class="wx-doc-panel">
        <!-- 左：目录 -->
        <aside class="wx-doc-nav">
          <header class="wx-doc-nav-head">
            <div class="wx-doc-nav-title">文档目录</div>
            <div class="wx-doc-nav-sub">
              {{ target?.title ?? '' }}<span v-if="targetList.length > 1"> · {{ targetList.length }} 个细目 / 条目</span>
            </div>
            <button class="wx-doc-nav-x" title="关闭" @click="emit('close')">×</button>
          </header>

          <div v-if="phase === 'loading'" class="wx-doc-nav-state">正在加载文档清单…</div>
          <div v-else-if="phase === 'error'" class="wx-doc-nav-state err">{{ errorMsg }}</div>
          <div v-else-if="!catalog.length" class="wx-doc-nav-state">暂无已存档文档</div>
          <ul v-else class="wx-doc-nav-list">
            <li v-for="d in catalog" :key="`${d.industry}/${d.file}`">
              <button
                class="wx-doc-nav-item"
                :class="{ active: selected?.file === d.file && selected?.industry === d.industry }"
                @click="loadContent(d)"
              >
                <span class="wx-doc-nav-item-title">{{ d.title }}</span>
                <span class="wx-doc-nav-item-meta">{{ d.industry || '未分类' }}</span>
              </button>
            </li>
          </ul>
          <div v-if="isEmptyMatch" class="wx-doc-nav-tip">
            {{ targetList.length > 1 ? '该节点子树下暂无已存档文档，以上为全部文档' : '未匹配到同名文档，以上为全部文档' }}
          </div>
          <button
            v-if="detailLabel"
            class="wx-doc-nav-detail"
            @click="emit('detail')"
          >{{ detailLabel }}</button>
        </aside>

        <!-- 右：正文 -->
        <div class="wx-doc-main">
          <header class="wx-doc-main-head">
            <div class="wx-doc-main-title">{{ selected?.title ?? target?.title ?? '文档' }}</div>
            <div class="wx-doc-main-path">
              {{ (target?.path ?? []).join(' / ') }}
            </div>
          </header>

          <div v-if="contentLoading" class="wx-doc-state">
            <div class="wx-doc-state-mark">✦</div>
            <div class="wx-doc-state-text">正在加载正文…</div>
          </div>

          <div v-else-if="contentError" class="wx-doc-state">
            <div class="wx-doc-state-mark err">⚠</div>
            <div class="wx-doc-state-text">{{ contentError }}</div>
            <button class="wx-doc-retry" @click="rerun">重新加载</button>
          </div>

          <!-- 空态：未匹配到文档，手动生成 -->
          <div v-else-if="!selected" class="wx-doc-state">
            <div class="wx-doc-state-mark">✧</div>
            <div class="wx-doc-state-text">
              暂无与「{{ target?.title }}」匹配的文档
            </div>
            <div class="wx-doc-state-hint">可由 AI 生成一份该主题的学习文档并存入文档库</div>
            <button class="wx-doc-generate" :disabled="generating" @click="generate">
              {{ generating ? '正在生成…' : '✦ 生成该文档' }}
            </button>
            <div v-if="genError" class="wx-doc-gen-error">{{ genError }}</div>
          </div>

          <article v-else class="wx-doc-md" v-html="contentHtml"></article>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* 模态层：覆盖全屏，遮罩点击关闭 */
.wx-doc-layer {
  position: fixed;
  inset: 0;
  z-index: 120;
}
.wx-doc-mask {
  position: absolute;
  inset: 0;
  background: transparent;
}

/* 界面内小窗：贴右边缘，宽度约 2/3 视口，高度与左侧目录树对齐 */
.wx-doc-panel {
  position: absolute;
  top: 56px;
  right: 16px;
  bottom: 24px;
  width: clamp(480px, 66vw, 960px);
  display: flex;
  overflow: hidden;
  border-radius: var(--wx-glass-radius);
  border: 1px solid var(--wx-glass-border);
  background: color-mix(in srgb, var(--wx-bg-deep) 92%, transparent);
  backdrop-filter: blur(calc(var(--wx-glass-blur) + 4px)) saturate(160%);
  box-shadow: var(--wx-shadow-lg);
  animation: wx-doc-in var(--wx-duration-mid) var(--wx-ease-out-soft);
}
@keyframes wx-doc-in {
  from { transform: translateX(28px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

/* 左目录 */
.wx-doc-nav {
  width: min(240px, 36%);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 4%, transparent);
}

.wx-doc-nav-head {
  position: relative;
  padding: 18px 34px 12px 18px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-doc-nav-x {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
  color: var(--wx-text-tertiary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-doc-nav-x:hover {
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
}
.wx-doc-nav-title {
  font-family: var(--wx-font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-doc-nav-sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-doc-nav-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wx-doc-nav-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  text-align: left;
  border-radius: var(--wx-radius-sm);
  border: 1px solid transparent;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-doc-nav-item:hover {
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}
.wx-doc-nav-item.active {
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  border-color: var(--wx-border-glow);
}
.wx-doc-nav-item-title {
  font-size: 12.5px;
  color: var(--wx-text-primary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wx-doc-nav-item-meta {
  font-size: 10.5px;
  color: var(--wx-text-tertiary);
}
.wx-doc-nav-state {
  flex: 1;
  padding: 24px 18px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
  line-height: 1.6;
}
.wx-doc-nav-state.err { color: var(--wx-color-vermilion); }
.wx-doc-nav-tip {
  padding: 8px 16px;
  font-size: 10.5px;
  color: var(--wx-text-muted);
  border-top: 1px dashed var(--wx-border-soft);
}
.wx-doc-nav-detail {
  margin: 8px 12px 12px;
  padding: 7px 0;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-doc-nav-detail:hover {
  color: var(--wx-text-primary);
  border-color: var(--wx-border-glow);
}

/* 右正文 */
.wx-doc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wx-doc-main-head {
  padding: 18px 26px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-doc-main-title {
  font-family: var(--wx-font-serif);
  font-size: 19px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-doc-main-path {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--wx-text-tertiary);
}
.wx-doc-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}
.wx-doc-state-mark {
  font-size: 40px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 14px var(--wx-color-primary));
  animation: wx-breathe 3s var(--wx-ease-in-out-soft) infinite alternate;
}
.wx-doc-state-mark.err {
  color: var(--wx-color-vermilion);
  filter: drop-shadow(0 0 10px var(--wx-color-vermilion));
  animation: none;
}
.wx-doc-state-text { font-size: 14px; color: var(--wx-text-secondary); }
.wx-doc-state-hint { font-size: 12px; color: var(--wx-text-tertiary); }
.wx-doc-retry,
.wx-doc-generate {
  margin-top: 6px;
  padding: 8px 20px;
  border-radius: var(--wx-radius-pill);
  font-size: 13px;
  border: 1px solid var(--wx-border-glow);
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-doc-retry:hover,
.wx-doc-generate:hover:not(:disabled) {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 22%, transparent);
}
.wx-doc-generate:disabled { opacity: 0.6; cursor: wait; }
.wx-doc-gen-error {
  margin-top: 4px;
  font-size: 12px;
  color: var(--wx-color-vermilion);
}

/* 正文排版 */
.wx-doc-md {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 30px 36px;
  color: var(--wx-text-secondary);
}
.wx-doc-md :deep(h1),
.wx-doc-md :deep(h2),
.wx-doc-md :deep(h3),
.wx-doc-md :deep(h4) {
  color: var(--wx-text-primary);
  font-family: var(--wx-font-serif);
  margin: 18px 0 10px;
  line-height: 1.4;
}
.wx-doc-md :deep(h1) { font-size: 20px; }
.wx-doc-md :deep(h2) { font-size: 17px; }
.wx-doc-md :deep(h3) { font-size: 15px; }
.wx-doc-md :deep(h4) { font-size: 13.5px; }
.wx-doc-md :deep(h1:first-child),
.wx-doc-md :deep(h2:first-child) { margin-top: 0; }
.wx-doc-md :deep(p) { font-size: 13px; line-height: 1.9; margin: 10px 0; }
.wx-doc-md :deep(ul),
.wx-doc-md :deep(ol) { margin: 10px 0; padding-left: 22px; font-size: 13px; line-height: 1.9; }
.wx-doc-md :deep(li::marker) { color: var(--wx-color-primary-soft); }
.wx-doc-md :deep(blockquote) {
  margin: 12px 0;
  padding: 10px 14px;
  border-left: 3px solid var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 7%, transparent);
  border-radius: 0 var(--wx-radius-sm) var(--wx-radius-sm) 0;
  font-size: 12.5px;
  line-height: 1.75;
}
.wx-doc-md :deep(code) {
  font-family: var(--wx-font-mono);
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  color: var(--wx-color-primary-soft);
}
.wx-doc-md :deep(pre.wx-code-block) {
  margin: 12px 0;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--wx-bg-deep) 85%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-sm);
  overflow-x: auto;
}
.wx-doc-md :deep(pre.wx-code-block code) { padding: 0; background: transparent; color: var(--wx-text-secondary); }
.wx-doc-md :deep(table.wx-md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 12px;
}
.wx-doc-md :deep(.wx-md-table th),
.wx-doc-md :deep(.wx-md-table td) {
  padding: 7px 10px;
  border: 1px solid var(--wx-border-soft);
  text-align: left;
}
.wx-doc-md :deep(.wx-md-table th) {
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  color: var(--wx-text-primary);
}
.wx-doc-md :deep(a) {
  color: var(--wx-color-primary-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.wx-doc-md :deep(hr.wx-md-hr) {
  border: none;
  height: 1px;
  background: var(--wx-border-soft);
  margin: 16px 0;
}
</style>
