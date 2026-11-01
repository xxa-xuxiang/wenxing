<!-- 个人中心（Tab 5）：资料卡 + 6 个分区 + 底部入口；全部请求由用户点击并确认后触发 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { useAuthStore } from '@/stores/authStore'
import { useMasteryStore } from '@/stores/masteryStore'
import { storage } from '@/utils/storage'
import { parseUserProfile, useAvatarUpload } from '@/components/me/useMeProfile'
import ProfileEditPopup from '@/components/me/ProfileEditPopup.vue'
import MemberPane from '@/components/me/MemberPane.vue'
import ApiPane from '@/components/me/ApiPane.vue'
import VerifyPane from '@/components/me/VerifyPane.vue'
import PersonalPane from '@/components/me/PersonalPane.vue'
import BasicPane from '@/components/me/BasicPane.vue'
import StudyPane from '@/components/me/StudyPane.vue'
import AboutPane from '@/components/me/AboutPane.vue'
import BizPane from '@/components/me/BizPane.vue'
import type { UserProfile } from '@/services/authService'

const router = useRouter()
const auth = useAuthStore()
const mastery = useMasteryStore()

const { uploaderWrap, avatarBusy, avatarUrl, requestAvatar, onAvatarRead } = useAvatarUpload()

// ===== 分区导航（6 个；关于 / 商务为底部入口弹层） =====
type MeTab = 'member' | 'api' | 'verify' | 'personal' | 'basic' | 'study'
const TABS: { key: MeTab; label: string }[] = [
  { key: 'member', label: '计费' },
  { key: 'api', label: 'API 与充值' },
  { key: 'verify', label: '认证' },
  { key: 'personal', label: '个性化' },
  { key: 'basic', label: '基本信息' },
  { key: 'study', label: '学习情况' }
]

function normalizeTab(raw: string): MeTab {
  return TABS.some((t) => t.key === raw) ? (raw as MeTab) : 'member'
}

const activeTab = ref<MeTab>(normalizeTab(storage.get<string>('meTab', 'member')))
watch(activeTab, (v) => storage.set('meTab', v))

const sheet = ref<'about' | 'biz' | null>(null)
function onSheetUpdate(show: boolean) {
  if (!show) sheet.value = null
}

// ===== 资料卡（本地渲染，不发请求） =====
const displayName = computed(() => auth.user?.nickname || auth.user?.username || '问星学者')
const profileInfo = computed(() => parseUserProfile(auth.user?.profile ?? null))

const archiveText = computed(() => {
  const p = profileInfo.value
  const text = [p?.identity, p?.stage].filter(Boolean).join(' · ')
  return text || '学习档案未完善，点击完善'
})

const domainsText = computed(() => {
  const list = profileInfo.value?.domains ?? []
  return list.length > 0 ? `已学领域：${list.join('、')}` : '零基础起步'
})

const verifyText = computed(() => {
  const v = profileInfo.value?.verification
  if (!v) return ''
  return v.status === 'approved' ? '已认证' : '认证审核中'
})

const stats = computed(() => mastery.stats)
const masteredPercent = computed(() =>
  stats.value.litCount === 0 ? 0 : Math.round((stats.value.masteredCount / stats.value.litCount) * 100)
)

// ===== 学习档案编辑（保存前确认） =====
const showProfileEdit = ref(false)

async function onProfileSave(p: UserProfile) {
  try {
    await showConfirmDialog({
      title: '保存学习档案',
      message: '将把学习档案保存到你的云端账号，是否继续？'
    })
  } catch {
    return
  }
  try {
    await auth.saveProfile(p)
    showToast('学习档案已保存')
    showProfileEdit.value = false
  } catch (e) {
    showToast((e as Error).message || '保存失败，请稍后重试')
  }
}

// ===== 底部入口 =====
function goFeedback() {
  router.push('/feedback')
}

async function handleLogout() {
  try {
    await showConfirmDialog({
      title: '退出登录',
      message: '退出后数据切换到未登录空间，云端数据保留，是否继续？'
    })
  } catch {
    return
  }
  auth.logout()
  router.replace('/auth')
}
</script>

<template>
  <div class="page-with-tabbar me-page">
    <!-- 资料卡：点击展开档案编辑；头像单独走上传确认 -->
    <section class="me-card me-profile" @click="showProfileEdit = true">
      <div class="me-profile-head">
        <button type="button" class="me-avatar" :disabled="avatarBusy" aria-label="更换头像" @click.stop="requestAvatar">
          <img :src="avatarUrl" alt="头像" />
          <span v-if="avatarBusy" class="me-avatar-mask">上传中…</span>
        </button>
        <div class="me-user">
          <div class="me-name-row">
            <span class="me-nickname">{{ displayName }}</span>
            <van-tag v-if="verifyText" type="primary" plain>{{ verifyText }}</van-tag>
          </div>
          <p class="me-archive">{{ archiveText }}</p>
          <p class="me-domains">{{ domainsText }}</p>
        </div>
        <van-icon name="arrow" class="me-arrow" />
      </div>

      <div class="me-stats">
        <div class="me-stat">
          <span class="me-stat-num">{{ stats.masteredCount }}</span>
          <span class="me-stat-label">已掌握</span>
        </div>
        <div class="me-stat">
          <span class="me-stat-num">{{ stats.litCount }}</span>
          <span class="me-stat-label">已点亮</span>
        </div>
        <div class="me-stat">
          <span class="me-stat-num">{{ stats.totalAnswers }}</span>
          <span class="me-stat-label">累计答题</span>
        </div>
      </div>
      <van-progress class="me-progress" :percentage="masteredPercent" :show-pivot="false" stroke-width="6" />
      <p class="me-stats-tip">点击资料卡完善学习档案 · {{ profileInfo ? '档案已建立' : '尚未建立档案' }}</p>
    </section>

    <!-- 6 个分区：横向滚动标签 -->
    <div class="me-tabs-wrap">
      <van-tabs v-model:active="activeTab" shrink class="me-tabs">
        <van-tab v-for="t in TABS" :key="t.key" :name="t.key" :title="t.label" />
      </van-tabs>
    </div>

    <div class="me-pane-wrap">
      <MemberPane v-if="activeTab === 'member'" />
      <ApiPane v-else-if="activeTab === 'api'" />
      <VerifyPane v-else-if="activeTab === 'verify'" />
      <PersonalPane v-else-if="activeTab === 'personal'" />
      <BasicPane v-else-if="activeTab === 'basic'" />
      <StudyPane v-else-if="activeTab === 'study'" />
    </div>

    <!-- 底部入口 -->
    <van-cell-group inset class="me-group">
      <van-cell title="关于问星" icon="info-o" is-link @click="sheet = 'about'" />
      <van-cell title="商务合作" icon="shop-o" is-link @click="sheet = 'biz'" />
      <van-cell title="我的反馈" icon="comment-o" is-link @click="goFeedback" />
    </van-cell-group>

    <van-cell-group inset class="me-group">
      <van-cell title="退出登录" class="me-logout-cell" @click="handleLogout" />
    </van-cell-group>

    <p class="me-foot">以星为图 · 以问为径</p>

    <!-- 隐藏的图片选择器：确认后程序化触发 -->
    <div ref="uploaderWrap" class="me-hidden-uploader">
      <van-uploader
        :after-read="onAvatarRead"
        :deletable="false"
        :max-count="9"
        accept="image/jpeg,image/png,image/webp,image/gif"
      />
    </div>

    <!-- 学习档案编辑 -->
    <ProfileEditPopup v-model:show="showProfileEdit" :profile="profileInfo" @save="onProfileSave" />

    <!-- 关于 / 商务合作弹层 -->
    <van-popup
      :show="sheet !== null"
      position="bottom"
      round
      closeable
      class="me-sheet"
      @update:show="onSheetUpdate"
    >
      <div class="me-sheet-body">
        <AboutPane v-if="sheet === 'about'" />
        <BizPane v-else-if="sheet === 'biz'" />
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.me-page {
  min-height: 100vh;
  padding-top: 12px;
  background: #f7f8fa;
}

.me-card {
  margin: 0 12px;
  background: #fff;
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 4px 14px rgba(25, 137, 250, 0.06);
}

.me-profile-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.me-avatar {
  position: relative;
  width: 58px;
  height: 58px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  overflow: hidden;
}

.me-avatar img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.me-avatar-mask {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.me-user {
  flex: 1;
  min-width: 0;
}

.me-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.me-nickname {
  font-size: 17px;
  font-weight: 600;
  color: #323233;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-archive {
  margin: 5px 0 0;
  font-size: 12px;
  color: #646566;
}

.me-domains {
  margin: 3px 0 0;
  font-size: 11px;
  color: #969799;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-arrow {
  color: #c8c9cc;
}

.me-stats {
  display: flex;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #f2f3f5;
}

.me-stat {
  flex: 1;
  text-align: center;
}

.me-stat-num {
  display: block;
  font-size: 18px;
  font-weight: 600;
  color: #323233;
}

.me-stat-label {
  font-size: 11px;
  color: #969799;
}

.me-progress {
  margin-top: 10px;
}

.me-stats-tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: #c8c9cc;
}

.me-tabs-wrap {
  margin: 12px 12px 0;
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(25, 137, 250, 0.06);
}

.me-tabs :deep(.van-tabs__wrap) {
  height: 44px;
}

.me-tabs :deep(.van-tab) {
  font-size: 13px;
  padding: 0 14px;
}

.me-tabs :deep(.van-tabs__line) {
  width: 20px;
  height: 3px;
  border-radius: 3px;
}

.me-pane-wrap {
  padding: 12px 12px 0;
}

.me-group {
  margin-top: 12px;
}

.me-logout-cell :deep(.van-cell__title) {
  color: #ee0a24;
  text-align: center;
}

.me-foot {
  text-align: center;
  font-size: 11px;
  color: #c8c9cc;
  margin: 20px 0 8px;
}

.me-hidden-uploader {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.me-sheet {
  max-height: 82vh;
}

.me-sheet-body {
  max-height: 82vh;
  overflow-y: auto;
  padding: 20px 12px calc(20px + env(safe-area-inset-bottom));
}
</style>
