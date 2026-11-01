// 问星 v0.1 — 20 行业注册表（星图 / 问卷 / 定制器共享的单一数据源）
// id 说明：信息技术与软件保留 'cs'，用于命中旧版 localStorage 存档（domain.id === 'cs'）的迁移逻辑
import industryMd from './industry-classification.md?raw'
import medicalMd from './medical-classification.md?raw'
import financeMd from './finance-classification.md?raw'
import manufacturingMd from './manufacturing-classification.md?raw'
import constructionMd from './construction-classification.md?raw'
import transportMd from './transport-classification.md?raw'
import govMd from './gov-classification.md?raw'
import agricultureMd from './agriculture-classification.md?raw'
import educationMd from './education-classification.md?raw'
import marketingMd from './marketing-classification.md?raw'
import retailMd from './retail-classification.md?raw'
import automotiveMd from './automotive-classification.md?raw'
import chemicalMd from './chemical-classification.md?raw'
import consumerMd from './consumer-classification.md?raw'
import cultureMd from './culture-classification.md?raw'
import environmentMd from './environment-classification.md?raw'
import electronicsMd from './electronics-classification.md?raw'
import aerospaceMd from './aerospace-classification.md?raw'
import miningMd from './mining-classification.md?raw'
import textileMd from './textile-classification.md?raw'

export interface IndustryDef {
  id: string
  name: string
  md: string
}

export const industries: IndustryDef[] = [
  { id: 'cs', name: '信息技术与软件', md: industryMd },
  { id: 'medical', name: '医疗卫生与生命科学', md: medicalMd },
  { id: 'finance', name: '金融', md: financeMd },
  { id: 'manufacturing', name: '制造业与工业工程', md: manufacturingMd },
  { id: 'construction', name: '建筑业与工程建设', md: constructionMd },
  { id: 'transport', name: '交通运输仓储与物流', md: transportMd },
  { id: 'gov', name: '政府公共治理与国防安全', md: govMd },
  { id: 'agriculture', name: '农业林业渔业与食品', md: agricultureMd },
  { id: 'education', name: '教育培训研究与知识服务', md: educationMd },
  { id: 'marketing', name: '营销传媒与创意产业', md: marketingMd },
  { id: 'retail', name: '零售电商与消费品', md: retailMd },
  { id: 'automotive', name: '汽车出行与智能交通', md: automotiveMd },
  { id: 'chemical', name: '化工材料与生物技术', md: chemicalMd },
  { id: 'consumer', name: '消费品与服务业', md: consumerMd },
  { id: 'culture', name: '文化体育与娱乐产业', md: cultureMd },
  { id: 'environment', name: '环境水务与城市治理', md: environmentMd },
  { id: 'electronics', name: '通信电子与半导体', md: electronicsMd },
  { id: 'aerospace', name: '航空航天与国防工业', md: aerospaceMd },
  { id: 'mining', name: '矿业冶金与原材料', md: miningMd },
  { id: 'textile', name: '纺织服装与轻工制造', md: textileMd }
]

export function industryByName(name: string): IndustryDef | undefined {
  return industries.find((i) => i.name === name)
}
