-- 充值系统（v1.1）：账户余额 + 兑换码 + 充值订单 + 余额流水
--
-- 纯加性变更：仅给 User 增加一列余额，并新建三张表与索引，不改动/删除任何现有列与数据。
-- 金额一律用整数「分」存储（balanceFen / amountFen / deltaFen），避免浮点误差。
-- 幂等处理：本地若曾用 db push 建过表，IF NOT EXISTS 保证不报错。

ALTER TABLE "User" ADD COLUMN "balanceFen" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "RedeemCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "usedBy" TEXT,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "RedeemCode_code_key" ON "RedeemCode"("code");
CREATE INDEX IF NOT EXISTS "RedeemCode_usedBy_idx" ON "RedeemCode"("usedBy");
CREATE INDEX IF NOT EXISTS "RedeemCode_createdAt_idx" ON "RedeemCode"("createdAt");

CREATE TABLE IF NOT EXISTS "RechargeOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "refCode" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "operator" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RechargeOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RechargeOrder_userId_createdAt_idx" ON "RechargeOrder"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RechargeOrder_createdAt_idx" ON "RechargeOrder"("createdAt");
CREATE INDEX IF NOT EXISTS "RechargeOrder_channel_idx" ON "RechargeOrder"("channel");

CREATE TABLE IF NOT EXISTS "WalletTxn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deltaFen" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "refId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletTxn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WalletTxn_userId_createdAt_idx" ON "WalletTxn"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "WalletTxn_createdAt_idx" ON "WalletTxn"("createdAt");
CREATE INDEX IF NOT EXISTS "WalletTxn_type_idx" ON "WalletTxn"("type");
