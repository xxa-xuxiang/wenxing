<script setup lang="ts">
// 星图 · 技能目录抽屉（移动端）：族 → 项 → 知识点
// 数据源：父级传入的「甲编 · 学科内技能」结构树，不发网络请求
// - 族 / 项两级可独立收起；默认展开族、收起项
// - 点击知识点 → emit('open-kp')，由父级弹出知识点详情
// - locate prop：星图节点点击 → 展开祖先、高亮并滚动定位
import { computed, nextTick, ref, watch } from 'vue'
import type { SkillKp, SkillZu } from '@/utils/skillsAtlas'

interface LocatePayload {
  nonce: number
  zu: string
  xiang?: string
  kp?: string
}

const props = defineProps<{
  show: boolean
  zu: SkillZu[]
  locate: LocatePayload | null
}>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'open-kp', payload: { zu: string; xiang: string; kp: SkillKp }): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const list = computed(() => props.zu ?? [])
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

function zuCode(name: string): string {
  return (name.split('.')[0] ?? '').trim()
}

const highlightKey = ref('')

async function applyLocate(loc: LocatePayload) {
  const zi = list.value.findIndex((z) => z.n === loc.zu)
  if (zi < 0) return
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
  await nextTick()
  const el = panelRef.value?.querySelector(`[data-locate="${targetKey}"]`) as HTMLElement | null
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(
  () => props.locate,
  (loc) => {
    if (loc) void applyLocate(loc)
  }
)

watch(
  () => props.show,
  (v) => {
    if (v && props.locate) void applyLocate(props.locate)
  }
)

watch(
  () => list.value,
  (val) => {
    expandedKeys.value = new Set(val.map((_, zi) => zuKey(zi)))
  },
  { immediate: true }
)
</script>

<template>
  <van-popup
    :show="show"
    position="left"
    :style="{ width: '86%', height: '100%' }"
    class="dts-popup"
    @update:show="emit('update:show', $event)"
  >
    <div ref="panelRef" class="dts">
      <header class="dts-head">
        <div class="dts-head-main">
          <div class="dts-title">技能目录</div>
          <div class="dts-sub">甲编 · 学科内技能</div>
        </div>
        <div class="dts-acts">
          <button class="dts-mini" title="全部展开" @click="expandAll">⤢</button>
          <button class="dts-mini" title="全部收起" @click="collapseAll">⤡</button>
          <button class="dts-close" title="关闭" @click="emit('update:show', false)">×</button>
        </div>
      </header>

      <div class="dts-body">
        <div v-if="!list.length" class="dts-tip">技能目录为空</div>

        <template v-else>
          <section
            v-for="(z, zi) in list"
            :key="z.n"
            class="dts-cat"
            :class="{ open: expandedKeys.has(zuKey(zi)) }"
          >
            <button
              class="dts-cat-head"
              :class="{ hl: highlightKey === `locate-zu-${zi}` }"
              :data-locate="`locate-zu-${zi}`"
              @click="toggleKey(zuKey(zi))"
            >
              <span class="dts-chevron" :class="{ open: expandedKeys.has(zuKey(zi)) }">›</span>
              <span class="dts-cat-code">{{ zuCode(z.n) }}</span>
              <span class="dts-cat-title">{{ z.n }}</span>
              <span class="dts-cat-meta">{{ z.xiang.length }}</span>
            </button>

            <div v-show="expandedKeys.has(zuKey(zi))" class="dts-cat-body">
              <div
                v-for="(x, xi) in z.xiang"
                :key="`${z.n}-${xi}`"
                class="dts-domain"
              >
                <button
                  class="dts-domain-head"
                  :class="{ hl: highlightKey === `locate-xiang-${zi}-${xi}` }"
                  :data-locate="`locate-xiang-${zi}-${xi}`"
                  @click="toggleKey(xiangKey(zi, xi))"
                >
                  <span class="dts-chevron sm" :class="{ open: expandedKeys.has(xiangKey(zi, xi)) }">›</span>
                  <span class="dts-domain-name">{{ x.n }}</span>
                  <span class="dts-domain-count">{{ x.kp.length }}</span>
                </button>

                <div v-show="expandedKeys.has(xiangKey(zi, xi))" class="dts-docs">
                  <button
                    v-for="(k, ki) in x.kp"
                    :key="k.n"
                    class="dts-doc"
                    :class="{ hl: highlightKey === `locate-kp-${zi}-${xi}-${ki}` }"
                    :data-locate="`locate-kp-${zi}-${xi}-${ki}`"
                    @click="emit('open-kp', { zu: z.n, xiang: x.n, kp: k })"
                  >
                    <span class="dts-kp-dot"></span>
                    <span>{{ k.n }}</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </template>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.dts-popup {
  background: color-mix(in srgb, var(--wx-bg-deep) 96%, transparent);
}
.dts {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--wx-text-primary);
}
.dts-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(14px + env(safe-area-inset-top)) 14px 12px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.dts-head-main { flex: 1; min-width: 0; }
.dts-title {
  font-size: 15px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
}
.dts-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
.dts-acts { display: flex; align-items: center; gap: 6px; }
.dts-mini,
.dts-close {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-secondary);
  font-size: 14px;
}
.dts-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 10px 12px calc(20px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dts-tip { padding: 20px 8px; text-align: center; font-size: 12px; color: var(--wx-text-tertiary); }
.dts-cat { border-radius: var(--wx-radius-md); border: 1px solid transparent; }
.dts-cat.open {
  border-color: var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.dts-cat-head,
.dts-domain-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  border-radius: var(--wx-radius-md);
  padding: 9px 8px;
  background: transparent;
  color: inherit;
}
.dts-chevron {
  width: 12px;
  flex-shrink: 0;
  color: var(--wx-text-muted);
  transition: transform 0.25s var(--wx-ease-in-out-soft);
}
.dts-chevron.sm { width: 10px; }
.dts-chevron.open { transform: rotate(90deg); }
.dts-cat-code { font-size: 10px; font-family: var(--wx-font-mono); color: var(--wx-color-primary-soft); }
.dts-cat-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dts-cat-meta {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  color: var(--wx-color-primary-soft);
}
.dts-cat-body { padding: 2px 8px 8px 14px; display: flex; flex-direction: column; gap: 4px; }
.dts-domain { border-left: 1px solid var(--wx-border-soft); padding-left: 6px; }
.dts-domain-head { padding: 7px 6px; }
.dts-domain-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--wx-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dts-domain-count {
  flex-shrink: 0;
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  color: var(--wx-text-tertiary);
}
.dts-docs { display: flex; flex-direction: column; gap: 4px; padding: 2px 0 4px 14px; }
.dts-doc {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  color: var(--wx-text-secondary);
  font-size: 12px;
  text-align: left;
}
.dts-doc span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dts-kp-dot {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--wx-color-primary-soft);
  opacity: 0.75;
}
.dts-cat-head.hl,
.dts-domain-head.hl,
.dts-doc.hl {
  border-color: var(--wx-color-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 18%, transparent);
  box-shadow: 0 0 0 1px var(--wx-color-primary) inset;
}
</style>
