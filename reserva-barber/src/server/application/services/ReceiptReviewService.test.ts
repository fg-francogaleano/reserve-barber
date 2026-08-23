import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ReceiptReviewService } from './ReceiptReviewService';

const OWNER = 'own-1';
const RECEIPT = 'rcp-1';
const NOW = new Date('2026-08-22T12:00:00.000Z');

function pendingReceipt(overrides: Record<string, unknown> = {}) {
  return {
    receiptId: RECEIPT,
    bookingId: 'bkg-1',
    filePath: 'auth-1/bkg-1/1755864000000.pdf',
    uploadedAt: NOW,
    startTime: new Date('2026-08-23T13:00:00.000Z'),
    endTime: new Date('2026-08-23T13:30:00.000Z'),
    depositAmount: '5000.50',
    clientName: 'Ana Pérez',
    barberDisplayName: 'Leo',
    serviceName: 'Corte',
    locationName: 'Centro',
    ...overrides,
  };
}

function build() {
  const receipts = {
    findPendingForOwner: vi.fn().mockResolvedValue([pendingReceipt()]),
    approve: vi.fn().mockResolvedValue({ outcome: 'applied' }),
    reject: vi.fn().mockResolvedValue({ outcome: 'applied' }),
  };
  const storage = {
    signForOwner: vi.fn().mockResolvedValue({ url: 'https://s/x?token=t', expiresInSeconds: 300 }),
  };
  const clock = { now: () => NOW.getTime(), sleep: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const service = new ReceiptReviewService(
    receipts as never,
    storage as never,
    clock as never,
    logger as never
  );

  return { service, receipts, storage, logger };
}

describe('listPending', () => {
  it('signs each receipt at request time', async () => {
    const { service, storage } = build();

    const [row] = await service.listPending(OWNER);

    expect(storage.signForOwner).toHaveBeenCalledWith('auth-1/bkg-1/1755864000000.pdf');
    expect(row.fileUrl).toBe('https://s/x?token=t');
  });

  it('scopes the queue by owner', async () => {
    const { service, receipts } = build();

    await service.listPending(OWNER);

    expect(receipts.findPendingForOwner).toHaveBeenCalledWith(OWNER);
  });

  it('carries the snapshotted amount through untouched', async () => {
    const { service } = build();

    const [row] = await service.listPending(OWNER);

    expect(row.depositAmount).toBe('5000.50');
  });

  /**
   * A storage hiccup must not empty a queue the owner needs to work through.
   * The row keeps its appointment, client and expected amount — everything the
   * decision needs except the file — and the page says the link is missing.
   */
  it('renders a row whose file could not be signed rather than failing the page', async () => {
    const { service, storage, logger } = build();
    storage.signForOwner.mockRejectedValue(new Error('object not found'));

    const [row] = await service.listPending(OWNER);

    expect(row.fileUrl).toBeNull();
    expect(row.clientName).toBe('Ana Pérez');
    expect(logger.error).toHaveBeenCalled();
  });

  /**
   * Each signature is an independent round trip. A serial loop would make a
   * ten-row queue ten times slower than a one-row one for no reason.
   */
  it('signs concurrently rather than in sequence', async () => {
    const { service, receipts, storage } = build();
    receipts.findPendingForOwner.mockResolvedValue([
      pendingReceipt({ receiptId: 'a', filePath: 'p/a.pdf' }),
      pendingReceipt({ receiptId: 'b', filePath: 'p/b.pdf' }),
      pendingReceipt({ receiptId: 'c', filePath: 'p/c.pdf' }),
    ]);

    let inFlight = 0;
    let peak = 0;
    storage.signForOwner.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { url: 'https://s/x', expiresInSeconds: 300 };
    });

    await service.listPending(OWNER);

    expect(peak).toBeGreaterThan(1);
  });
});

describe('approve and reject', () => {
  it('approves within the caller scope', async () => {
    const { service, receipts } = build();

    const result = await service.approve(RECEIPT, OWNER);

    expect(result).toEqual({ outcome: 'applied' });
    expect(receipts.approve).toHaveBeenCalledWith(
      expect.objectContaining({ receiptId: RECEIPT, ownerId: OWNER })
    );
  });

  it('rejects within the caller scope', async () => {
    const { service, receipts } = build();

    await service.reject(RECEIPT, OWNER);

    expect(receipts.reject).toHaveBeenCalledWith(
      expect.objectContaining({ receiptId: RECEIPT, ownerId: OWNER })
    );
  });

  it('passes an instant rather than letting the repository invent one', async () => {
    const { service, receipts } = build();

    await service.approve(RECEIPT, OWNER);

    expect(receipts.approve).toHaveBeenCalledWith(expect.objectContaining({ now: NOW }));
  });

  /** A second submission of the same decision is ordinary, not a failure. */
  it('passes a stale decision back as its own outcome', async () => {
    const { service, receipts } = build();
    receipts.approve.mockResolvedValue({ outcome: 'notPending', bookingStatus: 'CONFIRMED' });

    const result = await service.approve(RECEIPT, OWNER);

    expect(result).toEqual({ outcome: 'notPending', bookingStatus: 'CONFIRMED' });
  });

  it('passes a receipt outside the caller scope back as notFound', async () => {
    const { service, receipts } = build();
    receipts.approve.mockResolvedValue({ outcome: 'notFound' });

    expect(await service.approve(RECEIPT, OWNER)).toEqual({ outcome: 'notFound' });
  });
});

describe('what never reaches a log', () => {
  it('records a decision by receipt and outcome, and nothing about the person', async () => {
    const { service, logger } = build();

    await service.approve(RECEIPT, OWNER);

    const [, context] = logger.info.mock.calls.at(-1) ?? [];
    expect(context).toMatchObject({ receiptId: RECEIPT, outcome: 'applied' });
    expect(JSON.stringify(context)).not.toContain('Ana');
  });

  /**
   * A receipt belonging to another owner and one that never existed are the
   * same answer from outside. Logging the first as an error would make the
   * server's own noise the oracle the response refuses to be.
   */
  it('does not log a scope miss as an error', async () => {
    const { service, receipts, logger } = build();
    receipts.approve.mockResolvedValue({ outcome: 'notFound' });

    await service.approve(RECEIPT, OWNER);

    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('nothing here claims a payment was verified', () => {
  /**
   * There is no bank integration and a receipt image is trivially fabricated.
   * The vocabulary is enforced so a later reader cannot infer from a name that
   * the system checks something it does not.
   */
  it('uses no verification vocabulary in its own source', () => {
    const source = readFileSync(new URL('./ReceiptReviewService.ts', import.meta.url), 'utf8');

    const identifiers = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');

    expect(identifiers).not.toMatch(/verifyPayment|validateTransfer|confirmTransfer/i);
  });
});
