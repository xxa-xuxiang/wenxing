<!-- 认证分区：权威学者 / 学生 / 企业员工；提交后置 pending（与桌面端一致） -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useAuthStore } from '@/stores/authStore'
import { parseUserProfile } from './useMeProfile'
import type { UserProfile, VerificationType } from '@/services/authService'

const auth = useAuthStore()

const profileInfo = computed(() => parseUserProfile(auth.user?.profile ?? null))

const VERIFY_OPTIONS: {
  id: VerificationType
  name: string
  icon: string
  desc: string
  orgLabel: string
  orgPlaceholder: string
}[] = [
  {
    id: 'scholar',
    name: '权威学者',
    icon: '🎓',
    desc: '高校 / 研究机构的教师、研究员、博士',
    orgLabel: '所在机构',
    orgPlaceholder: '如：XX 大学 计算机学院'
  },
  {
    id: 'student',
    name: '学生',
    icon: '📚',
    desc: '在读本科、硕士、博士学生',
    orgLabel: '所在学校',
    orgPlaceholder: '如：XX 大学 物联网工程'
  },
  {
    id: 'employee',
    name: '某企业员工',
    icon: '🏢',
    desc: '企业 / 组织的在职员工',
    orgLabel: '所属企业',
    orgPlaceholder: '如：XX 科技有限公司'
  }
]

const verifyType = ref<VerificationType>('student')
const verifyOrg = ref('')
const verifyBusy = ref(false)

/** 已提交的认证信息（来自 profile JSON） */
const verification = computed(() => profileInfo.value?.verification ?? null)
const verifyOptionName = computed(
  () => VERIFY_OPTIONS.find((o) => o.id === verification.value?.type)?.name ?? ''
)
const verifySubmittedText = computed(() => {
  const v = verification.value
  return v ? new Date(v.submittedAt).toLocaleString('zh-CN') : ''
})
const currentOption = computed(() => VERIFY_OPTIONS.find((o) => o.id === verifyType.value))

async function submitVerification() {
  if (verifyBusy.value) return
  const org = verifyOrg.value.trim()
  if (!org) {
    showToast('请填写机构 / 学校 / 企业名称')
    return
  }
  try {
    await showConfirmDialog({
      title: '提交认证申请',
      message: `将以「${currentOption.value?.name ?? '学生'}」身份提交到 ${org}，是否继续？`
    })
  } catch {
    return
  }
  verifyBusy.value = true
  try {
    const base: UserProfile = profileInfo.value ?? { identity: '', stage: '', domains: [] }
    await auth.saveProfile({
      ...base,
      verification: { type: verifyType.value, org, status: 'pending', submittedAt: Date.now() }
    })
    verifyOrg.value = ''
    showToast('认证申请已提交')
  } catch (e) {
    showToast((e as Error).message || '提交失败，请稍后重试')
  } finally {
    verifyBusy.value = false
  }
}

async function revokeVerification() {
  const current = profileInfo.value
  if (verifyBusy.value || !current) return
  try {
    await showConfirmDialog({
      title: '撤销认证申请',
      message: '撤销后昵称旁将不再展示认证标识，是否继续？'
    })
  } catch {
    return
  }
  verifyBusy.value = true
  try {
    await auth.saveProfile({ ...current, verification: null })
    showToast('已撤销认证申请')
  } catch (e) {
    showToast((e as Error).message || '撤销失败，请稍后重试')
  } finally {
    verifyBusy.value = false
  }
}
</script>

<template>
  <div class="pane">
    <section v-if="verification" class="card">
      <h3 class="card-title">认证状态</h3>
      <div class="status-row">
        <span class="badge">☑ 审核中</span>
        <div class="status-main">
          <div class="status-line">{{ verifyOptionName }} · {{ verification.org }}</div>
          <div class="status-sub">提交于 {{ verifySubmittedText }}</div>
        </div>
      </div>
      <p class="tip">审核通过后将在昵称旁展示认证标识；问星暂不提供在线审核。</p>
      <van-button round block plain type="danger" :loading="verifyBusy" @click="revokeVerification">
        撤销申请
      </van-button>
    </section>

    <section v-else class="card">
      <h3 class="card-title">选择认证类型</h3>
      <div class="options">
        <button
          v-for="o in VERIFY_OPTIONS"
          :key="o.id"
          type="button"
          class="option"
          :class="{ active: verifyType === o.id }"
          @click="verifyType = o.id"
        >
          <span class="option-icon">{{ o.icon }}</span>
          <span class="option-name">{{ o.name }}</span>
          <span class="option-desc">{{ o.desc }}</span>
        </button>
      </div>

      <van-field
        v-model="verifyOrg"
        :label="currentOption?.orgLabel"
        :placeholder="currentOption?.orgPlaceholder"
        maxlength="60"
        clearable
        class="org-field"
      />

      <van-button round block type="primary" :loading="verifyBusy" class="submit-btn" @click="submitVerification">
        提交认证申请
      </van-button>
      <p class="tip">认证信息仅用于身份标识；问星暂不提供在线审核，提交后状态为「审核中」。</p>
    </section>
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

.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.option {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 14px;
  text-align: left;
  border-radius: 12px;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
  transition: all 0.15s ease;
}

.option.active {
  border-color: #1989fa;
  background: rgba(25, 137, 250, 0.08);
}

.option-icon {
  font-size: 18px;
}

.option-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #323233;
}

.option-desc {
  width: 100%;
  font-size: 11px;
  line-height: 1.6;
  color: #969799;
}

.org-field {
  border-radius: 10px;
  background: #f7f8fa;
  margin-bottom: 14px;
}

.submit-btn {
  margin-top: 2px;
}

.tip {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: #969799;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.badge {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  color: #ff976a;
  background: rgba(255, 151, 106, 0.12);
  border: 1px solid rgba(255, 151, 106, 0.35);
}

.status-main {
  min-width: 0;
}

.status-line {
  font-size: 13.5px;
  font-weight: 600;
  color: #323233;
}

.status-sub {
  margin-top: 3px;
  font-size: 11px;
  color: #969799;
}
</style>
