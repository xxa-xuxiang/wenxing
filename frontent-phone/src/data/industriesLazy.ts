// 问星 v0.7 — 行业分类 md 正文按需加载
// 单个行业一个动态 import：只有真正需要解析某行业分类时（如确认技能组解析知识点路径）才拉取该行业的 md，
// 避免 20 个行业 md（约 465KB）整体进首屏 chunk。
const LOADERS: Record<string, () => Promise<string>> = {
  信息技术与软件: () => import('./industry-classification.md?raw').then((m) => m.default),
  医疗卫生与生命科学: () => import('./medical-classification.md?raw').then((m) => m.default),
  金融: () => import('./finance-classification.md?raw').then((m) => m.default),
  制造业与工业工程: () => import('./manufacturing-classification.md?raw').then((m) => m.default),
  建筑业与工程建设: () => import('./construction-classification.md?raw').then((m) => m.default),
  交通运输仓储与物流: () => import('./transport-classification.md?raw').then((m) => m.default),
  政府公共治理与国防安全: () => import('./gov-classification.md?raw').then((m) => m.default),
  农业林业渔业与食品: () => import('./agriculture-classification.md?raw').then((m) => m.default),
  教育培训研究与知识服务: () => import('./education-classification.md?raw').then((m) => m.default),
  营销传媒与创意产业: () => import('./marketing-classification.md?raw').then((m) => m.default),
  零售电商与消费品: () => import('./retail-classification.md?raw').then((m) => m.default),
  汽车出行与智能交通: () => import('./automotive-classification.md?raw').then((m) => m.default),
  化工材料与生物技术: () => import('./chemical-classification.md?raw').then((m) => m.default),
  消费品与服务业: () => import('./consumer-classification.md?raw').then((m) => m.default),
  文化体育与娱乐产业: () => import('./culture-classification.md?raw').then((m) => m.default),
  环境水务与城市治理: () => import('./environment-classification.md?raw').then((m) => m.default),
  通信电子与半导体: () => import('./electronics-classification.md?raw').then((m) => m.default),
  航空航天与国防工业: () => import('./aerospace-classification.md?raw').then((m) => m.default),
  矿业冶金与原材料: () => import('./mining-classification.md?raw').then((m) => m.default),
  纺织服装与轻工制造: () => import('./textile-classification.md?raw').then((m) => m.default)
}

/** 按行业名加载其分类 md 正文；未知行业返回空串 */
export function loadIndustryMd(name: string): Promise<string> {
  const load = LOADERS[name]
  return load ? load() : Promise.resolve('')
}
