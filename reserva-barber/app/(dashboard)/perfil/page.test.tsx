import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import { BusinessProfile } from '@/server/domain/models/BusinessProfile';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const findProfile = vi.fn(async (): Promise<BusinessProfile | null> => null);
const headerValues = new Map<string, string>();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => headerValues.get(name) ?? null }),
}));
vi.mock('./profileService', () => ({
  profileService: async () => ({ findProfile, saveProfile: vi.fn() }),
}));

const { default: ProfilePage } = await import('./page');

function profile(slug = 'barberia-don-juan'): BusinessProfile {
  return new BusinessProfile('p1', 'Barbería Don Juan', null, null, null, slug, []);
}

beforeEach(() => {
  vi.clearAllMocks();
  headerValues.clear();
  headerValues.set('host', 'reservas.barberia.com.ar');
  delete process.env.APP_ORIGIN;
});

describe('ProfilePage - authentication', () => {
  it('should_resolve_the_owner_before_reading_anything', async () => {
    requireOwner.mockRejectedValueOnce(new Error('redirect to login'));

    await expect(ProfilePage()).rejects.toThrow('redirect to login');
    expect(findProfile).not.toHaveBeenCalled();
  });

  it('should_scope_the_read_to_the_session_owner', async () => {
    render(await ProfilePage());

    expect(findProfile).toHaveBeenCalledWith('owner-root');
  });
});

describe('ProfilePage - before a profile exists', () => {
  it('should_render_without_treating_the_absence_as_an_error', async () => {
    render(await ProfilePage());

    // No profile is the ordinary first-run state, not a failure.
    expect(screen.getByText(COPY.businessProfile.heading)).toBeInTheDocument();
  });

  it('should_say_the_link_arrives_after_saving', async () => {
    render(await ProfilePage());

    expect(screen.getByText(COPY.businessProfile.linkBeforeSave)).toBeInTheDocument();
  });
});

describe('ProfilePage - the shareable link', () => {
  it('should_compose_the_link_from_the_request_host', async () => {
    findProfile.mockResolvedValueOnce(profile());

    render(await ProfilePage());

    expect(
      screen.getByText('https://reservas.barberia.com.ar/b/barberia-don-juan')
    ).toBeInTheDocument();
  });

  it('should_prefer_a_configured_origin_over_the_request_host', async () => {
    process.env.APP_ORIGIN = 'https://mibarberia.com';
    findProfile.mockResolvedValueOnce(profile());

    render(await ProfilePage());

    expect(screen.getByText('https://mibarberia.com/b/barberia-don-juan')).toBeInTheDocument();
  });

  it('should_use_http_for_localhost_so_the_copied_link_opens_in_development', async () => {
    headerValues.set('host', 'localhost:3000');
    findProfile.mockResolvedValueOnce(profile());

    render(await ProfilePage());

    expect(screen.getByText('http://localhost:3000/b/barberia-don-juan')).toBeInTheDocument();
  });

  it('should_disclose_that_the_link_does_not_resolve_yet', async () => {
    findProfile.mockResolvedValueOnce(profile());

    render(await ProfilePage());

    // The owner's first instinct is to share it. Without this they send their
    // clients to a login screen.
    expect(screen.getByText(COPY.businessProfile.linkNotPublishedYet)).toBeInTheDocument();
  });

  it('should_render_the_link_as_selectable_text_not_only_behind_a_button', async () => {
    findProfile.mockResolvedValueOnce(profile());

    render(await ProfilePage());

    // The clipboard API needs a secure context and can refuse permission; a
    // link that can only be copied by button would then be unreachable.
    const link = screen.getByText('https://reservas.barberia.com.ar/b/barberia-don-juan');
    expect(link.className).toContain('select-all');
  });

  it('should_fall_back_to_the_pre_save_message_when_no_origin_can_be_resolved', async () => {
    headerValues.clear();
    findProfile.mockResolvedValueOnce(profile());

    render(await ProfilePage());

    // Better than a confident URL pointing at the wrong host.
    expect(screen.getByText(COPY.businessProfile.linkBeforeSave)).toBeInTheDocument();
  });
});
