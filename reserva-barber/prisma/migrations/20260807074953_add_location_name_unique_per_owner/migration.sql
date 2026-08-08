-- Moves the "name unique per owner" rule of docs/data-model.md §4 out of prose
-- and into the database. Verified before writing this migration: no duplicate
-- (ownerId, lower(trim(name))) pairs exist, so creating the unique index cannot
-- abort. Rollback is a single DROP INDEX — no data is transformed.

-- CreateIndex
CREATE UNIQUE INDEX "Location_ownerId_name_key" ON "Location"("ownerId", "name");

-- Backs the dashboard list query, which always filters by owner.
-- CreateIndex
CREATE INDEX "Location_ownerId_isActive_idx" ON "Location"("ownerId", "isActive");
