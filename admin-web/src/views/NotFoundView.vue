<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section>
    <header class="page-header">
      <h1 class="page-title">页面不存在</h1>
    </header>
    <div class="card card-pad">
      <p class="muted">你访问的页面不存在或已被移除（404）。</p>
      <RouterLink
        to="/"
        class="btn btn-primary"
        style="margin-top: var(--wx-space-md)"
      >
        返回数据看板
      </RouterLink>
    </div>
  </section>
</template>
