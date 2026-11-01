// 问星移动端 — 钱包服务：余额查询 / 兑换码核销
import { http } from './http'

export interface WalletTxn {
  id: string
  deltaFen: number
  deltaYuan: number
  type: string
  refId: string | null
  balanceAfter: number
  balanceYuan: number
  note: string
  createdAt: string
}

export interface WalletResult {
  balanceFen: number
  balanceYuan: number
  items: WalletTxn[]
}

export interface RedeemResult {
  ok: true
  amountFen: number
  amountYuan: number
  balanceFen: number
  balanceYuan: number
}

/** 查询我的余额与最近流水（需登录） */
export function fetchWallet(limit = 20): Promise<WalletResult> {
  return http<WalletResult>(`/api/wallet?limit=${limit}`, { timeout: 10000 })
}

/** 兑换码核销（成功后立即入账） */
export function redeemWalletCode(code: string): Promise<RedeemResult> {
  return http<RedeemResult>('/api/wallet/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
    timeout: 15000
  })
}
