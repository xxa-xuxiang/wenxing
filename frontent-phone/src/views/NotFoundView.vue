<!-- 404 兜底：未知路由不再白屏，给出返回上一页 / 回学习台两个出口 -->
<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

/** 有历史记录则回上一页，直达 404 时回落学习台 */
function goBack() {
  if (window.history.state && typeof window.history.state.back === 'string') router.back()
  else router.replace('/learn')
}
</script>

<template>
  <div class="nf">
    <div class="nf-mark">✧</div>
    <div class="nf-code">404</div>
    <h1 class="nf-title">页面走丢了</h1>
    <p class="nf-sub">你访问的地址不存在或已被移动</p>
    <div class="nf-actions">
      <van-button class="nf-btn" round plain type="primary" @click="goBack">返回上一页</van-button>
      <van-button class="nf-btn" round type="primary" @click="router.replace('/learn')">回学习页</van-button>
    </div>
  </div>
</template>

<style scoped>
.nf {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 24px calc(24px + env(safe-area-inset-bottom));
  text-align: center;
  background: linear-gradient(180deg, #eef5ff 0%, #f7f8fa 60%);
}

.nf-mark {
  font-size: 40px;
  line-height: 1;
  color: #7cb8ff;
  opacity: 0.85;
}

.nf-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  background: linear-gradient(120deg, #1989fa, #5b7cfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.nf-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #323233;
}

.nf-sub {
  margin: 0;
  font-size: 13px;
  color: #969799;
}

.nf-actions {
  display: flex;
  gap: 12px;
  margin-top: 14px;
}

.nf-btn {
  min-width: 128px;
  font-size: 14px;
}
</style>
