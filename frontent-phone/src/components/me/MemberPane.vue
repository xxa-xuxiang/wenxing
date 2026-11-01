<!-- 计费分区：两种计费模式说明 + 对比表 + 服务端计费标准（只展示，不接支付） -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { showConfirmDialog } from 'vant'
import { fetchPricing, type PricingInfo } from '@/services/pricingService'
import { useApiKey } from './useApiKey'

const { mode } = useApiKey()

/** 两种计费模式（与桌面端一致） */
const billingModes = [
  {
    id: 'byo',
    name: '自带 API Key',
    price: '零费用',
    unit: '调用走你自己的 Key',
    desc: '填写你自己的 API Key，AI 调用走你的额度',
    features: ['完全免费，零管理费', '不占用平台 AI 次数', '调用费用由你的 Key 承担'],
    highlight: false
  },
  {
    id: 'platform',
    name: '平台 AI',
    price: '按次计费',
    unit: '按调用次数计费',
    desc: '无需配置，直接用问星内置 AI 能力',
    features: ['按 AI 调用次数计费', '占用平台 AI 赠送额度', '开箱即用，零配置'],
    highlight: true
  }
]

/** 对比表：行 = 能力项，列 = 两种模式（自带 Key / 平台 AI） */
const billingCompareRows: { label: string; values: [string, string] }[] = [
  { label: '固定管理费', values: ['无', '无'] },
  { label: 'AI 调用计费', values: ['—（走你自己的 Key）', '按次计费'] },
  { label: '占用平台 AI 额度', values: ['不占用', '占用'] },
  { label: '需要配置 API Key', values: ['需要', '不需要'] },
  { label: '调用费用由谁承担', values: ['你的 API 账户', '问星平台'] }
]

// ===== 服务端计费标准：点击后才读取 /api/billing/pricing =====
interface PriceItem {
  action: string
  label: string
  price: number
}

const pricing = ref<PricingInfo | null>(null)
const pricingLoading = ref(false)
const pricingError = ref('')

const billingInfo = computed(() => pricing.value?.billing ?? null)

/** 后端 items = { [action]: { pricePerCall, label } }；字段缺失时回落 action 名与 0 */
const pricingRows = computed<PriceItem[]>(() => {
  const raw = pricing.value?.items
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  return Object.entries(raw as Record<string, unknown>).map(([action, value]) => {
    const v = (value && typeof value === 'object' ? value : {}) as { label?: unknown; pricePerCall?: unknown }
    const n = Number(v.pricePerCall)
    return {
      action,
      label: typeof v.label === 'string' && v.label.trim() ? v.label : action,
      price: Number.isFinite(n) ? n : 0
    }
  })
})

async function loadPricing() {
  if (pricingLoading.value) return
  try {
    await showConfirmDialog({
      title: '读取计费标准',
      message: '将向后端发起一次请求读取当前计费配置，是否继续？'
    })
  } catch {
    return
  }
  pricingLoading.value = true
  pricingError.value = ''
  try {
    pricing.value = await fetchPricing()
  } catch (e) {
    pricingError.value = (e as Error).message || '读取失败，请稍后重试'
  } finally {
    pricingLoading.value = false
  }
}
</script>

<template>
  <div class="pane">
    <section class="card">
      <div class="head">
        <h3 class="card-title">计费方式</h3>
        <span class="head-tip">两种模式 · 按需选择</span>
      </div>
      <p class="intro">
        问星提供两种 AI 使用方式：使用平台 AI 时，每日有免费额度，用尽后按调用次数从账户余额扣费；
        填写你自己的 API Key 则调用走你的额度，完全免费，不占用平台 AI 次数。余额可通过兑换码或后台充值入账。
      </p>

      <div class="plans">
        <div v-for="m in billingModes" :key="m.id" class="plan" :class="{ highlight: m.highlight }">
          <div class="plan-name">{{ m.name }}</div>
          <div class="plan-price">{{ m.price }}<span class="plan-unit">{{ m.unit }}</span></div>
          <p class="plan-desc">{{ m.desc }}</p>
          <ul class="plan-features">
            <li v-for="f in m.features" :key="f">{{ f }}</li>
          </ul>
          <span class="plan-btn" :class="{ active: mode === m.id }">
            {{ mode === m.id ? '当前模式' : '可切换' }}
          </span>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 class="card-title">计费对比</h3>
      <div class="compare">
        <div class="compare-row compare-head">
          <span class="compare-label">项目</span>
          <span>自带 Key</span>
          <span class="hl">平台 AI</span>
        </div>
        <div v-for="row in billingCompareRows" :key="row.label" class="compare-row">
          <span class="compare-label">{{ row.label }}</span>
          <span>{{ row.values[0] }}</span>
          <span class="hl">{{ row.values[1] }}</span>
        </div>
      </div>
      <p class="note">
        当前计费模式：{{ mode === 'byo' ? '自带 API Key（零费用，调用走你的 Key）' : '平台 AI（按次计费）' }}
      </p>
    </section>

    <section class="card">
      <div class="head">
        <h3 class="card-title">服务端计费标准</h3>
        <van-button size="small" round plain type="primary" :loading="pricingLoading" @click="loadPricing">
          读取
        </van-button>
      </div>

      <p v-if="pricingLoading" class="center"><van-loading size="20">读取中…</van-loading></p>
      <p v-else-if="pricingError" class="err">{{ pricingError }}</p>
      <template v-else-if="pricing">
        <div v-if="billingInfo" class="billing-meta">
          <p>管理费：{{ billingInfo.managementFee }} {{ billingInfo.currency }}</p>
          <p>{{ billingInfo.note }}</p>
        </div>
        <ul v-if="pricingRows.length" class="price-list">
          <li v-for="r in pricingRows" :key="r.action">
            <span class="price-label">{{ r.label }}</span>
            <span class="price-val">¥{{ r.price.toFixed(2) }} / 次</span>
          </li>
        </ul>
        <p v-else class="empty">服务端未返回计费明细，以上为默认口径</p>
        <p class="note">计费配置 v{{ pricing.version ?? '-' }} · 免费额度用尽后按次从余额扣费</p>
      </template>
      <p v-else class="empty">点击「读取」拉取后台最新计费标准（按次单价与说明）</p>
    </section>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: #fff;
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 4px 14px rgba(25, 137, 250, 0.06);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.head .card-title {
  margin: 0;
}

.head-tip {
  font-size: 11px;
  color: #969799;
  padding: 2px 8px;
  border: 1px solid #ebedf0;
  border-radius: 999px;
}

.intro {
  margin: 12px 0 14px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.7;
  color: #646566;
  background: rgba(25, 137, 250, 0.06);
  border-left: 2px solid #1989fa;
  border-radius: 8px;
}

.plans {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.plan {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 14px;
  border: 1px solid #ebedf0;
  border-radius: 12px;
}

.plan.highlight {
  border-color: rgba(25, 137, 250, 0.4);
  background: rgba(25, 137, 250, 0.03);
}

.plan.highlight::before {
  content: '推荐';
  position: absolute;
  top: -8px;
  right: 12px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: #1989fa;
  border-radius: 999px;
}

.plan-name {
  font-size: 16px;
  font-weight: 600;
  color: #323233;
}

.plan-price {
  font-size: 24px;
  font-weight: 700;
  color: #1989fa;
}

.plan-unit {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: #969799;
}

.plan-desc {
  margin: 0;
  font-size: 12px;
  color: #646566;
}

.plan-features {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: #646566;
}

.plan-features li::before {
  content: '✦ ';
  color: #1989fa;
}

.plan-btn {
  align-self: flex-start;
  margin-top: 4px;
  padding: 7px 18px;
  border-radius: 999px;
  font-size: 12px;
  color: #969799;
  border: 1px solid #ebedf0;
  background: #f7f8fa;
}

.plan-btn.active {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #1989fa, #6366f1);
  font-weight: 600;
}

.compare {
  margin-top: 4px;
  border: 1px solid #f2f3f5;
  border-radius: 10px;
  overflow: hidden;
}

.compare-row {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr;
  gap: 6px;
  padding: 10px 10px;
  font-size: 11.5px;
  color: #646566;
  border-bottom: 1px solid #f2f3f5;
}

.compare-row:last-child {
  border-bottom: none;
}

.compare-head {
  font-size: 11px;
  color: #969799;
  background: #f7f8fa;
}

.compare-label {
  color: #323233;
}

.compare-row .hl {
  color: #1989fa;
}

.note {
  margin: 10px 0 0;
  font-size: 11px;
  color: #969799;
}

.billing-meta {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f7f8fa;
  font-size: 12px;
  line-height: 1.6;
  color: #646566;
}

.billing-meta p {
  margin: 0;
}

.price-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.price-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  font-size: 12.5px;
  border-bottom: 1px solid #f2f3f5;
}

.price-list li:last-child {
  border-bottom: none;
}

.price-label {
  color: #323233;
}

.price-val {
  color: #1989fa;
  font-weight: 600;
}

.center {
  margin: 12px 0;
  text-align: center;
}

.err {
  margin: 8px 0;
  font-size: 12px;
  color: #ee0a24;
}

.empty {
  margin: 10px 0;
  padding: 16px;
  font-size: 12px;
  color: #969799;
  text-align: center;
  border: 1px dashed #ebedf0;
  border-radius: 10px;
}
</style>
