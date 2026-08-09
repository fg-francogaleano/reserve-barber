-- CreateTable
CREATE TABLE "Barber" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "bio" VARCHAR(500),
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Barber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Barber_locationId_isActive_idx" ON "Barber"("locationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Barber_locationId_displayName_key" ON "Barber"("locationId", "displayName");

-- AddForeignKey
ALTER TABLE "Barber" ADD CONSTRAINT "Barber_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
