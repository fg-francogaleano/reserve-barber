-- The two predicates the scheduled sweep (B7) runs, each given an index.
--
-- The sweep names no barber -- it is a maintenance query over every shop at
-- once -- so `Booking_barberId_startTime_idx`, which serves the availability
-- read and the no-overlap check, cannot help either of these. Without these two
-- indexes the job walks the whole table every five minutes, against a pooler
-- shared with the owner's dashboard and the public booking write.
--
-- PARTIAL, not full. The eligible statuses are a small and shrinking minority
-- of a table that grows with every appointment ever made, and a row leaves both
-- indexes the moment it is swept. A full index would carry every confirmed
-- booking in the product's history for a query that can never match one.
--
-- prisma/schema.prisma previously recorded that a partial index on the blocking
-- statuses was "rejected as premature -- it would optimize a predicate B7 may
-- still refine". The predicate is now written, and these match it.
--
-- Raw SQL because Prisma's schema language cannot declare a partial index.
-- Their existence is recorded in prisma/schema.prisma so the schema file is not
-- mistaken for the whole truth -- the same note the hold CHECK constraint and
-- Payment_one_live_per_booking already carry.
--
-- Index-only: no column is altered, no constraint added, no row modified. Every
-- booking eligible on the day this ships has been eligible for as long as it
-- has existed, and availability has treated it as such throughout -- so there
-- is nothing to correct, and the job reaches the backlog on its own in bounded
-- batches.

-- Serves: status = 'PENDING_PAYMENT' AND "holdExpiresAt" < cutoff
--   ordered by "holdExpiresAt" ASC (oldest abandoned hold first).
CREATE INDEX "Booking_lapsed_hold_sweep"
  ON "Booking" ("holdExpiresAt")
  WHERE status = 'PENDING_PAYMENT';

-- Serves: status = 'PENDING_APPROVAL' AND "startTime" < now
--   ordered by "startTime" ASC (oldest unanswered receipt first).
--
-- Keyed on "startTime" and NOT on "holdExpiresAt": that column is the deadline
-- for UPLOADING a receipt, not for ANSWERING one. A receipt whose upload window
-- lapsed weeks ago still holds a future appointment.
CREATE INDEX "Booking_unanswered_receipt_sweep"
  ON "Booking" ("startTime")
  WHERE status = 'PENDING_APPROVAL';
