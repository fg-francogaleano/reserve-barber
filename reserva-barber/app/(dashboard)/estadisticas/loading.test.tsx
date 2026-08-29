import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import Loading from './loading';

/**
 * The skeleton has the same shape as the page it stands in for.
 *
 * **What this can prove and what it cannot.** It cannot measure a layout shift —
 * that needs a browser, a real viewport and two paints, and D7 measured it
 * there. What it can pin is the thing that actually rots: a story adding a
 * section to the page and forgetting the skeleton, so the page grows by several
 * hundred pixels the moment the real markup streams in. On a control whose whole
 * purpose is switching periods, that means the content jumps under the cursor on
 * every selection.
 *
 * So it counts blocks rather than pixels, and it is deliberately coarse. A
 * skeleton whose proportions are wrong still passes; a skeleton that is missing
 * a whole section does not.
 *
 * It was written by D7's second adversarial pass, which found that
 * `business-statistics` requires *"The layout does not jump when the charts
 * arrive"* and that nothing in the suite had ever checked any part of it.
 */
describe('the statistics loading state', () => {
  it('should_render_the_real_range_control_rather_than_a_placeholder', () => {
    // The six links must not vanish and return on every period the owner tries;
    // `RangeNav` explains why this segment has no `layout.tsx`.
    render(<Loading />);

    expect(screen.getByRole('navigation', { name: COPY.statistics.rangeLabel })).toBeInTheDocument();
    for (const label of Object.values(COPY.statistics.ranges)) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('should_carry_the_page_heading_so_it_does_not_appear_late', () => {
    render(<Loading />);

    expect(screen.getByText(COPY.statistics.heading)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.intro)).toBeInTheDocument();
  });

  it('should_shape_a_block_for_every_figure_and_every_drawn_section', () => {
    const { container } = render(<Loading />);
    const pulsing = container.querySelectorAll('.animate-pulse');

    // Six figure cards, and five drawn sections — D6's two charts and D7's
    // three. Each section contributes a heading block plus its own body, so the
    // count is a lower bound rather than an equation: what it catches is a
    // section added to the page and not to the skeleton.
    expect(container.querySelectorAll('.h-32')).toHaveLength(6);
    expect(pulsing.length).toBeGreaterThanOrEqual(6 + 5 * 2);
  });

  it('should_hold_no_figure_and_no_number', () => {
    // A skeleton that rendered a zero would be making a claim about the
    // business — the rule the whole page is built on.
    const { container } = render(<Loading />);

    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toContain('$');
  });
});
