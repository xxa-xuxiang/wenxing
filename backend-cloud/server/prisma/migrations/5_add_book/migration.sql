-- 加性变更：社区书籍书架（Book 表）
CREATE TABLE "Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "format" TEXT NOT NULL,
    "filePath" TEXT,
    "fileSize" INTEGER,
    "coverPath" TEXT,
    "sourceUrl" TEXT,
    "license" TEXT,
    "industry" TEXT,
    "tags" TEXT,
    "textbookSlug" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Book_industry_idx" ON "Book"("industry");
CREATE INDEX "Book_createdAt_idx" ON "Book"("createdAt");
