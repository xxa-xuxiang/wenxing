// 个人中心共享：学习档案解析 / 头像选择与上传
// 头像上传必须由用户点击并确认后才发起请求（沿用移动端「点击才请求」原则）
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useAuthStore } from '@/stores/authStore'
import { uploadImage } from '@/services/communityService'
import { apiUrl } from '@/services/apiBase'
import type { UserProfile } from '@/services/authService'

/** 中性占位头像（SVG，不用首字母生成） */
export const DEFAULT_AVATAR_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#e6ebf5"/><circle cx="32" cy="25" r="11" fill="#a8b3cc"/><path d="M10 57c0-12 10-19 22-19s22 7 22 19" fill="#a8b3cc"/></svg>'
  )

/** 解析登录用户的学习档案 JSON（解析失败返回 null，不发请求） */
export function parseUserProfile(raw: string | null | undefined): UserProfile | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<UserProfile>
    return {
      identity: p.identity ?? '',
      stage: p.stage ?? '',
      domains: Array.isArray(p.domains) ? p.domains : [],
      avatar: p.avatar ?? '',
      verification: p.verification ?? null
    }
  } catch {
    return null
  }
}

/** 头像地址：服务端返回 /uploads/... 相对路径，按当前 API 基地址拼接 */
export function displayAvatar(url: string | undefined): string {
  if (!url) return DEFAULT_AVATAR_SVG
  return url.startsWith('/') ? apiUrl(url) : url
}

/** 头像上传：隐藏 van-uploader 选图 → 压缩（≤256px）→ POST /api/community/upload → 写入 profile.avatar */
export function useAvatarUpload() {
  const auth = useAuthStore()
  const uploaderWrap = ref<HTMLElement | null>(null)
  const avatarBusy = ref(false)

  const avatarUrl = computed(() => displayAvatar(parseUserProfile(auth.user?.profile ?? null)?.avatar))

  function requestAvatar() {
    if (avatarBusy.value) return
    showConfirmDialog({
      title: '更新头像',
      message: '将打开图片选择，选图后自动压缩并上传到服务器，是否继续？'
    })
      .then(() => {
        const input = uploaderWrap.value?.querySelector('input[type="file"]')
        if (input instanceof HTMLInputElement) input.click()
      })
      .catch(() => {
        /* 用户取消 */
      })
  }

  /** van-uploader after-read：校验 → 读图 → 压缩（≤256px）→ 上传 */
  function onAvatarRead(items: { file?: File } | { file?: File }[]) {
    const item = Array.isArray(items) ? items[0] : items
    const file = item?.file
    if (!file || avatarBusy.value) return
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      showToast('仅支持 JPG / PNG / WebP / GIF 图片')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast('图片过大，请选择 8MB 以内的图片')
      return
    }
    avatarBusy.value = true
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      // GIF 保留动画不压缩；后端 JSON 限制 4MB，控制解码后体积
      if (file.type === 'image/gif') {
        if (file.size > 2.5 * 1024 * 1024) {
          avatarBusy.value = false
          showToast('GIF 过大，请选择 2.5MB 以内的图片')
          return
        }
        void uploadAvatar(dataUrl)
        return
      }
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 256 / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          avatarBusy.value = false
          showToast('图片处理失败')
          return
        }
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        void uploadAvatar(canvas.toDataURL('image/png'))
      }
      img.onerror = () => {
        avatarBusy.value = false
        showToast('图片读取失败')
      }
      img.src = dataUrl
    }
    reader.onerror = () => {
      avatarBusy.value = false
      showToast('图片读取失败')
    }
    reader.readAsDataURL(file)
  }

  async function uploadAvatar(dataUrl: string) {
    try {
      const { url } = await uploadImage(dataUrl)
      const base: UserProfile = parseUserProfile(auth.user?.profile ?? null) ?? {
        identity: '',
        stage: '',
        domains: []
      }
      await auth.saveProfile({ ...base, avatar: url })
      showToast('头像已更新')
    } catch (e) {
      showToast((e as Error).message || '头像上传失败，请稍后重试')
    } finally {
      avatarBusy.value = false
    }
  }

  return { uploaderWrap, avatarBusy, avatarUrl, requestAvatar, onAvatarRead }
}
