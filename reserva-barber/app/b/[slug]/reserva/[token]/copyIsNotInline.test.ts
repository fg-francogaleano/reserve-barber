import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COPY } from '@/lib/copy';

/**
 * Every user-facing string C1 introduces lives in the copy module (C1).
 *
 * The rule is `base-standards.md` §2: the codebase is English and the product
 * speaks Spanish, which only stays true while the Spanish is isolated. A test
 * rather than a convention, because an inline string compiles, renders and
 * passes every behavioural test in this directory — the assertions there all
 * reference `COPY`, so a component that inlined the same words would satisfy
 * them exactly as well.
 */
const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

/** The keys this story added to the public booking page. */
const C1_KEYS = [
  'cancelBookingCta',
  'cancelConfirmHeading',
  'cancelConfirmSlot',
  'cancelConfirmFinal',
  'cancelConfirmDeposit',
  'cancelConfirmOpenPayment',
  'cancelConfirmSubmit',
  'cancelConfirmBack',
  'cancelRefusedStarted',
  'cancelRefusedMoved',
  'receiptUnderReviewCancelHelp',
  'bookingCancelledByClient',
  'bookingCancelledByClientHelp',
] as const;

const C1_COPY = C1_KEYS.map((key) => COPY.booking[key] as string);

describe('the booking page holds no inline Spanish from C1', () => {
  it.each(C1_COPY)('should_not_write_%s_into_the_component', (text) => {
    expect(PAGE).not.toContain(text);
  });

  it('should_reach_every_one_of_them_through_the_copy_module', () => {
    // The other half: absent from the component *and* present through `COPY`,
    // so the first assertion cannot be satisfied by a string nothing renders.
    for (const key of C1_KEYS) {
      expect(PAGE).toContain(`COPY.booking.${key}`);
    }
  });

  it('should_be_real_sentences_rather_than_placeholders', () => {
    // The opposite drift: a key present in `COPY` and rendered by the page can
    // still be a stub. A language heuristic was tried here first and dropped —
    // it could only pass by listing words these particular strings happened to
    // contain, which is a test of the test.
    for (const text of C1_COPY) {
      expect(text.trim().length).toBeGreaterThan(5);
      expect(text).not.toMatch(/^[a-z][a-zA-Z]*$/);
      expect(text).not.toContain('TODO');
    }
  });
});
