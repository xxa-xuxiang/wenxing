// 一次性重置脚本：清空所有用户，新建用户 X / 12345678
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  console.log('[reset] 清空所有用户（级联删除关联数据）...')
  const deleted = await db.user.deleteMany()
  console.log(`[reset] 已删除 ${deleted.count} 个用户`)

  const hash = await bcrypt.hash('12345678', 10)
  const u = await db.user.create({
    data: {
      username: 'XXX',
      passwordHash: hash,
      nickname: 'XXX',
    }
  })
  console.log(`[reset] 已创建用户 XXX（id=${u.id}），密码 12345678`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
