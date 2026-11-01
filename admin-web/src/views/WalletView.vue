<script setup lang="ts">
// 问星管理后台 — 充值与余额：手动充值 / 兑换码生成与管理 / 充值订单与余额流水
import { computed, onMounted, ref } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import { useToast } from '../stores/toast'
import { useConfirm } from '../stores/confirm'
import { fmtDate } from '../utils/format'
import {
  deleteWalletCode,
  generateWalletCodes,
  getWalletCodes,
  getWalletOrders,
  getWalletOverview,
  getWalletTxns,
  manualRecharge
} from '../services/adminApi'
import type {
  RedeemCodeStatus,
  RechargeChannel,
  WalletCodeItem,
  WalletOrderItem,
  WalletOverview,
  WalletTxnItem
} from '../services/types'

const toast = useToast()
const { ask } = useConfirm()

type TabKey = 'recharge' | 'codes' | 'txns'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'recharge', label: '手动充值' },
  { key: 'codes', label: '兑换码' },
  { key: 'txns', label: '余额流水' }
]
const tab = ref<TabKey>('recharge')

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

/* ===== 概览 ===== */
const overview = ref<WalletOverview | null>(null)
const overviewLoading = ref(false)

async function loadOverview() {
  overviewLoading.value = true
  try {
    overview.value = await getWalletOverview()
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    overviewLoading.value = false
  }
}

/* ===== 手动充值 ===== */
const rechargeUsername = ref('')
const rechargeYuan = ref('30')
const rechargeNote = ref('')
const recharging = ref(false)

async function submitRecharge() {
  if (recharging.value) return
  const username = rechargeUsername.value.trim()
  if (!username) {
    toast.show('请填写要充值的用户名', 'error')
    return
  }
  const yuan = Number(rechargeYuan.value)
  if (!Number.isFinite(yuan) || yuan <= 0) {
    toast.show('充值金额必须大于 0', 'error')
    return
  }
  const amountFen = Math.round(yuan * 100)
  const ok = await ask({
    title: '确认手动充值',
    message: `给用户「${username}」充值 ¥${(amountFen / 100).toFixed(2)}？入账后不可撤销。`,
    confirmText: '确认充值'
  })
  if (!ok) return

  recharging.value = true
  try {
    const res = await manualRecharge({
      username,
      amountFen,
      note: rechargeNote.value.trim() || undefined
    })
    toast.show(
      `已为 ${res.user.nickname || res.user.username} 充值 ¥${res.amountYuan.toFixed(2)}，当前余额 ¥${res.balanceYuan.toFixed(2)}`,
      'success'
    )
    rechargeNote.value = ''
    await Promise.all([loadOverview(), loadOrders(1)])
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    recharging.value = false
  }
}

/* ===== 充值订单 ===== */
const orders = ref<WalletOrderItem[]>([])
const orderTotal = ref(0)
const orderPage = ref(1)
const orderPageSize = 10
const orderQuery = ref('')
const orderChannel = ref<RechargeChannel | ''>('')
const orderLoading = ref(false)

const orderPages = computed(() =>
  Math.max(1, Math.ceil(orderTotal.value / orderPageSize))
)

async function loadOrders(page = orderPage.value) {
  orderLoading.value = true
  try {
    const res = await getWalletOrders({
      page,
      pageSize: orderPageSize,
      q: orderQuery.value.trim() || undefined,
      channel: orderChannel.value || undefined
    })
    orders.value = res.items
    orderTotal.value = res.total
    orderPage.value = res.page
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    orderLoading.value = false
  }
}

/* ===== 兑换码 ===== */
const codeCount = ref('10')
const codeYuan = ref('10')
const codeNote = ref('')
const generating = ref(false)
const generated = ref<{ code: string; codeText: string }[]>([])

const codes = ref<WalletCodeItem[]>([])
const codeTotal = ref(0)
const codePage = ref(1)
const codePageSize = 10
const codeStatus = ref<RedeemCodeStatus>('unused')
const codeLoading = ref(false)

const codePages = computed(() => Math.max(1, Math.ceil(codeTotal.value / codePageSize)))

const statusTabs: { key: RedeemCodeStatus; label: string }[] = [
  { key: 'unused', label: '未使用' },
  { key: 'used', label: '已使用' },
  { key: 'all', label: '全部' }
]

async function loadCodes(page = codePage.value) {
  codeLoading.value = true
  try {
    const res = await getWalletCodes({
      page,
      pageSize: codePageSize,
      status: codeStatus.value
    })
    codes.value = res.items
    codeTotal.value = res.total
    codePage.value = res.page
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    codeLoading.value = false
  }
}

async function switchCodeStatus(status: RedeemCodeStatus) {
  if (codeStatus.value === status) return
  codeStatus.value = status
  await loadCodes(1)
}

async function submitGenerate() {
  if (generating.value) return
  const count = Number(codeCount.value)
  const yuan = Number(codeYuan.value)
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    toast.show('生成数量需为 1–200 的整数', 'error')
    return
  }
  if (!Number.isFinite(yuan) || yuan <= 0) {
    toast.show('面额必须大于 0', 'error')
    return
  }
  const amountFen = Math.round(yuan * 100)
  const ok = await ask({
    title: '生成兑换码',
    message: `生成 ${count} 张面额 ¥${(amountFen / 100).toFixed(2)} 的兑换码？生成后可在「未使用」列表中查看。`,
    confirmText: '生成'
  })
  if (!ok) return

  generating.value = true
  try {
    const res = await generateWalletCodes({
      count,
      amountFen,
      note: codeNote.value.trim() || undefined
    })
    generated.value = res.items
    toast.show(`已生成 ${res.count} 张兑换码`, 'success')
    codeStatus.value = 'unused'
    await Promise.all([loadCodes(1), loadOverview()])
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    generating.value = false
  }
}

async function copyCodes(list: { codeText: string }[]) {
  const text = list.map((c) => c.codeText).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toast.show(`已复制 ${list.length} 张兑换码`, 'success')
  } catch {
    toast.show('复制失败，请手动选择文本复制', 'error')
  }
}

async function revokeCode(item: WalletCodeItem) {
  const ok = await ask({
    title: '作废兑换码',
    message: `确定作废兑换码 ${item.codeText}（¥${item.amountYuan.toFixed(2)}）吗？作废后用户将无法兑换。`,
    confirmText: '作废',
    danger: true
  })
  if (!ok) return
  try {
    await deleteWalletCode(item.id)
    toast.show('兑换码已作废', 'success')
    await Promise.all([loadCodes(), loadOverview()])
  } catch (e) {
    toast.show(errorText(e), 'error')
  }
}

/* ===== 余额流水 ===== */
const txns = ref<WalletTxnItem[]>([])
const txnTotal = ref(0)
const txnPage = ref(1)
const txnPageSize = 10
const txnQuery = ref('')
const txnLoading = ref(false)

const txnPages = computed(() => Math.max(1, Math.ceil(txnTotal.value / txnPageSize)))

async function loadTxns(page = txnPage.value) {
  txnLoading.value = true
  try {
    const res = await getWalletTxns({
      page,
      pageSize: txnPageSize,
      q: txnQuery.value.trim() || undefined
    })
    txns.value = res.items
    txnTotal.value = res.total
    txnPage.value = res.page
  } catch (e) {
    toast.show(errorText(e), 'error')
  } finally {
    txnLoading.value = false
  }
}

/* ===== 通用 ===== */
const TYPE_LABELS: Record<string, string> = {
  recharge_redeem: '兑换码充值',
  recharge_manual: '手动充值',
  ai_consume: 'AI 扣费',
  adjust: '余额调整'
}

const CHANNEL_LABELS: Record<string, string> = {
  redeem: '兑换码',
  manual: '手动充值'
}

function fmtMoney(n: number | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function signedMoney(fen: number): string {
  const sign = fen > 0 ? '+' : fen < 0 ? '-' : ''
  return `${sign}${fmtMoney(Math.abs(fen) / 100)}`
}

function refresh() {
  loadOverview()
  if (tab.value === 'recharge') loadOrders()
  else if (tab.value === 'codes') loadCodes()
  else loadTxns()
}

function switchTab(key: TabKey) {
  tab.value = key
  if (key === 'recharge' && !orders.value.length) loadOrders(1)
  if (key === 'codes' && !codes.value.length) loadCodes(1)
  if (key === 'txns' && !txns.value.length) loadTxns(1)
}

onMounted(() => {
  loadOverview()
  loadOrders(1)
})
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1 class="page-title">充值与余额</h1>
        <p class="muted page-sub">兑换码 + 手动充值通道；余额在每日免费 AI 额度用尽后按次扣费</p>
      </div>
      <button type="button" class="btn" :disabled="overviewLoading" @click="refresh">
        {{ overviewLoading ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <div class="stat-grid wallet-stats">
      <div class="stat-card">
        <div class="stat-label">用户余额合计</div>
        <div class="stat-value">{{ overview ? fmtMoney(overview.totalBalanceYuan) : '—' }}</div>
        <div class="stat-sub">有余额用户 {{ overview?.balanceUsers ?? 0 }} 人</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日充值</div>
        <div class="stat-value">{{ overview ? fmtMoney(overview.todayRechargeYuan) : '—' }}</div>
        <div class="stat-sub">累计 {{ overview ? fmtMoney(overview.totalRechargeYuan) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今日扣费</div>
        <div class="stat-value">{{ overview ? fmtMoney(overview.todayConsumeYuan) : '—' }}</div>
        <div class="stat-sub">累计 {{ overview ? fmtMoney(overview.totalConsumeYuan) : '—' }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">未使用兑换码</div>
        <div class="stat-value">{{ overview?.unusedCodeCount ?? 0 }} 张</div>
        <div class="stat-sub">面额合计 {{ overview ? fmtMoney(overview.unusedCodeValueYuan) : '—' }}</div>
      </div>
    </div>

    <div class="tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        :class="['page-btn', { active: tab === t.key }]"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 手动充值 + 订单 -->
    <template v-if="tab === 'recharge'">
      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">手动充值</h2>
          <span class="muted">按用户名入账，即时到账</span>
        </div>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">用户名</span>
            <input v-model="rechargeUsername" class="input" placeholder="如 zhangsan" />
          </label>
          <label class="field">
            <span class="field-label">金额（元）</span>
            <input v-model="rechargeYuan" class="input" type="number" min="0.01" step="0.01" />
          </label>
          <label class="field field-wide">
            <span class="field-label">备注（选填）</span>
            <input v-model="rechargeNote" class="input" placeholder="如：微信转账补单" />
          </label>
        </div>
        <div class="form-foot">
          <button type="button" class="btn btn-primary" :disabled="recharging" @click="submitRecharge">
            {{ recharging ? '充值中…' : '确认充值' }}
          </button>
        </div>
      </div>

      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">充值订单</h2>
          <div class="toolbar">
            <select v-model="orderChannel" class="input select" @change="loadOrders(1)">
              <option value="">全部渠道</option>
              <option value="manual">手动充值</option>
              <option value="redeem">兑换码</option>
            </select>
            <input
              v-model="orderQuery"
              class="input"
              placeholder="搜索用户名/昵称"
              @keyup.enter="loadOrders(1)"
            />
            <button type="button" class="btn btn-sm" :disabled="orderLoading" @click="loadOrders(1)">
              查询
            </button>
          </div>
        </div>

        <EmptyState v-if="!orders.length" :text="orderLoading ? '加载中…' : '暂无充值订单'" />
        <template v-else>
          <div class="table-wrap">
            <table class="ad-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>渠道</th>
                  <th>金额</th>
                  <th>备注</th>
                  <th>操作人</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in orders" :key="o.id">
                  <td class="nowrap muted">{{ fmtDate(o.createdAt) }}</td>
                  <td class="nowrap">
                    {{ o.user.nickname || o.user.username }}
                    <span class="muted">（{{ o.user.username }}）</span>
                  </td>
                  <td class="nowrap">
                    <span class="pill" :class="o.channel === 'manual' ? 'pill-blue' : 'pill-green'">
                      {{ CHANNEL_LABELS[o.channel] ?? o.channel }}
                    </span>
                  </td>
                  <td class="nowrap money">{{ fmtMoney(o.amountYuan) }}</td>
                  <td class="muted note-cell">{{ o.note || '-' }}</td>
                  <td class="nowrap muted">{{ o.operator || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pager">
            <button type="button" class="btn btn-sm" :disabled="orderPage <= 1 || orderLoading" @click="loadOrders(orderPage - 1)">
              上一页
            </button>
            <span class="muted">第 {{ orderPage }} / {{ orderPages }} 页 · 共 {{ orderTotal }} 条</span>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="orderPage >= orderPages || orderLoading"
              @click="loadOrders(orderPage + 1)"
            >
              下一页
            </button>
          </div>
        </template>
      </div>
    </template>

    <!-- 兑换码 -->
    <template v-else-if="tab === 'codes'">
      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">批量生成</h2>
          <span class="muted">面额与数量可自定义，生成后发给用户兑换</span>
        </div>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">数量（1–200）</span>
            <input v-model="codeCount" class="input" type="number" min="1" max="200" step="1" />
          </label>
          <label class="field">
            <span class="field-label">面额（元）</span>
            <input v-model="codeYuan" class="input" type="number" min="0.01" step="0.01" />
          </label>
          <label class="field field-wide">
            <span class="field-label">备注（选填）</span>
            <input v-model="codeNote" class="input" placeholder="如：双十一活动" />
          </label>
        </div>
        <div class="form-foot">
          <button type="button" class="btn btn-primary" :disabled="generating" @click="submitGenerate">
            {{ generating ? '生成中…' : '生成兑换码' }}
          </button>
        </div>

        <div v-if="generated.length" class="generated">
          <div class="section-head">
            <h2 class="section-title">本次生成（{{ generated.length }} 张）</h2>
            <button type="button" class="btn btn-sm" @click="copyCodes(generated)">复制全部</button>
          </div>
          <div class="code-grid">
            <code v-for="c in generated" :key="c.code" class="code-chip">{{ c.codeText }}</code>
          </div>
        </div>
      </div>

      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">兑换码列表</h2>
          <div class="tabs tabs-inline">
            <button
              v-for="s in statusTabs"
              :key="s.key"
              type="button"
              :class="['page-btn', { active: codeStatus === s.key }]"
              @click="switchCodeStatus(s.key)"
            >
              {{ s.label }}
            </button>
          </div>
        </div>

        <EmptyState v-if="!codes.length" :text="codeLoading ? '加载中…' : '暂无兑换码'" />
        <template v-else>
          <div class="table-wrap">
            <table class="ad-table">
              <thead>
                <tr>
                  <th>兑换码</th>
                  <th>面额</th>
                  <th>状态</th>
                  <th>备注</th>
                  <th>生成时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in codes" :key="c.id">
                  <td class="mono nowrap">{{ c.codeText }}</td>
                  <td class="nowrap money">{{ fmtMoney(c.amountYuan) }}</td>
                  <td class="nowrap">
                    <span class="pill" :class="c.usedBy ? 'pill-yellow' : 'pill-green'">
                      {{ c.usedBy ? '已使用' : '未使用' }}
                    </span>
                  </td>
                  <td class="muted note-cell">{{ c.note || '-' }}</td>
                  <td class="nowrap muted">{{ fmtDate(c.createdAt) }}</td>
                  <td class="nowrap">
                    <button
                      v-if="!c.usedBy"
                      type="button"
                      class="btn btn-sm btn-danger"
                      @click="revokeCode(c)"
                    >
                      作废
                    </button>
                    <span v-else class="muted">{{ fmtDate(c.usedAt) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pager">
            <button type="button" class="btn btn-sm" :disabled="codePage <= 1 || codeLoading" @click="loadCodes(codePage - 1)">
              上一页
            </button>
            <span class="muted">第 {{ codePage }} / {{ codePages }} 页 · 共 {{ codeTotal }} 条</span>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="codePage >= codePages || codeLoading"
              @click="loadCodes(codePage + 1)"
            >
              下一页
            </button>
          </div>
        </template>
      </div>
    </template>

    <!-- 余额流水 -->
    <template v-else>
      <div class="card card-pad">
        <div class="section-head">
          <h2 class="section-title">余额流水</h2>
          <div class="toolbar">
            <input
              v-model="txnQuery"
              class="input"
              placeholder="搜索用户名/昵称"
              @keyup.enter="loadTxns(1)"
            />
            <button type="button" class="btn btn-sm" :disabled="txnLoading" @click="loadTxns(1)">
              查询
            </button>
          </div>
        </div>

        <EmptyState v-if="!txns.length" :text="txnLoading ? '加载中…' : '暂无流水记录'" />
        <template v-else>
          <div class="table-wrap">
            <table class="ad-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>类型</th>
                  <th>变动</th>
                  <th>变动后余额</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in txns" :key="t.id">
                  <td class="nowrap muted">{{ fmtDate(t.createdAt) }}</td>
                  <td class="nowrap">
                    {{ t.user.nickname || t.user.username }}
                    <span class="muted">（{{ t.user.username }}）</span>
                  </td>
                  <td class="nowrap">{{ TYPE_LABELS[t.type] ?? t.type }}</td>
                  <td class="nowrap" :class="t.deltaFen > 0 ? 'money-in' : 'money-out'">
                    {{ signedMoney(t.deltaFen) }}
                  </td>
                  <td class="nowrap money">{{ fmtMoney(t.balanceAfterYuan) }}</td>
                  <td class="muted note-cell">{{ t.note || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pager">
            <button type="button" class="btn btn-sm" :disabled="txnPage <= 1 || txnLoading" @click="loadTxns(txnPage - 1)">
              上一页
            </button>
            <span class="muted">第 {{ txnPage }} / {{ txnPages }} 页 · 共 {{ txnTotal }} 条</span>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="txnPage >= txnPages || txnLoading"
              @click="loadTxns(txnPage + 1)"
            >
              下一页
            </button>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.wallet-stats {
  margin-bottom: var(--wx-space-md);
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: var(--wx-space-md);
}

.tabs-inline {
  margin-bottom: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--wx-space-md);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--wx-text-tertiary);
}

.field-wide {
  grid-column: span 2;
}

.form-foot {
  margin-top: var(--wx-space-md);
}

.select {
  min-width: 120px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.money {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.money-in {
  color: var(--wx-success, #17b26a);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.money-out {
  color: var(--wx-danger, #e04f5f);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.note-cell {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.generated {
  margin-top: var(--wx-space-md);
  padding-top: var(--wx-space-md);
  border-top: 1px solid var(--wx-border-soft);
}

.code-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.code-chip {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--wx-glass-bg);
  border: 1px solid var(--wx-border-soft);
  font-family: var(--wx-font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  letter-spacing: 0.04em;
}
</style>
