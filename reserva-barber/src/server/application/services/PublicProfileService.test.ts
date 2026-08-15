import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicProfileService } from './PublicProfileService';
import type { PublicBusinessProfile } from '@/server/domain/models/BusinessProfile';
import type { IBusinessProfileRepository } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { SocialLink } from '@/server/domain/models/BusinessProfile';

const PROFILE: PublicBusinessProfile = {
  businessName: 'Barbería Don Juan',
  bio: 'Cortes clásicos desde 1998.',
  photoUrl: 'https://storage.example/photo.webp',
  coverUrl: 'https://storage.example/cover.webp',
  publicSlug: 'barberia-don-juan',
  socialLinks: [new SocialLink('INSTAGRAM', 'https://instagram.com/a', 0)],
};

function createLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createService(findByPublicSlug: ReturnType<typeof vi.fn>) {
  const logger = createLogger();
  const profiles = {
    findByOwner: vi.fn(),
    save: vi.fn(),
    findByPublicSlug,
  } as unknown as IBusinessProfileRepository;

  return { service: new PublicProfileService(profiles, logger), logger, findByPublicSlug };
}

beforeEach(() => vi.clearAllMocks());

describe('PublicProfileService - resolving a live slug', () => {
  it('should_render_the_profile_when_the_slug_is_already_canonical', async () => {
    const { service } = createService(vi.fn().mockResolvedValue(PROFILE));

    await expect(service.resolveBySlug('barberia-don-juan')).resolves.toEqual({
      type: 'render',
      profile: PROFILE,
    });
  });

  it('should_query_with_the_canonical_slug_only', async () => {
    const { service, findByPublicSlug } = createService(vi.fn().mockResolvedValue(PROFILE));

    await service.resolveBySlug('BARBERIA-DON-JUAN');

    expect(findByPublicSlug).toHaveBeenCalledExactlyOnceWith('barberia-don-juan');
  });

  it('should_redirect_a_non_canonical_spelling_to_the_canonical_slug', async () => {
    const { service } = createService(vi.fn().mockResolvedValue(PROFILE));

    await expect(service.resolveBySlug('Barbería-Don-Juan')).resolves.toEqual({
      type: 'redirect',
      canonicalSlug: 'barberia-don-juan',
    });
  });

  it('should_return_a_slug_rather_than_a_url_so_routing_stays_with_the_route', async () => {
    const { service } = createService(vi.fn().mockResolvedValue(PROFILE));

    const resolution = await service.resolveBySlug('BARBERIA-DON-JUAN');

    expect(resolution).not.toHaveProperty('to');
    expect(JSON.stringify(resolution)).not.toContain('/b/');
  });
});

describe('PublicProfileService - a slug that does not resolve', () => {
  it('should_report_not_found_when_no_profile_holds_the_slug', async () => {
    const { service } = createService(vi.fn().mockResolvedValue(null));

    await expect(service.resolveBySlug('ya-no-existe')).resolves.toEqual({ type: 'notFound' });
  });

  it('should_log_the_miss_at_info_with_the_requested_value', async () => {
    // The only inventory that will exist of links stranded by a slug change
    // (T33), and the only way to tell that apart from slug enumeration.
    const { service, logger } = createService(vi.fn().mockResolvedValue(null));

    await service.resolveBySlug('ya-no-existe');

    expect(logger.info).toHaveBeenCalledExactlyOnceWith(
      'Public profile slug did not resolve',
      expect.objectContaining({ requestedSlug: 'ya-no-existe' })
    );
  });

  it('should_truncate_a_long_requested_value_before_logging_it', async () => {
    // Long enough to be refused outright (over the raw ceiling), so this
    // exercises the rejection path's logging.
    const { service, logger } = createService(vi.fn().mockResolvedValue(null));

    await service.resolveBySlug('a'.repeat(600));

    const context = vi.mocked(logger.debug).mock.calls[0]![1] as { requestedSlug: string };
    expect(context.requestedSlug.length).toBeLessThanOrEqual(60);
  });

  it('should_truncate_a_long_requested_value_on_the_miss_path_too', async () => {
    // A 200-character parameter is now accepted for lookup — it is under the
    // raw ceiling — so it reaches the miss path, and that log needs the same
    // truncation.
    const { service, logger } = createService(vi.fn().mockResolvedValue(null));

    await service.resolveBySlug('a'.repeat(200));

    const context = vi.mocked(logger.info).mock.calls[0]![1] as { requestedSlug: string };
    expect(context.requestedSlug.length).toBeLessThanOrEqual(60);
  });

  it('should_strip_control_characters_before_logging_the_requested_value', async () => {
    // A newline in a structured log line is how one entry becomes two. This
    // value normalizes to a well-formed slug, so it reaches the miss path and
    // the raw request is what gets recorded.
    const { service, logger } = createService(vi.fn().mockResolvedValue(null));

    await service.resolveBySlug('mala\n{"level":"error"}');

    const context = vi.mocked(logger.info).mock.calls[0]![1] as { requestedSlug: string };
    expect(context.requestedSlug).not.toContain('\n');
    expect(context.requestedSlug).toBe('mala{"level":"error"}');
  });
});

describe('PublicProfileService - values that never reach the database', () => {
  it.each([
    ['an overlong parameter', 'a'.repeat(5000)],
    ['a traversal attempt', '../login'],
    ['a path separator', 'barberia/don-juan'],
    ['an empty parameter', ''],
    ['a value that normalizes to nothing', '!!!'],
  ])('should_report_not_found_for_%s_without_querying', async (_label, raw) => {
    const findByPublicSlug = vi.fn();
    const { service } = createService(findByPublicSlug);

    await expect(service.resolveBySlug(raw)).resolves.toEqual({ type: 'notFound' });
    expect(findByPublicSlug).not.toHaveBeenCalled();
  });

  it('should_not_log_a_rejected_parameter_at_info', async () => {
    // Malformed input is noise; logging it at the same level as a real miss
    // would bury the T33 signal the info level exists to carry.
    const { service, logger } = createService(vi.fn());

    await service.resolveBySlug('../login');

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledOnce();
  });
});
