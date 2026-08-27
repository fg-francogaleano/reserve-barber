import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import PublicProfileNotFound, { metadata } from './not-found';

/**
 * **This boundary answers for two different failures, and its copy used to be
 * true of only one.**
 *
 * Measured in production before the fix: `/b/{real-slug}/reserva/{unknown}`
 * rendered the identical page to `/b/{invented-slug}` — *"No encontramos esta
 * barbería"* — telling a client the shop did not exist, and then advising them
 * to ask that shop for an updated link.
 *
 * N1 is what made it worth fixing: the booking link now lives in inboxes, gets
 * forwarded, and gets truncated by mail clients.
 *
 * Route-specific wording would be better and is not available — nested
 * `not-found` boundaries do not resolve in this app (T75) — so the subject is
 * the link, which is the one thing both failures share.
 */
describe('the public not-found page', () => {
  it('names the link rather than asserting the barbershop is missing', () => {
    render(<PublicProfileNotFound />);

    expect(screen.getByText(COPY.publicProfile.notFoundHeading)).toBeInTheDocument();
  });

  it('never tells a client the shop does not exist', () => {
    // The defect: this page also answers for a booking link whose shop is
    // perfectly real, so it must not make a claim about the shop at all.
    const { container } = render(<PublicProfileNotFound />);

    expect(container.textContent).not.toMatch(/no encontramos esta barber/i);
    expect(container.textContent).not.toMatch(/barbería no existe/i);
  });

  it('is true of a mistyped slug and of an unknown booking token alike', () => {
    const { container } = render(<PublicProfileNotFound />);
    const text = container.textContent ?? '';

    expect(text).toMatch(/link/i);
    // Nothing that presumes which of the two the visitor hit.
    expect(text).not.toMatch(/\bturno\b|\breserva\b|\bperfil\b/i);
  });

  /**
   * Two rules inherited unchanged: the system cannot tell a slug that never
   * existed from one the owner changed (T33), and a booking token that never
   * existed must be indistinguishable from one whose booking is gone, or this
   * page becomes an oracle for which bookings exist (B4).
   */
  it('discloses no cause', () => {
    const { container } = render(<PublicProfileNotFound />);
    const text = container.textContent ?? '';

    expect(text).toMatch(/puede estar/i);
    expect(text).not.toMatch(/no existe|nunca existió|fue eliminad/i);
  });

  /**
   * A link to `/` is the dashboard, which deposits a lost client on a login
   * screen and discloses that an administrative panel exists behind this
   * namespace. The one action offered is the one that works.
   */
  it('offers no way onward and no route into the dashboard', () => {
    const { container } = render(<PublicProfileNotFound />);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toMatch(/escribile a la barbería/i);
  });

  /**
   * Twice as important since N1: a URL that reaches this page may carry a
   * cancellation token, and a slug change (T33) would otherwise put this page
   * into search results under a shop's own name.
   */
  it('is never indexed', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('echoes nothing from the URL that reached it', () => {
    const { container } = render(<PublicProfileNotFound />);

    expect(container.textContent).not.toMatch(/@|token|\/reserva\//i);
  });
});
