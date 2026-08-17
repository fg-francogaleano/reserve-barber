-- A PENDING_PAYMENT booking must carry the deadline that makes it provisional.
--
-- Availability treats a null `holdExpiresAt` on a PENDING_PAYMENT row as
-- BLOCKING, on purpose: reading an absent deadline as "expired long ago" would
-- release a slot the moment a write set the status without it. That decision is
-- only safe while the combination cannot exist.
--
-- Left unconstrained it is a permanent silent lock. The sweep job (B7) selects
-- on `holdExpiresAt < now`, which is false for null, so the row would never be
-- expired, never stop blocking, and no surface in the product would explain to
-- the owner why that slot never came back.
--
-- PENDING_APPROVAL is deliberately excluded: a receipt has been uploaded and a
-- human owes an answer, so it blocks regardless of any deadline and needs none.
--
-- Raw SQL because Prisma's schema language cannot declare a CHECK. Its existence
-- is recorded in prisma/schema.prisma so the schema file is not mistaken for the
-- whole truth.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_pending_payment_requires_hold_expiry"
  CHECK (status <> 'PENDING_PAYMENT' OR "holdExpiresAt" IS NOT NULL);
