import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseReceiptStorage,
  SupabaseOwnerReceiptStorage,
  TRANSFER_RECEIPT_BUCKET,
  RECEIPT_SIGNED_URL_SECONDS,
} from './SupabaseReceiptStorage';

const KEY = 'auth-1/bkg-1/1755864000000.pdf';

function createClient(bucket: Record<string, unknown>) {
  const from = vi.fn().mockReturnValue(bucket);
  return {
    client: { storage: { from } } as unknown as SupabaseClient,
    from,
  };
}

function uploadBucket(result: unknown) {
  return { upload: vi.fn().mockResolvedValue(result) };
}

const RECEIPT = {
  key: KEY,
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  contentType: 'application/pdf' as const,
};

describe('SupabaseReceiptStorage.upload', () => {
  it('writes to the private receipts bucket', async () => {
    const bucket = uploadBucket({ data: { path: KEY }, error: null });
    const { client, from } = createClient(bucket);

    const stored = await new SupabaseReceiptStorage(client).upload(RECEIPT);

    expect(from).toHaveBeenCalledWith(TRANSFER_RECEIPT_BUCKET);
    expect(stored).toEqual({ key: KEY });
  });

  it('passes the detected content type', async () => {
    const bucket = uploadBucket({ data: { path: KEY }, error: null });
    const { client } = createClient(bucket);

    await new SupabaseReceiptStorage(client).upload(RECEIPT);

    expect(bucket.upload).toHaveBeenCalledWith(
      KEY,
      RECEIPT.bytes,
      expect.objectContaining({ contentType: 'application/pdf' })
    );
  });

  // Keys carry an instant, so a collision means a defect rather than a
  // replacement — the replacement path writes a new key instead of overwriting.
  it('never upserts', async () => {
    const bucket = uploadBucket({ data: { path: KEY }, error: null });
    const { client } = createClient(bucket);

    await new SupabaseReceiptStorage(client).upload(RECEIPT);

    expect(bucket.upload).toHaveBeenCalledWith(
      KEY,
      RECEIPT.bytes,
      expect.objectContaining({ upsert: false })
    );
  });

  /**
   * The trap this adapter exists to avoid: Supabase reports refusals in the
   * payload rather than by rejecting. Checking only for a thrown error would
   * persist a `filePath` pointing at nothing, discovered only when the owner
   * tried to open it.
   */
  it('treats an error in the payload as a failure', async () => {
    const bucket = uploadBucket({ data: null, error: { message: 'new row violates policy' } });
    const { client } = createClient(bucket);

    await expect(new SupabaseReceiptStorage(client).upload(RECEIPT)).rejects.toThrow(
      /new row violates policy/
    );
  });

  it('treats a response with neither data nor error as a failure', async () => {
    const bucket = uploadBucket({ data: null, error: null });
    const { client } = createClient(bucket);

    await expect(new SupabaseReceiptStorage(client).upload(RECEIPT)).rejects.toThrow();
  });

  // A policy refusal is what an anonymous caller gets at a key the predicate
  // rejects, and it must surface rather than being reported as a stored object.
  it('surfaces a policy refusal rather than reporting success', async () => {
    const bucket = uploadBucket({
      data: null,
      error: { message: 'new row violates row-level security policy' },
    });
    const { client } = createClient(bucket);

    await expect(new SupabaseReceiptStorage(client).upload(RECEIPT)).rejects.toThrow();
  });
});

describe('SupabaseOwnerReceiptStorage.signForOwner', () => {
  function signingBucket(result: unknown) {
    return { createSignedUrl: vi.fn().mockResolvedValue(result) };
  }

  it('signs against the receipts bucket with a short lifetime', async () => {
    const bucket = signingBucket({ data: { signedUrl: 'https://s/x?token=t' }, error: null });
    const { client, from } = createClient(bucket);

    const signed = await new SupabaseOwnerReceiptStorage(client).signForOwner(KEY);

    expect(from).toHaveBeenCalledWith(TRANSFER_RECEIPT_BUCKET);
    expect(signed).toEqual({
      url: 'https://s/x?token=t',
      expiresInSeconds: RECEIPT_SIGNED_URL_SECONDS,
    });
  });

  /**
   * Not cosmetic. A PDF can carry active content, and an inline render would
   * execute it against the storage origin in the owner's own browser — the most
   * privileged browser in this product, opening a stranger's file.
   */
  it('forces a download rather than an inline render', async () => {
    const bucket = signingBucket({ data: { signedUrl: 'https://s/x' }, error: null });
    const { client } = createClient(bucket);

    await new SupabaseOwnerReceiptStorage(client).signForOwner(KEY);

    expect(bucket.createSignedUrl).toHaveBeenCalledWith(
      KEY,
      RECEIPT_SIGNED_URL_SECONDS,
      expect.objectContaining({ download: true })
    );
  });

  it('treats an error in the payload as a failure', async () => {
    const bucket = signingBucket({ data: null, error: { message: 'object not found' } });
    const { client } = createClient(bucket);

    await expect(new SupabaseOwnerReceiptStorage(client).signForOwner(KEY)).rejects.toThrow(
      /object not found/
    );
  });

  it('treats a missing URL as a failure rather than rendering an empty link', async () => {
    const bucket = signingBucket({ data: {}, error: null });
    const { client } = createClient(bucket);

    await expect(new SupabaseOwnerReceiptStorage(client).signForOwner(KEY)).rejects.toThrow();
  });
});
