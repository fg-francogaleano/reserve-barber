import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * `prefetch` is consumed by the router, not reflected in the DOM, so it cannot
 * be asserted from rendered output. Mocking `next/link` is what makes the prop
 * observable — and this is the only test in the flow that can see it at all.
 */
const linkProps: Record<string, unknown>[] = [];
vi.mock('next/link', () => ({
  default: (props: Record<string, unknown>) => {
    linkProps.push(props);
    return (
      <a href={String(props.href)} className={props.className as string}>
        {props.children as React.ReactNode}
      </a>
    );
  },
}));

const { StepLink } = await import('./StepLink');

describe('StepLink', () => {
  it('should_disable_prefetching', () => {
    // Measured on workerd: the router prefetches each Link in the viewport, and
    // on this route that payload is a full catalogue read — so the branch step
    // cost `1 + L` queries before the client touched anything. The whole reason
    // this component exists.
    render(<StepLink href="/b/x/reservar">Ir</StepLink>);

    expect(linkProps.at(-1)?.prefetch).toBe(false);
  });

  it('should_render_a_real_anchor_carrying_its_href_and_classes', () => {
    render(
      <StepLink href="/b/x/reservar?local=y" className="alguna-clase">
        Elegir
      </StepLink>
    );

    const link = screen.getByRole('link', { name: 'Elegir' });
    expect(link).toHaveAttribute('href', '/b/x/reservar?local=y');
    expect(link).toHaveClass('alguna-clase');
  });
});
