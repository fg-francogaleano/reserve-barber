import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseImageStorage, PUBLIC_PROFILE_BUCKET } from './SupabaseImageStorage';
import type { SupabaseClient } from '@supabase/supabase-js';

const KEY = '11111111-2222-3333-4444-555555555555/photo-1700000000000.png';
const PUBLIC_URL = `https://project.supabase.co/storage/v1/object/public/${PUBLIC_PROFILE_BUCKET}/${KEY}`;

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function createClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const bucket = {
    upload: vi.fn().mockResolvedValue({ data: { path: KEY }, error: null }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: PUBLIC_URL } }),
    remove: vi.fn().mockResolvedValue({ data: [{ name: KEY }], error: null }),
    ...overrides,
  };
  const from = vi.fn().mockReturnValue(bucket);
  const client = { storage: { from } } as unknown as SupabaseClient;
  return { client, from, bucket };
}

beforeEach(() => vi.clearAllMocks());

describe('SupabaseImageStorage - it uses the client it was given', () => {
  it('should_write_through_the_injected_session_bound_client', async () => {
    const { client, from } = createClient();

    await new SupabaseImageStorage(client).upload({
      key: KEY,
      bytes: BYTES,
      contentType: 'image/png',
    });

    // The whole credential decision rests on this: the adapter never builds a
    // client of its own, so it can only ever act with the owner's session
    // (design D13).
    expect(from).toHaveBeenCalledWith(PUBLIC_PROFILE_BUCKET);
  });

  it('should_target_the_public_profile_bucket_and_no_other', async () => {
    const { client, from } = createClient();

    await new SupabaseImageStorage(client).remove(PUBLIC_URL);

    expect(from).toHaveBeenCalledWith(PUBLIC_PROFILE_BUCKET);
    // Transfer receipts (B6) belong in a private bucket; this adapter must not
    // become the place they end up.
    expect(from).not.toHaveBeenCalledWith(expect.stringContaining('receipt'));
  });
});

describe('SupabaseImageStorage - upload', () => {
  it('should_pass_the_key_bytes_and_content_type_through_unchanged', async () => {
    const { client, bucket } = createClient();

    await new SupabaseImageStorage(client).upload({
      key: KEY,
      bytes: BYTES,
      contentType: 'image/png',
    });

    const [key, bytes, options] = bucket.upload.mock.calls[0];
    expect(key).toBe(KEY);
    expect(bytes).toBe(BYTES);
    expect(options.contentType).toBe('image/png');
  });

  it('should_refuse_to_overwrite_an_existing_object', async () => {
    const { client, bucket } = createClient();

    await new SupabaseImageStorage(client).upload({
      key: KEY,
      bytes: BYTES,
      contentType: 'image/png',
    });

    // Keys carry a timestamp, so a collision means a defect. Allowing an
    // overwrite would hide it and could replace an image the profile still
    // points at.
    const [, , options] = bucket.upload.mock.calls[0];
    expect(options.upsert).toBe(false);
  });

  it('should_return_the_key_and_the_resolved_public_url', async () => {
    const { client } = createClient();

    const stored = await new SupabaseImageStorage(client).upload({
      key: KEY,
      bytes: BYTES,
      contentType: 'image/png',
    });

    expect(stored).toEqual({ key: KEY, url: PUBLIC_URL });
  });

  it('should_raise_when_the_provider_reports_an_error', async () => {
    const { client } = createClient({
      upload: vi.fn().mockResolvedValue({ data: null, error: { message: 'row-level security' } }),
    });

    // Supabase reports failures in the payload rather than by rejecting, so a
    // missing check would silently treat a refused upload as a success and
    // persist a URL to an object that does not exist.
    await expect(
      new SupabaseImageStorage(client).upload({ key: KEY, bytes: BYTES, contentType: 'image/png' })
    ).rejects.toThrow(/row-level security/);
  });

  it('should_raise_when_the_provider_returns_neither_data_nor_error', async () => {
    const { client } = createClient({
      upload: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    await expect(
      new SupabaseImageStorage(client).upload({ key: KEY, bytes: BYTES, contentType: 'image/png' })
    ).rejects.toBeDefined();
  });
});

describe('SupabaseImageStorage - remove takes the stored url and reverses it', () => {
  it('should_delete_the_object_the_url_points_at', async () => {
    const { client, bucket } = createClient();

    await new SupabaseImageStorage(client).remove(PUBLIC_URL);

    expect(bucket.remove).toHaveBeenCalledWith([KEY]);
  });

  it('should_recover_a_key_that_contains_slashes', async () => {
    const { client, bucket } = createClient();

    await new SupabaseImageStorage(client).remove(PUBLIC_URL);

    // The key's own slash separates the owner prefix from the filename, so a
    // naive "last path segment" split would delete the wrong thing or nothing.
    const [keys] = bucket.remove.mock.calls[0];
    expect(keys[0]).toContain('/');
    expect(keys[0]).toBe(KEY);
  });

  it('should_ignore_a_url_that_does_not_belong_to_this_bucket', async () => {
    const { client, bucket } = createClient();

    await new SupabaseImageStorage(client).remove('https://example.com/some/other/image.png');

    // Nothing to reverse means nothing to delete. Guessing a key from a foreign
    // URL is how an unrelated object gets removed.
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it('should_ignore_a_url_pointing_at_a_different_bucket', async () => {
    const { client, bucket } = createClient();

    await new SupabaseImageStorage(client).remove(
      'https://project.supabase.co/storage/v1/object/public/receipts/secret.png'
    );

    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it('should_ignore_a_value_that_is_not_a_url_at_all', async () => {
    const { client, bucket } = createClient();

    await new SupabaseImageStorage(client).remove('not a url');

    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it('should_raise_when_the_delete_matched_no_object_even_though_no_error_was_reported', async () => {
    const { client } = createClient({
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    // The failure mode the P1 storage gate actually caught: with no SELECT
    // policy on the bucket, the lookup preceding a delete finds nothing, so the
    // delete removes nothing and reports success. Trusting `error` alone meant
    // every replaced image was kept forever.
    await expect(new SupabaseImageStorage(client).remove(PUBLIC_URL)).rejects.toThrow(
      /matched no object/
    );
  });

  it('should_raise_when_the_provider_returns_no_deletion_payload', async () => {
    const { client } = createClient({
      remove: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    await expect(new SupabaseImageStorage(client).remove(PUBLIC_URL)).rejects.toBeDefined();
  });

  it('should_raise_when_the_provider_reports_a_deletion_error', async () => {
    const { client } = createClient({
      remove: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    });

    // The caller treats this as non-fatal and logs it; the adapter's job is to
    // report it rather than swallow it.
    await expect(new SupabaseImageStorage(client).remove(PUBLIC_URL)).rejects.toThrow(/not found/);
  });
});
