// 问星 v4 — 学习笔记存储（与社区草稿同命名空间：社区草稿键 community:draft:<industryId>）
// 多条笔记改用 community:notes:<noteId>，同命名空间、同块数据结构（note: true 标记区分于草稿）
import { storage } from '@/utils/storage'
import { defaultDoc, type EdBlock } from '@/components/community/blocks'

/** 笔记键前缀（storage 按当前用户命名空间隔离） */
export const NOTES_PREFIX = 'community:notes:'

export interface NoteDoc {
  id: string
  note: true
  industryId: string
  title: string
  tags: string[]
  images: string[]
  blocks: EdBlock[]
  updatedAt: number
}

/** 列出全部笔记，按 updatedAt 倒序；损坏条目自动跳过 */
export function listNotes(): NoteDoc[] {
  const out: NoteDoc[] = []
  for (const id of storage.keys(NOTES_PREFIX)) {
    const n = getNote(id)
    if (n) out.push(n)
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 读取单条笔记；结构损坏（blocks 非数组）时返回 null */
export function getNote(id: string): NoteDoc | null {
  const n = storage.get<NoteDoc | null>(NOTES_PREFIX + id, null)
  if (!n || typeof n !== 'object' || !Array.isArray(n.blocks)) return null
  return n
}

export function saveNote(note: NoteDoc): void {
  storage.set(NOTES_PREFIX + note.id, note)
}

export function deleteNote(id: string): void {
  storage.remove(NOTES_PREFIX + id)
}

/** 新建一篇空笔记（仅构造，不落盘；落盘由调用方 saveNote 决定） */
export function createNote(industryId: string): NoteDoc {
  const now = Date.now()
  return {
    id: `note-${now}`,
    note: true,
    industryId,
    title: '未命名笔记',
    tags: [],
    images: [],
    blocks: defaultDoc(),
    updatedAt: now
  }
}
