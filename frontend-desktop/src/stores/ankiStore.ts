// 问星 v4 — Anki 记忆卡片 Store（本地 SM-2 间隔复习，纯 localStorage 持久化，不改后端）
// 挂载不自动请求网络：从错题本抽卡只能由界面确认后显式触发
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AnkiCard } from '@/types'
import { storage } from '@/utils/storage'
import { cardsFromDoc, cardsFromWrong, newCard, sm2 } from '@/services/ankiService'
import { fetchWrongQuestions } from '@/services/wrongBookService'
import { useLearnStore } from './learnStore'

/** 本地存储键（storage 自动加命名空间 / 用户隔离前缀） */
const KEY = 'anki:cards'
/** 已掌握阈值：当前间隔 ≥ 21 天 */
const MASTERED_INTERVAL = 21

export const useAnkiStore = defineStore('anki', () => {
  const cards = ref<AnkiCard[]>(storage.get<AnkiCard[]>(KEY, []))

  function persist() {
    storage.set(KEY, cards.value)
  }

  /** 待复习队列：dueAt ≤ now，按 dueAt 升序 */
  const dueCards = computed(() =>
    cards.value.filter((c) => c.dueAt <= Date.now()).sort((a, b) => a.dueAt - b.dueAt)
  )

  /** 全局统计：总卡 / 今日待复习 / 已掌握（interval ≥ 21） */
  const stats = computed(() => {
    const now = Date.now()
    let due = 0
    let mastered = 0
    for (const c of cards.value) {
      if (c.dueAt <= now) due += 1
      if (c.interval >= MASTERED_INTERVAL) mastered += 1
    }
    return { total: cards.value.length, due, mastered }
  })

  /** 批量新增（去重：front + back 完全相同则跳过），返回新增卡数 */
  function addCards(list: AnkiCard[]): number {
    const seen = new Set(cards.value.map((c) => `${c.front}\u0000${c.back}`))
    const fresh: AnkiCard[] = []
    for (const c of list) {
      const sig = `${c.front}\u0000${c.back}`
      if (seen.has(sig)) continue
      seen.add(sig)
      fresh.push(c)
    }
    if (fresh.length === 0) return 0
    cards.value = [...cards.value, ...fresh]
    persist()
    return fresh.length
  }

  /** 手动建卡，返回新增卡数（0 或 1） */
  function addManual(front: string, back: string): number {
    const f = front.trim()
    const b = back.trim()
    if (!f || !b) return 0
    return addCards([newCard(f, b, 'manual')])
  }

  /** 从当前任务的学习文档抽卡，返回新增卡数（无文档/无任务返回 0） */
  function addFromDoc(taskId: string): number {
    const learn = useLearnStore()
    const doc = learn.docs.find((d) => d.skillId === taskId)
    const task = learn.outline.find((t) => t.id === taskId)
    if (!doc || !task) return 0
    return addCards(cardsFromDoc(doc, task))
  }

  /** 从错题本抽卡（async；未登录或请求失败会抛错，由调用方给出友好提示） */
  async function addFromWrong(): Promise<number> {
    const resp = await fetchWrongQuestions(100)
    if (!resp || !Array.isArray(resp.items)) return 0
    return addCards(resp.items.map((it) => cardsFromWrong(it)))
  }

  /** 评分推进：用 sm2 生成新卡替换，返回是否命中 */
  function grade(id: string, g: 0 | 1 | 2 | 3): void {
    const idx = cards.value.findIndex((c) => c.id === id)
    if (idx < 0) return
    const next = sm2(cards.value[idx], g)
    cards.value = cards.value.map((c, i) => (i === idx ? next : c))
    persist()
  }

  /** 删除卡片 */
  function deleteCard(id: string): void {
    const next = cards.value.filter((c) => c.id !== id)
    if (next.length === cards.value.length) return
    cards.value = next
    persist()
  }

  /** 从 localStorage 重读（登录/退出切换用户命名空间后调用） */
  function reload() {
    cards.value = storage.get<AnkiCard[]>(KEY, [])
  }

  return {
    cards,
    dueCards,
    stats,
    addCards,
    addManual,
    addFromDoc,
    addFromWrong,
    grade,
    deleteCard,
    reload
  }
})
