-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'WHATSAPP', 'X', 'YOUTUBE', 'WEBSITE');

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "businessName" VARCHAR(120) NOT NULL,
    "bio" VARCHAR(1000),
    "photoUrl" TEXT,
    "coverUrl" TEXT,
    "publicSlug" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialLink" (
    "id" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_ownerId_key" ON "BusinessProfile"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_publicSlug_key" ON "BusinessProfile"("publicSlug");

-- CreateIndex
CREATE INDEX "SocialLink_businessProfileId_orderIndex_idx" ON "SocialLink"("businessProfileId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SocialLink_businessProfileId_platform_key" ON "SocialLink"("businessProfileId", "platform");

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialLink" ADD CONSTRAINT "SocialLink_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
