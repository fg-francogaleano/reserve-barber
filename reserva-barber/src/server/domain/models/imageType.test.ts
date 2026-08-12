import { describe, it, expect } from 'vitest';
import { detectImageType, extensionFor, MAX_IMAGE_BYTES } from './imageType';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** A buffer long enough to be plausible, carrying the given signature. */
function withSignature(signature: number[], length = 64): Uint8Array {
  const buffer = new Uint8Array(length);
  buffer.set(signature, 0);
  return buffer;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function webp(): Uint8Array {
  const buffer = new Uint8Array(64);
  buffer.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  buffer.set([0x00, 0x00, 0x00, 0x00], 4); // size, irrelevant here
  buffer.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return buffer;
}

describe('detectImageType', () => {
  describe('the types the public bucket accepts', () => {
    it('recognizes JPEG', () => {
      expect(detectImageType(withSignature(JPEG))).toBe('image/jpeg');
    });

    it('recognizes PNG', () => {
      expect(detectImageType(withSignature(PNG))).toBe('image/png');
    });

    it('recognizes WEBP', () => {
      expect(detectImageType(webp())).toBe('image/webp');
    });
  });

  describe('what it refuses', () => {
    it('refuses SVG, which is a script-execution surface on a public origin', () => {
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      expect(detectImageType(svg)).toBeNull();
    });

    it('refuses a text file however it is named or declared', () => {
      expect(detectImageType(new TextEncoder().encode('not an image at all'))).toBeNull();
    });

    it('refuses GIF, which is a real image type this bucket still does not allow', () => {
      const gif = new TextEncoder().encode('GIF89a');
      expect(detectImageType(gif)).toBeNull();
    });

    it('refuses an empty buffer', () => {
      expect(detectImageType(new Uint8Array())).toBeNull();
    });

    it('refuses a buffer too short to carry a signature', () => {
      expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
    });

    it('refuses RIFF that is not WEBP', () => {
      // A WAV file also starts with RIFF. Checking only the first four bytes
      // would accept audio as an image.
      const wav = new Uint8Array(64);
      wav.set([0x52, 0x49, 0x46, 0x46], 0);
      wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
      expect(detectImageType(wav)).toBeNull();
    });
  });

  describe('the declared type is irrelevant', () => {
    it('reads the bytes, not what the caller says they are', () => {
      // The whole point: a text file renamed to .png and declared image/png
      // still has the bytes of a text file, and this is the only check that
      // notices.
      const disguised = new TextEncoder().encode('<html><script>alert(1)</script></html>');
      expect(detectImageType(disguised)).toBeNull();
    });

    it('accepts a real PNG regardless of what it might have been called', () => {
      expect(detectImageType(withSignature(PNG))).toBe('image/png');
    });
  });
});

describe('extensionFor', () => {
  it('derives the extension from the detected type, never from a filename', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
  });

  it('produces extensions that cannot alter a storage key', () => {
    // A filename can carry path separators; a derived extension cannot. This is
    // what keeps a crafted filename out of the object key.
    for (const type of ['image/jpeg', 'image/png', 'image/webp'] as const) {
      expect(extensionFor(type)).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe('MAX_IMAGE_BYTES', () => {
  it('matches the bucket ceiling so the two cannot disagree', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
