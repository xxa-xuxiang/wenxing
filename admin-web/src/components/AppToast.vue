<script setup lang="ts">
import { useToastStore } from '../stores/toast'

const toast = useToastStore()
</script>

<template>
  <Teleport to="body">
    <div class="toast-stack">
      <TransitionGroup name="wx-slide-left">
        <div
          v-for="item in toast.items"
          :key="item.id"
          :class="['toast', `toast-${item.type}`]"
        >
          {{ item.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
