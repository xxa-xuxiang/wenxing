<script setup lang="ts">
// 404 兜底页：未知路由不再白屏，给出返回学习台的出口
</script>

<template>
  <div class="wx-404">
    <div class="wx-404-mark">✧</div>
    <div class="wx-404-code">404</div>
    <div class="wx-404-title">页面走丢了</div>
    <p class="wx-404-sub">你访问的地址不存在或已被移动</p>
    <router-link class="wx-404-btn wx-pressable" to="/learn">返回学习台</router-link>
  </div>
</template>

<style scoped>
.wx-404 {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}
.wx-404-mark {
  font-size: 44px;
  color: var(--wx-color-primary-soft);
  opacity: 0.8;
}
.wx-404-code {
  font-family: var(--wx-font-mono);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  background: var(--wx-gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wx-404-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--wx-text-primary);
}
.wx-404-sub {
  font-size: 13px;
  color: var(--wx-text-tertiary);
}
.wx-404-btn {
  margin-top: 14px;
  padding: 10px 28px;
  border-radius: var(--wx-radius-pill);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--wx-text-on-accent);
  background: var(--wx-gradient-primary);
  text-decoration: none;
}
.wx-404-btn:hover { filter: brightness(1.08); }
</style>
