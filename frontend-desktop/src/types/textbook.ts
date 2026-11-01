// 问星 v1.7 — 教材导入类型（与后端 lib/epub.js 产出的 tree.json 对齐）

/** 教材章节节点（嵌套；父节点 id 即「章」） */
export interface TextbookNode {
  /** 阅读顺序编号，如 s001（同时是 sections 目录下的文件名） */
  id: string
  /** 阅读顺序（1 起，严格递增） */
  ordinal: number
  /** 层级（1 = 章，2 = 节…） */
  level: number
  title: string
  /** 所属章标题（level 1 节点即自身标题） */
  chapter: string
  file: string
  /** 来源：epub 内相对路径（可带 #锚点），用于溯源 */
  src: string
  /** 正文字数（不含空白） */
  charCount: number
  codeBlocks: number
  runnable: 'runnable' | 'partial' | 'illustrative'
  hasExercise: boolean
  children: TextbookNode[]
}

/** 教材章节树 */
export interface TextbookTree {
  slug: string
  title: string
  creator?: string
  importedAt: string
  nodeCount: number
  warnings: string[]
  nodes: TextbookNode[]
}

/** POST /api/textbooks/import 返回体 */
export interface TextbookImportResult {
  slug: string
  tree: TextbookTree
  stats: { sections: number; assets: number; chars: number }
}
