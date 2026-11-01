<script lang="ts">
// 目录树节点：EPUB 章节树 / MD 标题树 / TXT 章列表统一映射为该结构
export interface TocNode {
  id: string
  title: string
  children?: TocNode[]
}
</script>

<script setup lang="ts">
// 书籍阅读器左侧目录树：递归渲染 TocNode；有 children 的节点可折叠（默认全展开），叶子点击 emit select
import { nextTick, reactive, watch } from 'vue'

const props = withDefaults(defineProps<{ nodes: TocNode[]; activeId?: string; depth?: number }>(), {
  activeId: '',
  depth: 0
})
const emit = defineEmits<{ select: [id: string] }>()

// 折叠态：每个递归实例管自己渲染的这一层节点
const collapsed = reactive(new Set<string>())
function toggle(id: string) {
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
}
function onPick(node: TocNode) {
  if (node.children?.length) toggle(node.id)
  // 父节点也可被选中（EPUB 章节点若有正文则切换正文）
  emit('select', node.id)
}

// 激活项滚动定位：activeId 变化后把对应条目滚进目录面板可视区（仅根实例执行，避免递归重复滚动）
watch(
  () => props.activeId,
  (id) => {
    if (!id || props.depth !== 0) return
    nextTick(() => {
      document
        .querySelector(`[data-test="reader-toc-${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  },
  { immediate: true }
)
</script>

<template>
  <ul class="wx-toc" :class="{ 'wx-toc-root': depth === 0 }" :data-test="depth === 0 ? 'reader-toc' : undefined">
    <li v-for="n in nodes" :key="n.id">
      <button
        class="wx-toc-item"
        :class="{ active: n.id === activeId }"
        :style="{ paddingLeft: `${8 + depth * 12}px` }"
        :title="n.title"
        :data-test="`reader-toc-${n.id}`"
        @click="onPick(n)"
      >
        <span
          v-if="n.children?.length"
          class="wx-toc-arrow"
          :class="{ open: !collapsed.has(n.id) }"
        >▸</span>
        <span v-else class="wx-toc-arrow wx-toc-leaf"></span>
        <span class="wx-toc-text">{{ n.title }}</span>
      </button>
      <BookTocTree
        v-if="n.children?.length && !collapsed.has(n.id)"
        :nodes="n.children"
        :active-id="activeId"
        :depth="depth + 1"
        @select="(id) => emit('select', id)"
      />
    </li>
  </ul>
</template>

<style scoped>
.wx-toc { list-style: none; margin: 0; padding: 0; }
.wx-toc-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  text-align: left;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--wx-text-secondary);
  background: transparent;
  border: none;
  border-radius: 4px;
}
.wx-toc-item:hover { background: color-mix(in srgb, var(--wx-ink) 5%, transparent); }
.wx-toc-item.active {
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
}
.wx-toc-arrow {
  flex-shrink: 0;
  width: 12px;
  font-size: 9px;
  color: var(--wx-text-muted);
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-toc-arrow.open { transform: rotate(90deg); }
.wx-toc-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
