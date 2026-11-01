<script setup lang="ts">
// 底部悬浮导航栏：品牌（缩小）+ 4 入口 + 圆形用户头像（个人中心），白色半透明 + 圆角
import { useRoute } from 'vue-router'
import { computed } from 'vue'
import { useAuthStore } from '@/stores/authStore'

const route = useRoute()
const auth = useAuthStore()
const navs = [
  { to: '/learn', label: '学习', icon: '✦' },
  { to: '/atlas', label: '星图', icon: '✧' },
  { to: '/questions', label: '题库', icon: '◈' },
  { to: '/community', label: '社区', icon: '✿' }
]
const activePath = computed(() => route.path)
// 前缀匹配：子路由（如帖子详情）时所属入口仍高亮
function isActive(to: string): boolean {
  return activePath.value === to || activePath.value.startsWith(`${to}/`)
}
const meActive = computed(() => isActive('/me'))
// 头像字：昵称/用户名首字，未登录回退 ✦
const avatarChar = computed(() => (auth.user?.nickname || auth.user?.username || '✦').slice(0, 1))
// 自定义头像（基本信息页上传，存于 profile.avatar）
const avatarUrl = computed(() => {
  try {
    const p = auth.user?.profile ? (JSON.parse(auth.user.profile) as { avatar?: string }) : null
    return p?.avatar || ''
  } catch {
    return ''
  }
})
</script>

<template>
  <nav class="wx-nav" data-test="app-nav">
    <div class="wx-nav-brand">
      <span class="wx-nav-brand-mark">✦</span>
      <span class="wx-nav-brand-text">问星</span>
    </div>
    <ul class="wx-nav-links">
      <li v-for="n in navs" :key="n.to">
        <RouterLink
          :to="n.to"
          class="wx-nav-link"
          :class="{ active: isActive(n.to) }"
          :data-test="`nav-${n.to.slice(1)}`"
        >
          <span class="wx-nav-link-icon">{{ n.icon }}</span>
          <span class="wx-nav-link-text">{{ n.label }}</span>
        </RouterLink>
      </li>
    </ul>
    <!-- 个人中心：圆形用户头像 -->
    <RouterLink to="/me" class="wx-nav-avatar" :class="{ active: meActive }" title="个人中心" data-test="nav-me">
      <img v-if="avatarUrl" :src="avatarUrl" alt="头像" />
      <template v-else>{{ avatarChar }}</template>
    </RouterLink>
  </nav>
</template>

<style scoped>
.wx-nav {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px 10px 18px;
  height: 56px;
  background: color-mix(in srgb, var(--wx-bg-deep) 55%, transparent);
  backdrop-filter: blur(22px) saturate(170%);
  -webkit-backdrop-filter: blur(22px) saturate(170%);
  border: 1px solid color-mix(in srgb, var(--wx-ink) 14%, transparent);
  border-radius: 50px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 color-mix(in srgb, var(--wx-ink) 8%, transparent);
}

.wx-nav-brand {
  display: flex;
  align-items: center;
  gap: 5px;
  user-select: none;
  padding-right: 14px;
  border-right: 1px solid color-mix(in srgb, var(--wx-ink) 12%, transparent);
}
.wx-nav-brand-mark {
  font-size: 15px;
  color: var(--wx-color-primary);
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--wx-color-primary) 70%, transparent));
}
.wx-nav-brand-text {
  font-family: var(--wx-font-serif);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--wx-text-primary);
}

.wx-nav-links {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
}
.wx-nav-links li { height: 100%; display: flex; }

.wx-nav-link {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 13px;
  border-radius: 40px;
  color: var(--wx-text-secondary);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition:
    color var(--wx-duration-fast) var(--wx-ease-out-soft),
    background var(--wx-duration-fast) var(--wx-ease-out-soft),
    transform var(--wx-duration-fast) var(--wx-ease-spring);
}
.wx-nav-link:hover {
  color: var(--wx-text-on-accent);
  background: color-mix(in srgb, var(--wx-ink) 9%, transparent);
  transform: translateY(-1px);
}
.wx-nav-link-icon {
  font-size: 13px;
  margin-right: 6px;
  opacity: 0.85;
}
.wx-nav-link.active {
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--wx-color-primary) 50%, transparent), inset 0 1px 0 color-mix(in srgb, var(--wx-ink) 20%, transparent);
}
.wx-nav-link.active .wx-nav-link-icon {
  opacity: 1;
  color: var(--wx-text-on-accent);
}

/* 圆形用户头像（个人中心入口） */
.wx-nav-avatar {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--wx-gradient-primary);
  color: var(--wx-text-on-accent);
  font-size: 14px;
  font-weight: 600;
  user-select: none;
  border: 2px solid color-mix(in srgb, var(--wx-ink) 55%, transparent);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--wx-color-primary) 45%, transparent);
  transition: transform var(--wx-duration-fast) var(--wx-ease-spring), box-shadow var(--wx-duration-fast) var(--wx-ease-out-soft);
}
.wx-nav-avatar:hover { transform: translateY(-1px) scale(1.05); box-shadow: 0 6px 20px color-mix(in srgb, var(--wx-color-primary) 60%, transparent); }
.wx-nav-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block; }
.wx-nav-avatar.active {
  border-color: var(--wx-text-on-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--wx-color-primary) 85%, transparent), 0 6px 20px color-mix(in srgb, var(--wx-color-primary) 60%, transparent);
}
</style>
