import { defineStore } from 'pinia'

interface ConfirmState {
  open: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
  resolve: ((value: boolean) => void) | null
}

export const useConfirmStore = defineStore('confirm', {
  state: (): ConfirmState => ({
    open: false,
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
    resolve: null
  }),
  actions: {
    ask(options: {
      title: string
      message: string
      confirmText?: string
      danger?: boolean
    }): Promise<boolean> {
      if (this.resolve) this.resolve(false)
      this.open = true
      this.title = options.title
      this.message = options.message
      this.confirmText = options.confirmText ?? '确定'
      this.danger = options.danger ?? false
      return new Promise<boolean>((resolve) => {
        this.resolve = resolve
      })
    },
    respond(value: boolean) {
      const r = this.resolve
      this.resolve = null
      this.open = false
      r?.(value)
    }
  }
})

export function useConfirm() {
  const store = useConfirmStore()
  return {
    ask: (options: Parameters<typeof store.ask>[0]) => store.ask(options)
  }
}
