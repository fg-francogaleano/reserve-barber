import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COPY } from '@/lib/copy';

/**
 * Every user-facing string D5 introduces lives in the copy module.
 *
 * The rule is `base-standards.md` §2: the codebase is English and the product
 * speaks Spanish, which only stays true while the Spanish is isolated. A test
 * rather than a convention, because an inline string compiles, renders and
 * passes every behavioural test in this directory — those assertions reference
 * `COPY`, so a component that inlined the same words would satisfy them exactly
 * as well. C1's own copy test made the same argument.
 *
 * It matters more here than usual for one reason the runtime pass discovered:
 * this capability's copy is **composed** rather than fixed — the empty-period
 * sentence takes a period phrase — and composition is where the Spanish went
 * wrong ("No hubo turnos **en hoy**"). A rule that keeps the strings in one
 * place is what makes the next such error a one-file fix.
 */
const SOURCES = ['./page.tsx', './RangeNav.tsx', './loading.tsx'].map((file) =>
  readFileSync(new URL(file, import.meta.url), 'utf8')
);

const ALL = SOURCES.join('\n');

/** Every fixed string this story added, flattened. */
const FIXED_COPY: readonly string[] = [
  COPY.statistics.nav,
  COPY.statistics.heading,
  COPY.statistics.intro,
  COPY.statistics.rangeLabel,
  COPY.statistics.confirmedCount,
  COPY.statistics.confirmedCountHelp,
  COPY.statistics.depositTotal,
  COPY.statistics.depositTotalHelp,
  COPY.statistics.cancelledCount,
  COPY.statistics.cancelledCountHelp,
  COPY.statistics.averageDeposit,
  COPY.statistics.averageDepositHelp,
  COPY.statistics.averageDepositAbsentHelp,
  COPY.statistics.uniqueClients,
  COPY.statistics.uniqueClientsHelp,
  COPY.statistics.emptyPeriodHint,
  COPY.statistics.emptyPeriodLink,
  COPY.statistics.emptyShop,
  COPY.statistics.emptyShopHint,
  COPY.statistics.emptyShopLink,
  COPY.statistics.loadFailed,
  COPY.statistics.loadFailedHelp,
  ...Object.values(COPY.statistics.ranges),
  ...Object.values(COPY.statistics.rangesInPhrase),
];

describe('the statistics surface holds no inline Spanish', () => {
  it.each(FIXED_COPY)('should_not_write_%s_into_a_component', (text) => {
    expect(ALL).not.toContain(text);
  });

  it('should_reach_its_copy_through_the_module', () => {
    // The other half: absent from the components *and* present through `COPY`,
    // so the first assertion cannot be satisfied by a string nothing renders.
    for (const key of [
      'heading',
      'intro',
      'rangeLabel',
      'confirmedCount',
      'depositTotal',
      'cancelledCount',
      'averageDeposit',
      'uniqueClients',
      'emptyPeriod',
      'emptyShop',
      'loadFailed',
      'ranges',
      'rangesInPhrase',
    ]) {
      expect(ALL).toContain(`COPY.statistics.${key}`);
    }
  });

  it('should_compose_the_period_sentence_from_the_phrase_map_not_the_labels', () => {
    // The defect the runtime pass found: `en ${label}` reads correctly for two
    // of the six periods and wrong for four. The labels are for buttons; the
    // phrases are for sentences, and the page must not confuse them.
    const page = SOURCES[0]!;

    expect(page).toContain('COPY.statistics.rangesInPhrase[view.range]');
    expect(page).not.toMatch(/emptyPeriod\(COPY\.statistics\.ranges\[/);
  });

  it('should_be_real_sentences_rather_than_placeholders', () => {
    for (const text of FIXED_COPY) {
      expect(text.trim().length).toBeGreaterThan(2);
      expect(text).not.toContain('TODO');
    }
  });
});
