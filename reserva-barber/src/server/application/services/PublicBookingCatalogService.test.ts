import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicBookingCatalogService } from './PublicBookingCatalogService';
import type { IBusinessProfileRepository } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { IPublicCatalogRepository } from '@/server/domain/repositories/IPublicCatalogRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { buildBookingCatalog } from '@/server/domain/models/BookingCatalog';

const CATALOG = buildBookingCatalog([
  {
    id: 'loc-centro',
    name: 'Centro',
    address: null,
    barbers: [
      {
        id: 'bar-ana',
        displayName: 'Ana',
        bio: null,
        avatarUrl: null,
        services: [
          {
            id: 'svc-corte',
            name: 'Corte',
            description: null,
            price: '10000.00',
            durationMinutes: 30,
          },
        ],
      },
    ],
  },
]);

function createService(
  findOwnerIdByPublicSlug: ReturnType<typeof vi.fn>,
  findBookableCatalog: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(CATALOG)
) {
  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const profiles = {
    findByOwner: vi.fn(),
    findByPublicSlug: vi.fn(),
    save: vi.fn(),
    findOwnerIdByPublicSlug,
  } as unknown as IBusinessProfileRepository;
  const catalog = { findBookableCatalog } as unknown as IPublicCatalogRepository;

  return {
    service: new PublicBookingCatalogService(profiles, catalog, logger),
    logger,
    findOwnerIdByPublicSlug,
    findBookableCatalog,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PublicBookingCatalogService - resolving a slug', () => {
  it('should_render_the_catalog_for_a_canonical_slug', async () => {
    const { service } = createService(vi.fn().mockResolvedValue('owner-1'));

    await expect(service.resolveBySlug('barberia-don-juan')).resolves.toEqual({
      type: 'render',
      catalog: CATALOG,
    });
  });

  it('should_scope_the_catalog_read_by_the_resolved_owner', async () => {
    const { service, findBookableCatalog } = createService(vi.fn().mockResolvedValue('owner-1'));

    await service.resolveBySlug('barberia-don-juan');

    expect(findBookableCatalog).toHaveBeenCalledExactlyOnceWith('owner-1');
  });

  it('should_never_return_the_owner_id_to_the_caller', async () => {
    // The single most important assertion in this file. The owner is a query
    // predicate; a resolution that carried it would be one prop away from the
    // browser.
    const { service } = createService(vi.fn().mockResolvedValue('owner-secreto'));

    const resolution = await service.resolveBySlug('barberia-don-juan');

    expect(JSON.stringify(resolution)).not.toContain('owner-secreto');
    expect(resolution).not.toHaveProperty('ownerId');
  });

  it('should_redirect_a_non_canonical_spelling_without_reading_the_catalog', async () => {
    const { service, findBookableCatalog } = createService(vi.fn().mockResolvedValue('owner-1'));

    await expect(service.resolveBySlug('BARBERIA-DON-JUAN')).resolves.toEqual({
      type: 'redirect',
      canonicalSlug: 'barberia-don-juan',
    });
    expect(findBookableCatalog).not.toHaveBeenCalled();
  });

  it('should_report_not_found_for_a_slug_no_profile_holds', async () => {
    const { service, findBookableCatalog } = createService(vi.fn().mockResolvedValue(null));

    await expect(service.resolveBySlug('ya-no-existe')).resolves.toEqual({ type: 'notFound' });
    expect(findBookableCatalog).not.toHaveBeenCalled();
  });

  it('should_log_an_unresolved_slug_at_info_with_the_value_sanitized', async () => {
    const { service, logger } = createService(vi.fn().mockResolvedValue(null));

    await service.resolveBySlug('ya-no-existe');

    expect(logger.info).toHaveBeenCalledWith(
      'Booking catalog slug did not resolve',
      expect.objectContaining({ requestedSlug: 'ya-no-existe', normalizedSlug: 'ya-no-existe' })
    );
  });
});

describe('PublicBookingCatalogService - hostile slugs never reach a query', () => {
  it.each([
    ['an overlong value', 'x'.repeat(5000)],
    ['a traversal segment', '../../etc/passwd'],
    ['a null byte', 'barberia\0'],
    ['a malformed percent sequence', 'barberia%'],
    ['an empty value', ''],
  ])('should_reject_%s_before_any_lookup', async (_label, slug) => {
    const { service, findOwnerIdByPublicSlug, findBookableCatalog } = createService(vi.fn());

    await expect(service.resolveBySlug(slug)).resolves.toEqual({ type: 'notFound' });
    expect(findOwnerIdByPublicSlug).not.toHaveBeenCalled();
    expect(findBookableCatalog).not.toHaveBeenCalled();
  });

  it('should_log_a_rejected_slug_at_debug_not_info', async () => {
    // The T33 signal lives at `info` and means "a client is holding a link that
    // stopped working". Malformed input is noise, and mixing the two would bury
    // the signal.
    const { service, logger } = createService(vi.fn());

    await service.resolveBySlug('../../etc/passwd');

    expect(logger.debug).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should_strip_control_characters_before_writing_the_slug_to_a_log', async () => {
    // The requested value is stranger-supplied and ends up in structured logs.
    // A raw control character there can forge a line break and split one entry
    // into two, so the sanitizing happens before the write rather than being
    // hoped for from the log sink.
    const { service, logger } = createService(vi.fn().mockResolvedValue(null));

    await service.resolveBySlug('barberia-don-juan');

    const [, context] = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(context.requestedSlug).toBe('barberia-don-juan');
    expect(context.requestedSlug).not.toMatch(/\p{C}/u);
  });

  it('should_truncate_a_logged_slug_to_the_column_bound', async () => {
    const { service, logger } = createService(vi.fn());

    // Long enough to be refused outright, so the rejection log is the one that
    // has to survive the value. A slug this size is what an enumeration sweep
    // looks like, and the log is the only record that it happened.
    await service.resolveBySlug('x'.repeat(5000));

    const [, context] = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(context.requestedSlug.length).toBe(60);
  });
});

describe('PublicBookingCatalogService - the profile page gate', () => {
  it('should_report_bookable_when_the_catalog_has_at_least_one_branch', async () => {
    const { service } = createService(vi.fn(), vi.fn().mockResolvedValue(CATALOG));

    await expect(service.isBookable('owner-1')).resolves.toBe(true);
  });

  it('should_report_not_bookable_for_an_empty_catalog', async () => {
    const { service } = createService(vi.fn(), vi.fn().mockResolvedValue([]));

    await expect(service.isBookable('owner-1')).resolves.toBe(false);
  });

  it('should_answer_the_gate_from_the_same_read_the_booking_route_uses', async () => {
    // Not a cheaper `count`: two queries answering "is this bookable" are two
    // definitions waiting to disagree.
    const { service, findBookableCatalog } = createService(
      vi.fn(),
      vi.fn().mockResolvedValue(CATALOG)
    );

    await service.isBookable('owner-1');

    expect(findBookableCatalog).toHaveBeenCalledExactlyOnceWith('owner-1');
  });
});

describe('PublicBookingCatalogService - a shop with nothing bookable', () => {
  it('should_render_an_empty_catalog_rather_than_failing', async () => {
    const { service } = createService(
      vi.fn().mockResolvedValue('owner-1'),
      vi.fn().mockResolvedValue([])
    );

    await expect(service.resolveBySlug('barberia-nueva')).resolves.toEqual({
      type: 'render',
      catalog: [],
    });
  });
});
