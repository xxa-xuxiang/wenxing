-- 补记遗漏的迁移：Checkin / WeeklyReview
--
-- 原因：schema.prisma 里已有这两个模型，但历史上是本地用 `prisma db push`
-- 直接建表，没有生成对应迁移；云端空库只执行 migrations，因此缺表，
-- 管理后台登录后 dashboard 报 "table main.Checkin does not exist"。
--
-- 纯加性变更：只新建两张表与索引，不改动任何现有表和已有数据。
-- 使用 IF NOT EXISTS，本地那条已被 db push 建过表的库也不会报错。

CREATE TABLE IF NOT EXISTS "Checkin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "taskIds" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Checkin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Checkin_userId_date_key" ON "Checkin"("userId", "date");
CREATE INDEX IF NOT EXISTS "Checkin_userId_idx" ON "Checkin"("userId");

CREATE TABLE IF NOT EXISTS "WeeklyReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "good" TEXT NOT NULL DEFAULT '',
    "bad" TEXT NOT NULL DEFAULT '',
    "improve" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeeklyReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyReview_userId_weekStart_key" ON "WeeklyReview"("userId", "weekStart");
