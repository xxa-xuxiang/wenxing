// 问星 v0.7 — 行业元数据（仅 id/name/超类，不含分类 md 正文）
// 为什么拆出：分类 md 正文合计约 465KB，若被启动路径（authStore → learnStore → domains）静态引用，
// 会整包进首屏 chunk。启动路径只需要 id/name，因此这里只保留轻量元数据；
// 含 md 的完整注册表见 industries.ts（仅供懒加载路由使用），按需单文件加载见 industriesLazy.ts。
export interface IndustryMeta {
  id: string
  name: string
  /** 所属超类 id，见 industryGroups */
  group: string
}

// ===== 超类（星图最外层：行业大类之前的一层）=====
// 依据 GB/T 4754《国民经济行业分类》门类字母归并为 7 个获取—转化—流通—服务链条环节。
// 跨门类行业按“主业门类”归类，具体依据写在各成员下方注释。
export interface IndustryGroup {
  id: string
  name: string
  /** 覆盖的国标门类字母 */
  codes: string
  /** 链条定位说明 */
  desc: string
  /** 成员行业 id（顺序即星图展示顺序） */
  industries: string[]
}

export const industryGroups: IndustryGroup[] = [
  {
    id: 'resource',
    name: '资源与农业',
    codes: 'A 农林牧渔 · B 采矿',
    desc: '从自然直接获取原料',
    industries: ['agriculture', 'mining']
  },
  {
    id: 'manufacture',
    name: '制造与建造',
    codes: 'C 制造 · D 水电气供应 · E 建筑',
    desc: '把原料变成实物 / 工程',
    // 化工材料/纺织服装/通信电子/航空航天按主业均属 C 制造；消费品为轻工 C（兼 H 生活服务）
    industries: ['manufacturing', 'construction', 'chemical', 'textile', 'electronics', 'aerospace', 'consumer']
  },
  {
    id: 'trade',
    name: '流通与贸易',
    codes: 'F 批发零售 · G 交通仓储邮政',
    desc: '把东西从产地送到用户',
    // 汽车出行以整车流通与交通服务为主业，归 G 交通运输
    industries: ['retail', 'transport', 'automotive']
  },
  {
    id: 'life',
    name: '消费与生活服务',
    codes: 'H 住宿餐饮 · O 居民服务修理 · R 文体娱乐',
    desc: '直接服务个人日常生活',
    // 文化体育与娱乐对应 R 文体娱乐
    industries: ['culture']
  },
  {
    id: 'digital',
    name: '数字与专业服务',
    codes: 'I 信息传输软件 · L 租赁商务服务 · M 科研技术',
    desc: '靠知识、技术、信息交付',
    // 信息技术对应 I；营销传媒兼跨 L 商务服务与 R 文体娱乐，按商务信息服务归 L；
    // 教育培训研究与知识服务以知识/技术服务交付，归 M 科研技术服务（非公共教育 P）
    industries: ['cs', 'marketing', 'education']
  },
  {
    id: 'finance',
    name: '金融与地产',
    codes: 'J 金融 · K 房地产',
    desc: '管资金、管空间资产',
    industries: ['finance']
  },
  {
    id: 'public',
    name: '公共与社会服务',
    codes: 'N 水利环境 · P 教育 · Q 医疗卫生社工 · S 公共管理 · T 国际组织',
    desc: '政府 / 公共 / 非营利供给',
    industries: ['gov', 'medical', 'environment']
  }
]

export const industryMetas: IndustryMeta[] = [
  { id: 'cs', name: '信息技术与软件', group: 'digital' },
  { id: 'medical', name: '医疗卫生与生命科学', group: 'public' },
  { id: 'finance', name: '金融', group: 'finance' },
  { id: 'manufacturing', name: '制造业与工业工程', group: 'manufacture' },
  { id: 'construction', name: '建筑业与工程建设', group: 'manufacture' },
  { id: 'transport', name: '交通运输仓储与物流', group: 'trade' },
  { id: 'gov', name: '政府公共治理与国防安全', group: 'public' },
  { id: 'agriculture', name: '农业林业渔业与食品', group: 'resource' },
  { id: 'education', name: '教育培训研究与知识服务', group: 'digital' },
  { id: 'marketing', name: '营销传媒与创意产业', group: 'digital' },
  { id: 'retail', name: '零售电商与消费品', group: 'trade' },
  { id: 'automotive', name: '汽车出行与智能交通', group: 'trade' },
  { id: 'chemical', name: '化工材料与生物技术', group: 'manufacture' },
  { id: 'consumer', name: '消费品与服务业', group: 'manufacture' },
  { id: 'culture', name: '文化体育与娱乐产业', group: 'life' },
  { id: 'environment', name: '环境水务与城市治理', group: 'public' },
  { id: 'electronics', name: '通信电子与半导体', group: 'manufacture' },
  { id: 'aerospace', name: '航空航天与国防工业', group: 'manufacture' },
  { id: 'mining', name: '矿业冶金与原材料', group: 'resource' },
  { id: 'textile', name: '纺织服装与轻工制造', group: 'manufacture' }
]

export function industryMetaByName(name: string): IndustryMeta | undefined {
  return industryMetas.find((i) => i.name === name)
}

/** 行业 → 超类（未登记行业兜底归入数字与专业服务，保证星图不丢节点） */
export function groupOfIndustry(industryId: string): IndustryGroup {
  return (
    industryGroups.find((g) => g.industries.includes(industryId)) ??
    industryGroups.find((g) => g.id === 'digital')!
  )
}
