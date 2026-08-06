-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "authUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Owner_authUserId_key" ON "Owner"("authUserId");

-- Backfill: create the real Owner row (design D5). authUserId stays NULL here —
-- it is set by `scripts/provision-owner.ts` once the Supabase auth user exists.
INSERT INTO "Owner" ("id", "email", "authUserId", "createdAt", "updatedAt")
VALUES ('owner-root', 'fg.francogaleano@gmail.com', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Repoint every S0-seeded Location from the placeholder onto the real owner.
-- If any Location still references an unknown owner id, the FK constraint
-- below fails the migration loudly instead of leaving partial state.
UPDATE "Location"
SET "ownerId" = 'owner-root'
WHERE "ownerId" = 'seed-owner-placeholder';

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
