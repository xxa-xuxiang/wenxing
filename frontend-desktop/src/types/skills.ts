// 问星 · 星图技能数据模型（甲编 · 学科内技能）
// 数据由 frontend-desktop/scripts/gen-skills-atlas.mjs 从
// `技能分类/甲编 · 学科内技能/<技能类>/<族>/<项>.md` 解析生成到 src/data/skillsAtlas.json。
// 层级：编 → 技能类 → 族 → 项 → 知识点 → 子知识点 → 细目 → 条目（星图渲染到「子知识点」层）
export interface SkillTags {
  /** 迁移性：高 / 中 / 低 */
  qy?: string
  /** AI 风险：高 / 中 / 低 */
  ai?: string
  /** 半衰期：长 / 中 / 短 */
  hb?: string
  /** 是否执照门槛 */
  zz?: boolean
}

/** 细目（第五级） */
export interface SkillXm {
  n: string
  /** 条目（第六级，纯名称） */
  tm: string[]
}

/** 子知识点（第四级；星图叶子层） */
export interface SkillZk {
  n: string
  xm: SkillXm[]
}

/** 知识点（第三级；附适用专业 / 证据载体 / 标签） */
export interface SkillKp {
  n: string
  /** 适用专业 */
  zy: string[]
  /** 证据载体 */
  zj: string[]
  tags?: SkillTags
  zk: SkillZk[]
}

/** 项（第二级；一个 md 文件） */
export interface SkillXiang {
  n: string
  kp: SkillKp[]
}

/** 族（能力域，A–N） */
export interface SkillZu {
  n: string
  xiang: SkillXiang[]
}

/** 技能类（研究技能类 / 生产技能类） */
export interface SkillLeixing {
  n: string
  zu: SkillZu[]
}

/** 甲编 · 学科内技能结构树 */
export interface SkillsAtlas {
  bian: string
  generatedAt: string
  leixing: SkillLeixing[]
}
