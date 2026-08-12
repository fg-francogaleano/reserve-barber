import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BusinessProfileService } from './BusinessProfileService';
import { BusinessProfile, SocialLink } from '@/server/domain/models/BusinessProfile';
import {
  DuplicateSlugError,
  UnsupportedImageTypeError,
  ImageTooLargeError,
  ImageUploadFailedError,
} from '@/server/domain/errors/BusinessProfileErrors';
import { MAX_IMAGE_BYTES } from '@/server/domain/models/imageType';
import type { IBusinessProfileRepository } from '@/server/domain/repositories/IBusinessProfileRepository';
import type { IImageStorage } from '@/server/domain/repositories/IImageStorage';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { SaveBusinessProfileInput } from '@/server/application/businessProfile/businessProfileSchema';

const OWNER = 'owner-root';
const AUTH_USER = '11111111-2222-3333-4444-555555555555';

const PNG_BYTES = new Uint8Array(64);
PNG_BYTES.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);

// `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: since TypeScript
// 5.7 the type is generic over its backing buffer, and the bare form widens to
// `ArrayBufferLike`, which `BlobPart` does not accept.
function pngFile(bytes: Uint8Array<ArrayBuffer> = PNG_BYTES): File {
  return new File([bytes], 'whatever.png', { type: 'image/png' });
}

function storedProfile(overrides: Partial<Record<'photoUrl' | 'coverUrl', string | null>> = {}) {
  return new BusinessProfile(
    'profile-1',
    'Barbería Don Juan',
    null,
    overrides.photoUrl === undefined ? 'https://cdn/old-photo.png' : overrides.photoUrl,
    overrides.coverUrl === undefined ? 'https://cdn/old-cover.png' : overrides.coverUrl,
    'barberia-don-juan',
    [new SocialLink('INSTAGRAM', 'https://instagram.com/a', 0)]
  );
}

function input(overrides: Partial<SaveBusinessProfileInput> = {}): SaveBusinessProfileInput {
  return {
    businessName: 'Barbería Don Juan',
    bio: null,
    publicSlug: 'barberia-don-juan',
    socialLinks: [],
    photo: { intent: 'unchanged' },
    cover: { intent: 'unchanged' },
    ...overrides,
  };
}

function buildLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function buildService(
  repo: Partial<IBusinessProfileRepository> = {},
  storage: Partial<IImageStorage> = {},
  logger: ILogger = buildLogger()
) {
  const repository = {
    findByOwner: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation((_ownerId, data) =>
      Promise.resolve(
        new BusinessProfile(
          'profile-1',
          data.businessName,
          data.bio,
          data.photoUrl,
          data.coverUrl,
          data.publicSlug,
          []
        )
      )
    ),
    ...repo,
  } as IBusinessProfileRepository;

  const images = {
    upload: vi
      .fn()
      .mockImplementation((image) => Promise.resolve({ key: image.key, url: `https://cdn/${image.key}` })),
    remove: vi.fn().mockResolvedValue(undefined),
    ...storage,
  } as IImageStorage;

  return {
    service: new BusinessProfileService(repository, images, logger),
    repository,
    images,
    logger,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('BusinessProfileService - reading', () => {
  it('should_report_a_missing_profile_as_null_because_that_is_the_first_run_state', async () => {
    const { service } = buildService();

    await expect(service.findProfile(OWNER)).resolves.toBeNull();
  });
});

describe('BusinessProfileService - first save and later saves share one path', () => {
  it('should_save_when_no_profile_exists_yet', async () => {
    const { service, repository } = buildService();

    await service.saveProfile(OWNER, AUTH_USER, input());

    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('should_save_when_a_profile_already_exists', async () => {
    const { service, repository } = buildService({
      findByOwner: vi.fn().mockResolvedValue(storedProfile()),
    });

    await service.saveProfile(OWNER, AUTH_USER, input());

    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});

describe('BusinessProfileService - an unchanged image slot is left alone', () => {
  it('should_preserve_the_stored_urls_when_neither_slot_was_touched', async () => {
    const { service, repository } = buildService({
      findByOwner: vi.fn().mockResolvedValue(storedProfile()),
    });

    await service.saveProfile(OWNER, AUTH_USER, input());

    const [, data] = vi.mocked(repository.save).mock.calls[0];
    expect(data.photoUrl).toBe('https://cdn/old-photo.png');
    expect(data.coverUrl).toBe('https://cdn/old-cover.png');
  });

  it('should_neither_upload_nor_delete_when_neither_slot_was_touched', async () => {
    // The defect this guards: editing only the bio must not disturb the images.
    const { service, images } = buildService({
      findByOwner: vi.fn().mockResolvedValue(storedProfile()),
    });

    await service.saveProfile(OWNER, AUTH_USER, input({ bio: 'Nuevo texto' }));

    expect(images.upload).not.toHaveBeenCalled();
    expect(images.remove).not.toHaveBeenCalled();
  });

  it('should_leave_an_absent_image_absent_rather_than_inventing_one', async () => {
    const { service, repository } = buildService({
      findByOwner: vi.fn().mockResolvedValue(storedProfile({ photoUrl: null })),
    });

    await service.saveProfile(OWNER, AUTH_USER, input());

    const [, data] = vi.mocked(repository.save).mock.calls[0];
    expect(data.photoUrl).toBeNull();
  });
});

describe('BusinessProfileService - removal is explicit', () => {
  it('should_clear_the_url_and_delete_the_object_on_remove', async () => {
    const { service, repository, images } = buildService({
      findByOwner: vi.fn().mockResolvedValue(storedProfile()),
    });

    await service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'remove' } }));

    const [, data] = vi.mocked(repository.save).mock.calls[0];
    expect(data.photoUrl).toBeNull();
    expect(images.remove).toHaveBeenCalledWith('https://cdn/old-photo.png');
  });

  it('should_not_attempt_a_delete_when_there_was_nothing_stored', async () => {
    const { service, images } = buildService({
      findByOwner: vi.fn().mockResolvedValue(storedProfile({ photoUrl: null })),
    });

    await service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'remove' } }));

    expect(images.remove).not.toHaveBeenCalled();
  });
});

describe('BusinessProfileService - replacement', () => {
  it('should_upload_before_the_transaction_opens', async () => {
    const order: string[] = [];
    const { service } = buildService(
      {
        save: vi.fn().mockImplementation(() => {
          order.push('save');
          return Promise.resolve(storedProfile());
        }),
      },
      {
        upload: vi.fn().mockImplementation((image) => {
          order.push('upload');
          return Promise.resolve({ key: image.key, url: 'https://cdn/new.png' });
        }),
      }
    );

    await service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }));

    // Storage is not transactional, and a network round trip must not hold a
    // database transaction open on a pooled connection.
    expect(order).toEqual(['upload', 'save']);
  });

  it('should_compose_the_key_from_the_auth_user_id_not_the_owner_id', async () => {
    const { service, images } = buildService();

    await service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }));

    const [image] = vi.mocked(images.upload).mock.calls[0];
    // The bucket policy compares the leading segment against auth.uid(), which
    // is not the Prisma owner id. Using the wrong one makes every write fail.
    expect(image.key.startsWith(`${AUTH_USER}/`)).toBe(true);
    expect(image.key).not.toContain(OWNER);
  });

  it('should_take_the_content_type_from_the_bytes_not_from_the_declared_type', async () => {
    const jpegBytes = new Uint8Array(64);
    jpegBytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
    // Declared PNG, actually JPEG. The bytes win.
    const lying = new File([jpegBytes], 'photo.png', { type: 'image/png' });

    const { service, images } = buildService();

    await service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: lying } }));

    const [image] = vi.mocked(images.upload).mock.calls[0];
    expect(image.contentType).toBe('image/jpeg');
    expect(image.key.endsWith('.jpg')).toBe(true);
  });

  it('should_never_let_the_filename_reach_the_key', async () => {
    const hostile = new File([PNG_BYTES], '../../receipts/evil.png', { type: 'image/png' });
    const { service, images } = buildService();

    await service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: hostile } }));

    const [image] = vi.mocked(images.upload).mock.calls[0];
    expect(image.key).not.toContain('..');
    expect(image.key).not.toContain('receipts');
    expect(image.key.split('/')).toHaveLength(2);
  });

  it('should_delete_the_previous_object_after_a_successful_save', async () => {
    const { service, images } = buildService({
      findByOwner: vi.fn().mockResolvedValue(storedProfile()),
    });

    await service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }));

    expect(images.remove).toHaveBeenCalledWith('https://cdn/old-photo.png');
  });

  it('should_delete_the_previous_object_only_after_the_save_commits', async () => {
    const order: string[] = [];
    const { service } = buildService(
      {
        findByOwner: vi.fn().mockResolvedValue(storedProfile()),
        save: vi.fn().mockImplementation(() => {
          order.push('save');
          return Promise.resolve(storedProfile());
        }),
      },
      {
        upload: vi.fn().mockResolvedValue({ key: 'k', url: 'https://cdn/new.png' }),
        remove: vi.fn().mockImplementation(() => {
          order.push('remove');
          return Promise.resolve();
        }),
      }
    );

    await service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }));

    // Deleting first would destroy the live image if the save then failed.
    expect(order).toEqual(['save', 'remove']);
  });

  it('should_not_fail_the_save_when_deleting_the_previous_object_fails', async () => {
    const logger = buildLogger();
    const { service } = buildService(
      { findByOwner: vi.fn().mockResolvedValue(storedProfile()) },
      { remove: vi.fn().mockRejectedValue(new Error('storage unavailable')) },
      logger
    );

    // Reclaiming a few hundred kilobytes must never be the reason an owner's
    // work is lost.
    await expect(
      service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }))
    ).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('BusinessProfileService - image validation happens before anything is written', () => {
  it('should_reject_a_file_whose_bytes_are_not_an_accepted_image', async () => {
    const disguised = new File([new TextEncoder().encode('<html>nope</html>')], 'photo.png', {
      type: 'image/png',
    });
    const { service, images, repository } = buildService();

    const error = await service
      .saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: disguised } }))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UnsupportedImageTypeError);
    expect((error as UnsupportedImageTypeError).slot).toBe('photo');
    expect(images.upload).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('should_reject_a_file_over_the_server_bound_regardless_of_what_the_client_did', async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const { service, images } = buildService();

    await expect(
      service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile(huge) } }))
    ).rejects.toBeInstanceOf(ImageTooLargeError);
    expect(images.upload).not.toHaveBeenCalled();
  });

  it('should_validate_both_slots_before_uploading_either', async () => {
    const bad = new File([new TextEncoder().encode('nope')], 'cover.png', { type: 'image/png' });
    const { service, images } = buildService();

    const error = await service
      .saveProfile(
        OWNER,
        AUTH_USER,
        input({ photo: { intent: 'replace', file: pngFile() }, cover: { intent: 'replace', file: bad } })
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UnsupportedImageTypeError);
    // Named, so the owner is not left guessing which of the two inputs is wrong.
    expect((error as UnsupportedImageTypeError).slot).toBe('cover');
    // Rejecting the cover after the photo was already uploaded would orphan the
    // photo for a failure we could see coming.
    expect(images.upload).not.toHaveBeenCalled();
  });
});

describe('BusinessProfileService - a failure after upload orphans an object, and says so', () => {
  it('should_log_the_unreferenced_key_when_the_save_fails', async () => {
    const logger = buildLogger();
    const failure = new DuplicateSlugError('barberia-don-juan');
    const { service } = buildService(
      { save: vi.fn().mockRejectedValue(failure) },
      { upload: vi.fn().mockResolvedValue({ key: 'user/photo-1.png', url: 'https://cdn/x.png' }) },
      logger
    );

    await expect(
      service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }))
    ).rejects.toBe(failure);

    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).toContain('user/photo-1.png');
  });

  it('should_report_the_database_failure_rather_than_a_storage_one', async () => {
    const failure = new DuplicateSlugError('barberia-don-juan');
    const { service } = buildService({ save: vi.fn().mockRejectedValue(failure) });

    await expect(
      service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }))
    ).rejects.toBe(failure);
  });

  it('should_not_log_submitted_business_data_alongside_the_orphan', async () => {
    const logger = buildLogger();
    const { service } = buildService(
      { save: vi.fn().mockRejectedValue(new Error('connection lost')) },
      {},
      logger
    );

    await expect(
      service.saveProfile(
        OWNER,
        AUTH_USER,
        input({ bio: 'texto privado del dueño', photo: { intent: 'replace', file: pngFile() } })
      )
    ).rejects.toBeDefined();

    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('texto privado');
  });
});

describe('BusinessProfileService - the boundary with persistence', () => {
  it('should_let_domain_errors_from_the_repository_through_untouched', async () => {
    const failure = new DuplicateSlugError('barberia-don-juan');
    const { service } = buildService({ save: vi.fn().mockRejectedValue(failure) });

    // The service never inspects a driver error shape — the repository has
    // already turned it into a domain type (design D8).
    await expect(service.saveProfile(OWNER, AUTH_USER, input())).rejects.toBe(failure);
  });

  it('should_surface_an_upload_failure_as_a_domain_error_carrying_the_key', async () => {
    const { service } = buildService(
      {},
      { upload: vi.fn().mockRejectedValue(new Error('503 from storage')) }
    );

    await expect(
      service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }))
    ).rejects.toBeInstanceOf(ImageUploadFailedError);
  });

  it('should_not_write_the_profile_when_an_upload_fails', async () => {
    const { service, repository } = buildService(
      {},
      { upload: vi.fn().mockRejectedValue(new Error('503 from storage')) }
    );

    await expect(
      service.saveProfile(OWNER, AUTH_USER, input({ photo: { intent: 'replace', file: pngFile() } }))
    ).rejects.toBeDefined();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
