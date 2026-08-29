import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The dashboard navigation, reviewed as text.
 *
 * **The first test this project has ever had over the nav**, and it exists
 * because the nav has already been wrong once: its own comment records that it
 * linked to seven pages and to none of them was the dashboard's own home, so
 * the owner's landing page was unreachable from itself the moment they
 * navigated away.
 *
 * Rendering the layout would mean standing up a session, a Server Action and a
 * whole route group for a component whose entire content is a list of links —
 * so it is reviewed the way the composition roots are, which is the technique
 * this project already uses for things the suite cannot otherwise reach.
 *
 * What this asserts is the property that failed before: **every page an owner
 * can reach is reachable from here.** A new dashboard route that forgets its
 * entry should turn this red.
 */
function navSource(): string {
  return readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
}

/** Every dashboard page an owner is expected to be able to navigate to. */
const REACHABLE_PAGES = [
  '/',
  '/sucursales',
  '/barberos',
  '/servicios',
  '/clientes',
  '/estadisticas',
  '/perfil',
  '/transferencia',
  '/mercado-pago',
  '/sena',
  '/comprobantes',
] as const;

describe('dashboard layout - every page is reachable from the navigation', () => {
  it.each(REACHABLE_PAGES)('should_link_to_%s', (href) => {
    expect(navSource()).toContain(`href="${href}"`);
  });

  it('should_reach_the_statistics_page_through_the_copy_module', () => {
    const source = navSource();

    expect(source).toMatch(/href="\/estadisticas"/);
    expect(source).toMatch(/COPY\.statistics\.nav/);
  });

  it('should_reach_the_clients_directory_through_the_copy_module', () => {
    // Spanish strings live in the dictionary, never inline in a component.
    const source = navSource();

    expect(source).toMatch(/href="\/clientes"/);
    expect(source).toMatch(/COPY\.clients\.nav/);
  });
});
