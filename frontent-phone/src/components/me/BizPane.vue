<!-- 商务合作：合作方向与联系方式（沿用桌面端文案） -->
<script setup lang="ts">
const DIRECTIONS = [
  { name: '企业培训', desc: '为团队定制行业知识图与学习路径，批量账号与进度管理' },
  { name: '内容共建', desc: '行业文档、题库与学习大纲的联合制作与署名展示' },
  { name: '赛事合作', desc: '学习挑战赛、认证体系与社区活动的联合运营' }
]
</script>

<template>
  <div class="pane">
    <h2 class="pane-title">商业合作</h2>
    <section class="card">
      <h3 class="card-title">合作方向</h3>
      <div class="direction" v-for="d in DIRECTIONS" :key="d.name">
        <span class="direction-name">{{ d.name }}</span>
        <span class="direction-desc">{{ d.desc }}</span>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">联系方式</h3>
      <div class="row">
        <span class="k">合作邮箱</span>
        <span class="v">contact@example.com</span>
      </div>
      <div class="row">
        <span class="k">工作日回复</span>
        <span class="v">48 小时内</span>
      </div>
      <p class="note">来信请注明合作方向、机构名称与期望周期；个人学习问题请优先使用社区与 AI 助教。</p>
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

.direction {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: 10px;
  background: #f7f8fa;
}

.direction:last-child {
  margin-bottom: 0;
}

.direction-name {
  font-size: 13px;
  font-weight: 600;
  color: #323233;
}

.direction-desc {
  font-size: 11.5px;
  line-height: 1.6;
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

.row:last-of-type {
  border-bottom: none;
}

.k {
  color: #969799;
}

.v {
  color: #323233;
}

.note {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: #969799;
}
</style>
