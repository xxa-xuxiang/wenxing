<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAdminStatus } from '../services/adminApi'
import { useAdminAuthStore } from '../stores/adminAuth'

const route = useRoute()
const router = useRouter()
const auth = useAdminAuthStore()

const username = ref('')
const password = ref('')
const submitting = ref(false)
const serviceDisabled = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    const status = await getAdminStatus()
    serviceDisabled.value = !status.enabled
  } catch {
    // 后端未启动或接口异常时按可用处理，避免登录页不可用
    serviceDisabled.value = false
  }
})

async function submit() {
  if (submitting.value || serviceDisabled.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.login(username.value, password.value)
    const redirect =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
        ? route.query.redirect
        : '/'
    await router.replace(redirect)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">问星管理后台</h1>
      <p class="login-sub">管理员账号登录</p>

      <div v-if="serviceDisabled" class="login-notice">
        服务端未配置管理员账号，请先在 backend-cloud/server/.env 配置 ADMIN_USERNAME /
        ADMIN_PASSWORD
      </div>

      <form class="login-form" @submit.prevent="submit">
        <div class="field">
          <label class="field-label" for="admin-username">账号</label>
          <input
            id="admin-username"
            v-model.trim="username"
            class="input"
            type="text"
            autocomplete="username"
            placeholder="请输入管理员账号"
            required
          />
        </div>
        <div class="field">
          <label class="field-label" for="admin-password">密码</label>
          <input
            id="admin-password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            required
          />
        </div>

        <p v-if="error" class="login-error">{{ error }}</p>

        <button
          type="submit"
          class="btn btn-primary"
          :disabled="submitting || serviceDisabled"
        >
          {{ submitting ? '登录中…' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>
