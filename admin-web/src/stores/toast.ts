import { defineStore } from 'pinia'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
}

let _id = 0

export const useToastStore = defineStore('toast', {
  state: () => ({
    items: [] as ToastItem[]
  }),
  actions: {
    show(message: string, type: ToastType = 'info') {
      const item: ToastItem = { id: ++_id, message, type }
      this.items.push(item)
      if (this.items.length > 3) {
        this.items.shift()
      }
      setTimeout(() => this.dismiss(item.id), 3000)
    },
    dismiss(id: number) {
      const idx = this.items.findIndex((t) => t.id === id)
      if (idx > -1) this.items.splice(idx, 1)
    }
  }
})

export function useToast() {
  const store = useToastStore()
  return {
    show: (message: string, type?: ToastType) => store.show(message, type)
  }
}
