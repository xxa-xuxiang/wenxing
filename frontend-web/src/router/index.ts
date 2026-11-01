// 问星社区网页端 — 路由（社区专属 + 公开浏览守卫）
// 与桌面端的差异：桌面端「未登录一律跳登录页」，网页端「公开浏览免登录，仅写入口要求登录」
import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/community' },
    {
      path: '/community',
      name: 'community',
      component: () => import('@/views/community/CommunityView.vue'),
      meta: { title: '社区' }
    },
    // 静态段必须注册在 /community/:id 之前，避免 new / mine 被当作帖子 id
    {
      path: '/community/new',
      name: 'community-new',
      component: () => import('@/views/community/PostEditorView.vue'),
      meta: { title: '发布帖子' }
    },
    {
      path: '/community/mine',
      name: 'community-mine',
      component: () => import('@/views/community/MyPostsView.vue'),
      meta: { title: '我的文章' }
    },
    {
      path: '/community/:id',
      name: 'community-post',
      component: () => import('@/views/community/PostDetailView.vue'),
      meta: { title: '帖子详情' }
    },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('@/views/AuthView.vue'),
      meta: { title: '登录' }
    },
    // 兼容桌面端专有路由泄漏：AuthView 登录成功 replace('/learn')、MyPostsView 的「笔记 / 去学习」入口
    { path: '/learn', redirect: '/community' },
    // 未知路径兜底：不白屏
    { path: '/:pathMatch(.*)*', redirect: '/community' }
  ]
})

// 公开浏览：不拦截任何读页面；仅写入口要求登录
const AUTH_REQUIRED = ['/community/new', '/community/mine']

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  if (AUTH_REQUIRED.includes(to.path) && !auth.user) {
    return { path: '/auth', query: { redirect: to.fullPath } }
  }
})

router.afterEach((to) => {
  const title = (to.meta.title as string) || '社区'
  document.title = `${title} · 问星社区`
})

export default router
