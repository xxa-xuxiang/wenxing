<!-- 社区书籍书架（移动端，内嵌于社区「书架」分段）：搜索 + 上传 + 阅读/下载 -->
<!-- 删除书籍为管理员权限（后台书架管理页），普通用户界面不提供入口 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { useAuthStore } from '@/stores/authStore'
import { bookCoverUrl, bookFileUrl, listBooks, uploadBook } from '@/services/bookService'
import type { BookItem } from '@/types'

const router = useRouter()
const auth = useAuthStore()

const items = ref<BookItem[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(
    (b) => b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q)
  )
})

async function reload(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await listBooks()
    items.value = res.items
  } catch (e) {
    error.value = e instanceof Error ? e.message : '书架读取失败'
  } finally {
    loading.value = false
  }
}
onMounted(reload)

// ===== 阅读 / 下载 =====
function openReader(b: BookItem): void {
  if (!b.previewable) {
    showToast('该格式暂不支持在线阅读，请下载后查看')
    return
  }
  router.push(`/community/books/${b.id}`)
}

function downloadBook(b: BookItem): void {
  if (!b.hasFile) {
    showToast('该书籍仅有来源链接，暂无可下载文件')
    return
  }
  window.open(bookFileUrl(b.id), '_blank', 'noopener')
}

// ===== 上传 =====
const fileInput = ref<HTMLInputElement | null>(null)
const coverInput = ref<HTMLInputElement | null>(null)
const uploadOpen = ref(false)
const uploading = ref(false)
const pickedFile = ref<File | null>(null)
const pickedCover = ref<File | null>(null)
const uploadTitle = ref('')
const uploadAuthor = ref('')
const uploadLicense = ref('')

function pickFile(): void {
  if (!auth.user) {
    void router.push('/auth')
    return
  }
  fileInput.value?.click()
}

function onFile(e: Event): void {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0] ?? null
  input.value = ''
  if (!f) return
  pickedFile.value = f
  pickedCover.value = null
  uploadTitle.value = f.name.replace(/\.[^.]+$/, '')
  uploadAuthor.value = ''
  uploadLicense.value = ''
  uploadOpen.value = true
}

function pickCover(): void {
  coverInput.value?.click()
}

function onCover(e: Event): void {
  const input = e.target as HTMLInputElement
  pickedCover.value = input.files?.[0] ?? null
  input.value = ''
}

function closeUpload(): void {
  uploadOpen.value = false
  pickedFile.value = null
  pickedCover.value = null
}

async function submitUpload(): Promise<void> {
  const f = pickedFile.value
  if (!f || uploading.value) return
  const ok = await showConfirmDialog({
    title: '确认上传',
    message: `将上传《${uploadTitle.value.trim() || f.name}》到书架，是否继续？`
  })
    .then(() => true)
    .catch(() => false)
  if (!ok) return
  uploading.value = true
  try {
    const res = await uploadBook({
      file: f,
      cover: pickedCover.value,
      title: uploadTitle.value.trim() || undefined,
      author: uploadAuthor.value.trim() || undefined,
      license: uploadLicense.value.trim() || undefined
    })
    items.value = [res.item, ...items.value]
    closeUpload()
    showToast('已加入书架')
  } catch (e) {
    showToast(e instanceof Error ? e.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

const coverFallback = (b: BookItem) =>
  `linear-gradient(135deg, hsl(${(b.title.charCodeAt(0) * 7) % 360} 42% 58%), hsl(${(b.title.charCodeAt(0) * 13) % 360} 46% 42%))`
</script>

<template>
  <div class="shelf">
    <!-- 搜索 + 上传入口 -->
    <div class="shelf-toolbar">
      <van-search v-model="search" class="shelf-search" placeholder="搜索书名 / 作者" shape="round" background="transparent" />
      <button class="shelf-upload-btn" @click="pickFile">＋ 上传</button>
      <input
        ref="fileInput"
        type="file"
        accept=".pdf,.epub,.txt,.md,.mobi,.azw3"
        style="display: none"
        @change="onFile"
      />
      <input
        ref="coverInput"
        type="file"
        accept="image/jpeg,image/png"
        style="display: none"
        @change="onCover"
      />
    </div>

    <p v-if="error" class="shelf-error">⚠ {{ error }}</p>

    <van-loading v-if="loading" class="shelf-tip" vertical>正在读取书架…</van-loading>

    <van-empty
      v-else-if="filtered.length === 0"
      :description="search ? '没有匹配的书籍' : '书架还是空的'"
    >
      <p class="shelf-empty-tip">
        资源准备中下载的开放教材会自动出现在这里，也可以手动上传 PDF / EPUB / TXT 等格式。
      </p>
      <van-button round type="primary" size="small" @click="pickFile">上传书籍</van-button>
    </van-empty>

    <div v-else class="book-list">
      <article v-for="b in filtered" :key="b.id" class="book-card">
        <div class="book-cover" :style="b.coverUrl ? undefined : { background: coverFallback(b) }">
          <img v-if="b.coverUrl" :src="bookCoverUrl(b)" :alt="b.title" loading="lazy" />
          <span v-else class="book-cover-title">{{ b.title }}</span>
          <span class="book-format">{{ b.format.toUpperCase() }}</span>
        </div>
        <div class="book-main">
          <h3 class="book-title">{{ b.title }}</h3>
          <div class="book-author">{{ b.author || '未知作者' }}</div>
          <div class="book-meta">
            <span v-if="b.license" class="book-license">{{ b.license }}</span>
            <span v-else class="book-license muted">来源未标注</span>
          </div>
          <div class="book-actions">
            <button class="book-act" :disabled="!b.previewable" @click="openReader(b)">阅读</button>
            <button class="book-act" :disabled="!b.hasFile" @click="downloadBook(b)">下载</button>
          </div>
        </div>
      </article>
    </div>

    <!-- 上传表单 -->
    <van-popup v-model:show="uploadOpen" position="bottom" round safe-area-inset-bottom @closed="pickedFile = null">
      <div class="upload-panel">
        <div class="upload-head">
          <span class="upload-title">上传书籍</span>
          <span class="upload-file">{{ pickedFile?.name }}</span>
        </div>
        <van-cell-group :border="false">
          <van-field v-model="uploadTitle" label="书名" placeholder="请输入书名" maxlength="60" />
          <van-field v-model="uploadAuthor" label="作者" placeholder="可选" maxlength="40" />
          <van-field v-model="uploadLicense" label="许可" placeholder="如 CC BY / 官方免费（可选）" maxlength="60" />
          <van-field label="封面">
            <template #input>
              <van-button size="small" round plain type="primary" @click="pickCover">
                {{ pickedCover ? pickedCover.name : '选择封面（可选）' }}
              </van-button>
            </template>
          </van-field>
        </van-cell-group>
        <div class="upload-actions">
          <van-button block round plain @click="closeUpload">取消</van-button>
          <van-button block round type="primary" :loading="uploading" @click="submitUpload">
            {{ uploading ? '上传中…' : '确认上传' }}
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.shelf {
  padding: 0 0 8px;
}

.shelf-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 12px;
}

.shelf-search {
  flex: 1;
  min-width: 0;
  padding: 6px 4px;
}

.shelf-search :deep(.van-search__content) {
  background: #fff;
}

.shelf-upload-btn {
  flex-shrink: 0;
  padding: 7px 14px;
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.32);
}

.shelf-upload-btn:active {
  transform: scale(0.96);
  opacity: 0.9;
}

.shelf-error {
  margin: 8px 16px;
  font-size: 12.5px;
  color: #ee0a24;
}

.shelf-tip {
  padding: 60px 0;
  color: #969799;
}

.shelf-empty-tip {
  max-width: 280px;
  margin: 0 auto 12px;
  font-size: 12px;
  line-height: 1.7;
  color: #969799;
}

.book-list {
  padding: 4px 12px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.book-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.book-cover {
  position: relative;
  flex-shrink: 0;
  width: 68px;
  height: 92px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px 9px 9px 4px;
  border: 1px solid #f2f3f5;
}

.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.book-cover-title {
  padding: 6px;
  font-size: 11.5px;
  line-height: 1.4;
  color: #fff;
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.book-format {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 0 5px;
  font-size: 9px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
}

.book-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.book-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  color: #323233;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.book-author {
  margin-top: 3px;
  font-size: 12px;
  color: #969799;
}

.book-meta {
  margin-top: 4px;
  display: flex;
  gap: 6px;
}

.book-license {
  font-size: 11px;
  color: #07c160;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-license.muted {
  color: #c8c9cc;
}

.book-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
}

.book-act {
  flex: 1;
  padding: 5px 0;
  font-size: 12px;
  color: #646566;
  background: #f7f8fa;
  border: none;
  border-radius: 8px;
}

.book-act:disabled {
  opacity: 0.4;
}

.upload-panel {
  padding: 16px 0 calc(16px + env(safe-area-inset-bottom));
  background: #fff;
}

.upload-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 16px 10px;
}

.upload-title {
  font-size: 16px;
  font-weight: 600;
  color: #323233;
}

.upload-file {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: #969799;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-actions {
  display: flex;
  gap: 12px;
  padding: 14px 16px 0;
}
</style>
