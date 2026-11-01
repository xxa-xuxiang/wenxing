<!-- 关于：版本 / 团队 / 联系方式（版本号与移动端 package.json 保持一致） -->
<script setup lang="ts">
const APP_VERSION = '1.1.0'
const OFFICIAL_SITE = 'https://example.com'
</script>

<template>
  <div class="pane">
    <h2 class="pane-title">关于</h2>
    <section class="card">
      <div class="brand">
        <span class="mark">✦</span>
        <div>
          <h3 class="name">问星 · AI 学习伴侣</h3>
          <p class="ver">当前版本 v{{ APP_VERSION }} · 移动端 H5</p>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">团队</h3>
      <div class="team">
        <span class="team-mark">K</span>
        <div>
          <div class="team-name">问星开源</div>
          <div class="team-meta">开源社区维护</div>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">联系</h3>
      <div class="row">
        <span class="k">官网</span>
        <a class="link" :href="OFFICIAL_SITE" target="_blank" rel="noopener">example.com</a>
      </div>
      <div class="row">
        <span class="k">邮箱</span>
        <span class="v">contact@example.com</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pane-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #323233;
}

.card {
  background: #fff;
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 4px 14px rgba(25, 137, 250, 0.06);
}

.card-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mark {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  font-size: 26px;
  color: #fff;
  background: linear-gradient(135deg, #1989fa, #6366f1);
}

.name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #323233;
}

.ver {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: #969799;
}

.team {
  display: flex;
  align-items: center;
  gap: 12px;
}

.team-mark {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #1989fa, #6366f1);
}

.team-name {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #323233;
}

.team-meta {
  margin-top: 3px;
  font-size: 11.5px;
  color: #969799;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  font-size: 12.5px;
  border-bottom: 1px solid #f2f3f5;
}

.row:last-child {
  border-bottom: none;
}

.k {
  color: #969799;
}

.v {
  color: #323233;
}

.link {
  color: #1989fa;
  text-decoration: none;
}

.link:active {
  text-decoration: underline;
}
</style>
