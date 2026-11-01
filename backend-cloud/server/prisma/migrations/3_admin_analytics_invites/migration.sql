-- 管理后台增强：帖子审核、邀请码、行为埋点
ALTER TABLE "CommunityPost" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "CommunityPost" ADD COLUMN "auditReason" TEXT;
ALTER TABLE "CommunityPost" ADD COLUMN "auditBy" TEXT;
ALTER TABLE "CommunityPost" ADD COLUMN "auditedAt" DATETIME;
CREATE INDEX "CommunityPost_status_createdAt_idx" ON "CommunityPost"("status", "createdAt");

ALTER TABLE "User" ADD COLUMN "inviteCode" TEXT;
ALTER TABLE "User" ADD COLUMN "invitedById" TEXT;
CREATE UNIQUE INDEX "User_inviteCode_key" ON "User"("inviteCode");
CREATE INDEX "User_invitedById_idx" ON "User"("invitedById");

CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "target" TEXT,
    "durationMs" INTEGER,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "UsageEvent_createdAt_idx" ON "UsageEvent"("createdAt");
CREATE INDEX "UsageEvent_kind_screen_createdAt_idx" ON "UsageEvent"("kind", "screen", "createdAt");
CREATE INDEX "UsageEvent_userId_createdAt_idx" ON "UsageEvent"("userId", "createdAt");
CREATE INDEX "UsageEvent_sessionId_createdAt_idx" ON "UsageEvent"("sessionId", "createdAt");
