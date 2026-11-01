<!-- 问星 v0.6 — 首次进入学习档案引导窗（登录后 profile 为空时强制弹出，纯选择题采集；提交后进入学习计划制定流程） -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import type { UserProfile } from '@/services/authService'
import { industryMetas as industries } from '@/data/industriesMeta'

const auth = useAuthStore()
const router = useRouter()

/** 是否显示：已登录、档案未完善、非登录页 */
const visible = computed(() => !!auth.user && auth.user.profile === null)

const IDENTITIES = ['在校大学生', '研究生', '职场新人', '在职提升', '转行求职', '其他']
const STAGES = ['大一', '大二', '大三', '大四', '研究生', '0-1 年经验', '1-3 年经验', '3 年以上经验']

const identity = ref('')
const stage = ref('')
const pickedDomains = ref<string[]>([])
const error = ref('')
const saving = ref(false)

function pickIdentity(v: string) {
  identity.value = v
  error.value = ''
}

function pickStage(v: string) {
  stage.value = v
  error.value = ''
}

function toggleDomain(v: string) {
  const i = pickedDomains.value.indexOf(v)
  if (i >= 0) pickedDomains.value.splice(i, 1)
  else pickedDomains.value.push(v)
  error.value = ''
}

async function submit() {
  if (saving.value) return
  if (!identity.value || !stage.value) {
    error.value = '请先选择身份与当前阶段'
    return
  }
  saving.value = true
  try {
    const profile: UserProfile = {
      identity: identity.value,
      stage: stage.value,
      domains: [...pickedDomains.value]
    }
    await auth.saveProfile(profile)
    // 档案完成后直接进入学习计划制定流程（未选方向时工作台会出现「选择一个方向」）
    void router.push('/learn')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="wx-profile-mask">
      <div class="wx-profile-card wx-glass">
        <div class="wx-profile-head">
          <span class="wx-profile-logo">✦</span>
          <h2 class="wx-profile-title">完善学习档案</h2>
          <p class="wx-profile-sub">首次进入需要了解你的基本情况，便于定制学习建议</p>
        </div>

        <div class="wx-profile-field">
          <span class="wx-profile-label">你的身份 <i class="req">*</i></span>
          <div class="wx-profile-options">
            <button
              v-for="v in IDENTITIES"
              :key="v"
              type="button"
              class="wx-profile-opt"
              :class="{ active: identity === v }"
              @click="pickIdentity(v)"
            >
              {{ v }}
            </button>
          </div>
        </div>

        <div class="wx-profile-field">
          <span class="wx-profile-label">当前阶段 <i class="req">*</i></span>
          <div class="wx-profile-options">
            <button
              v-for="v in STAGES"
              :key="v"
              type="button"
              class="wx-profile-opt"
              :class="{ active: stage === v }"
              @click="pickStage(v)"
            >
              {{ v }}
            </button>
          </div>
        </div>

        <div class="wx-profile-field">
          <span class="wx-profile-label">
            学习过哪些领域的知识
            <span class="hint">可多选 · 零基础可不选</span>
          </span>
          <div class="wx-profile-options">
            <button
              v-for="ind in industries"
              :key="ind.id"
              type="button"
              class="wx-profile-opt"
              :class="{ active: pickedDomains.includes(ind.name) }"
              @click="toggleDomain(ind.name)"
            >
              {{ ind.name }}
            </button>
          </div>
        </div>

        <p v-if="error" class="wx-profile-error">⚠ {{ error }}</p>

        <button class="wx-profile-submit" type="button" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : '开始我的学习之旅' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wx-profile-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: color-mix(in srgb, var(--wx-bg-deep) 70%, transparent);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--wx-space-lg);
}

.wx-profile-card {
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  padding: var(--wx-space-xl);
  border-radius: var(--wx-glass-radius);
}

.wx-profile-head {
  text-align: center;
  margin-bottom: var(--wx-space-lg);
}

.wx-profile-logo {
  font-size: 28px;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.wx-profile-title {
  margin: var(--wx-space-xs) 0 var(--wx-space-sm);
  font-size: 20px;
  font-weight: 700;
  color: var(--wx-text-primary);
}

.wx-profile-sub {
  font-size: 13px;
  color: var(--wx-text-tertiary);
}

.wx-profile-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: var(--wx-space-md);
}

.wx-profile-label {
  font-size: 13px;
  color: var(--wx-text-secondary);
}

.hint {
  margin-left: 6px;
  font-size: 11px;
  color: var(--wx-text-muted);
}

.req {
  color: var(--wx-color-vermilion);
  font-style: normal;
}

.wx-profile-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wx-profile-opt {
  padding: 8px 16px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-pill);
  background: color-mix(in srgb, var(--wx-bg-deep) 40%, transparent);
  color: var(--wx-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}

.wx-profile-opt:hover {
  border-color: var(--wx-border-glow);
}

.wx-profile-opt.active {
  background: var(--wx-gradient-primary);
  border-color: transparent;
  color: var(--wx-text-on-accent);
  font-weight: 600;
}

.wx-profile-error {
  margin: 0 0 var(--wx-space-md);
  padding: 9px 12px;
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 30%, transparent);
  color: var(--wx-color-vermilion);
  font-size: 12px;
}

.wx-profile-submit {
  width: 100%;
  padding: 12px 0;
  border: none;
  border-radius: var(--wx-radius-md);
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: transform var(--wx-duration-fast) var(--wx-ease-spring), box-shadow var(--wx-duration-fast);
}

.wx-profile-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--wx-shadow-glow);
}

.wx-profile-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
