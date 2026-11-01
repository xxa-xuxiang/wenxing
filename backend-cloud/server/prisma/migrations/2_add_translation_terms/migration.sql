-- 划词翻译（v1.5）：术语库 + 译文缓存
CREATE TABLE "TermEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zh" TEXT NOT NULL,
    "en" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT 'general',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "TermEntry_zh_en_domain_key" ON "TermEntry"("zh", "en", "domain");
CREATE INDEX "TermEntry_domain_idx" ON "TermEntry"("domain");
CREATE INDEX "TermEntry_zh_idx" ON "TermEntry"("zh");

CREATE TABLE "TranslationCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "fromLang" TEXT NOT NULL,
    "toLang" TEXT NOT NULL,
    "terms" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "TranslationCache_hash_key" ON "TranslationCache"("hash");
CREATE INDEX "TranslationCache_createdAt_idx" ON "TranslationCache"("createdAt");
