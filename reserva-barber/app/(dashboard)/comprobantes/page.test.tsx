import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type { ReviewableReceipt } from '@/server/application/services/ReceiptReviewService';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const listPending = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./receiptReviewService', () => ({
  receiptReviewService: async () => ({ listPending }),
}));
vi.mock('./actions', () => ({
  approveReceiptAction: vi.fn(),
  rejectReceiptAction: vi.fn(),
}));

const { default: ReceiptsPage } = await import('./page');

function receipt(overrides: Partial<ReviewableReceipt> = {}): ReviewableReceipt {
  return {
    receiptId: 'rcp-1',
    bookingId: 'bkg-1',
    filePath: 'auth-1/bkg-1/1755864000000.pdf',
    uploadedAt: new Date('2026-08-22T12:00:00.000Z'),
    startTime: new Date('2026-08-23T13:00:00.000Z'),
    endTime: new Date('2026-08-23T13:30:00.000Z'),
    depositAmount: '5000.50',
    clientName: 'Ana Pérez',
    barberDisplayName: 'Leo',
    serviceName: 'Corte',
    locationName: 'Centro',
    fileUrl: 'https://storage.example/receipt?token=t',
    ...overrides,
  };
}

async function renderPage(rows: ReviewableReceipt[] = [receipt()]) {
  listPending.mockResolvedValue(rows);
  return render(await ReceiptsPage());
}

beforeEach(() => {
  listPending.mockReset();
});

describe('the queue', () => {
  it('lists a pending receipt with its appointment and client', async () => {
    await renderPage();

    expect(screen.getByText(/Corte/)).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
  });

  it('is scoped to the signed-in owner', async () => {
    await renderPage();

    expect(listPending).toHaveBeenCalledWith('owner-root');
  });

  /**
   * The figure the owner compares against their bank statement. Without it,
   * approving is a guess — this is the only thing on the page that makes the
   * comparison possible at all.
   */
  it('renders the expected amount beside the receipt', async () => {
    const { container } = await renderPage();

    expect(screen.getByText(COPY.receipts.amountLabel)).toBeInTheDocument();
    expect(container.textContent).toContain('5.000,50');
  });

  it('renders both decisions for each row', async () => {
    await renderPage();

    expect(screen.getByRole('button', { name: COPY.receipts.approve })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.receipts.reject })).toBeInTheDocument();
  });

  it('renders one card per pending receipt', async () => {
    await renderPage([
      receipt({ receiptId: 'a', clientName: 'Ana' }),
      receipt({ receiptId: 'b', clientName: 'Bruno' }),
    ]);

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bruno')).toBeInTheDocument();
  });
});

describe('the empty state', () => {
  it('is designed rather than a blank region', async () => {
    await renderPage([]);

    expect(screen.getByText(COPY.receipts.emptyState)).toBeInTheDocument();
    expect(screen.getByText(COPY.receipts.emptyStateHelp)).toBeInTheDocument();
  });

  it('offers no decision controls when there is nothing to decide', async () => {
    const { container } = await renderPage([]);

    expect(container.querySelector('button')).toBeNull();
  });
});

describe('the file link', () => {
  it('uses the signed URL produced for this render', async () => {
    const { container } = await renderPage();
    const link = container.querySelector('a[href^="https://storage.example"]');

    expect(link).toBeInTheDocument();
    expect(link?.textContent).toBe(COPY.receipts.openFile);
  });

  /** The stored value is a key, so no unsigned address can appear here. */
  it('never renders the stored object key', async () => {
    const { container } = await renderPage();

    expect(container.textContent).not.toContain('auth-1/bkg-1/1755864000000.pdf');
  });

  /**
   * A storage hiccup must not empty a queue the owner needs to work through.
   * The row keeps everything the decision needs except the file.
   */
  it('still renders the row when the link could not be produced', async () => {
    await renderPage([receipt({ fileUrl: null })]);

    expect(screen.getByText(COPY.receipts.fileUnavailable)).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.receipts.approve })).toBeInTheDocument();
  });
});

describe('the page does not claim the transfer was checked', () => {
  /**
   * There is no bank integration and a receipt image is trivially fabricated.
   * The page tells the owner what they have to do rather than implying the
   * system already did it.
   */
  it('instructs the owner to verify against their bank', async () => {
    await renderPage();

    expect(screen.getByText(COPY.receipts.intro)).toBeInTheDocument();
  });

  it('never states that a transfer was confirmed or validated', async () => {
    const { container } = await renderPage();
    const text = (container.textContent ?? '').toLowerCase();

    expect(text).not.toContain('transferencia verificada');
    expect(text).not.toContain('pago confirmado');
    expect(text).not.toContain('validamos');
  });
});

describe('what the page never renders', () => {
  /**
   * The queue projection carries no contact details, so they cannot appear by
   * accident — this asserts the property from the render side too.
   */
  it('shows the client name and nothing else about them', async () => {
    const { container } = await renderPage();

    expect(container.textContent).not.toContain('@');
    expect(container.textContent).not.toMatch(/\+?54\d{6,}/);
  });
});
