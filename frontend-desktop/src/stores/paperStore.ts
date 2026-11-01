// 问星 v1.1 — 试卷 Store（后端化：试卷存后端，题目以 ID 引用）
// 列表只存简要信息（标题/题量/分值）；卷面正文按需拉取详情，避免一次拉全量题目
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  createPaper,
  listPapers,
  getPaper,
  deletePaper,
  type PaperBrief
} from '@/services/paperService'
import type { Paper } from '@/types'

export const usePaperStore = defineStore('paper', () => {
  /** 我的试卷简要列表（后端返回） */
  const papers = ref<PaperBrief[]>([])
  /** 当前打开的卷面详情（含题目） */
  const activePaper = ref<Paper | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function loadList() {
    loading.value = true
    error.value = ''
    try {
      const r = await listPapers()
      papers.value = r.items
    } catch (e) {
      error.value = e instanceof Error ? e.message : '试卷列表加载失败'
      papers.value = []
    } finally {
      loading.value = false
    }
  }

  async function load(id: string): Promise<Paper | null> {
    if (!id) {
      activePaper.value = null
      return null
    }
    loading.value = true
    try {
      const r = await getPaper(id)
      activePaper.value = r.paper
      return r.paper
    } catch (e) {
      error.value = e instanceof Error ? e.message : '卷面加载失败'
      activePaper.value = null
      return null
    } finally {
      loading.value = false
    }
  }

  /** 新建试卷：后端落库（题目 ID 引用）后刷新列表并返回卷面 */
  async function create(payload: {
    title: string
    scope: string[]
    scorePer: number
    questionIds: string[]
  }): Promise<Paper> {
    const r = await createPaper(payload)
    await loadList()
    activePaper.value = r.paper
    return r.paper
  }

  async function remove(id: string) {
    await deletePaper(id)
    if (activePaper.value?.id === id) activePaper.value = null
    await loadList()
  }

  /** 从后端重读（登录/退出切换用户命名空间后调用，清空上一个账号残留） */
  function reload() {
    papers.value = []
    activePaper.value = null
    error.value = ''
  }

  return { papers, activePaper, loading, error, loadList, load, create, remove, reload }
})
