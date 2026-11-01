<script setup lang="ts">
import AppModal from './AppModal.vue'
import { useConfirmStore } from '../stores/confirm'

const confirm = useConfirmStore()

function cancel() {
  confirm.respond(false)
}

function accept() {
  confirm.respond(true)
}
</script>

<template>
  <AppModal
    :open="confirm.open"
    :title="confirm.title"
    width="440px"
    @close="cancel"
  >
    <p class="confirm-message">{{ confirm.message }}</p>
    <template #footer>
      <button type="button" class="btn" @click="cancel">{{ confirm.cancelText }}</button>
      <button
        type="button"
        :class="['btn', confirm.danger ? 'btn-danger' : 'btn-primary']"
        @click="accept"
      >
        {{ confirm.confirmText }}
      </button>
    </template>
  </AppModal>
</template>
