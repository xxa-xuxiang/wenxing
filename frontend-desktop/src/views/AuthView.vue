<!-- 问星 v0.6 — 登录/注册页（账号密码 + JWT；扫码登录留给后续独立 APP） -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const auth = useAuthStore()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const nickname = ref('')
const password = ref('')
const password2 = ref('')
const inviteCode = ref('')
const error = ref('')
const loading = ref(false)

const isLogin = computed(() => mode.value === 'login')

function switchMode(m: 'login' | 'register') {
  mode.value = m
  error.value = ''
}

/** 前端预校验（与后端规则一致：用户名 1-24 位中文/字母/数字/下划线，密码 ≥6 位） */
function validate(): string {
  const name = username.value.trim()
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_]{1,24}$/.test(name)) {
    return '用户名需为 1-24 位中文、字母、数字或下划线'
  }
  if (password.value.length < 6) return '密码至少 6 位'
  if (!isLogin.value && password.value !== password2.value) return '两次输入的密码不一致'
  return ''
}

async function submit() {
  if (loading.value) return
  error.value = validate()
  if (error.value) return
  loading.value = true
  try {
    if (isLogin.value) {
      await auth.login(username.value.trim(), password.value)
    } else {
      await auth.register(username.value.trim(), password.value, nickname.value.trim(), inviteCode.value.trim())
    }
    // 登录成功（含数据同步完成后）进入工作台
    await router.replace('/learn')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '请求失败，请检查后端是否启动'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="wx-auth">
    <div class="wx-auth-card wx-glass">
      <div class="wx-auth-brand">
        <span class="wx-auth-logo">✦</span>
        <h1 class="wx-auth-title">问星</h1>
        <p class="wx-auth-sub">{{ isLogin ? '登录后学习数据云端同步' : '注册账号，开启你的学习星图' }}</p>
      </div>

      <!-- 登录 / 注册切换 -->
      <div class="wx-auth-tabs">
        <button class="wx-auth-tab" :class="{ active: isLogin }" type="button" @click="switchMode('login')">
          登录
        </button>
        <button class="wx-auth-tab" :class="{ active: !isLogin }" type="button" @click="switchMode('register')">
          注册
        </button>
      </div>

      <form class="wx-auth-form" @submit.prevent="submit">
        <label class="wx-auth-field">
          <span class="wx-auth-label">用户名</span>
          <input
            v-model="username"
            class="wx-auth-input"
            type="text"
            placeholder="1-24 位中文、字母、数字或下划线"
            autocomplete="username"
            maxlength="24"
          />
        </label>
        <label v-if="!isLogin" class="wx-auth-field">
          <span class="wx-auth-label">昵称（可选）</span>
          <input
            v-model="nickname"
            class="wx-auth-input"
            type="text"
            placeholder="展示在个人中心的名字"
            maxlength="24"
          />
        </label>
        <label class="wx-auth-field">
          <span class="wx-auth-label">密码</span>
          <input
            v-model="password"
            class="wx-auth-input"
            type="password"
            placeholder="至少 6 位"
            :autocomplete="isLogin ? 'current-password' : 'new-password'"
          />
        </label>
        <label v-if="!isLogin" class="wx-auth-field">
          <span class="wx-auth-label">确认密码</span>
          <input
            v-model="password2"
            class="wx-auth-input"
            type="password"
            placeholder="再次输入密码"
            autocomplete="new-password"
          />
        </label>
        <label v-if="!isLogin" class="wx-auth-field">
          <span class="wx-auth-label">邀请码（选填）</span>
          <input
            v-model="inviteCode"
            class="wx-auth-input"
            type="text"
            placeholder="填写好友的邀请码"
            maxlength="16"
            autocomplete="off"
          />
        </label>

        <p v-if="error" class="wx-auth-error">⚠ {{ error }}</p>

        <button class="wx-auth-submit" type="submit" :disabled="loading">
          {{ loading ? '请稍候…' : isLogin ? '登录' : '注册并开始学习' }}
        </button>
      </form>

      <p class="wx-auth-note">数据同步基于本地后端 · 后续版本支持 APP 扫码登录</p>
    </div>
  </div>
</template>

<style scoped>
.wx-auth {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--wx-space-lg);
}

.wx-auth-card {
  width: 100%;
  max-width: 400px;
  padding: var(--wx-space-xl);
  border-radius: var(--wx-glass-radius);
}

.wx-auth-brand {
  text-align: center;
  margin-bottom: var(--wx-space-lg);
}

.wx-auth-logo {
  font-size: 34px;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.wx-auth-title {
  margin: var(--wx-space-xs) 0 var(--wx-space-sm);
  font-size: 24px;
  font-weight: 700;
  color: var(--wx-text-primary);
  letter-spacing: 2px;
}

.wx-auth-sub {
  font-size: 13px;
  color: var(--wx-text-tertiary);
}

/* Tab 切换 */
.wx-auth-tabs {
  display: flex;
  gap: var(--wx-space-xs);
  background: color-mix(in srgb, var(--wx-bg-deep) 50%, transparent);
  border-radius: var(--wx-radius-pill);
  padding: 4px;
  margin-bottom: var(--wx-space-lg);
}

.wx-auth-tab {
  flex: 1;
  padding: 9px 0;
  border: none;
  border-radius: var(--wx-radius-pill);
  background: transparent;
  color: var(--wx-text-tertiary);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--wx-duration-fast) var(--wx-ease-out-soft);
}

.wx-auth-tab.active {
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-weight: 600;
}

/* 表单 */
.wx-auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--wx-space-md);
}

.wx-auth-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wx-auth-label {
  font-size: 12px;
  color: var(--wx-text-secondary);
}

.wx-auth-input {
  padding: 11px 14px;
  border: 1px solid var(--wx-border-soft);
  border-radius: var(--wx-radius-md);
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  color: var(--wx-text-primary);
  font-size: 14px;
  font-family: var(--wx-font-sans);
  outline: none;
  transition: border-color var(--wx-duration-fast) var(--wx-ease-out-soft);
}

.wx-auth-input::placeholder {
  color: var(--wx-text-muted);
}

.wx-auth-input:focus {
  border-color: var(--wx-border-glow);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wx-color-primary) 15%, transparent);
}

.wx-auth-error {
  margin: 0;
  padding: 9px 12px;
  border-radius: var(--wx-radius-sm);
  background: color-mix(in srgb, var(--wx-color-vermilion) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wx-color-vermilion) 30%, transparent);
  color: var(--wx-color-vermilion);
  font-size: 12px;
}

.wx-auth-submit {
  margin-top: var(--wx-space-xs);
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

.wx-auth-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--wx-shadow-glow);
}

.wx-auth-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.wx-auth-note {
  margin: var(--wx-space-lg) 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--wx-text-muted);
}
</style>
