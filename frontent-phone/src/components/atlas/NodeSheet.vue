<!-- 星图节点底部弹层：点按星体后展示节点详情，支持下钻子级 / 展开收起 / 定位 / 关联文档 -->
<script setup lang="ts">
import { kindName } from '@/utils/skillsAtlas'
import type { SheetChild, SheetNode } from '@/utils/skillsAtlas'
import type { MasteryState } from '@/stores/masteryStore'

const props = defineProps<{
  show: boolean
  node: SheetNode | null
  /** 子知识点最近一次费曼评估缓存（有则展示「上次评估」入口） */
  explainCache?: { total: number; passed: boolean } | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'drill', child: SheetChild): void
  (e: 'toggleExpand', node: SheetNode): void
  (e: 'locate', id: string): void
  (e: 'openDocs', kpName: string): void
  (e: 'explain'): void
  (e: 'viewCache'): void
  (e: 'learn'): void
}>()

const masteryName: Record<MasteryState, string> = {
  unlearned: '未学',
  learning: '在学',
  mastered: '已掌握'
}

function onUpdateShow(v: boolean) {
  if (!v) emit('close')
}
</script>

<template>
  <van-popup
    :show="props.show && !!props.node"
    position="bottom"
    round
    class="ns-popup"
    @update:show="onUpdateShow"
  >
    <div v-if="node" class="ns">
      <!-- 头部：种类徽标 + 掌握态 + 名称 + 路径 + 定位 -->
      <header class="ns-head">
        <div class="ns-head-main">
          <div class="ns-badges">
            <span class="ns-badge kind" :data-kind="node.kind">{{ kindName[node.kind] }}</span>
            <span v-if="node.mastery" class="ns-badge mastery" :data-mastery="node.mastery">
              {{ masteryName[node.mastery] }}
            </span>
            <span v-if="node.masteryCount" class="ns-badge count">{{ node.masteryCount }}</span>
          </div>
          <div class="ns-title">{{ node.label }}</div>
          <div class="ns-path">{{ node.path || '星图中心 · 问星' }}</div>
        </div>
        <button class="ns-locate" aria-label="在星图上定位" @click="emit('locate', node.id)">◎</button>
      </header>

      <!-- 中心节点：全局概览 -->
      <div v-if="node.kind === 'root'" class="ns-tip">
        点按任意星体查看详情；单指拖拽平移，双指捏合缩放。
      </div>

      <!-- 知识点元信息（适用专业 / 证据载体 / 标签） -->
      <div v-if="node.kp" class="ns-meta">
        <div class="ns-meta-row">
          <span class="ns-meta-label">适用专业</span>
          <div class="ns-chips">
            <span v-for="t in node.kp.zy" :key="`zy-${t}`" class="ns-chip">{{ t }}</span>
            <span v-if="!node.kp.zy.length" class="ns-chip empty">未标注</span>
          </div>
        </div>
        <div class="ns-meta-row">
          <span class="ns-meta-label">证据载体</span>
          <div class="ns-chips">
            <span v-for="t in node.kp.zj" :key="`zj-${t}`" class="ns-chip">{{ t }}</span>
            <span v-if="!node.kp.zj.length" class="ns-chip empty">未标注</span>
          </div>
        </div>
        <div class="ns-meta-row">
          <span class="ns-meta-label">标签</span>
          <div class="ns-chips">
            <span v-if="node.kp.tags?.qy" class="ns-chip tag">迁移性 · {{ node.kp.tags.qy }}</span>
            <span v-if="node.kp.tags?.ai" class="ns-chip tag">AI 风险 · {{ node.kp.tags.ai }}</span>
            <span v-if="node.kp.tags?.hb" class="ns-chip tag">半衰期 · {{ node.kp.tags.hb }}</span>
            <span v-if="node.kp.tags?.zz" class="ns-chip tag zz">执照门槛</span>
            <span v-if="!node.kp.tags" class="ns-chip empty">未标注</span>
          </div>
        </div>
      </div>

      <!-- 展开收起（技能类 / 族 / 项） -->
      <button
        v-if="node.expandable && node.childCount"
        class="ns-expand"
        @click="emit('toggleExpand', node)"
      >
        {{ node.open ? '收起子级' : `在星图展开子级（${node.childCount}）` }}
      </button>

      <!-- 子级列表（点击下钻一层） -->
      <div v-if="node.children.length" class="ns-children">
        <div class="ns-section-title">{{ node.kind === 'kp' ? '子知识点' : '下级星体' }}</div>
        <button
          v-for="c in node.children"
          :key="c.id"
          class="ns-child"
          @click="emit('drill', c)"
        >
          <i
            class="ns-child-dot"
            :data-mastery="c.mastery ?? (c.masteryCount ? 'progress' : 'plain')"
          ></i>
          <span class="ns-child-label">{{ c.label }}</span>
          <span v-if="c.masteryCount" class="ns-child-count">{{ c.masteryCount }}</span>
          <span v-if="c.mastery" class="ns-child-state" :data-mastery="c.mastery">
            {{ masteryName[c.mastery] }}
          </span>
          <span class="ns-child-arrow">›</span>
        </button>
      </div>

      <!-- 子知识点叶子：细目条目 -->
      <div v-if="node.zk && node.zk.xm.length" class="ns-xm">
        <div class="ns-section-title">细目 · 条目（{{ node.zk.xm.length }} 个细目）</div>
        <div v-for="(xm, i) in node.zk.xm" :key="xm.n" class="ns-xm-item">
          <div class="ns-xm-head">
            <span class="ns-xm-idx">{{ i + 1 }}</span>
            <span class="ns-xm-name">{{ xm.n }}</span>
            <span class="ns-xm-count">{{ xm.tm.length }}</span>
          </div>
          <ul class="ns-tm-list">
            <li v-for="t in xm.tm" :key="t" class="ns-tm">{{ t }}</li>
          </ul>
        </div>
      </div>

      <!-- 子知识点：费曼讲解 / 上次评估（对齐桌面端技能详情） -->
      <div v-if="node.kind === 'zk'" class="ns-leaf-actions">
        <button class="ns-action primary" @click="emit('explain')">✦ 费曼讲解</button>
        <button v-if="explainCache" class="ns-action" @click="emit('viewCache')">
          上次评估 {{ explainCache.total }} 分{{ explainCache.passed ? ' · 已通过' : '' }}
        </button>
      </div>

      <!-- 操作：关联文档 / 去学习 -->
      <div v-if="node.kind === 'kp' || node.kind === 'zk'" class="ns-actions">
        <button class="ns-action" @click="emit('openDocs', node.kind === 'zk' && node.zk ? node.zk.n : node.label)">
          ❋ 关联文档
        </button>
        <button class="ns-action primary" @click="emit('learn')">✦ 去学习</button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.ns-popup {
  max-height: 72vh;
  border-radius: 16px 16px 0 0;
}
.ns {
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  max-height: 72vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.ns-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.ns-head-main {
  flex: 1;
  min-width: 0;
}
.ns-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.ns-badge {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  white-space: nowrap;
}
.ns-badge.kind {
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.25);
}
.ns-badge.kind[data-kind='root'] { color: #8b5cf6; background: rgba(139, 92, 246, 0.1); border-color: rgba(139, 92, 246, 0.25); }
.ns-badge.kind[data-kind='zk'] { color: #0ea5e9; background: rgba(14, 165, 233, 0.08); border-color: rgba(14, 165, 233, 0.25); }
.ns-badge.mastery {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.1);
  border: 1px solid rgba(148, 163, 184, 0.25);
}
.ns-badge.mastery[data-mastery='learning'] {
  color: #6366f1;
  background: rgba(129, 140, 248, 0.12);
  border-color: rgba(129, 140, 248, 0.35);
}
.ns-badge.mastery[data-mastery='mastered'] {
  color: #16a34a;
  background: rgba(74, 222, 128, 0.12);
  border-color: rgba(74, 222, 128, 0.4);
}
.ns-badge.count {
  color: #6366f1;
  background: rgba(129, 140, 248, 0.12);
}
.ns-title {
  font-size: 17px;
  font-weight: 600;
  color: #1f2937;
  line-height: 1.4;
  word-break: break-all;
}
.ns-path {
  margin-top: 3px;
  font-size: 11.5px;
  color: #9ca3af;
  line-height: 1.5;
}
.ns-locate {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  color: #6366f1;
  font-size: 15px;
  line-height: 1;
}
.ns-tip {
  padding: 10px 12px;
  border-radius: 10px;
  background: #f5f6fa;
  font-size: 12.5px;
  color: #6b7280;
  line-height: 1.6;
}
.ns-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.ns-meta-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.ns-meta-label {
  flex-shrink: 0;
  width: 60px;
  padding-top: 3px;
  font-size: 12px;
  color: #9ca3af;
}
.ns-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ns-chip {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  color: #4b5563;
  background: #f5f6fa;
  border: 1px solid #e5e7eb;
}
.ns-chip.tag {
  color: #6366f1;
  background: rgba(129, 140, 248, 0.1);
  border-color: rgba(129, 140, 248, 0.25);
}
.ns-chip.tag.zz {
  color: #ef4444;
  background: rgba(248, 113, 113, 0.1);
  border-color: rgba(248, 113, 113, 0.3);
}
.ns-chip.empty {
  color: #c0c4cc;
  border-style: dashed;
}
.ns-expand {
  display: block;
  width: 100%;
  padding: 9px 0;
  margin-bottom: 12px;
  border-radius: 10px;
  border: 1px solid rgba(129, 140, 248, 0.35);
  background: rgba(129, 140, 248, 0.08);
  color: #6366f1;
  font-size: 13px;
  font-weight: 500;
}
.ns-section-title {
  font-size: 11.5px;
  color: #9ca3af;
  margin-bottom: 8px;
}
.ns-children {
  margin-bottom: 14px;
}
.ns-child {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid #f0f1f5;
  background: #fafbfc;
  text-align: left;
}
.ns-child:active {
  background: rgba(129, 140, 248, 0.08);
}
.ns-child + .ns-child {
  margin-top: 6px;
}
.ns-child-dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #c7d2fe;
  border: 1px solid rgba(255, 255, 255, 0.4);
}
.ns-child-dot[data-mastery='learning'] {
  background: rgba(129, 140, 248, 0.2);
  border: 2px solid #818cf8;
}
.ns-child-dot[data-mastery='mastered'] {
  background: #4ade80;
  border-color: #bbf7d0;
}
.ns-child-dot[data-mastery='progress'] {
  background: #6366f1;
}
.ns-child-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #374151;
  line-height: 1.4;
  word-break: break-all;
}
.ns-child-count {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  color: #6366f1;
  background: rgba(129, 140, 248, 0.12);
}
.ns-child-state {
  flex-shrink: 0;
  font-size: 10.5px;
  color: #94a3b8;
}
.ns-child-state[data-mastery='learning'] { color: #6366f1; }
.ns-child-state[data-mastery='mastered'] { color: #16a34a; }
.ns-child-arrow {
  flex-shrink: 0;
  color: #c0c4cc;
  font-size: 15px;
}
.ns-xm {
  margin-bottom: 14px;
}
.ns-xm-item + .ns-xm-item {
  margin-top: 10px;
}
.ns-xm-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ns-xm-idx {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #6366f1;
  background: rgba(129, 140, 248, 0.14);
}
.ns-xm-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}
.ns-xm-count {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  color: #9ca3af;
  background: #f5f6fa;
}
.ns-tm-list {
  margin: 6px 0 0 26px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  list-style: none;
}
.ns-tm {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}
.ns-tm::before {
  content: '·';
  margin-right: 6px;
  color: #818cf8;
}
.ns-actions {
  display: flex;
  gap: 10px;
}
.ns-leaf-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}
.ns-leaf-actions .ns-action.primary {
  background: linear-gradient(135deg, #818cf8, #6366f1);
  color: #fff;
}
.ns-action {
  flex: 1;
  padding: 10px 0;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  color: #4b5563;
  font-size: 13px;
  font-weight: 500;
}
.ns-action.primary {
  border: none;
  background: linear-gradient(135deg, #818cf8, #6366f1);
  color: #fff;
}
</style>
