<!-- 问星移动端 — 应用外壳：路由视图 + 主页面底部 TabBar（学习/星图/题库/社区/我的） -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useAuthStore } from '@/stores/authStore'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
// 仅 5 个主 Tab 显示底部导航；二级页（/auth /quiz /papers /community/:id 等）全屏自管
const TAB_PATHS = ['/learn', '/atlas', '/questions', '/community', '/me']
const showTabbar = computed(() => TAB_PATHS.includes(route.path))

/** 账号禁用事件只处理一次（并发请求可能同时触发） */
let accountDisabledHandled = false
function onAccountDisabled(): void {
  if (accountDisabledHandled) return
  accountDisabledHandled = true
  auth.logout()
  void router.replace('/auth')
  showToast('账号已被禁用')
}

onMounted(() => {
  window.addEventListener('wx:account-disabled', onAccountDisabled)
})

onUnmounted(() => {
  window.removeEventListener('wx:account-disabled', onAccountDisabled)
})
</script>

<template>
  <router-view />
  <van-tabbar v-if="showTabbar" route safe-area-inset-bottom>
    <van-tabbar-item replace to="/learn" icon="bookmark-o">学习</van-tabbar-item>
    <van-tabbar-item replace to="/atlas" icon="star-o">星图</van-tabbar-item>
    <van-tabbar-item replace to="/questions" icon="todo-list-o">题库</van-tabbar-item>
    <van-tabbar-item replace to="/community" icon="chat-o">社区</van-tabbar-item>
    <van-tabbar-item replace to="/me" icon="user-o">我的</van-tabbar-item>
  </van-tabbar>
</template>
