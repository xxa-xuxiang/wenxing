// 问星 v0.6 — 路由（4 入口 + 登录页 + 全局鉴权守卫）
import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { trackRouteChange } from '@/services/trackService'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/learn'
    },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('@/views/AuthView.vue'),
      meta: { title: '登录' }
    },
    {
      path: '/learn',
      name: 'learn',
      component: () => import('@/views/LearnView.vue'),
      meta: { title: '学习' }
    },
    {
      path: '/atlas',
      name: 'atlas',
      component: () => import('@/views/AtlasView.vue'),
      meta: { title: '星图' }
    },
    {
      path: '/questions',
      name: 'questions',
      component: () => import('@/views/QuestionsView.vue'),
      meta: { title: '题库' }
    },
    {
      // 答题模式：全屏页面（由题库勾选/能力点入口进入，直开无会话自动回题库）
      path: '/quiz',
      name: 'quiz',
      component: () => import('@/views/QuizView.vue'),
      meta: { title: '答题' }
    },
    {
      // 我的试卷：智能组卷产出物管理（组卷 → 卷面 → 整卷答题 / 导出 / 复盘）
      path: '/papers',
      name: 'papers',
      component: () => import('@/views/PapersView.vue'),
      meta: { title: '我的试卷' }
    },
    {
      path: '/community',
      name: 'community',
      component: () => import('@/views/community/CommunityView.vue'),
      meta: { title: '社区' }
    },
    {
      // 静态段 /community/new 必须注册在动态段 /community/:id 之前，避免 new 被当作帖子 id
      path: '/community/new',
      name: 'community-new',
      component: () => import('@/views/community/PostEditorView.vue'),
      meta: { title: '发布帖子' }
    },
    {
      // 个人文章管理界面：静态段同样必须注册在 /community/:id 之前
      path: '/community/mine',
      name: 'community-mine',
      component: () => import('@/views/community/MyPostsView.vue'),
      meta: { title: '我的文章' }
    },
    {
      path: '/community/books/:id',
      name: 'community-book-reader',
      component: () => import('@/views/community/BookReaderView.vue'),
      meta: { title: '书籍阅读' }
    },
    {
      path: '/community/:id',
      name: 'community-post',
      component: () => import('@/views/community/PostDetailView.vue'),
      meta: { title: '帖子详情' }
    },
    {
      path: '/feedback',
      name: 'feedback',
      component: () => import('@/views/FeedbackView.vue'),
      meta: { title: '反馈中心' }
    },
    {
      path: '/me',
      name: 'me',
      component: () => import('@/views/MeView.vue'),
      meta: { title: '个人中心' }
    },
    {
      // 404 兜底：未知路由不再白屏
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: '页面未找到' }
    }
  ]
})

// 全局鉴权守卫：未登录 → /auth；已登录访问 /auth → /learn。
// offline（后端不可达）时放行，保持本地模式可用。
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  try {
    await auth.init()
  } catch {
    // 初始化异常不得阻塞路由：按离线模式放行，避免整页停在空白主区
  }
  if (!auth.user && !auth.offline && to.path !== '/auth') {
    return { path: '/auth' }
  }
  if (auth.user && to.path === '/auth') {
    return { path: '/learn' }
  }
})

router.afterEach((to) => {
  const title = (to.meta.title as string) || '问星'
  document.title = `${title} · 问星`
  // 行为埋点：view_leave（上一 screen 停留时长）+ view_enter（登录页等所有路由均上报）
  trackRouteChange(to.path)
})

export default router
