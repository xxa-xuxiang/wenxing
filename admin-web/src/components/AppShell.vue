<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAdminAuthStore } from '../stores/adminAuth'
import { useThemeStore } from '../stores/theme'
import { useConfirm } from '../stores/confirm'

const route = useRoute()
const auth = useAdminAuthStore()
const theme = useThemeStore()
const { ask } = useConfirm()

const navItems = [
  { to: '/', label: '数据看板' },
  { to: '/insights', label: '数据洞察' },
  { to: '/users', label: '用户管理' },
  { to: '/community', label: '社区管理' },
  { to: '/books', label: '书架管理' },
  { to: '/questions', label: '题库管理' },
  { to: '/revenue', label: 'API 盈利' },
  { to: '/wallet', label: '充值与余额' },
  { to: '/fill-jobs', label: '铺题任务' },
  { to: '/docs', label: '文档管理' },
  { to: '/feedback', label: '用户反馈' },
  { to: '/audit-logs', label: '审计日志' }
]

const title = computed(() =>
  typeof route.meta.title === 'string' ? route.meta.title : '管理后台'
)

async function onLogout() {
  const ok = await ask({
    title: '退出登录',
    message: '确定要退出问星管理后台吗？',
    confirmText: '退出',
    danger: true
  })
  if (ok) await auth.logout()
}
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <RouterLink to="/" class="admin-brand">
        <span class="admin-brand-mark">✦</span>
        <span>问星管理后台</span>
      </RouterLink>
      <nav class="admin-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="admin-nav-link"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <div class="admin-main">
      <header class="admin-topbar">
        <h1 class="admin-topbar-title">{{ title }}</h1>
        <div class="admin-topbar-actions">
          <span class="admin-user">{{ auth.username || '管理员' }}</span>
          <button type="button" class="btn btn-ghost btn-sm" @click="theme.toggle()">
            {{ theme.mode === 'dark' ? '切换到浅色' : '切换到深色' }}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" @click="onLogout">
            退出登录
          </button>
        </div>
      </header>

      <main class="admin-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
