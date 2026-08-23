-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TransferReceipt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "uploadCount" INTEGER NOT NULL DEFAULT 1,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TransferReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferReceipt_paymentId_key" ON "TransferReceipt"("paymentId");

-- CreateIndex
CREATE INDEX "TransferReceipt_status_uploadedAt_idx" ON "TransferReceipt"("status", "uploadedAt");

-- AddForeignKey
ALTER TABLE "TransferReceipt" ADD CONSTRAINT "TransferReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
