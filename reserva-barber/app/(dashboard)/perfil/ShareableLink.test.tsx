import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareableLink } from './ShareableLink';
import { COPY } from '@/lib/copy';

const LINK = 'https://reservas.barberia.com.ar/b/barberia-don-juan';

/**
 * MUST be called AFTER `userEvent.setup()`. `setup()` installs a clipboard stub
 * of its own, so stubbing first is silently overwritten and the component ends
 * up talking to user-event's clipboard instead of the test's.
 */
function stubClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

function removeClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('ShareableLink - the link itself', () => {
  it('renders the link as selectable text', () => {
    removeClipboard();
    render(<ShareableLink url={LINK} />);

    // Not only behind a button: the clipboard API needs a secure context and can
    // refuse permission, and a link that cannot be selected by hand would then
    // be unreachable.
    const text = screen.getByText(LINK);
    expect(text.className).toContain('select-all');
  });

  it('discloses that the link does not resolve yet', () => {
    render(<ShareableLink url={LINK} />);

    expect(screen.getByText(COPY.businessProfile.linkNotPublishedYet)).toBeInTheDocument();
  });
});

describe('ShareableLink - copying', () => {
  it('copies the link and confirms it visibly', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<ShareableLink url={LINK} />);
    await user.click(screen.getByRole('button', { name: COPY.businessProfile.linkCopy }));

    expect(writeText).toHaveBeenCalledWith(LINK);
    // A copy button with no feedback is indistinguishable from a broken one.
    expect(await screen.findByText(COPY.businessProfile.linkCopied)).toBeInTheDocument();
  });

  it('reports a refused clipboard instead of failing silently', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));

    render(<ShareableLink url={LINK} />);
    await user.click(screen.getByRole('button', { name: COPY.businessProfile.linkCopy }));

    expect(await screen.findByText(COPY.businessProfile.linkCopyFailed)).toBeInTheDocument();
  });

  it('hides the copy control when there is no clipboard at all', () => {
    removeClipboard();

    render(<ShareableLink url={LINK} />);

    // Outside a secure context the API is absent. Offering a button that cannot
    // work is worse than offering none, since the text is selectable anyway.
    expect(screen.queryByRole('button', { name: COPY.businessProfile.linkCopy })).toBeNull();
  });

  it('announces the outcome to assistive technology', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockResolvedValue(undefined));

    render(<ShareableLink url={LINK} />);
    await user.click(screen.getByRole('button', { name: COPY.businessProfile.linkCopy }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(COPY.businessProfile.linkCopied);
  });
});
