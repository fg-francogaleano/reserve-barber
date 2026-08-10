-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "price" DECIMAL(12,2) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Service_ownerId_isActive_idx" ON "Service"("ownerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Service_ownerId_name_key" ON "Service"("ownerId", "name");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
