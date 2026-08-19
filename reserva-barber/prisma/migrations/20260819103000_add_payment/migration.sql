-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MERCADO_PAGO', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "mpPaymentId" TEXT,
    "mpPreferenceId" TEXT,
    "mpInitPoint" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_mpPaymentId_key" ON "Payment"("mpPaymentId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one live payment per booking.
--
-- Two concurrent taps on "Pagar seña" each read no existing payment and each
-- create a preference, so the rule cannot live in handler logic — one of the
-- two writes has to be refused by the database or the client gets two charges
-- for one slot.
--
-- REJECTED is excluded deliberately: a failed attempt must not block a retry,
-- and a client whose card was declined is exactly the person who will try
-- again. PENDING and APPROVED are the two states that mean "this booking's
-- payment is already accounted for".
--
-- Raw SQL because Prisma's schema language cannot declare a partial index. Its
-- existence is recorded in prisma/schema.prisma so the schema file is not
-- mistaken for the whole truth — the same note Booking carries for its hold
-- constraint.
CREATE UNIQUE INDEX "Payment_one_live_per_booking"
  ON "Payment" ("bookingId") WHERE status <> 'REJECTED';
