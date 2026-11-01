// 问星移动端 — AI 计费配置读取（桌面端 pricingService 的移动端精简版）
// 桌面端原文件是「在线时长轮询 + 变更提醒」；移动端只在「计费」分区按需读取，不做后台轮询。
import { http } from './http'

export interface PricingBilling {
  managementFee: number
  currency: string
  note: string
}

export interface PricingInfo {
  version?: number
  billing?: PricingBilling
  [key: string]: unknown
}

/** 读取计费配置（套餐/对比表/管理费说明） */
export function fetchPricing(): Promise<PricingInfo> {
  return http<PricingInfo>('/api/billing/pricing', { timeout: 10000 })
}
