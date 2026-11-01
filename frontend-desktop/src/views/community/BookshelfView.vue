<script setup lang="ts">
// 社区书籍书架：封面网格 + 阅读/下载 + 上传（多格式）
// 数据来自 /api/books；封面走 /api/books/:id/cover
// 删除书籍为管理员权限（后台书架管理页），普通用户界面不提供入口
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { bookCoverUrl, bookFileUrl, listBooks, uploadBook } from '@/services/bookService'
import type { BookItem } from '@/types'

const router = useRouter()
const auth = useAuthStore()

const items = ref<BookItem[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const uploading = ref(false)
const uploadMsg = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(
    (b) => b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q)
  )
})

async function reload() {
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

function openReader(b: BookItem) {
  router.push(`/community/books/${b.id}`)
}
function downloadBook(b: BookItem) {
  if (!b.hasFile) return
  window.open(bookFileUrl(b.id), '_blank', 'noopener')
}

// ===== 上传 =====
const fileInput = ref<HTMLInputElement | null>(null)
const coverInput = ref<HTMLInputElement | null>(null)
const pickedFile = ref<File | null>(null)
const pickedCover = ref<File | null>(null)
const uploadTitle = ref('')
const uploadAuthor = ref('')
const uploadLicense = ref('')

function pickFile() {
  if (!auth.user) {
    router.push('/auth')
    return
  }
  fileInput.value?.click()
}
function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null
  pickedFile.value = f
  if (f && !uploadTitle.value) uploadTitle.value = f.name.replace(/\.[^.]+$/, '')
  ;(e.target as HTMLInputElement).value = ''
}
function pickCover() {
  coverInput.value?.click()
}
function onCover(e: Event) {
  pickedCover.value = (e.target as HTMLInputElement).files?.[0] ?? null
  ;(e.target as HTMLInputElement).value = ''
}
async function submitUpload() {
  const f = pickedFile.value
  if (!f || uploading.value) return
  if (!window.confirm(`将上传《${uploadTitle.value || f.name}》到书架，是否继续？`)) return
  uploading.value = true
  uploadMsg.value = ''
  try {
    const res = await uploadBook({
      file: f,
      cover: pickedCover.value,
      title: uploadTitle.value.trim() || undefined,
      author: uploadAuthor.value.trim() || undefined,
      license: uploadLicense.value.trim() || undefined
    })
    items.value = [res.item, ...items.value]
    pickedFile.value = null
    pickedCover.value = null
    uploadTitle.value = ''
    uploadAuthor.value = ''
    uploadLicense.value = ''
    uploadMsg.value = '已加入书架'
  } catch (e) {
    uploadMsg.value = e instanceof Error ? e.message : '上传失败'
  } finally {
    uploading.value = false
  }
}

const formatLabel = (f: string) => f.toUpperCase()
const coverFallback = (b: BookItem) =>
  `linear-gradient(135deg, hsl(${(b.title.charCodeAt(0) * 7) % 360} 42% 38%), hsl(${(b.title.charCodeAt(0) * 13) % 360} 46% 22%))`
</script>

<template>
  <div class="wx-shelf">
    <div class="wx-shelf-toolbar">
      <div class="wx-shelf-search">
        <input v-model="search" type="text" placeholder="搜索书名 / 作者" />
      </div>
      <button class="wx-shelf-btn wx-pressable" @click="pickFile">＋ 上传书籍</button>
      <input ref="fileInput" type="file" accept=".pdf,.epub,.txt,.md,.mobi,.azw3" style="display: none" @change="onFile" />
      <input ref="coverInput" type="file" accept="image/jpeg,image/png" style="display: none" @change="onCover" />
    </div>

    <p v-if="error" class="wx-shelf-err">{{ error }}</p>

    <!-- 上传表单（选中文件后出现） -->
    <div v-if="pickedFile" class="wx-shelf-upload">
      <div class="wx-shelf-upload-name">{{ pickedFile.name }}</div>
      <input v-model="uploadTitle" type="text" placeholder="书名" />
      <input v-model="uploadAuthor" type="text" placeholder="作者（可选）" />
      <input v-model="uploadLicense" type="text" placeholder="许可（如 CC BY / 官方免费；可选）" />
      <div class="wx-shelf-upload-actions">
        <button class="wx-shelf-btn ghost" @click="pickCover">{{ pickedCover ? `封面：${pickedCover.name}` : '选择封面' }}</button>
        <button class="wx-shelf-btn" :disabled="uploading" @click="submitUpload">
          {{ uploading ? '上传中…' : '确认上传' }}
        </button>
      </div>
      <p v-if="uploadMsg" class="wx-shelf-msg">{{ uploadMsg }}</p>
    </div>

    <div v-if="loading" class="wx-shelf-empty">正在读取书架…</div>
    <div v-else-if="filtered.length === 0" class="wx-shelf-empty">
      <div class="wx-shelf-empty-mark">📚</div>
      <div>书架还是空的</div>
      <div class="wx-shelf-empty-tip">资源准备中下载的开放教材会自动出现在这里，也可以手动上传 PDF / EPUB / TXT 等格式。</div>
    </div>

    <div v-else class="wx-shelf-grid">
      <article v-for="b in filtered" :key="b.id" class="wx-book">
        <div class="wx-book-cover" :style="b.coverUrl ? undefined : { background: coverFallback(b) }">
          <img v-if="b.coverUrl" :src="bookCoverUrl(b)" :alt="b.title" loading="lazy" />
          <span v-else class="wx-book-cover-title">{{ b.title }}</span>
          <span class="wx-book-format">{{ formatLabel(b.format) }}</span>
        </div>
        <div class="wx-book-info">
          <div class="wx-book-title" :title="b.title">{{ b.title }}</div>
          <div class="wx-book-author">{{ b.author || '未知作者' }}</div>
          <div class="wx-book-meta">
            <span v-if="b.license" class="wx-book-license">{{ b.license }}</span>
            <span v-else class="wx-book-license muted">来源未标注</span>
          </div>
        </div>
        <div class="wx-book-actions">
          <button class="wx-book-act" :disabled="!b.previewable" @click="openReader(b)">阅读</button>
          <button class="wx-book-act" :disabled="!b.hasFile" @click="downloadBook(b)">下载</button>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.wx-shelf { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; overflow-y: auto; padding: 4px 4px 24px; }
.wx-shelf-toolbar { display: flex; align-items: center; gap: 10px; }
.wx-shelf-search { flex: 1; max-width: 320px; }
.wx-shelf-search input {
  width: 100%;
  height: 32px;
  padding: 0 12px;
  font-size: 12.5px;
  color: var(--wx-text-primary);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  outline: none;
}
.wx-shelf-search input:focus { border-color: var(--wx-border-glow); }
.wx-shelf-btn {
  padding: 7px 16px;
  font-size: 12.5px;
  border-radius: var(--wx-radius-pill);
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  border: none;
}
.wx-shelf-btn.ghost {
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 5%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-shelf-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.wx-shelf-err { margin: 0; font-size: 12px; color: var(--wx-color-vermilion); }
.wx-shelf-upload {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border: 1px dashed var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 5%, transparent);
}
.wx-shelf-upload-name { width: 100%; font-size: 12px; color: var(--wx-text-secondary); }
.wx-shelf-upload input {
  flex: 1;
  min-width: 150px;
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--wx-text-primary);
  background: var(--wx-bg-deep);
  border: 1px solid var(--wx-border-soft);
}
.wx-shelf-upload-actions { display: flex; gap: 8px; width: 100%; }
.wx-shelf-msg { margin: 0; width: 100%; font-size: 12px; color: var(--wx-color-yanqing); }
.wx-shelf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--wx-text-tertiary);
  font-size: 13px;
}
.wx-shelf-empty-mark { font-size: 34px; }
.wx-shelf-empty-tip { max-width: 380px; text-align: center; font-size: 11.5px; color: var(--wx-text-muted); line-height: 1.7; }
.wx-shelf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 18px 16px;
}
.wx-book { display: flex; flex-direction: column; gap: 8px; }
.wx-book-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 6px 10px 10px 6px;
  overflow: hidden;
  box-shadow: 0 10px 22px color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--wx-border-soft);
}
.wx-book-cover img { width: 100%; height: 100%; object-fit: cover; }
.wx-book-cover-title {
  padding: 12px;
  font-family: var(--wx-font-serif);
  font-size: 14px;
  line-height: 1.5;
  color: #fff;
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wx-book-format {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 6px;
  font-size: 9.5px;
  font-family: var(--wx-font-mono);
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 4px;
}
.wx-book-info { display: flex; flex-direction: column; gap: 2px; }
.wx-book-title {
  font-size: 12.5px;
  color: var(--wx-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wx-book-author { font-size: 11px; color: var(--wx-text-muted); }
.wx-book-meta { display: flex; gap: 6px; }
.wx-book-license { font-size: 10px; color: var(--wx-color-yanqing); }
.wx-book-license.muted { color: var(--wx-text-muted); }
.wx-book-actions { display: flex; gap: 6px; }
.wx-book-act {
  flex: 1;
  padding: 4px 0;
  font-size: 11px;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: 4px;
}
.wx-book-act:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
