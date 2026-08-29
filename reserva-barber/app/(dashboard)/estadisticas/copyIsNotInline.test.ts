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
const SOURCES = [
  './page.tsx',
  './RangeNav.tsx',
  './loading.tsx',
  // D7's two components. `RankingChart` takes its headings as props so both
  // rankings can share it, which means the scan's real target there is that it
  // never grows a sentence of its own; `HourlyChart` reaches `COPY` directly.
  './RankingChart.tsx',
  './HourlyChart.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'));

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
  // D7
  COPY.statistics.servicesChartHeading,
  COPY.statistics.servicesChartHelp,
  COPY.statistics.servicesChartTableCaption,
  COPY.statistics.servicesChartNameColumn,
  COPY.statistics.barbersChartHeading,
  COPY.statistics.barbersChartHelp,
  COPY.statistics.barbersChartTableCaption,
  COPY.statistics.barbersChartNameColumn,
  COPY.statistics.rankingCountColumn,
  COPY.statistics.rankingShareColumn,
  COPY.statistics.rankingOthers,
  COPY.statistics.hoursChartHeading,
  COPY.statistics.hoursChartHelp,
  COPY.statistics.hoursChartHelpSingleDay,
  COPY.statistics.hoursChartTableCaption,
  COPY.statistics.hoursChartHourColumn,
  COPY.statistics.hoursChartCountColumn,
  COPY.statistics.breakdownsFailed,
  COPY.statistics.breakdownsFailedHelp,
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

// ---------------------------------------------------------------------------
// D6 — the composed sentences, spelled out
// ---------------------------------------------------------------------------

describe('the chart copy composes real Spanish', () => {
  /**
   * **Every expectation here is a literal.** D5's runtime pass found four wrong
   * sentences that a test had passed, because the test built its expectation the
   * same way the code did — both sides equally wrong, compared against each
   * other. The only version of this test that can fail for the right reason is
   * one that writes the sentence out.
   */
  it('should_name_the_income_chart_with_the_period_as_an_adverbial_phrase', () => {
    expect(COPY.statistics.incomeChartLabel(COPY.statistics.rangesInPhrase.hoy)).toBe(
      'Gráfico de barras: señas cobradas por los turnos que hubo hoy.'
    );
    expect(COPY.statistics.incomeChartLabel(COPY.statistics.rangesInPhrase['mes-anterior'])).toBe(
      'Gráfico de barras: señas cobradas por los turnos que hubo el mes pasado.'
    );
    expect(COPY.statistics.incomeChartLabel(COPY.statistics.rangesInPhrase.semana)).toBe(
      'Gráfico de barras: señas cobradas por los turnos que hubo esta semana.'
    );
  });

  it('should_read_correctly_for_all_six_periods', () => {
    // The four the composition got wrong last time are `hoy`, `ayer`,
    // `semana-anterior` and `mes-anterior`. None may produce a bare "en".
    for (const phrase of Object.values(COPY.statistics.rangesInPhrase)) {
      const sentence = COPY.statistics.incomeChartLabel(phrase);
      expect(sentence).not.toMatch(/\ben (hoy|ayer|semana|mes)\b/);
      expect(sentence.endsWith('.')).toBe(true);
    }
  });

  it('should_pluralize_the_payment_count', () => {
    expect(COPY.statistics.methodPaymentCount(1)).toBe('1 pago');
    expect(COPY.statistics.methodPaymentCount(2)).toBe('2 pagos');
    expect(COPY.statistics.methodPaymentCount(0)).toBe('0 pagos');
  });

  it('should_state_the_single_method_case_as_a_sentence', () => {
    expect(
      COPY.statistics.methodsChartSingle(
        COPY.statistics.methods.BANK_TRANSFER,
        '$ 12.000,00',
        COPY.statistics.methodPaymentCount(3)
      )
    ).toBe('Todas las señas del período entraron por Transferencia: $ 12.000,00 en 3 pagos.');
  });

  it('should_say_in_the_cash_figure_that_it_will_not_match_the_other_one', () => {
    // T83's entire mitigation is this sentence. An owner who discovers the
    // disagreement on their own concludes one of the two figures is broken.
    expect(COPY.statistics.cashCollectedHelp).toContain('Señas cobradas');
    expect(COPY.statistics.cashCollectedHelp).toMatch(/aprobadas durante el período/);
    expect(COPY.statistics.cashCollectedHelp).toMatch(/no coincidir/);
  });

  it('should_never_claim_the_charts_show_turnover', () => {
    // This product records deposits and never the balance paid in the chair.
    for (const text of [
      COPY.statistics.incomeChartHelp,
      COPY.statistics.incomeChartHelpHourly,
    ]) {
      expect(text).toContain('No incluye lo que se paga en el local');
    }
  });

  it('should_tell_the_owner_the_figures_survived_a_chart_failure', () => {
    // Zero and failure never render alike, and a partial failure has to say
    // which half is still true or the owner distrusts both.
    expect(COPY.statistics.chartsFailedHelp).toMatch(/números de arriba sí están actualizados/);
  });
});
