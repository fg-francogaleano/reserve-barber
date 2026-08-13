-- CreateEnum
CREATE TYPE "DepositType" AS ENUM ('FIXED', 'PERCENT');

-- CreateTable
CREATE TABLE "PaymentConfig" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mpAccessToken" TEXT,
    "mpPublicKey" TEXT,
    "transferCbuCvu" VARCHAR(30),
    "transferAlias" VARCHAR(60),
    "transferHolderName" VARCHAR(120),
    "depositType" "DepositType" NOT NULL DEFAULT 'PERCENT',
    "depositValue" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConfig_ownerId_key" ON "PaymentConfig"("ownerId");

-- AddForeignKey
ALTER TABLE "PaymentConfig" ADD CONSTRAINT "PaymentConfig_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
