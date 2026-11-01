<!-- 移动端发布帖子：标题 + 行业 + Notion 式块编辑正文 + 附件图片 + 草稿自动保存 + 发布确认 -->
<!-- 块类型/块操作使用 van-action-sheet，AI 为 85% 高底部抽屉，图片上传沿用 /api/community/upload -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import type { ActionSheetAction, UploaderAfterRead, UploaderFileListItem } from 'vant'
import { apiUrl } from '@/services/apiBase'
import { useAuthStore } from '@/stores/authStore'
import { useCommunityStore } from '@/stores/communityStore'
import { DEFAULT_INDUSTRY_ID, industryById, industryName, visibleIndustries } from '@/data/communityIndustries'
import { createPost, uploadImage } from '@/services/communityService'
import { renderMarkdown } from '@/utils/markdown'
import { storage } from '@/utils/storage'
import {
  BLOCK_DEFS,
  blocksCharCount,
  blocksImageUrls,
  blocksToMarkdown,
  defaultDoc,
  loadSubPage,
  markdownToBlocks,
  newBlock,
  saveSubPage,
  type BlockType,
  type EdBlock,
  type SubPageDoc
} from '@/components/community/blocks'
import BlockEditorCore from '@/components/community/BlockEditorCore.vue'
import AiPanel from '@/components/community/AiPanel.vue'

const router = useRouter()
const auth = useAuthStore()
const community = useCommunityStore()

// 未登录不允许进入编辑页（路由守卫之外的双保险）
onMounted(() => {
  if (!auth.user) router.replace('/auth')
})

// ===== 发布范围：默认继承当前行业（全站推荐流非真实行业，回退默认行业） =====
const industryId = ref(
  industryById(community.activeIndustryId) ? community.activeIndustryId : DEFAULT_INDUSTRY_ID
)
const industryColumns = computed(() => visibleIndustries().map((i) => ({ text: i.name, value: i.id })))
const showIndustry = ref(false)

function onIndustryConfirm({ selectedValues }: { selectedValues: (string | number)[] }): void {
  industryId.value = String(selectedValues[0] ?? DEFAULT_INDUSTRY_ID)
  showIndustry.value = false
}

// ===== 文档数据（块树，就地变更 + 深度监听自动保存） =====
const title = ref('')
const blocks = ref<EdBlock[]>(defaultDoc())
const editorRef = ref<InstanceType<typeof BlockEditorCore> | null>(null)
const aiRef = ref<InstanceType<typeof AiPanel> | null>(null)

const docMarkdown = computed(() => blocksToMarkdown(blocks.value))
const charCount = computed(() => blocksCharCount(blocks.value))

// ===== 附件图片（van-uploader → dataURL → /api/community/upload → /uploads/ 相对地址） =====
const fileList = ref<UploaderFileListItem[]>([])
const remoteUrls = new WeakMap<UploaderFileListItem, string>()
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function imagesOf(): string[] {
  return fileList.value
    .map((f) => remoteUrls.get(f))
    .filter((u): u is string => Boolean(u))
}

const afterRead: UploaderAfterRead = async (items) => {
  const list = Array.isArray(items) ? items : [items]
  for (const item of list) {
    item.status = 'uploading'
    item.message = '上传中'
    try {
      const dataUrl = item.content || (item.file ? await fileToDataUrl(item.file) : '')
      // 后端仅接受 data:image/(jpeg|png|webp|gif);base64 格式
      if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(dataUrl)) {
        throw new Error('仅支持 jpg/png/webp/gif 格式图片')
      }
      const { url } = await uploadImage(dataUrl)
      remoteUrls.set(item, url)
      item.url = apiUrl(url)
      item.status = 'done'
      item.message = undefined
      markDirty()
    } catch (e) {
      item.status = 'failed'
      item.message = '上传失败'
      showToast((e as Error).message || '图片上传失败')
    }
  }
}

function onOversize(): void {
  showToast('单张图片不能超过 5MB')
}

function removeImage(): void {
  markDirty()
}

// ===== 状态提示 =====
function onNotify(text: string): void {
  if (text) showToast(text)
}

// ===== 草稿自动保存（块 JSON v2，旧版纯文本草稿自动迁移） =====
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved'
interface DraftShape {
  v?: number
  title?: string
  content?: string
  blocks?: EdBlock[]
  images?: string[]
  updatedAt?: number
}

const saveState = ref<SaveState>('idle')
const savedAt = ref('')
let saveTimer: number | undefined

function draftKey(id: string): string {
  return `community:draft:${id}`
}

function flushDraft(): void {
  storage.set(draftKey(industryId.value), {
    v: 2,
    title: title.value,
    blocks: blocks.value,
    images: imagesOf(),
    updatedAt: Date.now()
  })
  savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  saveState.value = 'saved'
}

function markDirty(): void {
  if (saveState.value !== 'saving') saveState.value = 'dirty'
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveState.value = 'saving'
    saveTimer = window.setTimeout(flushDraft, 300)
  }, 900)
}

const saveLabel = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'dirty') return '未保存'
  if (saveState.value === 'saved') return savedAt.value ? `已保存 ${savedAt.value}` : '已保存'
  return '自动保存'
})

// 关闭/刷新前：未保存内容强制落盘
function onBeforeUnload(): void {
  if (saveState.value === 'dirty' || saveState.value === 'saving') {
    window.clearTimeout(saveTimer)
    flushDraft()
  }
}

// ===== 键盘弹出检测：底栏随可视视口上移，始终贴住键盘上沿 =====
const keyboardInset = ref(0)
let baseHeight = 0

function onViewportResize(): void {
  const vv = window.visualViewport
  const active = document.activeElement as HTMLElement | null
  if (!vv) {
    // 老 WebView 无 visualViewport：退化为 layout 高度差
    const fallback = Math.round(baseHeight - window.innerHeight)
    keyboardInset.value = fallback > 120 ? fallback : 0
    return
  }
  // iOS 键盘弹出时 innerHeight 不变、visualViewport.height 变小；offsetTop 会随页面滚动变化，故不参与计算
  const inset = Math.round(baseHeight - vv.height)
  const editing = Boolean(
    active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
  )
  keyboardInset.value = editing && inset > 120 ? inset : 0
}

/** 横竖屏切换后布局高度变化，重取基线并复位 */
function onOrientationChange(): void {
  window.setTimeout(() => {
    baseHeight = window.innerHeight
    keyboardInset.value = 0
  }, 240)
}

const toolbarStyle = computed(() => ({
  bottom: keyboardInset.value > 0 ? `${keyboardInset.value}px` : '0px'
}))

// ===== 底部块工具栏：插入块类型（van-action-sheet） =====
const showTypes = ref(false)

/** 底部弹层打开前收起软键盘，否则弹层会被键盘盖住 */
function blurEditor(): void {
  const el = document.activeElement as HTMLElement | null
  if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.blur()
}

function openTypes(): void {
  blurEditor()
  showTypes.value = true
}

const blockTypeActions: ActionSheetAction[] = BLOCK_DEFS.map((d) => ({
  name: d.label,
  subname: d.desc
}))

function onBlockTypeSelect(action: ActionSheetAction): void {
  const d = BLOCK_DEFS.find((x) => x.label === action.name)
  if (!d) return
  showTypes.value = false
  editorRef.value?.insertNewBlock(d.type as BlockType)
}

// ===== 预览（块树 → Markdown → 渲染） =====
const previewOn = ref(false)
const previewHtml = computed(() => renderMarkdown(docMarkdown.value))

function togglePreview(): void {
  previewOn.value = !previewOn.value
  if (previewOn.value) (document.activeElement as HTMLElement | null)?.blur()
}

// ===== AI 弹层 =====
const showAi = ref(false)

function openAi(): void {
  blurEditor()
  showAi.value = true
}

function onEditorAi(text: string): void {
  blurEditor()
  showAi.value = true
  void nextTick(() => aiRef.value?.setSelection(text))
}

function insertFromAi(md: string): void {
  const parsed = markdownToBlocks(md)
  blocks.value.push(...parsed)
  markDirty()
  showToast('AI 内容已插入文档末尾')
}

// ===== 页面引用：子页面全屏 overlay / 帖子跳转 =====
const subPage = ref<SubPageDoc | null>(null)

function openPageRef(pageId: string, pageTitle: string): void {
  if (pageId.startsWith('sp_')) {
    const doc = loadSubPage(pageId) ?? {
      id: pageId,
      title: pageTitle || '无标题子页面',
      blocks: [newBlock('p', '')],
      updatedAt: Date.now()
    }
    subPage.value = doc
  } else {
    void router.push(`/community/${pageId}`)
  }
}

// 子页面内容变化自动落盘
watch(
  () => subPage.value?.blocks,
  () => {
    const sp = subPage.value
    if (!sp) return
    sp.updatedAt = Date.now()
    saveSubPage(sp)
  },
  { deep: true }
)

function onSubTitleInput(): void {
  const sp = subPage.value
  if (!sp) return
  sp.updatedAt = Date.now()
  saveSubPage(sp)
}

function closeSubPage(): void {
  const sp = subPage.value
  if (sp) saveSubPage(sp)
  subPage.value = null
}

// 主文档块就地变更 → 触发草稿自动保存（块编辑器不经 v-model，全靠深度监听）
watch(blocks, markDirty, { deep: true })
watch(title, markDirty)
watch(fileList, markDirty, { deep: true })

// ===== 发布（重要写操作：先确认框） =====
const submitting = ref(false)

async function onSubmit(): Promise<void> {
  if (submitting.value) return
  if (!industryById(industryId.value)) {
    showToast('当前行业无效，请重新选择行业')
    return
  }
  const t = title.value.trim()
  if (!t) {
    showToast('请输入标题（1-60 字）')
    return
  }
  if (t.length > 60) {
    showToast('标题需为 1-60 字')
    return
  }
  const md = blocksToMarkdown(blocks.value)
  if (!md.trim()) {
    showToast('正文不能为空，写点什么再发布吧')
    return
  }
  if (md.length > 20000) {
    showToast('正文不能超过 20000 字')
    return
  }
  if (fileList.value.some((f) => f.status === 'uploading')) {
    showToast('图片上传中，请稍候')
    return
  }
  if (fileList.value.some((f) => f.status === 'failed')) {
    showToast('请先删除上传失败的图片')
    return
  }
  const attachImgs = imagesOf()
  const allImgs = [...new Set([...attachImgs, ...blocksImageUrls(blocks.value)])]
  if (allImgs.length > 9) {
    showToast(`图片共 ${allImgs.length} 张（附件 + 文内插图），最多 9 张，请删减后再发布`)
    return
  }

  const confirmed = await showConfirmDialog({
    title: '确认发布',
    message: `将发布到「${industryName(industryId.value)}」，确定提交吗？`
  }).then(() => true).catch(() => false)
  if (!confirmed) return

  submitting.value = true
  try {
    const saved = await createPost({
      industryId: industryId.value,
      title: t,
      content: md,
      tags: [],
      images: allImgs
    })
    window.clearTimeout(saveTimer)
    storage.remove(draftKey(industryId.value))
    void community.loadCounts()
    showToast('发布成功')
    router.replace(`/community/${saved.id}`)
  } catch (e) {
    showToast((e as Error).message || '提交失败，请重试')
  } finally {
    submitting.value = false
  }
}

// ===== 初始化：恢复本行业草稿并聚焦首块 =====
function restoreDraft(): void {
  const d = storage.get<DraftShape | null>(draftKey(industryId.value), null)
  if (d && (d.blocks?.length || d.content || d.title)) {
    title.value = d.title ?? ''
    blocks.value =
      Array.isArray(d.blocks) && d.blocks.length
        ? d.blocks
        : d.content
          ? markdownToBlocks(d.content)
          : defaultDoc()
    fileList.value = (d.images ?? []).map((url) => {
      const item: UploaderFileListItem = { url: apiUrl(url), status: 'done' }
      remoteUrls.set(item, url)
      return item
    })
    saveState.value = 'saved'
    savedAt.value = '已恢复'
    showToast('已恢复本行业未发布的草稿')
    return
  }
  void nextTick(() => {
    const first = blocks.value[0]
    if (first) editorRef.value?.focusBlock(first.id, 'end')
  })
}

onMounted(() => {
  baseHeight = window.innerHeight
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('resize', onViewportResize)
  window.visualViewport?.addEventListener('resize', onViewportResize)
  window.addEventListener('orientationchange', onOrientationChange)
  restoreDraft()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('resize', onViewportResize)
  window.visualViewport?.removeEventListener('resize', onViewportResize)
  window.removeEventListener('orientationchange', onOrientationChange)
  window.clearTimeout(saveTimer)
  if (saveState.value === 'dirty' || saveState.value === 'saving') flushDraft()
})
</script>

<template>
  <div class="editor-page">
    <van-nav-bar fixed placeholder left-arrow title="发布帖子" @click-left="router.back()">
      <template #right>
        <span class="nav-publish" :class="{ busy: submitting }" @click="onSubmit">
          {{ submitting ? '发布中…' : '发布' }}
        </span>
      </template>
    </van-nav-bar>

    <div class="editor-body">
      <!-- 标题 / 行业 -->
      <van-cell-group inset class="group">
        <van-field
          v-model="title"
          label="标题"
          placeholder="一句话说清主题（1-60 字）"
          maxlength="60"
          show-word-limit
        />
        <van-field
          :model-value="industryName(industryId)"
          label="发布到"
          placeholder="选择行业"
          readonly
          is-link
          @click="showIndustry = true"
        />
      </van-cell-group>

      <!-- 正文：Notion 式块编辑器（局部浅色令牌） -->
      <div class="editor-card">
        <div class="editor-card-head">
          <span>正文</span>
          <span class="editor-tip">/ 块菜单 · 长按块/⋮ 块操作 · 选中文字格式化</span>
        </div>
        <div v-show="!previewOn" class="wx-light">
          <BlockEditorCore
            ref="editorRef"
            :blocks="blocks"
            placeholder="按下 / 呼出块菜单，@ 引用日期与名片，[[ 链接页面…"
            @open-page="openPageRef"
            @notify="onNotify"
            @ai="onEditorAi"
          />
        </div>
        <div v-if="previewOn" class="preview">
          <div v-if="!docMarkdown.trim()" class="preview-empty">暂无内容</div>
          <div v-else class="preview-md" v-html="previewHtml"></div>
        </div>
      </div>

      <!-- 附件图片（≤9 张，真实上传到后端 /uploads/community/） -->
      <van-cell-group inset class="group">
        <van-field label="图片">
          <template #input>
            <van-uploader
              v-model:file-list="fileList"
              multiple
              :max-count="9"
              :max-size="MAX_IMAGE_SIZE"
              :after-read="afterRead"
              @oversize="onOversize"
              @delete="removeImage"
            />
          </template>
        </van-field>
        <div class="upload-hint">最多 9 张 · 单张 ≤5MB · 第一张将作为封面</div>
      </van-cell-group>
    </div>

    <!-- 底部块工具栏（固定底部，键盘弹出时随可视视口上移；安全区适配） -->
    <footer class="block-bar" :class="{ kb: keyboardInset > 0 }" :style="toolbarStyle">
      <button class="bb-btn" @click="openTypes"><span class="bb-ico">＋</span>块</button>
      <button class="bb-btn" @click="openAi"><span class="bb-ico spark">✦</span>AI</button>
      <button class="bb-btn" :class="{ on: previewOn }" @click="togglePreview">
        <span class="bb-ico">◧</span>{{ previewOn ? '编辑' : '预览' }}
      </button>
      <span class="bb-stat">{{ charCount }} 字</span>
      <button class="bb-save" :class="saveState" @click="flushDraft">{{ saveLabel }}</button>
    </footer>

    <!-- 插入块类型（van-action-sheet） -->
    <van-action-sheet
      v-model:show="showTypes"
      :actions="blockTypeActions"
      title="插入块"
      cancel-text="取消"
      round
      safe-area-inset-bottom
      @select="onBlockTypeSelect"
    />

    <!-- 问星 AI：底部抽屉（85% 屏高） -->
    <van-popup v-model:show="showAi" position="bottom" round :style="{ height: '85vh' }">
      <div class="ai-sheet">
        <AiPanel ref="aiRef" :doc-title="title" :doc-text="docMarkdown" @insert="insertFromAi" />
      </div>
    </van-popup>

    <!-- 行业选择 Picker -->
    <van-popup v-model:show="showIndustry" position="bottom" round>
      <van-picker
        :columns="industryColumns"
        :model-value="[industryId]"
        title="选择行业"
        @confirm="onIndustryConfirm"
        @cancel="showIndustry = false"
      />
    </van-popup>

    <!-- 子页面全屏编辑 overlay -->
    <div v-if="subPage" class="sub-mask">
      <div class="sub-page">
        <div class="sub-head">
          <button class="sub-back" @click="closeSubPage">‹</button>
          <span class="sub-badge">子页面</span>
          <input
            v-model="subPage.title"
            class="sub-title"
            type="text"
            maxlength="60"
            placeholder="子页面标题"
            @input="onSubTitleInput"
          />
          <button class="sub-done" @click="closeSubPage">完成</button>
        </div>
        <div class="sub-body wx-light">
          <BlockEditorCore
            :blocks="subPage.blocks"
            placeholder="子页面内容，同样支持 / 块菜单与 [[ 链接…"
            @open-page="openPageRef"
            @notify="onNotify"
            @ai="onEditorAi"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-page {
  min-height: 100vh;
  background: #f7f8fa;
  padding-bottom: calc(64px + env(safe-area-inset-bottom));
}

.nav-publish {
  color: #1989fa;
  font-size: 15px;
  font-weight: 600;
  padding: 4px 6px;
}
.nav-publish.busy { color: #969799; }

.editor-body {
  padding: 12px 0 16px;
}

.group {
  margin-bottom: 12px;
}

.editor-card {
  margin: 0 16px 12px;
  padding: 10px 10px 14px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  overflow: visible;
}
.editor-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 2px 8px;
  font-size: 13px;
  font-weight: 600;
  color: #323233;
}
.editor-tip {
  font-size: 10.5px;
  font-weight: 400;
  color: #c8c9cc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 编辑器局部浅色令牌（wx-* 只作用于块编辑区） */
.wx-light {
  --wx-color-primary: #1989fa;
  --wx-color-primary-strong: #0570db;
  --wx-color-primary-soft: #1989fa;
  --wx-color-yanqing: #07c160;
  --wx-color-amber: #ee9900;
  --wx-color-vermilion: #ee0a24;
  --wx-color-zixia: #7c4dff;
  --wx-color-jade: #07c160;
  --wx-bg-deep: #ffffff;
  --wx-bg-deep-2: #f7f8fa;
  --wx-bg-mid: #f2f3f5;
  --wx-ink: #323233;
  --wx-text-primary: #323233;
  --wx-text-secondary: #646566;
  --wx-text-tertiary: #969799;
  --wx-text-muted: #c8c9cc;
  --wx-text-on-accent: #ffffff;
  --wx-border-soft: #ebedf0;
  --wx-border-glow: rgba(25, 137, 250, 0.35);
  --wx-gradient-primary: linear-gradient(135deg, #1989fa 0%, #0570db 100%);
  --wx-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);
  --wx-shadow-md: 0 6px 18px rgba(0, 0, 0, 0.1);
  --wx-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.14);
  --wx-font-serif: 'PingFang SC', 'Microsoft YaHei', serif;
  --wx-font-mono: 'JetBrains Mono', 'Cascadia Code', monospace;
  --wx-radius-sm: 6px;
  --wx-radius-md: 10px;
  --wx-radius-lg: 14px;
  --wx-radius-pill: 999px;
  --wx-duration-fast: 120ms;
  --wx-ease-out-soft: ease;
}

.preview {
  padding: 4px 2px 8px;
}
.preview-empty {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: #969799;
}
.preview-md {
  font-size: 15px;
  line-height: 1.85;
  color: #323233;
  word-break: break-word;
}
.preview-md :deep(h1),
.preview-md :deep(h2),
.preview-md :deep(h3),
.preview-md :deep(h4) {
  color: #323233;
  font-weight: 600;
  line-height: 1.4;
}
.preview-md :deep(h1) { font-size: 21px; margin: 16px 0 10px; }
.preview-md :deep(h2) { font-size: 18px; margin: 14px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #ebedf0; }
.preview-md :deep(h3) { font-size: 16px; margin: 12px 0 6px; }
.preview-md :deep(p) { margin: 8px 0; }
.preview-md :deep(ul),
.preview-md :deep(ol) { margin: 8px 0; padding-left: 22px; }
.preview-md :deep(a) { color: #1989fa; }
.preview-md :deep(code) {
  font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
  font-size: 13px;
  padding: 1px 5px;
  border-radius: 5px;
  background: #f2f3f5;
  color: #323233;
}
.preview-md :deep(.wx-code-block) {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f2f3f5;
  overflow-x: auto;
}
.preview-md :deep(.wx-code-block code) { background: none; padding: 0; }
.preview-md :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid #1989fa;
  background: #eef6ff;
  color: #646566;
}
.preview-md :deep(.wx-md-hr) { margin: 16px 0; border: none; border-top: 1px solid #ebedf0; }
.preview-md :deep(.wx-md-table) { width: 100%; margin: 10px 0; border-collapse: collapse; font-size: 13px; }
.preview-md :deep(.wx-md-table th),
.preview-md :deep(.wx-md-table td) { padding: 6px 8px; border: 1px solid #ebedf0; text-align: left; }
.preview-md :deep(.wx-md-table th) { background: #f7f8fa; color: #323233; }
.preview-md :deep(img) { max-width: 100%; border-radius: 8px; }
.preview-md :deep(.wx-mark) { background: #ffe7a3; color: inherit; padding: 0 2px; border-radius: 3px; }

.upload-hint {
  padding: 0 16px 10px 58px;
  font-size: 11px;
  color: #c8c9cc;
}

/* ===== 底部块工具栏 ===== */
.block-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.97);
  border-top: 1px solid #ebedf0;
  backdrop-filter: blur(10px);
  transition: bottom 0.16s ease;
}
/* 键盘上沿：安全区已被键盘占位，去掉额外留白，尽量不遮挡正文 */
.block-bar.kb { padding-bottom: 8px; }
.block-bar.kb .bb-stat { display: none; }
.bb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 13px;
  color: #646566;
  background: #f7f8fa;
  border: 1px solid #ebedf0;
  flex-shrink: 0;
}
.bb-btn.on { color: #1989fa; border-color: #b8dcff; background: #eef6ff; }
.bb-ico { font-size: 14px; line-height: 1; color: #1989fa; }
.bb-ico.spark { color: #7c4dff; }
.bb-stat {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 11.5px;
  color: #c8c9cc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bb-save {
  flex-shrink: 0;
  min-height: 40px;
  padding: 8px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  color: #969799;
  background: transparent;
}
.bb-save.dirty { color: #ee9900; }
.bb-save.saved { color: #07c160; }

/* ===== AI 弹层 ===== */
.ai-sheet {
  width: 100%;
  height: 100%;
  display: flex;
  min-height: 0;
}

/* ===== 子页面 overlay ===== */
.sub-mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: #f7f8fa;
  display: flex;
  flex-direction: column;
}
.sub-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
}
.sub-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #ffffff;
  border-bottom: 1px solid #ebedf0;
  flex-shrink: 0;
}
.sub-back {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  font-size: 20px;
  color: #323233;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sub-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: #1989fa;
  background: #eef6ff;
}
.sub-title {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  color: #323233;
}
.sub-title::placeholder { color: #c8c9cc; font-weight: 400; }
.sub-done {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  color: #1989fa;
  background: #eef6ff;
}
.sub-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px calc(20px + env(safe-area-inset-bottom));
  -webkit-overflow-scrolling: touch;
}
</style>
