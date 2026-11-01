<!-- API 与充值分区：计费模式徽标 / Key 输入保存 / 今日用量（点击后请求） -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { http } from '@/services/http'
import { currentApiBase, getCustomApiBase, setCustomApiBase } from '@/services/apiBase'
import {
  fetchWallet,
  redeemWalletCode,
  type WalletResult
} from '@/services/walletService'
import type { AiUsageResult } from '@/types/me'
import { useAuthStore } from '@/stores/authStore'
import appreciationQr from '@/assets/wallet/appreciation.jpg'
import payQr from '@/assets/wallet/pay.jpg'
import { useApiKey } from './useApiKey'

const { keyInput, mode, saveKey } = useApiKey()

/** action → 中文名（与后端 DAILY_LIMITS 分桶对应） */
const ACTION_LABELS: Record<string, string> = {
  recommend: '技能推荐',
  doc: '文档生成',
  revise: '文档修订',
  chat: '对话聊天',
  questions: '批量出题',
  explainCheck: '讲解检测',
  plan: '学习计划'
}

// ===== 用量：必须点击「查询用量」并确认后才发起请求 =====
const usageData = ref<AiUsageResult | null>(null)
const usageLoading = ref(false)
const usageError = ref('')

async function queryUsage() {
  if (usageLoading.value) return
  try {
    await showConfirmDialog({
      title: '查询 AI 用量',
      message: '将向后端发起一次请求查询今日用量，是否继续？'
    })
  } catch {
    return
  }
  usageLoading.value = true
  usageError.value = ''
  try {
    usageData.value = await http<AiUsageResult>('/api/ai/usage')
  } catch (e) {
    usageError.value = (e as Error).message || '查询失败'
  } finally {
    usageLoading.value = false
  }
}

/** 用量汇总指标（长期累计，仅统计走平台 AI 的调用；自带 Key 完全免费不计入） */
const usageSummary = computed(() => {
  const m = usageData.value?.metering
  const calls = m?.calls ?? 0
  const tokens = m?.tokens ?? 0
  const quota = m?.tokenQuota ?? 1_000_000
  // 计费口径：1000 次 1 元 + 超出免费量部分 1.3 元/百万 token（与桌面端一致）
  const cost = calls * 0.001 + (Math.max(0, tokens - quota) * 1.3) / 1_000_000
  return { calls, tokens, quota, cost: cost.toFixed(4) }
})

/** 横向条形图数据（各 action 今日调用次数） */
const usageChart = computed(() => {
  const data = usageData.value?.usage
  if (!data) return []
  return Object.entries(data).map(([key, v]) => ({
    key,
    label: ACTION_LABELS[key] ?? key,
    used: v.used,
    limit: v.limit
  }))
})

const usageMax = computed(() => Math.max(1, ...usageChart.value.map((c) => c.used)))

const usageNote = computed(
  () => usageData.value?.billing?.note ?? '每账号长期免费 100 万 token；超出后 1.3 元/百万 token，API 调用 0.001 元/次；自带 API Key 完全免费。'
)

// ===== 账户余额与兑换码（请求仅在用户点击后发起） =====
const wallet = ref<WalletResult | null>(null)
const walletLoading = ref(false)
const walletError = ref('')
const redeemInput = ref('')
const redeeming = ref(false)

/** 收款码付款备注要填的用户名 */
const authStore = useAuthStore()
const walletUsername = computed(() => authStore.user?.username || '')
const usernameCopied = ref(false)

async function copyUsername() {
  if (!walletUsername.value) return
  try {
    await navigator.clipboard.writeText(walletUsername.value)
    usernameCopied.value = true
    showToast(`已复制用户名：${walletUsername.value}`)
    window.setTimeout(() => { usernameCopied.value = false }, 1600)
  } catch {
    showToast(`请手动填写用户名：${walletUsername.value}`)
  }
}

async function queryWallet() {
  if (walletLoading.value) return
  try {
    await showConfirmDialog({
      title: '查询余额',
      message: '将向后端发起一次请求查询账户余额与最近流水，是否继续？'
    })
  } catch {
    return
  }
  walletLoading.value = true
  walletError.value = ''
  try {
    wallet.value = await fetchWallet(10)
  } catch (e) {
    walletError.value = (e as Error).message || '查询失败，请确认已登录'
  } finally {
    walletLoading.value = false
  }
}

async function doRedeem() {
  if (redeeming.value) return
  const code = redeemInput.value.trim()
  if (!code) {
    showToast('请输入兑换码')
    return
  }
  try {
    await showConfirmDialog({
      title: '兑换码入账',
      message: `确认使用兑换码：\n${code}\n兑换成功后金额立即入账，是否继续？`
    })
  } catch {
    return
  }
  redeeming.value = true
  try {
    const res = await redeemWalletCode(code)
    showToast(`兑换成功，入账 ¥${res.amountYuan.toFixed(2)}`)
    redeemInput.value = ''
    // 已查询过余额时同步刷新，避免展示旧余额
    if (wallet.value) wallet.value = await fetchWallet(10)
  } catch (e) {
    showToast((e as Error).message || '兑换失败')
  } finally {
    redeeming.value = false
  }
}

// ===== 服务器地址（沿用原设置项；修改后刷新页面生效） =====
const serverInput = ref(getCustomApiBase())
const currentBaseText = ref(currentApiBase() || '默认（构建注入 / 代理 / 同源）')

async function saveServer() {
  const v = serverInput.value.trim()
  try {
    await showConfirmDialog({
      title: '修改服务器地址',
      message: v ? `将服务器地址设为：\n${v}\n刷新页面后生效。` : '将清除自定义地址，恢复默认服务器，刷新页面后生效。'
    })
  } catch {
    return
  }
  setCustomApiBase(v)
  showToast('已保存，刷新页面后生效')
}
</script>

<template>
  <div class="pane">
    <section class="card">
      <h3 class="card-title">当前计费模式</h3>
      <div class="mode-badge" :class="mode">
        {{ mode === 'byo' ? '自带 API Key · 零费用' : '平台 AI · 按次计费' }}
      </div>
      <p class="tip">
        {{
          mode === 'byo'
            ? '你已配置自己的 API Key：AI 调用走你的额度，零费用，不占用平台 AI 次数。'
            : '未配置自己的 API Key：AI 调用走问星平台，按调用次数计费。'
        }}
      </p>
    </section>

    <section class="card">
      <h3 class="card-title">API Key</h3>
      <van-field
        v-model="keyInput"
        type="password"
        label="自定义 Key"
        placeholder="留空使用平台 AI（按次计费）"
        clearable
        class="key-field"
      />
      <van-button round block type="primary" class="save-btn" @click="saveKey">保存 API Key</van-button>
      <p class="tip">
        填写你自己的 API Key 后，AI 调用将使用你的 Key（完全免费，不计平台计量）；留空则使用平台 AI，按 token 与调用次数计量计费。
      </p>
    </section>

    <section class="card">
      <div class="head">
        <h3 class="card-title">用量统计</h3>
        <van-button size="small" round plain type="primary" :loading="usageLoading" @click="queryUsage">
          查询用量
        </van-button>
      </div>

      <p v-if="usageLoading" class="center"><van-loading size="22">查询中…</van-loading></p>

      <template v-else-if="usageData">
        <div class="stats">
          <div class="stat">
            <div class="stat-label">累计消费（估算）</div>
            <div class="stat-value">{{ usageSummary.cost }}<span class="unit"> CNY</span></div>
          </div>
          <div class="stat">
            <div class="stat-label">API 调用总次数</div>
            <div class="stat-value">{{ usageSummary.calls.toLocaleString() }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Token 累计用量</div>
            <div class="stat-value">{{ usageSummary.tokens.toLocaleString() }}</div>
          </div>
        </div>

        <div v-if="usageData.metering" class="quota">
          <van-progress
            :percentage="Math.min(100, (usageSummary.tokens / usageSummary.quota) * 100)"
            stroke-width="6"
            :show-pivot="false"
          />
          <p class="quota-text">
            免费 token 剩余 {{ (usageData.metering.tokenRemaining ?? 0).toLocaleString() }} / {{ usageSummary.quota.toLocaleString() }}
          </p>
          <p v-if="(usageData.metering.debtFen ?? 0) > 0" class="err">
            有未清费用 ¥{{ ((usageData.metering.debtFen ?? 0) / 100).toFixed(2) }}，请充值后再使用平台 AI。
          </p>
        </div>

        <div v-if="usageChart.length" class="chart">
          <div class="chart-title">今日各功能调用次数</div>
          <div class="bar-row" v-for="c in usageChart" :key="c.key">
            <span class="bar-label">{{ c.label }}</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: `${(c.used / usageMax) * 100}%` }"></div>
            </div>
            <span class="bar-val">{{ c.used }}<span class="bar-limit"> / {{ c.limit }}</span></span>
          </div>
        </div>
      </template>

      <p v-else-if="usageError" class="err">{{ usageError }}</p>
      <p v-else class="empty">点击「查询用量」查看今日 API 调用统计</p>

      <p class="note">{{ usageNote }}</p>
    </section>

    <section class="card">
      <div class="head">
        <h3 class="card-title">账户余额</h3>
        <van-button size="small" round plain type="primary" :loading="walletLoading" @click="queryWallet">
          查询余额
        </van-button>
      </div>

      <p v-if="walletLoading" class="center"><van-loading size="20">查询中…</van-loading></p>
      <p v-else-if="walletError" class="err">{{ walletError }}</p>
      <template v-else-if="wallet">
        <div class="balance">
          <span class="balance-label">可用余额</span>
          <span class="balance-value">¥{{ wallet.balanceYuan.toFixed(2) }}</span>
        </div>
        <p class="tip">每日免费额度用尽后，AI 调用按次从余额扣费；兑换码或后台充值可入账。</p>
        <ul v-if="wallet.items.length" class="txn-list">
          <li v-for="t in wallet.items" :key="t.id">
            <span class="txn-type">{{ t.note || t.type }}</span>
            <span class="txn-delta" :class="{ minus: t.deltaFen < 0 }">
              {{ t.deltaFen > 0 ? '+' : '' }}{{ (t.deltaFen / 100).toFixed(2) }}
            </span>
          </li>
        </ul>
      </template>
      <p v-else class="empty">点击「查询余额」查看账户余额与最近流水</p>

      <van-field
        v-model="redeemInput"
        label="兑换码"
        placeholder="输入 16 位兑换码"
        clearable
        class="key-field redeem-field"
      />
      <van-button round block type="warning" :loading="redeeming" @click="doRedeem">
        兑换入账
      </van-button>
      <p class="tip">兑换码由管理员发放，兑换成功后金额立即入账，每张仅可使用一次。</p>
    </section>

    <section class="card">
      <h3 class="card-title">赞赏与充值</h3>
      <div class="pay-grid">
        <div class="pay-item">
          <img class="pay-img" :src="appreciationQr" alt="赞赏码" />
          <span class="pay-name">赞赏码</span>
          <p class="pay-desc">愿意支持问星就扫码随意赞赏，金额不限；赞赏不进入账户余额。</p>
        </div>
        <div class="pay-item">
          <img class="pay-img" :src="payQr" alt="微信支付收款码" />
          <span class="pay-name">充值收款码</span>
          <p class="pay-desc">微信扫码后自己填写金额，用于充值账户余额。</p>
        </div>
      </div>

      <div class="pay-user">
        <span>付款备注必填用户名：<strong>{{ walletUsername || '请先登录' }}</strong></span>
        <van-button size="mini" round plain type="warning" :disabled="!walletUsername" @click="copyUsername">
          {{ usernameCopied ? '已复制' : '复制用户名' }}
        </van-button>
      </div>

      <ol class="pay-steps">
        <li>微信扫「充值收款码」，输入你想充值的金额（多少都可以）；</li>
        <li><strong>付款备注必须填写你的用户名</strong>（就是上面显示的）；</li>
        <li>付款后把截图或订单号发给管理员；</li>
        <li>核对后充值到余额，回到本页点「查询余额」即可看到。</li>
      </ol>
      <p class="pay-warn">不填用户名无法核对，将无法入账；赞赏码付款不计入余额。</p>
    </section>

    <section class="card">
      <h3 class="card-title">服务器地址（高级）</h3>
      <p class="tip base-text">当前生效：{{ currentBaseText }}</p>
      <van-field
        v-model="serverInput"
        label="地址"
        placeholder="留空恢复默认，如 http://127.0.0.1:3001"
        clearable
        class="key-field"
      />
      <van-button round block type="primary" plain @click="saveServer">保存服务器地址</van-button>
      <p class="tip">自定义地址用于指向云端或其他可达后端，修改后需刷新页面生效。</p>
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
  margin-bottom: 10px;
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

.mode-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}

.mode-badge.byo {
  color: #07c160;
  background: rgba(7, 193, 96, 0.1);
  border-color: rgba(7, 193, 96, 0.35);
}

.mode-badge.platform {
  color: #1989fa;
  background: rgba(25, 137, 250, 0.1);
  border-color: rgba(25, 137, 250, 0.35);
}

.tip {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: #969799;
}

.base-text {
  word-break: break-all;
}

.key-field {
  border-radius: 10px;
  background: #f7f8fa;
  margin-bottom: 12px;
}

.save-btn {
  margin-top: 4px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.stat {
  padding: 12px 8px;
  border-radius: 10px;
  background: #f7f8fa;
}

.stat-label {
  font-size: 11px;
  color: #969799;
  margin-bottom: 6px;
}

.stat-value {
  font-size: 19px;
  font-weight: 700;
  color: #1989fa;
}

.stat-value .unit {
  font-size: 11px;
  font-weight: 400;
  color: #969799;
}

.chart-title {
  font-size: 12.5px;
  color: #646566;
  margin-bottom: 10px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.bar-label {
  width: 72px;
  flex-shrink: 0;
  font-size: 11.5px;
  color: #646566;
  text-align: right;
}

.bar-track {
  flex: 1;
  height: 10px;
  border-radius: 999px;
  background: #f2f3f5;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #1989fa, #6366f1);
}

.bar-val {
  width: 58px;
  flex-shrink: 0;
  font-size: 11.5px;
  color: #323233;
}

.bar-limit {
  color: #969799;
}

.note {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #969799;
}

.quota {
  margin-top: 12px;
}
.quota-text {
  margin: 6px 0 0;
  font-size: 11px;
  color: #969799;
}

.center {
  text-align: center;
}

.err {
  margin: 8px 0;
  font-size: 12px;
  color: #ee0a24;
}

.empty {
  margin: 8px 0;
  padding: 18px;
  font-size: 12px;
  color: #969799;
  text-align: center;
  border: 1px dashed #ebedf0;
  border-radius: 10px;
}

.balance {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(25, 137, 250, 0.1), rgba(99, 102, 241, 0.1));
}

.balance-label {
  font-size: 12px;
  color: #646566;
}

.balance-value {
  font-size: 22px;
  font-weight: 700;
  color: #1989fa;
}

.txn-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.txn-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  font-size: 12px;
  border-bottom: 1px solid #f2f3f5;
}

.txn-list li:last-child {
  border-bottom: none;
}

.txn-type {
  color: #646566;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.txn-delta {
  flex-shrink: 0;
  color: #07c160;
  font-weight: 600;
}

.txn-delta.minus {
  color: #ee0a24;
}

.redeem-field {
  margin-top: 12px;
}

/* 赞赏与充值收款码 */
.pay-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.pay-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px;
  border: 1px solid #ebedf0;
  border-radius: 12px;
  background: #fafbfc;
}

.pay-img {
  width: 100%;
  height: 160px;
  object-fit: contain;
  border-radius: 8px;
  background: #fff;
}

.pay-name {
  font-size: 13px;
  font-weight: 600;
  color: #323233;
}

.pay-desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: #969799;
  text-align: center;
}

.pay-user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff8e6;
  border: 1px solid #ffe1a8;
  font-size: 12px;
  color: #646566;
}

.pay-user strong {
  color: #323233;
  font-size: 14px;
  letter-spacing: 0.04em;
}

.pay-steps {
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.9;
  color: #646566;
}

.pay-steps strong {
  color: #323233;
}

.pay-warn {
  margin: 10px 0 0;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.7;
  color: #ee0a24;
  background: rgba(238, 10, 36, 0.06);
  border: 1px solid rgba(238, 10, 36, 0.2);
}
</style>
