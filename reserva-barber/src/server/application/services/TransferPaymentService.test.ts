import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TransferPaymentService } from './TransferPaymentService';
import { MAX_RECEIPT_BYTES } from '@/server/domain/models/receiptFileType';

const TOKEN = 'tok-1';
const SLUG = 'barberia-don-juan';
const BOOKING = 'bkg-1';
const PAYMENT = 'pay-1';
const OWNER = 'own-1';
const AUTH_USER = '3f1c9a2e-7b4d-4e11-9a55-0c2d8e6f1a30';
const NOW = new Date('2026-08-22T12:00:00.000Z');

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function bookingForTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING,
    status: 'PENDING_PAYMENT',
    startTime: new Date('2026-08-23T13:00:00.000Z'),
    endTime: new Date('2026-08-23T13:30:00.000Z'),
    holdExpiresAt: new Date('2026-08-22T12:15:00.000Z'),
    depositAmount: '5000.50',
    ownerId: OWNER,
    ownerAuthUserId: AUTH_USER,
    publicSlug: SLUG,
    barberId: 'bar-1',
    ...overrides,
  };
}

function usableDestination() {
  return {
    hasMercadoPagoCredentials: false,
    transfer: { cbuCvu: '0000003100010000000001', alias: null, holderName: 'Ana Pérez' },
    depositType: 'FIXED' as const,
    depositValue: '5000.50',
  };
}

function build() {
  const bookings = { findForTransfer: vi.fn().mockResolvedValue(bookingForTransfer()) };
  const payments = {
    commitBankTransfer: vi.fn().mockResolvedValue({
      outcome: 'committed',
      payment: { id: PAYMENT },
      holdExpiresAt: new Date('2026-08-22T12:45:00.000Z'),
    }),
    findLiveByBookingId: vi
      .fn()
      .mockResolvedValue({ id: PAYMENT, method: 'BANK_TRANSFER', status: 'PENDING' }),
  };
  const paymentConfig = {
    findPaymentReadinessForPublic: vi.fn().mockResolvedValue(usableDestination()),
  };
  const receipts = {
    attachReceipt: vi.fn().mockResolvedValue({ outcome: 'created', receiptId: 'rcp-1' }),
    // No receipt yet, which is the first-submission case.
    findByBookingId: vi.fn().mockResolvedValue(null),
  };
  const storage = { upload: vi.fn().mockResolvedValue({ key: 'k' }) };
  const clock = { now: () => NOW.getTime(), sleep: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const service = new TransferPaymentService(
    bookings as never,
    payments as never,
    paymentConfig as never,
    receipts as never,
    storage as never,
    clock as never,
    logger as never
  );

  return { service, bookings, payments, paymentConfig, receipts, storage, logger };
}

describe('commit', () => {
  it('opens the transfer payment for a held booking at a configured shop', async () => {
    const { service, payments } = build();

    const result = await service.commit(TOKEN);

    expect(result).toEqual({ outcome: 'committed', slug: SLUG });
    expect(payments.commitBankTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING, amount: '5000.50' })
    );
  });

  /**
   * The amount is the booking's snapshot. Recomputing it would reject a client
   * paying against a destination shown moments before the owner edited their
   * policy — the payment correct, and the system calling it wrong.
   */
  it('passes the snapshotted deposit, never a recomputed one', async () => {
    const { service, payments, paymentConfig } = build();
    paymentConfig.findPaymentReadinessForPublic.mockResolvedValue({
      ...usableDestination(),
      depositValue: '999.00',
    });

    await service.commit(TOKEN);

    expect(payments.commitBankTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '5000.50' })
    );
  });

  it('refuses when the booking is not pending payment', async () => {
    const { service, bookings, payments } = build();
    bookings.findForTransfer.mockResolvedValue(bookingForTransfer({ status: 'CONFIRMED' }));

    const result = await service.commit(TOKEN);

    expect(result).toEqual({ outcome: 'notPayable', slug: SLUG });
    expect(payments.commitBankTransfer).not.toHaveBeenCalled();
  });

  /**
   * Stricter than the bookability gate, deliberately. Without a holder name the
   * client cannot confirm from their bank's screen who they are paying, so the
   * destination is not one a stranger can safely use.
   */
  it('refuses a destination with no holder name', async () => {
    const { service, paymentConfig, payments } = build();
    paymentConfig.findPaymentReadinessForPublic.mockResolvedValue({
      ...usableDestination(),
      transfer: { cbuCvu: '0000003100010000000001', alias: null, holderName: null },
    });

    const result = await service.commit(TOKEN);

    expect(result).toEqual({ outcome: 'notConfigured', slug: SLUG });
    expect(payments.commitBankTransfer).not.toHaveBeenCalled();
  });

  it('refuses when the shop has no destination at all', async () => {
    const { service, paymentConfig } = build();
    paymentConfig.findPaymentReadinessForPublic.mockResolvedValue(null);

    expect(await service.commit(TOKEN)).toEqual({ outcome: 'notConfigured', slug: SLUG });
  });

  it('reports a live Mercado Pago checkout as its own outcome', async () => {
    const { service, payments } = build();
    payments.commitBankTransfer.mockResolvedValue({ outcome: 'mercadoPagoInFlight' });

    expect(await service.commit(TOKEN)).toEqual({ outcome: 'mercadoPagoInFlight', slug: SLUG });
  });

  it('reports a lapsed hold as its own outcome', async () => {
    const { service, payments } = build();
    payments.commitBankTransfer.mockResolvedValue({ outcome: 'holdExpired' });

    expect(await service.commit(TOKEN)).toEqual({ outcome: 'holdExpired', slug: SLUG });
  });

  it('answers a token that resolves to nothing without a slug', async () => {
    const { service, bookings } = build();
    bookings.findForTransfer.mockResolvedValue(null);

    expect(await service.commit(TOKEN)).toEqual({ outcome: 'notFound' });
  });

  /**
   * The destination never travels in this response. The page re-reads it on the
   * render that follows, so the only thing that can put a CBU in front of a
   * client is a live committed state in the database.
   */
  it('returns no destination of any kind', async () => {
    const { service } = build();

    const result = await service.commit(TOKEN);

    expect(JSON.stringify(result)).not.toContain('0000003100010000000001');
    expect(JSON.stringify(result)).not.toContain('Ana Pérez');
  });
});

describe('submitReceipt', () => {
  it('uploads the file and attaches it to the booking', async () => {
    const { service, storage, receipts } = build();

    const result = await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    expect(result).toEqual({ outcome: 'received', slug: SLUG });
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/pdf' })
    );
    expect(receipts.attachReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING, paymentId: PAYMENT, barberId: 'bar-1' })
    );
  });

  /**
   * The order is not interchangeable. An upload that succeeds over a failed
   * transaction leaves a bounded, logged orphan; the reverse leaves a row
   * pointing at nothing, which the owner discovers only when they open it.
   */
  it('uploads before it opens the transaction', async () => {
    const order: string[] = [];
    const { service, storage, receipts } = build();
    storage.upload.mockImplementation(async () => {
      order.push('upload');
      return { key: 'k' };
    });
    receipts.attachReceipt.mockImplementation(async () => {
      order.push('attach');
      return { outcome: 'created', receiptId: 'rcp-1' };
    });

    await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    expect(order).toEqual(['upload', 'attach']);
  });

  it('composes a key from server-held values only', async () => {
    const { service, storage } = build();

    await service.submitReceipt({ cancellationToken: TOKEN, bytes: JPEG });

    const { key } = storage.upload.mock.calls[0][0];
    expect(key).toBe(`${AUTH_USER}/${BOOKING}/${NOW.getTime()}.jpg`);
  });

  /** The bytes decide, and a `.pdf` that is a JPEG is stored as a JPEG. */
  it('classifies by leading bytes rather than by anything declared', async () => {
    const { service, storage } = build();

    await service.submitReceipt({ cancellationToken: TOKEN, bytes: JPEG });

    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/jpeg' })
    );
  });

  it('refuses a file that is not one of the accepted types', async () => {
    const { service, storage } = build();

    const result = await service.submitReceipt({
      cancellationToken: TOKEN,
      bytes: new Uint8Array([0x3c, 0x73, 0x76, 0x67]), // "<svg"
    });

    expect(result).toEqual({ outcome: 'invalidFile', slug: SLUG });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('re-checks the size against the real bytes', async () => {
    const { service, storage } = build();
    const oversized = new Uint8Array(MAX_RECEIPT_BYTES + 1);
    oversized.set(PDF, 0);

    const result = await service.submitReceipt({ cancellationToken: TOKEN, bytes: oversized });

    expect(result).toEqual({ outcome: 'fileTooLarge', slug: SLUG });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('accepts a replacement over a booking already awaiting approval', async () => {
    const { service, bookings, receipts } = build();
    bookings.findForTransfer.mockResolvedValue(bookingForTransfer({ status: 'PENDING_APPROVAL' }));
    receipts.attachReceipt.mockResolvedValue({
      outcome: 'replaced',
      receiptId: 'rcp-1',
      previousPath: 'old/key.jpg',
    });

    expect(await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF })).toEqual({
      outcome: 'received',
      slug: SLUG,
    });
  });

  /**
   * The anonymous uploader holds no delete grant, so the displaced object stays.
   * Logging its key is what a retention rule will follow.
   */
  it('logs the orphaned key when a receipt is replaced', async () => {
    const { service, bookings, receipts, logger } = build();
    bookings.findForTransfer.mockResolvedValue(bookingForTransfer({ status: 'PENDING_APPROVAL' }));
    receipts.attachReceipt.mockResolvedValue({
      outcome: 'replaced',
      receiptId: 'rcp-1',
      previousPath: 'old/key.jpg',
    });

    await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('orphaned'),
      expect.objectContaining({ orphanedKey: 'old/key.jpg' })
    );
  });

  it('refuses a submission with no committed transfer behind it', async () => {
    const { service, payments, storage } = build();
    payments.findLiveByBookingId.mockResolvedValue(null);

    const result = await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    expect(result).toEqual({ outcome: 'notCommitted', slug: SLUG });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('refuses when the live payment belongs to the other method', async () => {
    const { service, payments } = build();
    payments.findLiveByBookingId.mockResolvedValue({ id: PAYMENT, method: 'MERCADO_PAGO' });

    expect(await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF })).toEqual({
      outcome: 'notCommitted',
      slug: SLUG,
    });
  });

  /**
   * Inventing a prefix would place the object where the owner's own policy can
   * never read it — a receipt stored and permanently unreachable.
   */
  it('refuses when the owner has no auth user id to key the object under', async () => {
    const { service, bookings, storage } = build();
    bookings.findForTransfer.mockResolvedValue(bookingForTransfer({ ownerAuthUserId: null }));

    const result = await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    expect(result).toEqual({ outcome: 'notCommitted', slug: SLUG });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('reports a lost slot as its own outcome and warns', async () => {
    const { service, receipts, logger } = build();
    receipts.attachReceipt.mockResolvedValue({ outcome: 'slotLost' });

    const result = await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    expect(result).toEqual({ outcome: 'slotLost', slug: SLUG });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reports the submission cap as its own outcome', async () => {
    const { service, receipts } = build();
    receipts.attachReceipt.mockResolvedValue({ outcome: 'capped' });

    expect(await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF })).toEqual({
      outcome: 'tooManyAttempts',
      slug: SLUG,
    });
  });

  it('refuses over a booking that is confirmed or cancelled', async () => {
    const { service, bookings, storage } = build();
    bookings.findForTransfer.mockResolvedValue(bookingForTransfer({ status: 'CANCELLED' }));

    expect(await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF })).toEqual({
      outcome: 'notPayable',
      slug: SLUG,
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('what never reaches a log', () => {
  /**
   * Every refusal is diagnosable by booking and cause. The client's name, email
   * and phone are not on any projection this service reads, the filename never
   * reaches it, and the destination is never logged.
   */
  it('identifies a refusal by cause and booking, and nothing else', async () => {
    const { service, logger } = build();

    await service.submitReceipt({
      cancellationToken: TOKEN,
      bytes: new Uint8Array([0x00, 0x01]),
    });

    expect(logger.info).toHaveBeenCalledWith(
      'Transfer receipt refused',
      expect.objectContaining({ bookingId: BOOKING, cause: 'unsupported_type' })
    );
    const context = logger.info.mock.calls.at(-1)?.[1];
    expect(JSON.stringify(context)).not.toContain(TOKEN);
  });
});

describe('the deposit rule is not reachable from here', () => {
  /**
   * The Mercado Pago service carries the same assertion. The amount is a
   * snapshot on the booking, and importing the policy would be the first step
   * towards recomputing it.
   */
  it('does not import DepositPolicy', () => {
    const source = readFileSync(new URL('./TransferPaymentService.ts', import.meta.url), 'utf8');

    // Import statements only. The module's own doc comment names the rule it is
    // obeying, and a substring search over the whole file would fail on the
    // sentence that explains why the import is absent.
    const imports = source.split('\n').filter((line) => line.trimStart().startsWith('import'));

    expect(imports.join('\n')).not.toMatch(/depositPolicy/i);
  });
});

describe('the cap bounds object storage, not only rows', () => {
  /**
   * **The defect an adversarial review found after the change was otherwise
   * complete.** `attachReceipt` refuses a capped submission — but it runs
   * *after* the upload, so on its own it bounds rows and leaves the bucket
   * unbounded: a token holder could push 10 MB per request for as long as their
   * booking sat in `PENDING_APPROVAL`, each one answered "too many attempts"
   * while the file was quietly kept.
   *
   * Three documents claimed this bound held. None of them was true for storage,
   * and no test would have noticed, because the existing cap test mocks
   * `attachReceipt` and never asks what the storage did.
   */
  it('writes no object once the cap is reached', async () => {
    const { service, receipts, storage } = build();
    receipts.findByBookingId.mockResolvedValue({
      id: 'rcp-1',
      status: 'PENDING',
      uploadedAt: NOW,
      uploadCount: 3,
    });

    const result = await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    expect(result).toEqual({ outcome: 'tooManyAttempts', slug: SLUG });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(receipts.attachReceipt).not.toHaveBeenCalled();
  });

  it('still uploads while the booking is under the cap', async () => {
    const { service, receipts, storage } = build();
    receipts.findByBookingId.mockResolvedValue({
      id: 'rcp-1',
      status: 'PENDING',
      uploadedAt: NOW,
      uploadCount: 2,
    });
    receipts.attachReceipt.mockResolvedValue({
      outcome: 'replaced',
      receiptId: 'rcp-1',
      previousPath: 'old/key.pdf',
    });

    const result = await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    expect(result).toEqual({ outcome: 'received', slug: SLUG });
    expect(storage.upload).toHaveBeenCalled();
  });

  /**
   * The pre-check cannot settle a race between two concurrent submissions —
   * both would read the same count. The transactional guard still has to hold,
   * so it stays, and this asserts the two do not collapse into one.
   */
  it('keeps the transactional guard as well as the pre-check', async () => {
    const { service, receipts, storage } = build();
    receipts.findByBookingId.mockResolvedValue({
      id: 'rcp-1',
      status: 'PENDING',
      uploadedAt: NOW,
      uploadCount: 1,
    });
    receipts.attachReceipt.mockResolvedValue({ outcome: 'capped' });

    const result = await service.submitReceipt({ cancellationToken: TOKEN, bytes: PDF });

    // The upload happened — the pre-check let it through — and the transaction
    // is what refused. That is the race, reported truthfully.
    expect(storage.upload).toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'tooManyAttempts', slug: SLUG });
  });
});
