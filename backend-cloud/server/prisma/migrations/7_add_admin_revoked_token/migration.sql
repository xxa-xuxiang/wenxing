-- CreateTable（纯加性：管理员令牌吊销表，logout 时登记 jti，到期惰性清理）
CREATE TABLE "AdminRevokedToken" (
    "jti" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AdminRevokedToken_expiresAt_idx" ON "AdminRevokedToken"("expiresAt");
