<script setup lang="ts">
// 问星 v0.9 — 个人中心（左侧 1/7 可收起导航 + 右侧内容区）
// 导航：计费（默认）/ API 与充值 / 个性化 / 基本信息 / 学习情况，底部「关于」；内容随选中标签切换
// 数据驱动：掌握度来自 masteryStore（答题回流），大纲/文档进度来自 learnStore，档案来自登录 profile
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLearnStore } from '@/stores/learnStore'
import { useMasteryStore } from '@/stores/masteryStore'
import { useAuthStore } from '@/stores/authStore'
import { storage } from '@/utils/storage'
import { fetchMe, type UserProfile, type VerificationType } from '@/services/authService'
import { uploadImage } from '@/services/communityService'
import { fetchWallet, redeemWalletCode, type WalletResult } from '@/services/walletService'
import appreciationQr from '@/assets/wallet/appreciation.jpg'
import payQr from '@/assets/wallet/pay.jpg'
import { apiUrl } from '@/services/apiBase'
import { authHeaders } from '@/services/http'
import { industries as industryDefs } from '@/data/industries'
import { parseIndustryMd } from '@/utils/industryMd'
import type { IndustryNode } from '@/utils/industryMd'
import RadarChart from '@/components/common/RadarChart.vue'
import { useThemeStore, THEMES } from '@/stores/themeStore'
import { useNightUiStore } from '@/stores/nightUi'
import { FLAGS } from '@/config/flags'
import TaskCardPreview from '@/components/learn/TaskCardPreview.vue'
import { isTauri } from '@/composables/useTauriWindow'

/** 版本号由 Vite 构建时从 package.json 注入，与安装包版本共用一个来源 */
const appVersion = __APP_VERSION__

const themeStore = useThemeStore()
const nightUi = useNightUiStore()
const taskCardPreview = ref(false)

const router = useRouter()
const learnStore = useLearnStore()
const masteryStore = useMasteryStore()
const authStore = useAuthStore()

// ===== 导航状态 =====
type MeTab = 'member' | 'api' | 'verify' | 'personal' | 'basic' | 'study' | 'biz' | 'about'
const TABS: { key: MeTab; label: string; icon: string }[] = [
  { key: 'member', label: '计费', icon: '✦' },
  { key: 'api', label: 'API 与充值', icon: '⚡' },
  { key: 'verify', label: '认证', icon: '☑' },
  { key: 'personal', label: '个性化', icon: '◈' },
  { key: 'basic', label: '基本信息', icon: '◐' },
  { key: 'study', label: '学习情况', icon: '❖' }
]
const activeTab = ref<MeTab>((storage.get<MeTab>('meTab', 'member')))
const collapsed = ref(storage.get<boolean>('meSideCollapsed', false))

function switchTab(t: MeTab) {
  activeTab.value = t
  storage.set('meTab', t)
}

const displayName = computed(() => authStore.user?.nickname || authStore.user?.username || '问星学者')

// ===== 关于页：官网链接（系统默认浏览器打开，不在应用内 WebView；右键复制地址） =====
const OFFICIAL_SITE = 'https://example.com'
const siteCopied = ref(false)
async function openOfficialSite() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(OFFICIAL_SITE)
  } else {
    window.open(OFFICIAL_SITE, '_blank', 'noopener')
  }
}
async function copyOfficialSite() {
  try {
    await navigator.clipboard.writeText(OFFICIAL_SITE)
    siteCopied.value = true
    window.setTimeout(() => { siteCopied.value = false }, 1600)
  } catch {
    /* 剪贴板不可用 — 静默 */
  }
}

/** 中性占位头像（SVG，不再取用户名首字母） */
const DEFAULT_AVATAR_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#2a2f45"/><circle cx="32" cy="24" r="11" fill="#8b92ad"/><path d="M10 56c0-12 10-20 22-20s22 8 22 20" fill="#8b92ad"/></svg>'
  )

// ===== 头像（基本信息页可选图上传；存 profile.avatar，走社区图片上传拿短 URL） =====
const avatarUrl = computed(() => profileInfo.value?.avatar ?? '')
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarBusy = ref(false)
const avatarError = ref('')

function pickAvatar() {
  if (avatarBusy.value) return
  avatarError.value = ''
  avatarInput.value?.click()
}

function onAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    avatarError.value = '仅支持 JPG / PNG / WebP / GIF 图片'
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    avatarError.value = '图片过大，请选择 8MB 以内的图片'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const src = String(reader.result)
    // GIF 保持动画，不做 canvas 压缩，直接上传
    if (file.type === 'image/gif') {
      void uploadAvatarDataUrl(src)
      return
    }
    // 静态图进入裁剪模态框
    openCrop(src)
  }
  reader.onerror = () => {
    avatarError.value = '图片读取失败'
  }
  reader.readAsDataURL(file)
}

/** 上传头像 dataURL 并保存到 profile */
async function uploadAvatarDataUrl(dataUrl: string) {
  avatarBusy.value = true
  try {
    const { url } = await uploadImage(dataUrl)
    const base: UserProfile = profileInfo.value ?? { identity: '', stage: '', domains: [] }
    await authStore.saveProfile({ ...base, avatar: url })
  } catch (err) {
    avatarError.value = err instanceof Error ? err.message : '头像上传失败，请稍后重试'
  } finally {
    avatarBusy.value = false
  }
}

// ===== 头像裁剪模态框 =====
const cropVisible = ref(false)
const cropSrc = ref('')
const cropScale = ref(1)
const cropOffset = ref({ x: 0, y: 0 })
const cropDragging = ref(false)
const cropDragStart = ref({ x: 0, y: 0, ox: 0, oy: 0 })
const CROP_VIEW = 300     // 预览区尺寸
const CROP_FRAME = 240    // 圆形裁剪框尺寸
const CROP_OUT = 256      // 输出尺寸

function openCrop(src: string) {
  cropSrc.value = src
  cropScale.value = 1
  cropOffset.value = { x: 0, y: 0 }
  cropVisible.value = true
}

function closeCrop() {
  cropVisible.value = false
  cropSrc.value = ''
}

function onCropWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  cropScale.value = Math.min(5, Math.max(0.2, cropScale.value * delta))
}

function onCropMouseDown(e: MouseEvent) {
  cropDragging.value = true
  cropDragStart.value = { x: e.clientX, y: e.clientY, ox: cropOffset.value.x, oy: cropOffset.value.y }
}

function onCropMouseMove(e: MouseEvent) {
  if (!cropDragging.value) return
  cropOffset.value = {
    x: cropDragStart.value.ox + (e.clientX - cropDragStart.value.x),
    y: cropDragStart.value.oy + (e.clientY - cropDragStart.value.y)
  }
}

function onCropMouseUp() {
  cropDragging.value = false
}

function confirmCrop() {
  const img = new Image()
  img.onload = () => {
    // 预览区居中显示图片（按短边适配 CROP_VIEW）
    const fit = Math.min(CROP_VIEW / img.width, CROP_VIEW / img.height)
    const baseW = img.width * fit
    const baseH = img.height * fit
    // 实际显示的图片尺寸
    const dispW = baseW * cropScale.value
    const dispH = baseH * cropScale.value
    // 预览区中心
    const cx = CROP_VIEW / 2
    const cy = CROP_VIEW / 2
    // 图片左上角在预览区的坐标
    const imgLeft = cx - dispW / 2 + cropOffset.value.x
    const imgTop = cy - dispH / 2 + cropOffset.value.y
    // 裁剪框在预览区的范围（居中 CROP_FRAME）
    const frameLeft = (CROP_VIEW - CROP_FRAME) / 2
    const frameTop = (CROP_VIEW - CROP_FRAME) / 2
    // 映射回原图坐标
    const ratioX = img.width / dispW
    const ratioY = img.height / dispH
    const sx = (frameLeft - imgLeft) * ratioX
    const sy = (frameTop - imgTop) * ratioY
    const sw = CROP_FRAME * ratioX
    const sh = CROP_FRAME * ratioY

    const canvas = document.createElement('canvas')
    canvas.width = CROP_OUT
    canvas.height = CROP_OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      avatarError.value = '图片处理失败'
      return
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CROP_OUT, CROP_OUT)
    const dataUrl = canvas.toDataURL('image/png')
    closeCrop()
    void uploadAvatarDataUrl(dataUrl)
  }
  img.onerror = () => {
    avatarError.value = '图片读取失败'
  }
  img.src = cropSrc.value
}

const syncLabel = computed(() => {
  if (!authStore.user) return '数据本地存储 · 未登录'
  return authStore.offline ? '后端离线 · 数据暂存本地' : '数据已云端同步'
})

// 退出登录二次确认：首次点击只弹确认框，确认后才真正退出
const logoutConfirmOpen = ref(false)
function handleLogout() {
  logoutConfirmOpen.value = true
}
function confirmLogout() {
  logoutConfirmOpen.value = false
  authStore.logout()
  void router.push('/auth')
}

// ===== 学习档案（v0.6 首次进入引导采集，profile 为 JSON 字符串） =====
const profileInfo = computed<UserProfile | null>(() => {
  const raw = authStore.user?.profile
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
})

// ===== 掌握度总览 =====
const masteryStats = computed(() => {
  let mastered = 0
  let learning = 0
  let answers = 0
  let correct = 0
  for (const key of Object.keys(masteryStore.map)) {
    const e = masteryStore.map[key]
    if (e.state === 'mastered') mastered += 1
    else if (e.state === 'learning') learning += 1
    for (const r of e.records) {
      answers += 1
      if (r.ok) correct += 1
    }
  }
  return { mastered, learning, answers, accuracy: answers === 0 ? 0 : Math.round((correct / answers) * 100) }
})

// ===== 大纲与文档进度 =====
const outlineStats = computed(() => {
  const c = learnStore.statusCount
  const total = learnStore.outline.length
  return {
    total,
    done: c.light + c.deep,
    coverage: total === 0 ? 0 : Math.round(((c.light + c.deep) / total) * 100),
    docs: learnStore.docs.length
  }
})

// ===== 答题表现（近 10 题正确率对比前 10 题） =====
const perf = computed(() => {
  const all: { ok: boolean; t: number }[] = []
  for (const key of Object.keys(masteryStore.map)) all.push(...masteryStore.map[key].records)
  all.sort((a, b) => a.t - b.t)
  const acc = (list: { ok: boolean }[]) =>
    list.length === 0 ? null : Math.round((list.filter((r) => r.ok).length / list.length) * 100)
  const recent = acc(all.slice(-10))
  const prev = acc(all.slice(-20, -10))
  const diff = recent === null || prev === null ? null : recent - prev
  return { recent, prev, diff, total: all.length }
})

// ===== 复习提醒：≥2 天未练习且已有记录的知识点 =====
const reviewList = computed(() => {
  const now = Date.now()
  const DAY = 86400000
  const items: { name: string; state: 'learning' | 'mastered'; days: number; acc: number }[] = []
  for (const name of Object.keys(masteryStore.map)) {
    const e = masteryStore.map[name]
    if (e.state === 'unlearned' || e.records.length === 0) continue
    const days = Math.floor((now - e.records[e.records.length - 1].t) / DAY)
    if (days < 2) continue
    const recent = e.records.slice(-10)
    items.push({
      name,
      state: e.state,
      days,
      acc: Math.round((recent.filter((r) => r.ok).length / recent.length) * 100)
    })
  }
  return items.sort((a, b) => b.days - a.days).slice(0, 6)
})

// ===== 能力对比：按在学行业知识大类聚合掌握率 =====
function countLeaves(n: IndustryNode): { total: number; mastered: number } {
  if (n.children.length === 0) {
    return { total: 1, mastered: masteryStore.getState(n.name) === 'mastered' ? 1 : 0 }
  }
  let total = 0
  let mastered = 0
  for (const c of n.children) {
    const s = countLeaves(c)
    total += s.total
    mastered += s.mastered
  }
  return { total, mastered }
}
const categoryRows = computed(() => {
  const name = learnStore.selectedDomain?.name
  const ind = industryDefs.find((i) => i.name === name)
  if (!ind) return []
  return parseIndustryMd(ind.md).children.map((cat) => {
    const s = countLeaves(cat)
    return { name: cat.name, total: s.total, mastered: s.mastered }
  })
})

/** 雷达图轴数上限：轴过多时标签会互相重叠，按能力项数量取前 8 个大类 */
const RADAR_MAX_AXES = 8

/** 各知识大类的掌握率（0-100），供雷达图与整体掌握率使用 */
const radarPoints = computed(() =>
  categoryRows.value.map((r) => ({
    label: r.name,
    value: r.total === 0 ? 0 : Math.round((r.mastered / r.total) * 100),
    total: r.total
  }))
)
const radarAxes = computed(() =>
  [...radarPoints.value].sort((a, b) => b.total - a.total).slice(0, RADAR_MAX_AXES)
)
const radarTruncated = computed(() => radarPoints.value.length > RADAR_MAX_AXES)
const radarUsable = computed(() => radarAxes.value.length >= 3)
/** 雷达图的整体掌握率（全部大类均值），用于卡片右上角概览数字 */
const radarAverage = computed(() => {
  if (radarPoints.value.length === 0) return 0
  return Math.round(radarPoints.value.reduce((s, a) => s + a.value, 0) / radarPoints.value.length)
})

// ===== 计费方式（v1.4：平台 AI 按次，自带 Key 零管理费） =====
/** 两种计费模式：自带 Key（零费用） / 平台 AI（按次） */
const billingModes = [
  {
    id: 'byo', name: '自带 API Key', price: '零费用', unit: '调用走你自己的 Key',
    desc: '填写你自己的 API Key，AI 调用走你的额度',
    features: ['完全免费，零管理费', '不占用平台 AI 次数', '调用费用由你的 Key 承担'],
    highlight: false
  },
  {
    id: 'platform', name: '平台 AI', price: '按次计费', unit: '按调用次数计费',
    desc: '无需配置，直接用问星内置 AI 能力',
    features: ['按 AI 调用次数计费', '占用平台 AI 赠送额度', '开箱即用，零配置'],
    highlight: true
  }
]

/** 对比表：行 = 能力项，列 = 两种模式（自带 Key / 平台 AI） */
const billingCompareRows: { label: string; values: [string, string] }[] = [
  { label: '固定管理费', values: ['无', '无'] },
  { label: 'AI 调用计费', values: ['—（走你自己的 Key）', '按次计费'] },
  { label: '占用平台 AI 额度', values: ['不占用', '占用'] },
  { label: '需要配置 API Key', values: ['需要', '不需要'] },
  { label: '调用费用由谁承担', values: ['你的 API 账户', '问星平台'] }
]

// ===== 认证（权威学者 / 学生 / 企业员工；暂无后台审核，提交后置 pending） =====
const VERIFY_OPTIONS: {
  id: VerificationType
  name: string
  icon: string
  desc: string
  orgLabel: string
  orgPlaceholder: string
}[] = [
  {
    id: 'scholar', name: '权威学者', icon: '🎓',
    desc: '高校 / 研究机构的教师、研究员、博士',
    orgLabel: '所在机构', orgPlaceholder: '如：XX 大学 计算机学院'
  },
  {
    id: 'student', name: '学生', icon: '📚',
    desc: '在读本科、硕士、博士学生',
    orgLabel: '所在学校', orgPlaceholder: '如：XX 大学 物联网工程'
  },
  {
    id: 'employee', name: '某企业员工', icon: '🏢',
    desc: '企业 / 组织的在职员工',
    orgLabel: '所属企业', orgPlaceholder: '如：XX 科技有限公司'
  }
]

const verifyType = ref<VerificationType>('student')
const verifyOrg = ref('')
const verifyBusy = ref(false)
const verifyError = ref('')
const verifyMsg = ref('')

/** 已提交的认证信息（来自 profile JSON） */
const verification = computed(() => profileInfo.value?.verification ?? null)
const verifyOptionName = computed(
  () => VERIFY_OPTIONS.find((o) => o.id === verification.value?.type)?.name ?? ''
)
const verifySubmittedText = computed(() =>
  verification.value ? new Date(verification.value.submittedAt).toLocaleString('zh-CN') : ''
)

async function submitVerification() {
  if (verifyBusy.value) return
  const org = verifyOrg.value.trim()
  if (!org) {
    verifyError.value = '请填写机构 / 学校 / 企业名称'
    return
  }
  verifyError.value = ''
  verifyMsg.value = ''
  verifyBusy.value = true
  try {
    const base: UserProfile = profileInfo.value ?? { identity: '', stage: '', domains: [] }
    await authStore.saveProfile({
      ...base,
      verification: { type: verifyType.value, org, status: 'pending', submittedAt: Date.now() }
    })
    verifyMsg.value = '认证申请已提交，审核通过后将在昵称旁展示认证标识'
    verifyOrg.value = ''
  } catch (e) {
    verifyError.value = e instanceof Error ? e.message : '提交失败，请稍后重试'
  } finally {
    verifyBusy.value = false
  }
}

async function revokeVerification() {
  if (verifyBusy.value || !profileInfo.value) return
  verifyBusy.value = true
  verifyError.value = ''
  verifyMsg.value = ''
  try {
    await authStore.saveProfile({ ...profileInfo.value, verification: null })
    verifyMsg.value = '已撤销认证申请'
  } catch (e) {
    verifyError.value = e instanceof Error ? e.message : '撤销失败，请稍后重试'
  } finally {
    verifyBusy.value = false
  }
}

// ===== API 与充值 =====
/** 用户自定义 API Key（留空走后端默认 = 平台 AI） */
const API_KEY_STORAGE_KEY = 'wx:userApiKey'
const userApiKey = ref(storage.getGlobal<string>(API_KEY_STORAGE_KEY, ''))
/** 已保存的 Key（决定当前计费模式：自带 Key = 零费用；留空 = 平台 AI 按次） */
const savedApiKey = ref(storage.getGlobal<string>(API_KEY_STORAGE_KEY, ''))
const apiKeySaving = ref(false)
const apiKeyMsg = ref('')

/** 当前计费模式（本地即可判定，无需请求） */
const currentMode = computed<'byo' | 'platform'>(() => (savedApiKey.value.trim() ? 'byo' : 'platform'))

function saveUserApiKey() {
  if (apiKeySaving.value) return
  apiKeySaving.value = true
  apiKeyMsg.value = ''
  try {
    const v = userApiKey.value.trim()
    if (v) storage.setGlobal(API_KEY_STORAGE_KEY, v)
    else storage.removeGlobal(API_KEY_STORAGE_KEY)
    savedApiKey.value = v
    apiKeyMsg.value = v ? '已保存：后续 AI 调用走你的 Key，零费用' : '已清空：后续 AI 调用走平台 AI，按次计费'
  } finally {
    apiKeySaving.value = false
  }
}

/** 用量数据（仅在用户点击「查询用量」并确认后加载，禁止自动拉取） */
interface UsageBucket { used: number; limit: number; remaining: number }
interface MeteringStats { tokens: number; calls: number; tokenQuota: number; tokenRemaining: number; debtFen: number }
const usageData = ref<Record<string, UsageBucket> | null>(null)
const metering = ref<MeteringStats | null>(null)
const usageLoading = ref(false)
const usageError = ref('')
/** 后端返回的计费口径（说明） */
const billingInfo = ref<{ managementFee: number; currency: string; note: string } | null>(null)

async function queryUsage() {
  // API 调用约束：必须用户确认后才发请求
  const ok = window.confirm('查询用量将向后端发起一次请求，是否继续？')
  if (!ok) return
  usageLoading.value = true
  usageError.value = ''
  try {
    const res = await fetch(apiUrl('/api/ai/usage'), { headers: authHeaders() })
    if (!res.ok) throw new Error(`请求失败 ${res.status}`)
    const json = (await res.json()) as {
      usage: Record<string, UsageBucket>
      billing?: { managementFee: number; currency: string; note: string }
      metering?: MeteringStats | null
    }
    usageData.value = json.usage
    billingInfo.value = json.billing ?? null
    metering.value = json.metering ?? null
  } catch (e) {
    usageError.value = e instanceof Error ? e.message : '查询失败'
  } finally {
    usageLoading.value = false
  }
}

/** 计量汇总（长期累计，仅统计走平台 AI 的调用；自带 Key 完全免费不计入） */
const usageSummary = computed(() => {
  const m = metering.value
  const calls = m?.calls ?? 0
  const tokens = m?.tokens ?? 0
  const quota = m?.tokenQuota ?? 1_000_000
  // 计费口径：1000 次 1 元 + 超出免费量部分 1.3 元/百万 token
  const cost = calls * 0.001 + (Math.max(0, tokens - quota) * 1.3) / 1_000_000
  return { calls, tokens, quota, cost: cost.toFixed(4), debtFen: m?.debtFen ?? 0 }
})

/** 柱状图数据（各 action 调用次数） */
const usageChart = computed(() => {
  const data = usageData.value
  if (!data) return []
  return Object.entries(data).map(([key, v]) => ({
    key,
    used: v.used,
    limit: v.limit
  }))
})
const usageMax = computed(() => Math.max(1, ...usageChart.value.map((c) => c.used)))

/** 账户余额与兑换码（请求仅在用户点击后发起） */
const wallet = ref<WalletResult | null>(null)
const walletLoading = ref(false)
const walletError = ref('')
const redeemInput = ref('')
const redeeming = ref(false)

/** 充值备注要填的用户名 */
const walletUsername = computed(() => authStore.user?.username || '')
const usernameCopied = ref(false)

async function copyUsername() {
  if (!walletUsername.value) return
  try {
    await navigator.clipboard.writeText(walletUsername.value)
    usernameCopied.value = true
    window.setTimeout(() => { usernameCopied.value = false }, 1600)
  } catch {
    window.alert(`请手动填写用户名：${walletUsername.value}`)
  }
}

async function queryWallet() {
  if (walletLoading.value) return
  if (!window.confirm('查询余额将向后端发起一次请求，是否继续？')) return
  walletLoading.value = true
  walletError.value = ''
  try {
    wallet.value = await fetchWallet(10)
  } catch (e) {
    walletError.value = e instanceof Error ? e.message : '查询失败'
  } finally {
    walletLoading.value = false
  }
}

async function confirmRedeem() {
  if (redeeming.value) return
  const code = redeemInput.value.trim()
  if (!code) {
    window.alert('请输入兑换码')
    return
  }
  if (!window.confirm(`确认使用兑换码：\n${code}\n兑换成功后金额立即入账。`)) return
  redeeming.value = true
  try {
    const res = await redeemWalletCode(code)
    window.alert(`兑换成功，入账 ¥${res.amountYuan.toFixed(2)}`)
    redeemInput.value = ''
    if (wallet.value) wallet.value = await fetchWallet(10)
  } catch (e) {
    window.alert(e instanceof Error ? e.message : '兑换失败')
  } finally {
    redeeming.value = false
  }
}

// ===== 个性化：减弱动效（持久化，立即生效） =====
const reduceMotion = ref(storage.get<boolean>('wxReduceMotion', false))

function applyMotion() {
  let el = document.getElementById('wx-reduce-motion-style')
  if (reduceMotion.value) {
    if (!el) {
      el = document.createElement('style')
      el.id = 'wx-reduce-motion-style'
      el.textContent = '*, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }'
      document.head.appendChild(el)
    }
  } else {
    el?.remove()
  }
  storage.set('wxReduceMotion', reduceMotion.value)
}
watch(reduceMotion, applyMotion)

// ===== 个性化：夜间 UI（独立 data-night 属性，不覆盖整体风格） =====
function onNightToggle(e: Event): void {
  nightUi.setEnabled((e.target as HTMLInputElement).checked)
}

// ===== 我的邀请码（publicUser 携带；缓存缺失时 onMounted 补拉一次 me）=====
const inviteCode = computed(() => authStore.user?.inviteCode ?? '')
const inviteCopied = ref(false)
let inviteCopiedTimer: number | undefined

async function ensureInviteCode() {
  if (authStore.user && authStore.user.inviteCode == null) {
    try {
      authStore.user = await fetchMe()
    } catch {
      /* 后端不可达静默：沿用缓存用户信息 */
    }
  }
}

async function copyInviteCode() {
  if (!inviteCode.value) return
  try {
    await navigator.clipboard.writeText(inviteCode.value)
    inviteCopied.value = true
    window.clearTimeout(inviteCopiedTimer)
    inviteCopiedTimer = window.setTimeout(() => (inviteCopied.value = false), 2000)
  } catch {
    /* 剪贴板不可用静默 */
  }
}

onMounted(() => {
  applyMotion()
  void ensureInviteCode()
})
</script>

<template>
  <div class="wx-me">
    <!-- ===== 左侧导航（1/7 宽，可收起） ===== -->
    <aside class="wx-me-side" :class="{ collapsed }">
      <div class="wx-me-side-user">
        <span class="wx-me-avatar">
          <img v-if="avatarUrl" :src="avatarUrl" alt="头像" />
          <img v-else :src="DEFAULT_AVATAR_SVG" alt="默认头像" />
        </span>
        <transition name="wx-fade">
          <div v-if="!collapsed" class="wx-me-side-user-info">
            <span class="wx-me-side-name">{{ displayName }}</span>
            <span class="wx-me-side-sync">{{ syncLabel }}</span>
          </div>
        </transition>
      </div>

      <ul class="wx-me-nav">
        <li v-for="t in TABS" :key="t.key">
          <button
            class="wx-me-nav-item"
            :class="{ active: activeTab === t.key }"
            :title="t.label"
            :data-test="`me-tab-${t.key}`"
            @click="switchTab(t.key)"
          >
            <span class="wx-me-nav-icon">{{ t.icon }}</span>
            <span v-if="!collapsed" class="wx-me-nav-label">{{ t.label }}</span>
          </button>
        </li>
      </ul>

      <div class="wx-me-nav-bottom">
        <button
          class="wx-me-nav-item"
          :class="{ active: activeTab === 'about' }"
          title="关于"
          @click="switchTab('about')"
        >
          <span class="wx-me-nav-icon">✧</span>
          <span v-if="!collapsed" class="wx-me-nav-label">关于</span>
        </button>
        <button
          class="wx-me-nav-item"
          :class="{ active: activeTab === 'biz' }"
          title="商业合作"
          @click="switchTab('biz')"
        >
          <span class="wx-me-nav-icon">◇</span>
          <span v-if="!collapsed" class="wx-me-nav-label">商业合作</span>
        </button>
        <button class="wx-me-nav-item" :title="collapsed ? '展开' : '收起'" @click="collapsed = !collapsed">
          <span class="wx-me-nav-icon" :class="{ flip: collapsed }">◀</span>
          <span v-if="!collapsed" class="wx-me-nav-label">收起</span>
        </button>
        <button v-if="authStore.user" class="wx-me-nav-item wx-me-nav-logout" title="退出登录" @click="handleLogout">
          <span class="wx-me-nav-icon">⏻</span>
          <span v-if="!collapsed" class="wx-me-nav-label">退出登录</span>
        </button>
      </div>
    </aside>

    <!-- ===== 右侧内容区（Tab 切换带过渡动效） ===== -->
    <div class="wx-me-content">
      <Transition name="wx-me-swap" mode="out-in">
      <!-- 会员（默认） -->
      <section v-if="activeTab === 'member'" :key="activeTab" class="wx-me-pane">
        <div class="wx-me-membership-head">
          <div class="wx-me-membership-title">
            <h2 class="wx-me-section-title">计费方式</h2>
            <span class="wx-me-membership-tip">两种模式 · 按需选择</span>
          </div>
        </div>

        <p class="wx-me-billing-intro">
          问星提供两种 AI 使用方式：使用平台 AI 时，每日有免费额度，用尽后按调用次数从账户余额扣费；
          填写你自己的 API Key 则调用走你的额度，完全免费，不占用平台 AI 次数。余额可通过兑换码或后台充值入账。
        </p>

        <div class="wx-me-plans">
          <div
            v-for="m in billingModes"
            :key="m.id"
            class="wx-me-plan"
            :class="{ highlight: m.highlight }"
          >
            <div class="wx-me-plan-name">{{ m.name }}</div>
            <div class="wx-me-plan-price">
              {{ m.price }}
              <span class="wx-me-plan-price-unit">{{ m.unit }}</span>
            </div>
            <div class="wx-me-billing-mode-desc">{{ m.desc }}</div>
            <ul class="wx-me-plan-features">
              <li v-for="f in m.features" :key="f">{{ f }}</li>
            </ul>
            <button class="wx-me-plan-btn" :class="{ active: currentMode === m.id }" disabled>
              {{ currentMode === m.id ? '当前模式' : '可切换' }}
            </button>
          </div>
        </div>

        <!-- 两种模式对比表 -->
        <div class="wx-me-compare">
          <h3 class="wx-me-card-title">计费对比</h3>
          <table class="wx-me-compare-table">
            <thead>
              <tr>
                <th class="wx-me-compare-label">项目</th>
                <th v-for="m in billingModes" :key="m.id" :class="{ highlight: m.highlight }">{{ m.name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in billingCompareRows" :key="row.label">
                <td class="wx-me-compare-label">{{ row.label }}</td>
                <td v-for="(v, i) in row.values" :key="i" :class="{ yes: v === '✓', no: v === '—' }">{{ v }}</td>
              </tr>
            </tbody>
          </table>
          <p class="wx-me-compare-note">当前计费模式：{{ currentMode === 'byo' ? '自带 API Key（零费用，调用走你的 Key）' : '平台 AI（按次计费）' }}</p>
        </div>
      </section>

      <!-- API 与充值 -->
      <section v-else-if="activeTab === 'api'" :key="activeTab" class="wx-me-pane">
        <h2 class="wx-me-section-title">API 与充值</h2>

        <!-- 当前计费模式 -->
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">当前计费模式</h3>
          <div class="wx-me-mode-badge" :class="currentMode">
            {{ currentMode === 'byo' ? '自带 API Key · 零费用' : '平台 AI · 按次计费' }}
          </div>
          <p class="wx-me-avatar-tip">
            {{ currentMode === 'byo'
              ? '你已配置自己的 API Key：AI 调用走你的额度，零费用，不占用平台 AI 次数。'
              : '未配置自己的 API Key：AI 调用走问星平台，按调用次数计费。' }}
          </p>
        </div>

        <!-- API Key -->
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">API Key</h3>
          <div class="wx-me-apikey-row">
            <input
              v-model="userApiKey"
              type="password"
              class="wx-me-apikey-input"
              placeholder="留空则使用平台 AI（按次计费）"
              autocomplete="off"
            />
            <button class="wx-me-apikey-btn" type="button" :disabled="apiKeySaving" @click="saveUserApiKey">
              {{ apiKeySaving ? '保存中…' : '保存' }}
            </button>
          </div>
          <p v-if="apiKeyMsg" class="wx-me-verify-msg ok">{{ apiKeyMsg }}</p>
          <p class="wx-me-avatar-tip">填写你自己的 API Key 后，AI 调用将使用你的 Key（完全免费，不计平台计量）；留空则使用平台 AI，按 token 与调用次数计量计费。</p>
        </div>

        <!-- 用量计量表 -->
        <div class="wx-me-card">
          <div class="wx-me-usage-head">
            <h3 class="wx-me-card-title">用量统计</h3>
            <button class="wx-me-usage-query" type="button" :disabled="usageLoading" @click="queryUsage">
              {{ usageLoading ? '查询中…' : '查询用量' }}
            </button>
          </div>

          <div v-if="usageData" class="wx-me-usage-stats">
            <div class="wx-me-usage-stat">
              <div class="wx-me-usage-stat-label">累计消费（估算）</div>
              <div class="wx-me-usage-stat-value">{{ usageSummary.cost }}<span class="unit"> CNY</span></div>
            </div>
            <div class="wx-me-usage-stat">
              <div class="wx-me-usage-stat-label">API 调用总次数</div>
              <div class="wx-me-usage-stat-value">{{ usageSummary.calls.toLocaleString() }}</div>
            </div>
            <div class="wx-me-usage-stat">
              <div class="wx-me-usage-stat-label">Token 累计用量</div>
              <div class="wx-me-usage-stat-value">{{ usageSummary.tokens.toLocaleString() }}</div>
            </div>
          </div>
          <div v-if="usageData && metering" class="wx-me-usage-quota">
            <div class="wx-me-usage-quota-head">
              <span>免费 token 额度（长期累计 {{ usageSummary.quota.toLocaleString() }}）</span>
              <span>剩余 {{ (metering.tokenRemaining ?? 0).toLocaleString() }}</span>
            </div>
            <div class="wx-me-usage-quota-track">
              <div
                class="wx-me-usage-quota-fill"
                :style="{ width: `${Math.min(100, (usageSummary.tokens / usageSummary.quota) * 100)}%` }"
              ></div>
            </div>
            <p v-if="usageSummary.debtFen > 0" class="wx-me-avatar-tip wx-me-wallet-error">
              有未清费用 ¥{{ (usageSummary.debtFen / 100).toFixed(2) }}，请充值后再使用平台 AI。
            </p>
          </div>

          <div v-if="usageError" class="wx-me-verify-msg error">{{ usageError }}</div>

          <div v-if="usageData && usageChart.length" class="wx-me-usage-chart">
            <div class="wx-me-usage-chart-title">今日各功能调用次数</div>
            <div class="wx-me-usage-bars">
              <div v-for="c in usageChart" :key="c.key" class="wx-me-usage-bar-row">
                <span class="wx-me-usage-bar-label">{{ c.key }}</span>
                <div class="wx-me-usage-bar-track">
                  <div
                    class="wx-me-usage-bar-fill"
                    :style="{ width: `${(c.used / usageMax) * 100}%` }"
                  ></div>
                </div>
                <span class="wx-me-usage-bar-val">{{ c.used }}<span class="wx-me-usage-bar-limit"> / {{ c.limit }}</span></span>
              </div>
            </div>
          </div>

          <div v-if="!usageData && !usageLoading" class="wx-me-card-empty">
            点击「查询用量」查看今日 API 调用统计
          </div>

          <p class="wx-me-usage-note">
            {{ billingInfo?.note ?? '每账号长期免费 100 万 token；超出后 1.3 元/百万 token，API 调用 0.001 元/次；自带 API Key 完全免费。' }}
          </p>
        </div>

        <!-- 账户余额与兑换码 -->
        <div class="wx-me-card">
          <div class="wx-me-wallet-head">
            <h3 class="wx-me-card-title">账户余额</h3>
            <button
              class="wx-me-recharge-btn wx-me-wallet-query"
              type="button"
              :disabled="walletLoading"
              @click="queryWallet"
            >
              {{ walletLoading ? '查询中…' : '查询余额' }}
            </button>
          </div>

          <div v-if="wallet" class="wx-me-wallet">
            <span class="wx-me-wallet-label">可用余额</span>
            <span class="wx-me-wallet-value">¥{{ wallet.balanceYuan.toFixed(2) }}</span>
          </div>
          <p v-else-if="walletError" class="wx-me-avatar-tip wx-me-wallet-error">{{ walletError }}</p>
          <p class="wx-me-avatar-tip">
            免费 token 用尽后，AI 调用按 token 与次数从余额扣费；兑换码或后台充值可入账。
          </p>

          <div class="wx-me-redeem-row">
            <input v-model="redeemInput" class="wx-me-redeem-input" placeholder="输入 16 位兑换码" />
            <button class="wx-me-recharge-btn" type="button" :disabled="redeeming" @click="confirmRedeem">
              {{ redeeming ? '兑换中…' : '兑换入账' }}
            </button>
          </div>
          <p class="wx-me-avatar-tip">兑换码由管理员发放，成功后金额立即入账，每张仅可使用一次。</p>
        </div>

        <!-- 赞赏与充值收款码 -->
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">赞赏与充值</h3>
          <div class="wx-me-pay-grid">
            <div class="wx-me-pay-item">
              <img class="wx-me-pay-img" :src="appreciationQr" alt="赞赏码" />
              <h4 class="wx-me-pay-name">赞赏码</h4>
              <p class="wx-me-pay-desc">愿意支持问星就扫码随意赞赏，金额不限；赞赏是心意，不进入账户余额。</p>
            </div>
            <div class="wx-me-pay-item">
              <img class="wx-me-pay-img" :src="payQr" alt="微信支付收款码" />
              <h4 class="wx-me-pay-name">充值收款码</h4>
              <p class="wx-me-pay-desc">微信扫码后自己填写金额，用于充值账户余额、继续使用平台 AI。</p>
            </div>
          </div>

          <div class="wx-me-pay-user">
            <span>付款备注要填的用户名：<strong>{{ walletUsername || '请先登录' }}</strong></span>
            <button class="wx-me-recharge-btn" type="button" :disabled="!walletUsername" @click="copyUsername">
              {{ usernameCopied ? '已复制' : '复制用户名' }}
            </button>
          </div>

          <ol class="wx-me-pay-steps">
            <li>微信扫右侧「充值收款码」，输入你想充值的金额（多少都可以）；</li>
            <li><strong>在付款备注里填写你的用户名</strong>，就是上面显示的那一串；</li>
            <li>付款完成后把付款截图或订单号发给管理员；</li>
            <li>管理员核对后手动充值到余额，回来点「查询余额」即可看到。</li>
          </ol>
          <p class="wx-me-pay-warn">注意：不填用户名无法核对付款，将无法入账；使用赞赏码付款不计入余额。</p>
        </div>
      </section>

      <!-- 认证 -->
      <section v-else-if="activeTab === 'verify'" :key="activeTab" class="wx-me-pane">
        <h2 class="wx-me-section-title">认证</h2>

        <!-- 已提交：展示当前状态 -->
        <div v-if="verification" class="wx-me-card wx-me-verify-status">
          <div class="wx-me-verify-status-main">
            <span class="wx-me-verify-badge">☑ 审核中</span>
            <div>
              <div class="wx-me-verify-line">{{ verifyOptionName }} · {{ verification.org }}</div>
              <div class="wx-me-verify-sub">
                提交于 {{ verifySubmittedText }} · 审核通过后将在昵称旁展示认证标识
              </div>
            </div>
          </div>
          <button class="wx-me-verify-revoke" type="button" :disabled="verifyBusy" @click="revokeVerification">
            {{ verifyBusy ? '处理中…' : '撤销申请' }}
          </button>
        </div>

        <!-- 未认证：选择类型并提交 -->
        <div v-else class="wx-me-card">
          <h3 class="wx-me-card-title">选择认证类型</h3>
          <div class="wx-me-verify-options">
            <button
              v-for="o in VERIFY_OPTIONS"
              :key="o.id"
              class="wx-me-verify-option"
              :class="{ active: verifyType === o.id }"
              type="button"
              @click="verifyType = o.id"
            >
              <span class="wx-me-verify-icon">{{ o.icon }}</span>
              <span class="wx-me-verify-opt-name">{{ o.name }}</span>
              <span class="wx-me-verify-opt-desc">{{ o.desc }}</span>
            </button>
          </div>

          <label class="wx-me-verify-field">
            <span class="k">{{ VERIFY_OPTIONS.find((o) => o.id === verifyType)?.orgLabel }}</span>
            <input
              v-model="verifyOrg"
              type="text"
              maxlength="60"
              :placeholder="VERIFY_OPTIONS.find((o) => o.id === verifyType)?.orgPlaceholder"
            />
          </label>

          <p v-if="verifyError" class="wx-me-verify-msg error">{{ verifyError }}</p>
          <p v-else-if="verifyMsg" class="wx-me-verify-msg ok">{{ verifyMsg }}</p>

          <button class="wx-me-verify-submit" type="button" :disabled="verifyBusy" @click="submitVerification">
            {{ verifyBusy ? '提交中…' : '提交认证申请' }}
          </button>
          <p class="wx-me-verify-note">
            认证信息仅用于身份标识；问星暂不提供在线审核，提交后状态为「审核中」。
          </p>
        </div>
      </section>

      <!-- 个性化 -->
      <section v-else-if="activeTab === 'personal'" :key="activeTab" class="wx-me-pane">
        <h2 class="wx-me-section-title">个性化</h2>

        <!-- 整体风格 -->
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">整体风格</h3>
          <div class="wx-me-theme-list">
            <button
              v-for="t in THEMES"
              :key="t.id"
              class="wx-me-theme-card"
              :class="{ active: themeStore.name === t.id }"
              :data-test="`theme-${t.id}`"
              @click="themeStore.set(t.id)"
            >
              <span class="wx-me-theme-swatch" :class="'swatch-' + t.id"></span>
              <span class="wx-me-theme-name">{{ t.name }}</span>
              <span class="wx-me-theme-hint">{{ t.hint }}</span>
            </button>
          </div>
        </div>

        <div class="wx-me-card">
          <h3 class="wx-me-card-title">动效</h3>
          <label class="wx-me-switch-row">
            <span class="wx-me-switch-text">
              减弱动效
              <em>关闭呼吸灯、悬浮位移等过渡动画，界面更安静</em>
            </span>
            <input v-model="reduceMotion" type="checkbox" class="wx-me-switch" />
          </label>
        </div>

        <!-- 夜间 UI：独立属性 data-night，不覆盖整体风格 -->
        <div v-if="FLAGS.NIGHT_THEME" class="wx-me-card">
          <h3 class="wx-me-card-title">夜间 UI</h3>
          <label class="wx-me-switch-row">
            <span class="wx-me-switch-text">
              夜间界面
              <em>独立于整体风格，仅影响新版任务卡、Agent 面板等灰度组件</em>
            </span>
            <input
              type="checkbox"
              class="wx-me-switch"
              :checked="nightUi.enabled"
              data-test="night-ui-toggle"
              @change="onNightToggle"
            />
          </label>
        </div>

        <!-- 任务卡四字段预览入口（样例数据，不提交反馈） -->
        <div v-if="FLAGS.TASK_CARD_V2" class="wx-me-card">
          <h3 class="wx-me-card-title">任务卡四字段</h3>
          <div class="wx-me-preview-row">
            <p class="wx-me-preview-desc">去哪学 / 怎么做 / 做出什么 / 怎么算会</p>
            <button
              class="wx-me-avatar-btn wx-pressable"
              type="button"
              data-test="open-task-card-preview"
              @click="taskCardPreview = true"
            >预览样例</button>
          </div>
        </div>
      </section>

      <!-- 基本信息 -->
      <section v-else-if="activeTab === 'basic'" :key="activeTab" class="wx-me-pane">
        <h2 class="wx-me-section-title">基本信息</h2>

        <!-- 头像：选择本地图片上传 -->
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">头像</h3>
          <div class="wx-me-avatar-row">
            <span class="wx-me-avatar-big">
              <img v-if="avatarUrl" :src="avatarUrl" alt="当前头像" />
              <img v-else :src="DEFAULT_AVATAR_SVG" alt="默认头像" />
            </span>
            <div class="wx-me-avatar-actions">
              <button class="wx-me-avatar-btn wx-pressable" type="button" :disabled="avatarBusy" @click="pickAvatar">
                {{ avatarBusy ? '上传中…' : '选择图片' }}
              </button>
              <p class="wx-me-avatar-tip">支持 JPG / PNG / WebP，自动裁切为正方形</p>
              <p v-if="avatarError" class="wx-me-verify-msg error">{{ avatarError }}</p>
            </div>
            <input
              ref="avatarInput"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style="display: none"
              @change="onAvatarFile"
            />
          </div>
        </div>

        <!-- 头像裁剪模态框 -->
        <Teleport to="body">
          <div v-if="cropVisible" class="wx-crop-mask" @click.self="closeCrop">
            <div class="wx-crop-dialog">
              <h3 class="wx-crop-title">裁剪头像</h3>
              <div
                class="wx-crop-view"
                :style="{ width: CROP_VIEW + 'px', height: CROP_VIEW + 'px' }"
                @wheel.prevent="onCropWheel"
                @mousedown="onCropMouseDown"
                @mousemove="onCropMouseMove"
                @mouseup="onCropMouseUp"
                @mouseleave="onCropMouseUp"
              >
                <img
                  class="wx-crop-img"
                  :src="cropSrc"
                  :style="{
                    transform: `translate(calc(-50% + ${cropOffset.x}px), calc(-50% + ${cropOffset.y}px)) scale(${cropScale})`
                  }"
                  draggable="false"
                  alt=""
                />
                <!-- 圆形裁剪框（视觉提示） -->
                <div
                  class="wx-crop-frame"
                  :style="{ width: CROP_FRAME + 'px', height: CROP_FRAME + 'px' }"
                ></div>
              </div>
              <p class="wx-crop-tip">拖动移动位置，滚轮缩放，圆形区域为最终头像</p>
              <div class="wx-crop-actions">
                <button class="wx-crop-cancel" type="button" @click="closeCrop">取消</button>
                <button class="wx-crop-confirm" type="button" @click="confirmCrop">确认</button>
              </div>
            </div>
          </div>
        </Teleport>

        <!-- 退出登录二次确认 -->
        <Teleport to="body">
          <div v-if="logoutConfirmOpen" class="wx-crop-mask" @click.self="logoutConfirmOpen = false">
            <div class="wx-crop-dialog wx-logout-dialog">
              <h3 class="wx-crop-title">退出登录</h3>
              <p class="wx-crop-tip">退出后需要重新登录才能继续使用云端同步功能，确定要退出吗？</p>
              <div class="wx-crop-actions">
                <button class="wx-crop-cancel" type="button" @click="logoutConfirmOpen = false">取消</button>
                <button class="wx-crop-confirm wx-logout-confirm" type="button" @click="confirmLogout">退出登录</button>
              </div>
            </div>
          </div>
        </Teleport>

        <div class="wx-me-card">
          <h3 class="wx-me-card-title">账号</h3>
          <div class="wx-me-basic-grid">
            <div class="wx-me-basic-item">
              <span class="k">昵称</span>
              <span class="v">{{ authStore.user?.nickname || '未设置' }}</span>
            </div>
            <div class="wx-me-basic-item">
              <span class="k">用户名</span>
              <span class="v">{{ authStore.user?.username || '--' }}</span>
            </div>
            <div class="wx-me-basic-item">
              <span class="k">同步状态</span>
              <span class="v">{{ syncLabel }}</span>
            </div>
            <div class="wx-me-basic-item wide">
              <span class="k">我的邀请码</span>
              <span class="v wx-me-invite-value">
                <span class="wx-me-invite-code">{{ inviteCode || '暂无' }}</span>
                <button v-if="inviteCode" class="wx-me-invite-copy" type="button" @click="copyInviteCode">
                  复制
                </button>
                <transition name="wx-fade">
                  <span v-if="inviteCopied" class="wx-me-invite-copied">已复制</span>
                </transition>
              </span>
            </div>
          </div>
          <button v-if="authStore.user" class="wx-me-logout" type="button" @click="handleLogout">退出登录</button>
        </div>

        <div v-if="profileInfo" class="wx-me-card">
          <h3 class="wx-me-card-title">学习档案</h3>
          <div class="wx-me-basic-grid">
            <div class="wx-me-basic-item">
              <span class="k">身份</span>
              <span class="v">{{ profileInfo.identity || '未填写' }}</span>
            </div>
            <div class="wx-me-basic-item">
              <span class="k">当前阶段</span>
              <span class="v">{{ profileInfo.stage || '未填写' }}</span>
            </div>
            <div class="wx-me-basic-item wide">
              <span class="k">学过的领域</span>
              <span class="v wrap">
                <template v-if="profileInfo.domains.length">{{ profileInfo.domains.join('、') }}</template>
                <template v-else>暂无 · 零基础起步</template>
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- 学习情况 -->
      <section v-else-if="activeTab === 'study'" :key="activeTab" class="wx-me-pane">
        <h2 class="wx-me-section-title">学习情况</h2>
        <div class="wx-me-stats">
          <div class="wx-me-stat">
            <div class="wx-me-stat-value">{{ masteryStats.mastered }}</div>
            <div class="wx-me-stat-label">已掌握知识点</div>
          </div>
          <div class="wx-me-stat">
            <div class="wx-me-stat-value">{{ masteryStats.learning }}</div>
            <div class="wx-me-stat-label">在学知识点</div>
          </div>
          <div class="wx-me-stat">
            <div class="wx-me-stat-value">{{ masteryStats.answers }}</div>
            <div class="wx-me-stat-label">累计答题数</div>
          </div>
          <div class="wx-me-stat">
            <div class="wx-me-stat-value">{{ masteryStats.accuracy }}<span class="unit">%</span></div>
            <div class="wx-me-stat-label">总正确率</div>
          </div>
          <div class="wx-me-stat">
            <div class="wx-me-stat-value">{{ outlineStats.done }}<span class="unit">/{{ outlineStats.total }}</span></div>
            <div class="wx-me-stat-label">大纲任务进度</div>
          </div>
          <div class="wx-me-stat">
            <div class="wx-me-stat-value">{{ outlineStats.docs }}</div>
            <div class="wx-me-stat-label">已生成文档</div>
          </div>
        </div>

        <div class="wx-me-row">
          <div class="wx-me-card">
            <h3 class="wx-me-card-title">答题表现</h3>
            <div v-if="perf.recent === null" class="wx-me-card-empty">还没有答题记录，去题库练几题吧</div>
            <div v-else class="wx-me-perf">
              <div class="wx-me-perf-num">
                <span class="val">{{ perf.recent }}</span><span class="unit">% 近 10 题正确率</span>
              </div>
              <div class="wx-me-perf-trend" :class="{ up: (perf.diff ?? 0) > 0, down: (perf.diff ?? 0) < 0 }">
                <template v-if="perf.diff === null">暂无对比数据</template>
                <template v-else-if="perf.diff > 0">↑ 较前 10 题 +{{ perf.diff }}%</template>
                <template v-else-if="perf.diff < 0">↓ 较前 10 题 {{ perf.diff }}%</template>
                <template v-else>— 与前 10 题持平</template>
              </div>
              <p class="wx-me-perf-note">正确率跌破 60% 的知识点会退回「在学」，持续练习保持记忆活性</p>
            </div>
          </div>
          <div class="wx-me-card">
            <h3 class="wx-me-card-title">复习提醒</h3>
            <div v-if="reviewList.length === 0" class="wx-me-card-empty">
              近 2 天练习过的知识点都在记忆活跃期，保持节奏 ✓
            </div>
            <ul v-else class="wx-me-review">
              <li v-for="r in reviewList" :key="r.name" class="wx-me-review-row">
                <span class="wx-me-review-dot" :class="r.state"></span>
                <span class="wx-me-review-name" :title="r.name">{{ r.name }}</span>
                <span class="wx-me-review-meta">{{ r.days }} 天未练 · 近 10 题 {{ r.acc }}%</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="wx-me-radar">
          <div class="wx-me-radar-head">
            <h3 class="wx-me-card-title">能力雷达图</h3>
            <span v-if="categoryRows.length > 0" class="wx-me-radar-avg">
              整体掌握率 <b>{{ radarAverage }}%</b>
            </span>
          </div>
          <div v-if="categoryRows.length === 0" class="wx-me-card-empty">
            选择学习方向后，这里将展示各知识大类的掌握率
          </div>
          <div v-else class="wx-me-radar-empty">
            <RadarChart v-if="radarUsable" :axes="radarAxes" :size="320" class="wx-me-radar-chart" />
            <p v-else class="wx-me-radar-fallback">
              该方向的知识大类不足 3 个，暂以列表呈现掌握率
            </p>
            <p v-if="radarUsable && radarTruncated" class="wx-me-radar-hint">
              雷达图展示能力项最多的 {{ RADAR_MAX_AXES }} 个大类，其余见下表
            </p>
            <table>
              <thead>
                <tr>
                  <th>知识大类</th>
                  <th>能力项</th>
                  <th>已掌握</th>
                  <th>掌握率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in categoryRows" :key="r.name">
                  <td>{{ r.name }}</td>
                  <td>{{ r.total }}</td>
                  <td :class="{ zero: r.mastered === 0 }">{{ r.mastered }}</td>
                  <td>
                    <span class="wx-me-radar-bar">
                      <span class="fill" :style="{ width: `${r.total === 0 ? 0 : Math.round((r.mastered / r.total) * 100)}%` }"></span>
                    </span>
                    <span class="pct">{{ r.total === 0 ? 0 : Math.round((r.mastered / r.total) * 100) }}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="wx-me-radar-note">掌握率 = 已掌握知识点 / 该大类全部能力项（答对 5 题 ≥80% 即点亮）</p>
          </div>
        </div>
      </section>

      <!-- 关于：当前版本 + 团队信息 -->
      <section v-else-if="activeTab === 'about'" :key="activeTab" class="wx-me-pane">
        <h2 class="wx-me-section-title">关于</h2>
        <div class="wx-me-card">
          <div class="wx-me-about-brand">
            <span class="wx-me-about-mark">✦</span>
            <div>
              <h3 class="wx-me-about-name">问星 · AI 学习伴侣</h3>
              <p class="wx-me-about-ver">当前版本 v{{ appVersion }} · 桌宠已上线</p>
            </div>
          </div>
        </div>
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">团队</h3>
          <div class="wx-me-about-team">
            <span class="wx-me-team-mark">K</span>
            <div>
              <div class="wx-me-team-name">问星开源</div>
              <div class="wx-me-team-meta">开源社区维护</div>
            </div>
          </div>
        </div>
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">联系</h3>
          <div class="wx-me-biz-contact">
            <div class="wx-me-basic-item">
              <span class="k">官网</span>
              <span class="v wx-me-site">
                <a
                  :href="OFFICIAL_SITE"
                  class="wx-me-link"
                  title="在系统默认浏览器打开官网 · 右键复制地址"
                  @click.prevent="openOfficialSite"
                  @contextmenu.prevent="copyOfficialSite"
                >example.com</a>
                <span v-if="siteCopied" class="wx-me-site-copied">已复制</span>
              </span>
            </div>
            <div class="wx-me-basic-item">
              <span class="k">邮箱</span>
              <span class="v">contact@example.com</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 商业合作 -->
      <section v-else-if="activeTab === 'biz'" :key="activeTab" class="wx-me-pane">
        <h2 class="wx-me-section-title">商业合作</h2>
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">合作方向</h3>
          <ul class="wx-me-biz-list">
            <li>
              <span class="wx-me-biz-name">企业培训</span>
              <span class="wx-me-biz-desc">为团队定制行业知识图与学习路径，批量账号与进度管理</span>
            </li>
            <li>
              <span class="wx-me-biz-name">内容共建</span>
              <span class="wx-me-biz-desc">行业文档、题库与学习大纲的联合制作与署名展示</span>
            </li>
            <li>
              <span class="wx-me-biz-name">赛事合作</span>
              <span class="wx-me-biz-desc">学习挑战赛、认证体系与社区活动的联合运营</span>
            </li>
          </ul>
        </div>
        <div class="wx-me-card">
          <h3 class="wx-me-card-title">联系方式</h3>
          <div class="wx-me-biz-contact">
            <div class="wx-me-basic-item">
              <span class="k">合作邮箱</span>
              <span class="v">contact@example.com</span>
            </div>
            <div class="wx-me-basic-item">
              <span class="k">工作日回复</span>
              <span class="v">48 小时内</span>
            </div>
          </div>
          <p class="wx-me-biz-note">来信请注明合作方向、机构名称与期望周期；个人学习问题请优先使用社区与 AI 助教。</p>
        </div>
      </section>
      </Transition>
    </div>
    <TaskCardPreview :open="taskCardPreview" @close="taskCardPreview = false" />
  </div>
</template>

<style scoped>
.wx-me {
  height: 100%;
  display: flex;
  overflow: hidden;
}

/* ===== 左侧导航 ===== */
.wx-me-side {
  width: calc(100% / 7);
  min-width: 168px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 22px 12px 90px 22px;
  border-right: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 22%, transparent);
  transition: width var(--wx-duration-mid) var(--wx-ease-out-soft);
}
.wx-me-side.collapsed { min-width: 76px; width: 76px; padding-left: 12px; }
.wx-me-side-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px 16px;
  border-bottom: 1px solid var(--wx-border-soft);
  margin-bottom: 12px;
}
.wx-me-avatar {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--wx-gradient-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  box-shadow: var(--wx-shadow-glow);
}
.wx-me-side-user-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wx-me-side-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wx-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-me-side-sync { font-size: 10.5px; color: var(--wx-text-muted); }

.wx-me-nav { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.wx-me-nav-bottom {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 12px;
  border-top: 1px solid var(--wx-border-soft);
}
.wx-me-nav-item {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--wx-radius-md);
  color: var(--wx-text-secondary);
  font-size: 13px;
  text-align: left;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-nav-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 18px;
  border-radius: 3px;
  background: var(--wx-gradient-primary);
  transition: transform var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-nav-item:hover { color: var(--wx-text-primary); background: color-mix(in srgb, var(--wx-ink) 5%, transparent); }
.wx-me-nav-item.active { color: var(--wx-text-on-accent); background: color-mix(in srgb, var(--wx-color-primary) 16%, transparent); }
.wx-me-nav-item.active::before { transform: translateY(-50%) scaleY(1); }
.wx-me-nav-icon { font-size: 14px; width: 20px; text-align: center; flex-shrink: 0; }
.wx-me-nav-icon.flip { transform: rotate(180deg); }
.wx-me-nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ===== 右侧内容 ===== */
.wx-me-content {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 26px 32px 100px;
}
.wx-me-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 100%;
}
.wx-me-section-title {
  font-family: var(--wx-font-serif);
  font-size: 21px;
  font-weight: 600;
}

.wx-me-nav-logout:hover { color: var(--wx-color-vermilion); }

.wx-me-logout {
  align-self: flex-start;
  padding: 8px 18px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
  color: var(--wx-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-logout:hover {
  border-color: color-mix(in srgb, var(--wx-color-vermilion) 50%, transparent);
  color: var(--wx-color-vermilion);
}

.wx-me-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}
.wx-me-stat {
  padding: 18px;
  text-align: center;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-me-stat-value {
  font-size: 28px;
  font-weight: 700;
  font-family: var(--wx-font-mono);
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-me-stat-value .unit { font-size: 16px; }
.wx-me-stat-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

.wx-me-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.wx-me-card {
  padding: 20px 0;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-me-card-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  font-family: var(--wx-font-serif);
}
.wx-me-card-empty {
  font-size: 12px;
  color: var(--wx-text-muted);
  padding: 20px;
  text-align: center;
  border: 1px dashed var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
}

/* 基本信息 */
.wx-me-basic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.wx-me-basic-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border-radius: var(--wx-radius-md);
}
.wx-me-basic-item.wide { grid-column: 1 / -1; }
.wx-me-basic-item .k { font-size: 11px; color: var(--wx-text-muted); }
.wx-me-basic-item .v {
  font-size: 14px;
  color: var(--wx-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-me-basic-item .v.wrap { white-space: normal; line-height: 1.6; }

/* 我的邀请码 */
.wx-me-invite-value {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: normal;
}
.wx-me-invite-code {
  font-family: var(--wx-font-mono);
  letter-spacing: 1px;
}
.wx-me-invite-copy {
  padding: 3px 12px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
  color: var(--wx-text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-invite-copy:hover {
  border-color: var(--wx-border-glow);
  color: var(--wx-text-primary);
}
.wx-me-invite-copied {
  font-size: 11px;
  color: var(--wx-state-deep);
}

/* 个性化 */
.wx-me-theme-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.wx-me-theme-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: var(--wx-radius-lg);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  color: var(--wx-text-primary);
  text-align: left;
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
  position: relative;
  overflow: hidden;
}
.wx-me-theme-card:hover { border-color: var(--wx-border-glow); transform: translateY(-1px); }
.wx-me-theme-card.active {
  border-color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  box-shadow: 0 0 0 1px var(--wx-border-glow), 0 4px 16px color-mix(in srgb, var(--wx-color-primary) 20%, transparent);
}
.wx-me-theme-card.active::after {
  content: '✓';
  position: absolute;
  top: 10px; right: 12px;
  font-size: 12px;
  color: var(--wx-color-primary-soft);
  font-weight: 700;
}
.wx-me-theme-swatch {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  margin-bottom: 2px;
  border: 1px solid color-mix(in srgb, var(--wx-ink) 10%, transparent);
}
.swatch-midnight { background: linear-gradient(135deg, #000510 0%, #030018 50%, #000000 100%); }
.swatch-dawn     { background: linear-gradient(135deg, #fff5e8 0%, #ffe8f0 50%, #f0f4ff 100%); border-color: var(--wx-border-soft); }
.wx-me-theme-name { font-size: 13.5px; font-weight: 600; }
.wx-me-theme-hint { font-size: 11px; color: var(--wx-text-tertiary); }
.wx-me-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
}
.wx-me-switch-text { display: flex; flex-direction: column; gap: 3px; font-size: 13.5px; color: var(--wx-text-primary); }
.wx-me-switch-text em { font-style: normal; font-size: 11.5px; color: var(--wx-text-muted); }
.wx-me-switch {
  appearance: none;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 10%, transparent);
  border: 1px solid var(--wx-border-soft);
  position: relative;
  cursor: pointer;
  transition: background var(--wx-duration-fast) var(--wx-ease-out-soft);
  flex-shrink: 0;
}
.wx-me-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--wx-text-tertiary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-switch:checked { background: var(--wx-color-primary); }
.wx-me-switch:checked::after { left: 20px; background: #fff; }

/* 任务卡四字段预览入口 */
.wx-me-preview-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.wx-me-preview-desc { margin: 0; font-size: 12.5px; color: var(--wx-text-tertiary); }

/* 答题表现 */
.wx-me-perf { display: flex; flex-direction: column; gap: 10px; }
.wx-me-perf-num { display: flex; align-items: baseline; gap: 8px; }
.wx-me-perf-num .val {
  font-size: 40px;
  font-weight: 700;
  font-family: var(--wx-font-mono);
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-me-perf-num .unit { font-size: 12px; color: var(--wx-text-tertiary); }
.wx-me-perf-trend { font-size: 13px; color: var(--wx-text-secondary); }
.wx-me-perf-trend.up { color: var(--wx-state-deep); }
.wx-me-perf-trend.down { color: var(--wx-color-vermilion); }
.wx-me-perf-note { font-size: 11px; color: var(--wx-text-muted); line-height: 1.6; }

/* 复习提醒 */
.wx-me-review {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 190px;
  overflow-y: auto;
}
.wx-me-review-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 12px;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border-radius: var(--wx-radius-sm);
}
.wx-me-review-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.wx-me-review-dot.learning { background: var(--wx-color-primary); }
.wx-me-review-dot.mastered { background: var(--wx-state-deep); }
.wx-me-review-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wx-text-primary);
}
.wx-me-review-meta { color: var(--wx-text-muted); white-space: nowrap; }

/* 会员 */
.wx-me-membership-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.wx-me-membership-title { display: flex; align-items: center; gap: 12px; }
.wx-me-membership-tip {
  font-size: 11px;
  color: var(--wx-text-muted);
  padding: 2px 8px;
  border: 1px solid var(--wx-border-soft);
  border-radius: 999px;
}

/* 连续包月 / 包年 */
.wx-me-cycle {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 35%, transparent);
}
.wx-me-cycle-btn {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 7px 14px;
  border-radius: var(--wx-radius-pill);
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-cycle-btn:hover { color: var(--wx-text-primary); }
.wx-me-cycle-btn.active {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  box-shadow: var(--wx-shadow-glow);
}
.wx-me-cycle-btn em { font-style: normal; font-size: 10px; color: var(--wx-color-amber); }
.wx-me-cycle-btn.active em { color: var(--wx-text-on-accent); }

/* 动态支付二维码占位 */
.wx-me-pay-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 14px;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
}
.wx-me-pay-qr {
  width: 84px;
  height: 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--wx-radius-md);
  border: 1.5px dashed var(--wx-border-glow);
  background: repeating-linear-gradient(
    45deg,
    color-mix(in srgb, var(--wx-ink) 5%, transparent) 0,
    color-mix(in srgb, var(--wx-ink) 5%, transparent) 6px,
    transparent 6px,
    transparent 12px
  );
}
.wx-me-pay-qr-mark { font-size: 30px; color: var(--wx-text-muted); opacity: 0.75; }
.wx-me-pay-note { font-size: 11.5px; color: var(--wx-text-tertiary); }
.wx-me-pay-sub { font-size: 10px; color: var(--wx-text-muted); }

.wx-me-plans {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.wx-me-plan {
  padding: 22px 20px;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border: 1px solid var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  transition: all var(--wx-duration-mid) var(--wx-ease-spring);
}
.wx-me-plan.highlight {
  border-color: var(--wx-border-glow);
}
.wx-me-plan.highlight::before {
  content: '推荐';
  position: absolute;
  top: -8px;
  right: 16px;
  padding: 2px 10px;
  font-size: 10px;
  background: var(--wx-gradient-amber);
  border-radius: 999px;
  color: #1a1a1a;
  font-weight: 600;
}
.wx-me-plan-name {
  font-size: 17px;
  font-weight: 600;
  font-family: var(--wx-font-serif);
}
.wx-me-plan-price {
  font-size: 26px;
  font-weight: 700;
  font-family: var(--wx-font-mono);
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-me-plan-price-unit { font-size: 13px; color: var(--wx-text-muted); -webkit-text-fill-color: var(--wx-text-muted); }
.wx-me-plan-save {
  align-self: flex-start;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--wx-color-amber);
  background: color-mix(in srgb, var(--wx-color-amber) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-amber) 35%, transparent);
}
.wx-me-plan-features {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  flex: 1;
}
.wx-me-plan-features li::before { content: '✦ '; color: var(--wx-color-primary); }
.wx-me-plan-btn {
  margin-top: 8px;
  padding: 10px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
  border: 1px solid var(--wx-border-glow);
  color: var(--wx-text-secondary);
  font-size: 13px;
  cursor: not-allowed;
  opacity: 0.6;
}
.wx-me-plan-btn.active {
  opacity: 1;
  background: var(--wx-gradient-primary);
  border-color: transparent;
  color: var(--wx-text-on-accent);
  font-weight: 600;
}

/* 计费说明与模式描述（v1.3 取消会员制） */
.wx-me-billing-intro {
  margin: 4px 0 18px;
  padding: 12px 14px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--wx-text-secondary);
  background: color-mix(in srgb, var(--wx-color-primary) 7%, transparent);
  border-left: 2px solid var(--wx-border-glow);
  border-radius: var(--wx-radius-sm);
}
.wx-me-billing-mode-desc { font-size: 12.5px; color: var(--wx-text-tertiary); line-height: 1.6; }

/* 当前计费模式徽标（API 页） */
.wx-me-mode-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 8px;
  border: 1px solid transparent;
}
.wx-me-mode-badge.byo {
  color: var(--wx-state-deep);
  background: color-mix(in srgb, var(--wx-state-deep) 12%, transparent);
  border-color: color-mix(in srgb, var(--wx-state-deep) 35%, transparent);
}
.wx-me-mode-badge.platform {
  color: var(--wx-color-primary-soft);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  border-color: var(--wx-border-glow);
}

/* 功能对比表 */
.wx-me-compare {
  padding: 20px 0;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-me-compare-table { width: 100%; border-collapse: collapse; }
.wx-me-compare-table th,
.wx-me-compare-table td {
  padding: 10px 12px;
  font-size: 12.5px;
  text-align: center;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-me-compare-table th { color: var(--wx-text-tertiary); font-weight: 500; font-size: 12px; }
.wx-me-compare-table th.highlight { color: var(--wx-color-primary-soft); }
.wx-me-compare-table td { color: var(--wx-text-secondary); }
.wx-me-compare-label { text-align: left !important; color: var(--wx-text-primary); }
.wx-me-compare-table td.yes { color: var(--wx-state-deep); }
.wx-me-compare-table td.no { color: var(--wx-text-muted); }
.wx-me-compare-note {
  margin-top: 10px;
  font-size: 11px;
  color: var(--wx-text-muted);
  text-align: center;
}

/* 认证 */
.wx-me-verify-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.wx-me-verify-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 14px;
  text-align: left;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-verify-option:hover { border-color: var(--wx-border-glow); }
.wx-me-verify-option.active {
  border-color: var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 12%, transparent);
}
.wx-me-verify-icon { font-size: 20px; }
.wx-me-verify-opt-name { font-size: 13.5px; font-weight: 600; color: var(--wx-text-primary); }
.wx-me-verify-opt-desc { font-size: 11px; color: var(--wx-text-muted); line-height: 1.6; }
.wx-me-verify-field { display: flex; flex-direction: column; gap: 7px; }
.wx-me-verify-field .k { font-size: 11.5px; color: var(--wx-text-tertiary); }
.wx-me-verify-field input {
  padding: 10px 14px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
  color: var(--wx-text-primary);
  font-size: 13px;
}
.wx-me-verify-field input:focus-visible { border-color: var(--wx-border-glow); }
.wx-me-verify-msg { margin-top: 12px; font-size: 12px; }
.wx-me-verify-msg.error { color: var(--wx-color-vermilion); }
.wx-me-verify-msg.ok { color: var(--wx-state-deep); }
.wx-me-verify-submit {
  margin-top: 14px;
  padding: 10px 22px;
  border-radius: var(--wx-radius-pill);
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-size: 13px;
  font-weight: 600;
  box-shadow: var(--wx-shadow-glow);
}
.wx-me-verify-submit:disabled { opacity: 0.6; cursor: not-allowed; }
.wx-me-verify-note { margin-top: 12px; font-size: 11px; color: var(--wx-text-muted); line-height: 1.7; }
.wx-me-verify-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.wx-me-verify-status-main { display: flex; align-items: center; gap: 14px; }
.wx-me-verify-badge {
  flex-shrink: 0;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--wx-color-amber);
  background: color-mix(in srgb, var(--wx-color-amber) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-amber) 35%, transparent);
}
.wx-me-verify-line { font-size: 14px; color: var(--wx-text-primary); font-weight: 600; }
.wx-me-verify-sub { margin-top: 4px; font-size: 11.5px; color: var(--wx-text-muted); }
.wx-me-verify-revoke {
  padding: 8px 16px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-secondary);
  font-size: 12px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-verify-revoke:hover { border-color: color-mix(in srgb, var(--wx-color-vermilion) 50%, transparent); color: var(--wx-color-vermilion); }
.wx-me-verify-revoke:disabled { opacity: 0.6; cursor: not-allowed; }

/* 能力雷达图 */
.wx-me-radar-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.wx-me-radar-avg { font-size: 12px; color: var(--wx-text-tertiary); }
.wx-me-radar-avg b {
  font-family: var(--wx-font-mono);
  font-size: 14px;
  color: var(--wx-color-primary-soft);
}
.wx-me-radar-chart { margin: 0 auto 18px; }
.wx-me-radar-fallback {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--wx-text-muted);
  text-align: center;
}
.wx-me-radar-hint {
  margin-bottom: 12px;
  font-size: 11px;
  color: var(--wx-text-muted);
  text-align: center;
}
.wx-me-radar-empty {
  padding: 18px 0;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-me-radar-empty table {
  width: 100%;
  border-collapse: collapse;
}
.wx-me-radar-empty th,
.wx-me-radar-empty td {
  padding: 10px 14px;
  text-align: left;
  font-size: 13px;
  border-bottom: 1px solid var(--wx-border-soft);
}
.wx-me-radar-empty th {
  color: var(--wx-text-tertiary);
  font-weight: 500;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.wx-me-radar-empty td { color: var(--wx-text-secondary); font-family: var(--wx-font-mono); }
.wx-me-radar-empty td:first-child { font-family: var(--wx-font-sans); }
.wx-me-radar-empty td.zero { color: var(--wx-text-muted); }
.wx-me-radar-bar {
  display: inline-block;
  width: 120px;
  height: 6px;
  margin-right: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  overflow: hidden;
  vertical-align: middle;
}
.wx-me-radar-bar .fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--wx-gradient-primary);
  transition: width var(--wx-duration-mid) var(--wx-ease-out-soft);
}
.wx-me-radar-empty .pct { font-size: 12px; color: var(--wx-text-tertiary); }
.wx-me-radar-note {
  margin-top: 12px;
  font-size: 11px;
  color: var(--wx-text-muted);
  text-align: center;
}

/* 关于 */
.wx-me-about-brand { display: flex; align-items: center; gap: 14px; }
.wx-me-about-mark {
  font-size: 34px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 12px var(--wx-color-primary));
}
.wx-me-about-name { font-family: var(--wx-font-serif); font-size: 18px; font-weight: 600; }
.wx-me-about-ver { font-size: 12px; color: var(--wx-text-muted); }

/* 官网链接：悬浮变色 + 下划线 + 手型；右侧「已复制」轻提示 */
.wx-me-site { display: inline-flex; align-items: center; gap: 8px; }
.wx-me-link {
  color: var(--wx-text-secondary);
  cursor: pointer;
  transition: color var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-link:hover {
  color: var(--wx-color-primary-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.wx-me-site-copied { font-size: 11px; color: var(--wx-color-yanqing); }

/* 团队 */
.wx-me-about-team { display: flex; align-items: center; gap: 14px; }
.wx-me-team-mark {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--wx-font-serif);
  font-size: 20px;
  font-weight: 700;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  box-shadow: var(--wx-shadow-glow);
}
.wx-me-team-name { font-size: 15px; font-weight: 600; color: var(--wx-text-primary); letter-spacing: 0.08em; }
.wx-me-team-meta { margin-top: 3px; font-size: 11.5px; color: var(--wx-text-muted); }

/* 头像（侧栏与基本信息页） */
.wx-me-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  display: block;
}
.wx-me-avatar-row { display: flex; align-items: center; gap: 18px; }
.wx-me-avatar-big {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--wx-gradient-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  overflow: hidden;
  box-shadow: var(--wx-shadow-glow);
}
.wx-me-avatar-big img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wx-me-avatar-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.wx-me-avatar-btn {
  padding: 8px 18px;
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  border: 1px solid var(--wx-border-glow);
  color: var(--wx-text-primary);
  font-size: 12.5px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-avatar-btn:hover { background: color-mix(in srgb, var(--wx-color-primary) 26%, transparent); color: var(--wx-text-on-accent); }
.wx-me-avatar-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.wx-me-avatar-tip { font-size: 11px; color: var(--wx-text-muted); }

/* 商业合作 */
.wx-me-biz-list { display: flex; flex-direction: column; gap: 10px; }
.wx-me-biz-list li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border-radius: var(--wx-radius-md);
}
.wx-me-biz-name { font-size: 13.5px; font-weight: 600; color: var(--wx-text-primary); }
.wx-me-biz-desc { font-size: 12px; color: var(--wx-text-tertiary); line-height: 1.6; }
.wx-me-biz-contact {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.wx-me-biz-note { font-size: 11px; color: var(--wx-text-muted); line-height: 1.7; }

/* Tab 切换动效：淡入 + 轻微上移 */
.wx-me-swap-enter-active,
.wx-me-swap-leave-active {
  transition: opacity 0.22s var(--wx-ease-out-soft), transform 0.22s var(--wx-ease-out-soft);
}
.wx-me-swap-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.wx-me-swap-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ===== API 与充值 ===== */
.wx-me-apikey-row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.wx-me-apikey-input {
  flex: 1;
  padding: 10px 14px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
  color: var(--wx-text-primary);
  font-size: 13px;
  font-family: var(--wx-font-mono);
}
.wx-me-apikey-input:focus-visible { border-color: var(--wx-border-glow); }
.wx-me-apikey-btn {
  padding: 10px 20px;
  border-radius: var(--wx-radius-pill);
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.wx-me-apikey-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.wx-me-usage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.wx-me-usage-head .wx-me-card-title { margin-bottom: 0; }
.wx-me-usage-query {
  padding: 8px 16px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-glow);
  background: color-mix(in srgb, var(--wx-color-primary) 14%, transparent);
  color: var(--wx-text-primary);
  font-size: 12.5px;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-me-usage-query:hover { background: color-mix(in srgb, var(--wx-color-primary) 26%, transparent); color: var(--wx-text-on-accent); }
.wx-me-usage-query:disabled { opacity: 0.6; cursor: not-allowed; }

.wx-me-usage-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.wx-me-usage-stat {
  padding: 16px;
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
}
.wx-me-usage-stat-label { font-size: 12px; color: var(--wx-text-tertiary); margin-bottom: 8px; }
.wx-me-usage-stat-value {
  font-size: 26px;
  font-weight: 700;
  font-family: var(--wx-font-mono);
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-me-usage-stat-value .unit { font-size: 13px; color: var(--wx-text-muted); -webkit-text-fill-color: var(--wx-text-muted); }

/* 用量口径说明（仅统计平台 AI 调用） */
.wx-me-usage-note {
  margin-top: 12px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--wx-text-muted);
}

.wx-me-usage-quota {
  margin-top: 10px;
}
.wx-me-usage-quota-head {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  margin-bottom: 6px;
}
.wx-me-usage-quota-track {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 8%, transparent);
  overflow: hidden;
}
.wx-me-usage-quota-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--wx-gradient-primary);
  transition: width 300ms var(--wx-ease-out-soft);
}

.wx-me-usage-chart-title { font-size: 13px; color: var(--wx-text-secondary); margin-bottom: 12px; }
.wx-me-usage-bars { display: flex; flex-direction: column; gap: 10px; }
.wx-me-usage-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wx-me-usage-bar-label {
  width: 90px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--wx-text-secondary);
  text-align: right;
}
.wx-me-usage-bar-track {
  flex: 1;
  height: 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wx-ink) 6%, transparent);
  overflow: hidden;
}
.wx-me-usage-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--wx-gradient-primary);
  transition: width var(--wx-duration-mid) var(--wx-ease-out-soft);
}
.wx-me-usage-bar-val {
  width: 70px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--wx-text-primary);
  font-family: var(--wx-font-mono);
}
.wx-me-usage-bar-limit { color: var(--wx-text-muted); }

.wx-me-recharge-btn {
  margin-top: 12px;
  padding: 10px 24px;
  border-radius: var(--wx-radius-pill);
  background: var(--wx-gradient-amber);
  color: #1a1a1a;
  font-size: 13px;
  font-weight: 600;
}

/* 账户余额与兑换码 */
.wx-me-wallet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.wx-me-wallet-query {
  margin-top: 0;
  padding: 7px 16px;
  font-size: 12px;
}
.wx-me-wallet {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 4px;
  padding: 14px 16px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-primary) 10%, transparent);
  border: 1px solid var(--wx-border-soft);
}
.wx-me-wallet-label {
  font-size: 12px;
  color: var(--wx-text-secondary);
}
.wx-me-wallet-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--wx-text-on-accent);
  font-variant-numeric: tabular-nums;
}
.wx-me-wallet-error {
  color: var(--wx-color-danger, #e04f5f);
}
.wx-me-redeem-row {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.wx-me-redeem-input {
  flex: 1;
  padding: 10px 14px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 4%, transparent);
  color: var(--wx-text-primary);
  font-size: 13px;
  letter-spacing: 0.06em;
}
.wx-me-redeem-row .wx-me-recharge-btn {
  margin-top: 0;
  padding: 10px 20px;
  white-space: nowrap;
}

/* 赞赏与充值收款码 */
.wx-me-pay-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.wx-me-pay-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: var(--wx-radius-md);
  border: 1px solid var(--wx-border-soft);
  background: color-mix(in srgb, var(--wx-ink) 3%, transparent);
}
.wx-me-pay-img {
  width: 100%;
  height: 210px;
  object-fit: contain;
  border-radius: var(--wx-radius-sm);
  background: #fff;
}
.wx-me-pay-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-me-pay-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--wx-text-tertiary);
  text-align: center;
}
.wx-me-pay-user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-color-primary) 8%, transparent);
  border: 1px solid var(--wx-border-soft);
  font-size: 13px;
  color: var(--wx-text-secondary);
}
.wx-me-pay-user strong {
  color: var(--wx-text-primary);
  font-size: 15px;
  letter-spacing: 0.04em;
}
.wx-me-pay-user .wx-me-recharge-btn {
  margin-top: 0;
  padding: 6px 14px;
  font-size: 12px;
  white-space: nowrap;
}
.wx-me-pay-steps {
  margin: 14px 0 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--wx-text-secondary);
}
.wx-me-pay-steps strong {
  color: var(--wx-text-primary);
}
.wx-me-pay-warn {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: var(--wx-radius-md);
  font-size: 12px;
  line-height: 1.7;
  color: var(--wx-color-danger, #e04f5f);
  border: 1px solid color-mix(in srgb, var(--wx-color-danger, #e04f5f) 35%, transparent);
  background: color-mix(in srgb, var(--wx-color-danger, #e04f5f) 8%, transparent);
}
@media (max-width: 720px) {
  .wx-me-pay-grid {
    grid-template-columns: 1fr;
  }
}

/* 头像裁剪模态框 */
.wx-crop-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: color-mix(in srgb, var(--wx-bg-deep) 75%, transparent);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wx-crop-dialog {
  width: 90%;
  max-width: 360px;
  padding: 20px;
  border-radius: var(--wx-glass-radius);
  background: color-mix(in srgb, var(--wx-bg-deep) 96%, transparent);
  border: 1px solid var(--wx-border-soft);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.wx-crop-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--wx-text-primary);
  margin: 0;
}
.wx-crop-view {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: var(--wx-bg-deep-2);
  cursor: move;
  user-select: none;
  touch-action: none;
}
.wx-crop-img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: 100%;
  max-height: 100%;
  transform-origin: center center;
  pointer-events: none;
  -webkit-user-drag: none;
}
/* 圆形裁剪框：用 box-shadow 在圆形外做遮罩，内部透明 */
.wx-crop-frame {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--wx-ink) 85%, transparent);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.wx-crop-tip {
  font-size: 11.5px;
  color: var(--wx-text-muted);
  text-align: center;
  margin: 0;
}
.wx-crop-actions {
  display: flex;
  gap: 10px;
  width: 100%;
}
.wx-crop-cancel {
  flex: 1;
  padding: 10px;
  border-radius: var(--wx-radius-pill);
  border: 1px solid var(--wx-border-soft);
  color: var(--wx-text-secondary);
  font-size: 13px;
}
.wx-crop-confirm {
  flex: 1;
  padding: 10px;
  border-radius: var(--wx-radius-pill);
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-size: 13px;
  font-weight: 600;
}

/* 退出登录二次确认：危险动作用朱红 */
.wx-logout-dialog {
  max-width: 320px;
}
.wx-logout-confirm {
  background: var(--wx-color-vermilion);
  color: var(--wx-text-on-accent);
}
</style>
