import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COPY } from '@/lib/copy';
import { STATISTICS_RANGES } from '@/server/domain/models/statistics';
import { RangeNav } from './RangeNav';
import Loading from './loading';

/**
 * This file runs in the jsdom project, where `import.meta.url` is not a `file:`
 * URL — so the source-reading assertions below resolve from the repository root
 * rather than from the module. The `.ts` source tests in this directory run in
 * the node project and use `import.meta.url` as usual.
 */
const SEGMENT = join(process.cwd(), 'app', '(dashboard)', 'estadisticas');

/**
 * The period control, and the decision it embodies.
 *
 * **This file exists because the adversarial pass found the control had no test
 * at all** — the one piece design D9 was rewritten around, verified only by
 * looking at it once. A `layout.tsx` "simplification" would have restored the
 * exact defect D9 rejected, and nothing would have gone red.
 *
 * What is pinned here is therefore not only the markup but the *arrangement*:
 * the same component rendered by the page and by the loading state, and no
 * layout in this segment.
 */

describe('RangeNav - the control itself', () => {
  it('should_offer_every_period_the_product_defines', () => {
    render(<RangeNav current="hoy" />);

    for (const range of STATISTICS_RANGES) {
      expect(
        screen.getByRole('link', { name: COPY.statistics.ranges[range] })
      ).toBeInTheDocument();
    }
  });

  it('should_carry_an_accessible_name', () => {
    // A row of links with no name is a list of destinations, not a control.
    render(<RangeNav current="hoy" />);

    expect(screen.getByRole('navigation', { name: COPY.statistics.rangeLabel })).toBeInTheDocument();
  });

  it('should_mark_only_the_selected_period_as_current', () => {
    render(<RangeNav current="semana" />);

    const marked = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));

    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent(COPY.statistics.ranges.semana);
  });

  it('should_never_write_aria_current_false_on_an_unselected_link', () => {
    // `aria-current="false"` is a valid value that screen readers announce, so
    // an unselected link must carry no attribute rather than a falsy one.
    render(<RangeNav current="mes" />);

    for (const link of screen.getAllByRole('link')) {
      const value = link.getAttribute('aria-current');
      expect(value === null || value === 'page').toBe(true);
    }
  });

  it('should_leave_the_default_period_unparameterised', () => {
    render(<RangeNav current="hoy" />);

    expect(screen.getByRole('link', { name: COPY.statistics.ranges.hoy })).toHaveAttribute(
      'href',
      '/estadisticas'
    );
  });

  it('should_point_every_other_period_at_its_own_parameter', () => {
    render(<RangeNav current="hoy" />);

    expect(screen.getByRole('link', { name: COPY.statistics.ranges['mes-anterior'] })).toHaveAttribute(
      'href',
      '/estadisticas?rango=mes-anterior'
    );
  });
});

describe('RangeNav - the loading state it was built for', () => {
  it('should_render_the_control_while_the_figures_load', () => {
    // The whole of design D9. Without this the six links vanish and return
    // highlighted differently on every selection — four tenths of a second at a
    // time, on the one page whose purpose is comparing periods.
    render(<Loading />);

    for (const range of STATISTICS_RANGES) {
      expect(
        screen.getByRole('link', { name: COPY.statistics.ranges[range] })
      ).toBeInTheDocument();
    }
  });

  it('should_mark_nothing_as_current_while_loading', () => {
    // A static loading file cannot know which period was selected. Marking one
    // anyway would be a lie about state, which is the one cost D9 refused to
    // pay; showing none is the cost it accepted.
    render(<Loading />);

    const marked = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));

    expect(marked).toHaveLength(0);
  });

  it('should_render_no_control_of_its_own', () => {
    // Both surfaces draw the *same* component. A second copy in `loading.tsx`
    // would drift the moment either changed.
    const loading = readFileSync(join(SEGMENT, 'loading.tsx'), 'utf8');

    expect(loading).toContain('<RangeNav />');
    expect(loading).not.toContain('STATISTICS_RANGES');
  });
});

describe('RangeNav - the arrangement design D9 settled on', () => {
  /**
   * The negative half, and the one that protects the decision.
   *
   * A route-segment `layout.tsx` is the obvious way to keep a control above the
   * suspense boundary, and it is what D9 originally proposed. It cannot work
   * here: a layout receives no `searchParams`, so it could not mark the current
   * period without becoming a Client Component — which would spend this page's
   * no-JavaScript promise on a highlight.
   *
   * If someone adds one, this fails and points them at the reasoning instead of
   * letting them discover it in the browser.
   */
  it('should_have_no_layout_in_this_segment', () => {
    const entries = readdirSync(SEGMENT);

    expect(entries).not.toContain('layout.tsx');
  });

  it('should_state_why_the_layout_is_absent', () => {
    const source = readFileSync(join(SEGMENT, 'RangeNav.tsx'), 'utf8');

    // If the argument goes, this test should go with it; if this test goes, the
    // next reader has nothing to stop them adding the layout.
    expect(source).toMatch(/no `layout\.tsx` for this segment/);
    expect(source).toMatch(/searchParams/);
  });
});

// ---------------------------------------------------------------------------
// D6 — the segment stays a Server Component route
// ---------------------------------------------------------------------------

describe('the statistics segment ships no client component', () => {
  /**
   * **The claim D6 is most likely to have quietly broken.**
   *
   * This page's no-client-JavaScript requirement is tested for the figures and
   * the period control, and D6 extended it to the charts. The way it would be
   * lost is not a deliberate decision — it is one `'use client'` added to make
   * a tooltip work, or a charting library imported for "just this one chart".
   * Both compile, both render, and every behavioural test in this directory
   * keeps passing, because jsdom runs the client bundle happily.
   *
   * So the assertion is over the source of the whole segment rather than over
   * any behaviour, and it is the same shape as the composition root's
   * source-level tests.
   */
  const SOURCE_FILES = readdirSync(SEGMENT).filter(
    (entry) => entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')
  );

  it('should_carry_no_use_client_directive_anywhere_in_the_segment', () => {
    for (const file of SOURCE_FILES) {
      expect(readFileSync(join(SEGMENT, file), 'utf8')).not.toMatch(/['"]use client['"]/);
    }
  });

  it('should_import_no_charting_library', () => {
    // The stack decision named Recharts/Tremor and this page deliberately does
    // not use them (see `chartGeometry.ts`). If one is ever added, the
    // no-JavaScript requirement above becomes false at the same moment.
    for (const file of SOURCE_FILES) {
      const source = readFileSync(join(SEGMENT, file), 'utf8');
      expect(source).not.toMatch(/from\s+['"](recharts|@tremor\/|chart\.js|victory|nivo)/);
    }
  });

  it('should_reach_for_no_browser_api_while_drawing_a_chart', () => {
    // A chart that measures its container cannot render on the server. This is
    // the mechanism that disqualified every client charting library here, and
    // it would disqualify a hand-rolled component just as completely.
    for (const file of [...SOURCE_FILES, 'chartGeometry.ts']) {
      const source = readFileSync(join(SEGMENT, file), 'utf8');
      expect(source).not.toMatch(/\bwindow\.|\bdocument\.|getBoundingClientRect|ResizeObserver/);
      expect(source).not.toMatch(/\buse(State|Effect|Ref|LayoutEffect)\s*\(/);
    }
  });

  it('should_keep_the_chart_geometry_free_of_react', () => {
    // The half of a hand-rolled chart that can be wrong is the arithmetic, and
    // it is only cheap to test while it is pure.
    const source = readFileSync(join(SEGMENT, 'chartGeometry.ts'), 'utf8');

    expect(source).not.toMatch(/from\s+['"]react['"]/);
    expect(source).not.toMatch(/<[A-Za-z]/);
  });
});
