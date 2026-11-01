<script lang="ts">
// 目录树节点：EPUB 章节树 / MD 标题树 / TXT 章列表统一映射为该结构
export interface TocNode {
  id: string
  title: string
  children?: TocNode[]
}
</script>

<script setup lang="ts">
// 移动端书籍目录（自桌面端移植）：递归渲染 TocNode，有 children 的节点可折叠，叶子点击 emit select
// 移动端适配：更大的点按区域、浅色 Vant 风格、激活项自动滚入可视区
import { nextTick, reactive, watch } from 'vue'

const props = withDefaults(defineProps<{ nodes: TocNode[]; activeId?: string; depth?: number }>(), {
  activeId: '',
  depth: 0
})
const emit = defineEmits<{ select: [id: string] }>()

// 折叠态：每个递归实例管自己渲染的这一层节点（默认展开）
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

// 激活项滚动定位：activeId 变化后把对应条目滚进目录面板可视区（仅根实例执行）
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
  <ul class="toc" :class="{ 'toc-root': depth === 0 }" :data-test="depth === 0 ? 'reader-toc' : undefined">
    <li v-for="n in nodes" :key="n.id">
      <button
        class="toc-item"
        :class="{ active: n.id === activeId }"
        :style="{ paddingLeft: `${10 + depth * 14}px` }"
        :data-test="`reader-toc-${n.id}`"
        @click="onPick(n)"
      >
        <span v-if="n.children?.length" class="toc-arrow" :class="{ open: !collapsed.has(n.id) }">▸</span>
        <span v-else class="toc-arrow toc-leaf"></span>
        <span class="toc-text">{{ n.title }}</span>
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
.toc {
  list-style: none;
  margin: 0;
  padding: 0;
}

.toc-item {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 5px;
  text-align: left;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  color: #646566;
  background: transparent;
  border: none;
  border-radius: 8px;
}

.toc-item:active {
  background: #f2f3f5;
}

.toc-item.active {
  color: #1989fa;
  font-weight: 500;
  background: rgba(25, 137, 250, 0.1);
}

.toc-arrow {
  flex-shrink: 0;
  width: 14px;
  font-size: 10px;
  color: #c8c9cc;
  transition: transform 0.16s ease;
}

.toc-arrow.open {
  transform: rotate(90deg);
}

.toc-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
