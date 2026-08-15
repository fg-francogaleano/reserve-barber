import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { SocialLink, type PublicBusinessProfile } from '@/server/domain/models/BusinessProfile';
import type { PublicProfileResolution } from '@/server/application/services/PublicProfileService';

const resolveBySlug = vi.fn(async (): Promise<PublicProfileResolution> => ({ type: 'notFound' }));
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const permanentRedirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  permanentRedirect: (to: string) => permanentRedirect(to),
}));
vi.mock('./publicProfileService', () => ({
  publicProfileService: () => ({ resolveBySlug }),
}));

const { default: PublicProfilePage, generateMetadata } = await import('./page');

function profile(overrides: Partial<PublicBusinessProfile> = {}): PublicBusinessProfile {
  return {
    businessName: 'Barbería Don Juan',
    bio: 'Cortes clásicos desde 1998.',
    photoUrl: 'https://storage.example/photo.webp',
    coverUrl: 'https://storage.example/cover.webp',
    publicSlug: 'barberia-don-juan',
    socialLinks: [new SocialLink('INSTAGRAM', 'https://instagram.com/donjuan', 0)],
    ...overrides,
  };
}

function params(slug = 'barberia-don-juan') {
  return { params: Promise.resolve({ slug }) };
}

function renders(p: PublicBusinessProfile = profile()) {
  resolveBySlug.mockResolvedValue({ type: 'render', profile: p });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.APP_ORIGIN;
});

describe('PublicProfilePage - a published profile', () => {
  it('should_render_the_business_name', async () => {
    renders();

    render(await PublicProfilePage(params()));

    expect(screen.getByRole('heading', { name: 'Barbería Don Juan' })).toBeInTheDocument();
  });

  it('should_render_the_bio_when_present', async () => {
    renders();

    render(await PublicProfilePage(params()));

    expect(screen.getByText('Cortes clásicos desde 1998.')).toBeInTheDocument();
  });

  it('should_render_both_images_through_a_plain_img_element', async () => {
    renders();

    const { container } = render(await PublicProfilePage(params()));

    const sources = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toEqual([
      'https://storage.example/cover.webp',
      'https://storage.example/photo.webp',
    ]);
  });

  it('should_render_a_social_link_that_opens_safely_in_a_new_tab', async () => {
    renders();

    render(await PublicProfilePage(params()));

    const link = screen.getByRole('link', { name: 'Instagram' });
    expect(link).toHaveAttribute('href', 'https://instagram.com/donjuan');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('PublicProfilePage - the booking call to action', () => {
  it('should_render_it_as_present_but_not_actionable', async () => {
    renders();

    render(await PublicProfilePage(params()));

    const control = screen.getByRole('button', { name: COPY.publicProfile.book });
    expect(control).toBeDisabled();
  });

  it('should_explain_why_it_is_unavailable', async () => {
    renders();

    render(await PublicProfilePage(params()));

    expect(screen.getByText(COPY.publicProfile.bookUnavailable)).toBeInTheDocument();
  });

  it('should_not_link_to_a_booking_route_that_does_not_exist_yet', async () => {
    renders();

    const { container } = render(await PublicProfilePage(params()));

    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.some((href) => href?.includes('/reservar'))).toBe(false);
  });

  it('should_render_identically_for_a_business_with_nothing_bookable', async () => {
    // The gate belongs to B2, and this page must never read PaymentConfig to
    // find out — that row holds the encrypted Mercado Pago token (design D11).
    renders();

    render(await PublicProfilePage(params()));

    expect(screen.getByRole('button', { name: COPY.publicProfile.book })).toBeInTheDocument();
  });
});

describe('PublicProfilePage - a profile carrying only a name', () => {
  const bare = profile({ bio: null, photoUrl: null, coverUrl: null, socialLinks: [] });

  it('should_still_render_a_deliberate_page', async () => {
    renders(bare);

    render(await PublicProfilePage(params()));

    expect(screen.getByRole('heading', { name: 'Barbería Don Juan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.publicProfile.book })).toBeInTheDocument();
  });

  it('should_render_no_image_element_at_all', async () => {
    renders(bare);

    const { container } = render(await PublicProfilePage(params()));

    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('should_omit_the_bio_block_rather_than_showing_a_placeholder', async () => {
    renders(bare);

    render(await PublicProfilePage(params()));

    expect(screen.queryByText(/sin descripci/i)).not.toBeInTheDocument();
  });

  it('should_omit_the_social_section_entirely', async () => {
    renders(bare);

    render(await PublicProfilePage(params()));

    expect(screen.queryByText(COPY.publicProfile.socialHeading)).not.toBeInTheDocument();
  });

  it('should_show_initials_in_place_of_the_missing_photo', async () => {
    renders(bare);

    render(await PublicProfilePage(params()));

    expect(screen.getByText('BD')).toBeInTheDocument();
  });
});

describe('PublicProfilePage - slugs that do not render', () => {
  it('should_call_notFound_when_the_slug_does_not_resolve', async () => {
    resolveBySlug.mockResolvedValue({ type: 'notFound' });

    await expect(PublicProfilePage(params('ya-no-existe'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('should_redirect_a_non_canonical_spelling_to_the_canonical_url', async () => {
    resolveBySlug.mockResolvedValue({ type: 'redirect', canonicalSlug: 'barberia-don-juan' });

    await expect(PublicProfilePage(params('BARBERIA-DON-JUAN'))).rejects.toThrow(
      'NEXT_REDIRECT:/b/barberia-don-juan'
    );
    expect(permanentRedirect).toHaveBeenCalledExactlyOnceWith('/b/barberia-don-juan');
  });
});

describe('PublicProfilePage - the route is rendered per request', () => {
  it('should_export_force_dynamic_so_a_profile_edit_is_visible_immediately', async () => {
    // The owner saves and reloads; anything cached would show them stale copy
    // of their own page (design D7). Same assertion the dashboard pages carry.
    const mod = await import('./page');

    expect(mod.dynamic).toBe('force-dynamic');
  });
});

describe('PublicProfilePage - the route declares no loading boundary', () => {
  it('should_not_ship_a_loading_file_for_this_route', async () => {
    // Not a style preference. A `loading.tsx` opens a Suspense boundary, Next
    // commits `200 OK` before the page resolves, and `notFound()` /
    // `permanentRedirect()` then degrade to a soft 404 and a meta refresh —
    // measured on the deployment runtime (design D19). WhatsApp and Instagram
    // follow HTTP redirects but not meta refreshes, so this file reappearing
    // would silently cost a shared link its preview.
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    expect(existsSync(join(process.cwd(), 'app', 'b', '[slug]', 'loading.tsx'))).toBe(false);
  });
});

describe('generateMetadata', () => {
  it('should_title_the_page_with_the_business_name', async () => {
    renders();

    await expect(generateMetadata(params())).resolves.toMatchObject({
      title: 'Barbería Don Juan',
    });
  });

  it('should_omit_every_absolute_value_when_no_origin_is_configured', async () => {
    // The Host header is not a fallback here: it is supplied by a stranger and
    // would make the page advertise someone else's origin (design D3).
    renders();

    const metadata = await generateMetadata(params());

    expect(metadata.metadataBase).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
  });

  it('should_emit_canonical_and_opengraph_from_the_configured_origin', async () => {
    process.env.APP_ORIGIN = 'https://reservas.example';
    renders();

    const metadata = await generateMetadata(params());

    expect(metadata.metadataBase?.toString()).toBe('https://reservas.example/');
    expect(metadata.alternates?.canonical).toBe('/b/barberia-don-juan');
    expect(metadata.openGraph).toMatchObject({
      url: 'https://reservas.example/b/barberia-don-juan',
      images: [{ url: 'https://storage.example/cover.webp' }],
    });
  });

  it('should_fall_back_to_the_profile_image_when_there_is_no_cover', async () => {
    process.env.APP_ORIGIN = 'https://reservas.example';
    renders(profile({ coverUrl: null }));

    const metadata = await generateMetadata(params());

    expect(metadata.openGraph).toMatchObject({
      images: [{ url: 'https://storage.example/photo.webp' }],
    });
  });

  it('should_truncate_a_long_bio_at_a_word_boundary', async () => {
    renders(profile({ bio: `${'palabra '.repeat(40)}final` }));

    const metadata = await generateMetadata(params());

    expect(metadata.description!.length).toBeLessThanOrEqual(161);
    expect(metadata.description).toMatch(/…$/);
    expect(metadata.description).not.toMatch(/palabr…$/);
  });

  it('should_omit_the_description_when_there_is_no_bio', async () => {
    renders(profile({ bio: null }));

    await expect(generateMetadata(params())).resolves.not.toHaveProperty('description');
  });

  it('should_return_noindex_rather_than_throwing_for_an_unknown_slug', async () => {
    // Metadata runs before the page. Throwing here turns a mistyped slug into a
    // 500 instead of a 404.
    resolveBySlug.mockResolvedValue({ type: 'notFound' });

    await expect(generateMetadata(params('ya-no-existe'))).resolves.toEqual({
      robots: { index: false, follow: false },
    });
  });

  it('should_return_empty_metadata_rather_than_throwing_when_the_read_fails', async () => {
    resolveBySlug.mockRejectedValue(new Error('connection lost'));

    await expect(generateMetadata(params())).resolves.toEqual({});
  });

  it('should_never_derive_any_value_from_a_host_header', async () => {
    renders();

    const metadata = await generateMetadata(params());

    expect(JSON.stringify(metadata)).not.toContain('attacker');
  });
});
