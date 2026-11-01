<script setup lang="ts">
// 星图左侧 · 技能目录面板（毛玻璃模态，固定，可一键折叠）
// 数据源：父级（星图）传入的「甲编 · 学科内技能」结构树（族 → 项 → 知识点），不发网络请求
// - 族 / 项两级可独立收起；默认展开全部族、收起项
// - 点击知识点 → emit('open-kp')，由父级弹出知识点详情
// - locate prop：星图节点点击 → 展开祖先、高亮并滚动定位到对应族 / 项 / 知识点
import { computed, nextTick, ref, watch } from 'vue'
import type { SkillKp, SkillZu } from '@/types/skills'

interface LocatePayload {
  nonce: number
  zu: string
  xiang?: string
  kp?: string
}

const props = defineProps<{
  zu: SkillZu[]
  locate: LocatePayload | null
}>()
const emit = defineEmits<{
  (e: 'open-kp', payload: { zu: string; xiang: string; kp: SkillKp }): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const collapsed = ref(false)

const list = computed(() => props.zu ?? [])

// 展开状态：族（z-<i>）与项（x-<i>-<j>）两级独立；默认展开族、收起项
const expandedKeys = ref<Set<string>>(new Set())

const zuKey = (zi: number) => `z-${zi}`
const xiangKey = (zi: number, xi: number) => `x-${zi}-${xi}`

function toggleKey(key: string) {
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}

function expandAll() {
  const keys: string[] = []
  list.value.forEach((z, zi) => {
    keys.push(zuKey(zi))
    z.xiang.forEach((_, xi) => keys.push(xiangKey(zi, xi)))
  })
  expandedKeys.value = new Set(keys)
}

function collapseAll() {
  expandedKeys.value = new Set(list.value.map((_, zi) => zuKey(zi)))
}

/** 族代码：取名称首字母（如「A. 数理与形式推理」→ A） */
function zuCode(name: string): string {
  return (name.split('.')[0] ?? '').trim()
}

// ===== 星图节点 → 目录定位 =====
const highlightKey = ref('')

async function applyLocate(loc: LocatePayload) {
  const zi = list.value.findIndex((z) => z.n === loc.zu)
  if (zi < 0) return
  collapsed.value = false
  const keys = new Set(expandedKeys.value)
  keys.add(zuKey(zi))
  let targetKey = `locate-zu-${zi}`
  if (loc.xiang) {
    const xi = list.value[zi].xiang.findIndex((x) => x.n === loc.xiang)
    if (xi >= 0) {
      keys.add(xiangKey(zi, xi))
      targetKey = `locate-xiang-${zi}-${xi}`
      if (loc.kp) {
        const ki = list.value[zi].xiang[xi].kp.findIndex((k) => k.n === loc.kp)
        if (ki >= 0) targetKey = `locate-kp-${zi}-${xi}-${ki}`
      }
    }
  }
  expandedKeys.value = keys
  highlightKey.value = targetKey
  await nextTick()
  // 第二次 nextTick 确保 v-show 展开后 DOM 已布局
  await nextTick()
  const el = panelRef.value?.querySelector(`[data-locate="${targetKey}"]`) as HTMLElement | null
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(() => props.locate, (loc) => {
  if (loc) void applyLocate(loc)
})

watch(() => list.value, (val) => {
  expandedKeys.value = new Set(val.map((_, zi) => zuKey(zi)))
}, { immediate: true })
</script>

<template>
  <!-- 折叠态：左侧悬浮胶囊入口 -->
  <button
    v-if="collapsed"
    class="wx-dtp-open wx-pressable"
    title="展开技能目录"
    @click="collapsed = false"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
    <span>目录</span>
  </button>

  <!-- 展开态：左侧固定毛玻璃面板（顶部避开「缺少能力？」按钮，底部避开导航/悬浮球） -->
  <aside v-else ref="panelRef" class="wx-dtp">
    <header class="wx-dtp-head">
      <div class="wx-dtp-head-main">
        <div class="wx-dtp-title">技能目录</div>
        <div class="wx-dtp-sub">甲编 · 学科内技能</div>
      </div>
      <div class="wx-dtp-head-acts">
        <button class="wx-dtp-mini wx-pressable" title="全部展开" @click="expandAll">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 20h10M12 4v12M6 10l6-6 6 6" />
          </svg>
        </button>
        <button class="wx-dtp-mini wx-pressable" title="全部收起" @click="collapseAll">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 4h10M12 20V8M6 14l6 6 6-6" />
          </svg>
        </button>
        <button class="wx-dtp-collapse wx-pressable" title="收起面板" @click="collapsed = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      </div>
    </header>

    <div class="wx-dtp-body">
      <div v-if="!list.length" class="wx-dtp-tip">技能目录为空</div>

      <template v-else>
        <section
          v-for="(z, zi) in list"
          :key="z.n"
          class="wx-dtp-cat"
          :class="{ open: expandedKeys.has(zuKey(zi)) }"
        >
          <button
            class="wx-dtp-cat-head"
            :class="{ hl: highlightKey === `locate-zu-${zi}` }"
            :data-locate="`locate-zu-${zi}`"
            @click="toggleKey(zuKey(zi))"
          >
            <svg
              class="wx-dtp-chevron"
              :class="{ open: expandedKeys.has(zuKey(zi)) }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span class="wx-dtp-cat-code">{{ zuCode(z.n) }}</span>
            <span class="wx-dtp-cat-title" :title="z.n">{{ z.n }}</span>
            <span class="wx-dtp-cat-meta">{{ z.xiang.length }}</span>
          </button>

          <div v-show="expandedKeys.has(zuKey(zi))" class="wx-dtp-cat-body">
            <div
              v-for="(x, xi) in z.xiang"
              :key="`${z.n}-${xi}`"
              class="wx-dtp-domain"
              :class="{ open: expandedKeys.has(xiangKey(zi, xi)) }"
            >
              <button
                class="wx-dtp-domain-head"
                :class="{ hl: highlightKey === `locate-xiang-${zi}-${xi}` }"
                :data-locate="`locate-xiang-${zi}-${xi}`"
                @click="toggleKey(xiangKey(zi, xi))"
              >
                <svg
                  class="wx-dtp-chevron sm"
                  :class="{ open: expandedKeys.has(xiangKey(zi, xi)) }"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <span class="wx-dtp-domain-name" :title="x.n">{{ x.n }}</span>
                <span class="wx-dtp-domain-count">{{ x.kp.length }}</span>
              </button>

              <div v-show="expandedKeys.has(xiangKey(zi, xi))" class="wx-dtp-docs">
                <button
                  v-for="(k, ki) in x.kp"
                  :key="k.n"
                  class="wx-dtp-doc"
                  :class="{ hl: highlightKey === `locate-kp-${zi}-${xi}-${ki}` }"
                  :data-locate="`locate-kp-${zi}-${xi}-${ki}`"
                  :title="k.n"
                  @click="emit('open-kp', { zu: z.n, xiang: x.n, kp: k })"
                >
                  <span class="wx-dtp-kp-dot"></span>
                  <span>{{ k.n }}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
/* 面板：左侧固定毛玻璃模态，宽 = 界面总宽 1/7；top 避开左上反馈按钮 */
.wx-dtp {
  position: absolute;
  top: 56px;
  left: 16px;
  bottom: 24px;
  width: calc(100vw / 7);
  min-width: 184px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  border-radius: var(--wx-glass-radius);
  background: var(--wx-glass-bg);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  border: 1px solid var(--wx-glass-border);
  overflow: hidden;
}

.wx-dtp-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 10px 10px 14px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-dtp-head-main { flex: 1; min-width: 0; }
.wx-dtp-title {
  font-size: 13px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
  color: var(--wx-text-primary);
}
.wx-dtp-sub {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--wx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-dtp-head-acts { display: flex; align-items: center; gap: 4px; }
.wx-dtp-mini,
.wx-dtp-collapse {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
}
.wx-dtp-mini svg { width: 12px; height: 12px; }
.wx-dtp-collapse svg { width: 13px; height: 13px; }
.wx-dtp-mini:hover,
.wx-dtp-collapse:hover { color: var(--wx-color-primary-soft); border-color: var(--wx-border-glow); }

.wx-dtp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wx-dtp-tip {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
  text-align: center;
  padding: 16px 8px;
}

.wx-dtp-cat {
  flex-shrink: 0;
  border-radius: var(--wx-radius-md);
  border: 1px solid transparent;
}
.wx-dtp-cat.open {
  border-color: var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-dtp-cat-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  text-align: left;
  border-radius: var(--wx-radius-md);
}
.wx-dtp-cat-head:hover { background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent); }
.wx-dtp-chevron {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--wx-text-muted);
  transition: transform 0.25s var(--wx-ease-in-out-soft);
}
.wx-dtp-chevron.sm { width: 11px; height: 11px; }
.wx-dtp-chevron.open { transform: rotate(90deg); }
.wx-dtp-cat-code {
  font-size: 10px;
  font-family: var(--wx-font-mono);
  color: var(--wx-color-primary-soft);
  flex-shrink: 0;
}
.wx-dtp-cat-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--wx-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-dtp-cat-meta {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  color: var(--wx-color-primary-soft);
}

.wx-dtp-cat-body {
  padding: 2px 8px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wx-dtp-domain {
  border-left: 1px solid var(--wx-border-soft);
  padding-left: 8px;
}
.wx-dtp-domain-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  text-align: left;
  border-radius: var(--wx-radius-sm);
}
.wx-dtp-domain-head:hover { background: color-mix(in srgb, var(--wx-color-primary) 7%, transparent); }
.wx-dtp-domain-name {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--wx-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-dtp-domain-count {
  flex-shrink: 0;
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  color: var(--wx-text-tertiary);
}
.wx-dtp-docs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0 4px 16px;
}
.wx-dtp-doc {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  color: var(--wx-text-secondary);
  font-size: 11.5px;
  text-align: left;
}
.wx-dtp-kp-dot {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--wx-color-primary-soft);
  opacity: 0.75;
}
.wx-dtp-doc span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wx-dtp-doc:hover {
  color: var(--wx-text-primary);
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
}

/* 星图节点定位高亮 */
.wx-dtp-cat-head.hl,
.wx-dtp-domain-head.hl,
.wx-dtp-doc.hl {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  box-shadow: 0 0 0 1px var(--wx-color-primary) inset, 0 0 12px color-mix(in srgb, var(--wx-color-primary) 35%, transparent);
}

/* 折叠态入口：左侧悬浮胶囊（毛玻璃） */
.wx-dtp-open {
  position: absolute;
  top: 56px;
  left: 16px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  border-radius: var(--wx-radius-pill);
  background: var(--wx-glass-bg);
  backdrop-filter: blur(var(--wx-glass-blur));
  -webkit-backdrop-filter: blur(var(--wx-glass-blur));
  border: 1px solid var(--wx-border-glow);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-dtp-open svg { width: 13px; height: 13px; }
.wx-dtp-open:hover {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--wx-color-primary) 25%, transparent);
}
</style>
