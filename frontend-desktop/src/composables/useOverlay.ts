/**
 * 问星 — 统一浮层行为 composable
 * 统一弹窗 / 抽屉 / 气泡的三类关闭行为：
 *   1) Esc 关闭（document 捕获阶段监听，并阻止事件继续传播，避免同时关闭下层浮层）
 *   2) 点击浮层外部关闭（非模态：document 捕获阶段监听；模态：点击遮罩空白处）
 *   3) 模态遮罩：仅当点击落在遮罩本身（非内部卡片）时才关闭
 *
 * 用法：
 *   const { overlayRef, onOverlayMousedown } = useOverlay({ onClose: () => emit('close'), modal: true })
 *   模板：模态时 <div ref="overlayRef" @mousedown="onOverlayMousedown"> …卡片… </div>
 *        非模态时仅把 overlayRef 绑到浮层根元素即可（点击其外任意处关闭）
 *
 * 说明：用 mousedown（而非 click）判定，避免与浮层内按钮的 click 竞争；
 *      所有监听在 onMounted 注册、onBeforeUnmount 移除，不在 setup 顶层直接 addEventListener。
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export interface UseOverlayOptions {
  /** 关闭回调：复用组件原有的关闭出口（emit('close') / emit('update:modelValue', false) / 内部 ref 置 false） */
  onClose: () => void
  /** 为 true 时点击浮层外部关闭，默认 true */
  closeOnOutside?: boolean
  /** 为 true 时 Esc 关闭，默认 true */
  closeOnEsc?: boolean
  /** 是否为模态遮罩（模态时点击遮罩空白处关闭），默认 false */
  modal?: boolean
}

export interface UseOverlayReturn {
  /** 绑定到浮层根元素：模态绑到遮罩，非模态绑到浮层本身 */
  overlayRef: Ref<HTMLElement | null>
  /** 模态遮罩的 mousedown 处理器（内部卡片点击会冒泡到此，靠 target 判定不误关） */
  onOverlayMousedown: (e: MouseEvent) => void
}

export function useOverlay(opts: UseOverlayOptions): UseOverlayReturn {
  const overlayRef = ref<HTMLElement | null>(null)

  const closeOnOutside = opts.closeOnOutside ?? true
  const closeOnEsc = opts.closeOnEsc ?? true
  const modal = opts.modal ?? false

  /** 判定 mousedown 目标是否属于「浮层外部 / 遮罩空白」 */
  function isOutside(target: EventTarget | null): boolean {
    const el = overlayRef.value
    if (!el || !(target instanceof Node)) return false
    // 模态：只有点在遮罩本身（空白）才算外部；点在内部卡片上不算
    // 非模态：目标不在浮层内容范围内即算外部
    return modal ? target === el : !el.contains(target)
  }

  /** 模态遮罩上的 mousedown（模板绑定） */
  function onOverlayMousedown(e: MouseEvent) {
    if (!closeOnOutside) return
    if (isOutside(e.target)) opts.onClose()
  }

  /** document 捕获阶段的 mousedown：非模态浮层点击其外部任意处关闭 */
  function onDocumentMousedown(e: MouseEvent) {
    if (modal) return // 模态交给遮罩上的 onOverlayMousedown 处理，避免重复触发
    if (isOutside(e.target)) opts.onClose()
  }

  /** document 捕获阶段的 keydown：Esc 关闭，并阻止传播（防止同时关闭下层浮层） */
  function onDocumentKeydown(e: KeyboardEvent) {
    if (!closeOnEsc || e.key !== 'Escape') return
    e.stopPropagation()
    opts.onClose()
  }

  onMounted(() => {
    if (closeOnOutside) document.addEventListener('mousedown', onDocumentMousedown, true)
    if (closeOnEsc) document.addEventListener('keydown', onDocumentKeydown, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocumentMousedown, true)
    document.removeEventListener('keydown', onDocumentKeydown, true)
  })

  return { overlayRef, onOverlayMousedown }
}
