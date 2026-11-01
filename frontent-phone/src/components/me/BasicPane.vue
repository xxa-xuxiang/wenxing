<!-- 基本信息分区：头像 / 账号只读信息 / 学习档案编辑 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useAuthStore } from '@/stores/authStore'
import { parseUserProfile, useAvatarUpload } from './useMeProfile'
import ProfileEditPopup from './ProfileEditPopup.vue'
import type { UserProfile } from '@/services/authService'

const auth = useAuthStore()
const { uploaderWrap, avatarBusy, avatarUrl, requestAvatar, onAvatarRead } = useAvatarUpload()

const profileInfo = computed(() => parseUserProfile(auth.user?.profile ?? null))

const syncLabel = computed(() => {
  if (!auth.user) return '数据本地存储 · 未登录'
  return auth.offline ? '后端离线 · 数据暂存本地' : '数据已云端同步'
})

const createdAtText = computed(() => {
  const v = auth.user?.createdAt
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN')
})

const inviteCode = computed(() => auth.user?.inviteCode ?? '')

async function copyInviteCode() {
  if (!inviteCode.value) return
  try {
    await navigator.clipboard.writeText(inviteCode.value)
    showToast('邀请码已复制')
  } catch {
    showToast('剪贴板不可用，请手动复制')
  }
}

// ===== 学习档案编辑：保存前确认 =====
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
</script>

<template>
  <div class="pane">
    <section class="card">
      <h3 class="card-title">头像</h3>
      <div class="avatar-row">
        <button type="button" class="avatar-btn" :disabled="avatarBusy" aria-label="更换头像" @click.stop="requestAvatar">
          <img :src="avatarUrl" alt="头像" />
          <span v-if="avatarBusy" class="avatar-mask">上传中…</span>
        </button>
        <div class="avatar-actions">
          <van-button size="small" round type="primary" plain :disabled="avatarBusy" @click="requestAvatar">
            {{ avatarBusy ? '上传中…' : '选择图片' }}
          </van-button>
          <p class="tip">支持 JPG / PNG / WebP / GIF，自动压缩后上传</p>
        </div>
      </div>
      <div ref="uploaderWrap" class="hidden-uploader">
        <van-uploader
          :after-read="onAvatarRead"
          :deletable="false"
          :max-count="9"
          accept="image/jpeg,image/png,image/webp,image/gif"
        />
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">账号</h3>
      <div class="grid">
        <div class="item">
          <span class="k">昵称</span>
          <span class="v">{{ auth.user?.nickname || '未设置' }}</span>
        </div>
        <div class="item">
          <span class="k">用户名</span>
          <span class="v">{{ auth.user?.username || '--' }}</span>
        </div>
        <div class="item">
          <span class="k">用户 ID</span>
          <span class="v">{{ auth.user?.id || '--' }}</span>
        </div>
        <div class="item">
          <span class="k">注册时间</span>
          <span class="v">{{ createdAtText }}</span>
        </div>
        <div class="item">
          <span class="k">同步状态</span>
          <span class="v">{{ syncLabel }}</span>
        </div>
        <div v-if="inviteCode" class="item">
          <span class="k">我的邀请码</span>
          <span class="v invite">
            {{ inviteCode }}
            <button type="button" class="copy-btn" @click="copyInviteCode">复制</button>
          </span>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">学习档案</h3>
      <div v-if="profileInfo" class="grid">
        <div class="item">
          <span class="k">身份</span>
          <span class="v">{{ profileInfo.identity || '未填写' }}</span>
        </div>
        <div class="item">
          <span class="k">当前阶段</span>
          <span class="v">{{ profileInfo.stage || '未填写' }}</span>
        </div>
        <div class="item wide">
          <span class="k">学过的领域</span>
          <span class="v wrap">
            {{ profileInfo.domains.length ? profileInfo.domains.join('、') : '暂无 · 零基础起步' }}
          </span>
        </div>
      </div>
      <p v-else class="empty">尚未建立学习档案，点击下方按钮完善</p>
      <van-button round block type="primary" plain class="edit-btn" @click="showProfileEdit = true">
        {{ profileInfo ? '编辑学习档案' : '完善学习档案' }}
      </van-button>
    </section>

    <ProfileEditPopup v-model:show="showProfileEdit" :profile="profileInfo" @save="onProfileSave" />
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: #fff;
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 4px 14px rgba(25, 137, 250, 0.06);
}

.card-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar-btn {
  position: relative;
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  overflow: hidden;
}

.avatar-btn img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.avatar-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 10px;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.tip {
  margin: 0;
  font-size: 11px;
  color: #969799;
}

.hidden-uploader {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 10px;
  background: #f7f8fa;
}

.item.wide {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.k {
  flex-shrink: 0;
  font-size: 11.5px;
  color: #969799;
}

.v {
  font-size: 12.5px;
  color: #323233;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v.wrap {
  white-space: normal;
  line-height: 1.6;
}

.invite {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  letter-spacing: 0.5px;
}

.copy-btn {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid #ebedf0;
  background: #fff;
  color: #646566;
  font-size: 11px;
}

.edit-btn {
  margin-top: 2px;
}

.empty {
  margin: 0 0 12px;
  padding: 16px;
  border: 1px dashed #ebedf0;
  border-radius: 10px;
  text-align: center;
  font-size: 12px;
  color: #969799;
}
</style>
