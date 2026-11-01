import { createRouter, createWebHashHistory } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import LoginView from '../views/LoginView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import DashboardView from '../views/DashboardView.vue'
import InsightsView from '../views/InsightsView.vue'
import UsersView from '../views/UsersView.vue'
import CommunityView from '../views/CommunityView.vue'
import BooksView from '../views/BooksView.vue'
import QuestionsView from '../views/QuestionsView.vue'
import FillJobsView from '../views/FillJobsView.vue'
import DocsView from '../views/DocsView.vue'
import RevenueView from '../views/RevenueView.vue'
import WalletView from '../views/WalletView.vue'
import FeedbackView from '../views/FeedbackView.vue'
import AuditLogsView from '../views/AuditLogsView.vue'
import { useAdminAuthStore } from '../stores/adminAuth'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
  }
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      component: LoginView,
      meta: { public: true, title: '登录' }
    },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: '', component: DashboardView, meta: { title: '数据看板' } },
        { path: 'insights', component: InsightsView, meta: { title: '数据洞察' } },
        { path: 'users', component: UsersView, meta: { title: '用户管理' } },
        { path: 'community', component: CommunityView, meta: { title: '社区管理' } },
        { path: 'books', component: BooksView, meta: { title: '书架管理' } },
        { path: 'questions', component: QuestionsView, meta: { title: '题库管理' } },
        { path: 'revenue', component: RevenueView, meta: { title: 'API 盈利' } },
        { path: 'wallet', component: WalletView, meta: { title: '充值与余额' } },
        { path: 'fill-jobs', component: FillJobsView, meta: { title: '铺题任务' } },
        { path: 'docs', component: DocsView, meta: { title: '文档管理' } },
        { path: 'feedback', component: FeedbackView, meta: { title: '用户反馈' } },
        { path: 'audit-logs', component: AuditLogsView, meta: { title: '审计日志' } },
        {
          path: ':pathMatch(.*)*',
          component: NotFoundView,
          meta: { title: '页面不存在' }
        }
      ]
    }
  ]
})

router.beforeEach(async (to) => {
  const auth = useAdminAuthStore()
  await auth.init()

  if (!to.meta.public && !auth.token) {
    return {
      path: '/login',
      query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined
    }
  }

  if (to.meta.public && auth.token && to.path === '/login') {
    return { path: '/' }
  }

  return true
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : ''
  document.title = title ? `${title} · 问星管理后台` : '问星管理后台'
})

export default router
