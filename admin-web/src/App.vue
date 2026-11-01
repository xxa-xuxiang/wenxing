<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppConfirm from './components/AppConfirm.vue'
import AppToast from './components/AppToast.vue'
</script>

<template>
  <RouterView />
  <AppConfirm />
  <AppToast />
</template>
