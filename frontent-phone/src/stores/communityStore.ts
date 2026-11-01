// 问星社区 — 当前行业 + 各行业内容计数（跨视图共享：Tab 流 ↔ 编辑器继承同一行业）
// 行业切换即重置内容上下文：列表由视图监听 activeIndustryId 变化后重新加载
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getIndustryStats } from '@/services/communityService'
import { DEFAULT_INDUSTRY_ID, visibleIndustries } from '@/data/communityIndustries'
import { storage } from '@/utils/storage'

export const useCommunityStore = defineStore('community', () => {
  // 当前行业（持久化；首次进入落默认行业）
  const raw = storage.get<string>('communityIndustry', DEFAULT_INDUSTRY_ID)
  const activeIndustryId = ref<string>(
    visibleIndustries().some((i) => i.id === raw) ? raw : DEFAULT_INDUSTRY_ID
  )
  // 各行业内容计数（空行业 → 0）
  const counts = ref<Record<string, number>>({})

  function setIndustry(id: string) {
    activeIndustryId.value = id
    storage.set('communityIndustry', id)
  }

  /** 拉取各行业内容计数（后端不可达时静默降级，不展示数字） */
  async function loadCounts() {
    try {
      counts.value = (await getIndustryStats()).counts
    } catch {
      /* 静默 */
    }
  }

  return { activeIndustryId, counts, setIndustry, loadCounts }
})
