-- 加性变更：任务卡四字段 + 微反馈/埋点两表
-- 全部新字段可空（含 updatedAt），老数据不受影响；不重建任何现有表

ALTER TABLE "PlanTask" ADD COLUMN "acceptanceJson" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "commonErrorsJson" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "deliverable" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "estMinutes" INTEGER;
ALTER TABLE "PlanTask" ADD COLUMN "isCriticalPath" BOOLEAN DEFAULT false;
ALTER TABLE "PlanTask" ADD COLUMN "onboardingNote" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "resourcesJson" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "scaffoldLevel" INTEGER DEFAULT 3;
ALTER TABLE "PlanTask" ADD COLUMN "stepsJson" TEXT;
ALTER TABLE "PlanTask" ADD COLUMN "updatedAt" DATETIME;

CREATE TABLE "FeedbackEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userGiven" TEXT NOT NULL,
    "reasonTag" TEXT,
    "detail" TEXT,
    "taskId" TEXT,
    "userId" TEXT,
    "contextJson" TEXT,
    "qualityScore" REAL,
    "actionTaken" TEXT,
    "planChanged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "LearnerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "taskId" TEXT,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "FeedbackEvent_taskId_idx" ON "FeedbackEvent"("taskId");
CREATE INDEX "FeedbackEvent_reasonTag_idx" ON "FeedbackEvent"("reasonTag");
CREATE INDEX "FeedbackEvent_createdAt_idx" ON "FeedbackEvent"("createdAt");
CREATE INDEX "LearnerEvent_taskId_type_idx" ON "LearnerEvent"("taskId", "type");
CREATE INDEX "LearnerEvent_createdAt_idx" ON "LearnerEvent"("createdAt");
