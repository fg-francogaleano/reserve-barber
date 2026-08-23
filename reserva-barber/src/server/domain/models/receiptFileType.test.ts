import { describe, it, expect } from 'vitest';
import {
  detectReceiptType,
  receiptExtensionFor,
  MAX_RECEIPT_BYTES,
  RECEIPT_CONTENT_TYPES,
} from './receiptFileType';

/** A buffer long enough to be plausible, carrying the given signature. */
function withSignature(signature: number[], length = 64): Uint8Array {
  const buffer = new Uint8Array(length);
  buffer.set(signature, 0);
  return buffer;
}

function ascii(text: string, length = 64): Uint8Array {
  const buffer = new Uint8Array(length);
  for (let i = 0; i < text.length; i += 1) buffer[i] = text.charCodeAt(i);
  return buffer;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('detectReceiptType', () => {
  describe('the types a bank actually produces', () => {
    it('recognizes JPEG', () => {
      expect(detectReceiptType(withSignature(JPEG))).toBe('image/jpeg');
    });

    it('recognizes PNG', () => {
      expect(detectReceiptType(withSignature(PNG))).toBe('image/png');
    });

    it('recognizes PDF', () => {
      expect(detectReceiptType(ascii('%PDF-1.7\n'))).toBe('application/pdf');
    });
  });

  describe('what it refuses', () => {
    // The exclusion is deliberate and not an oversight: an SVG is a
    // script-execution surface, and the owner opens these files in their own
    // browser.
    it('refuses SVG even though it is an image', () => {
      expect(detectReceiptType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    });

    it('refuses SVG that opens with an XML declaration', () => {
      expect(detectReceiptType(ascii('<?xml version="1.0"?><svg>'))).toBeNull();
    });

    // WEBP is accepted by the profile bucket and not by this one. The two lists
    // must not drift into each other.
    it('refuses WEBP, which belongs to the other bucket', () => {
      const buffer = new Uint8Array(64);
      buffer.set([0x52, 0x49, 0x46, 0x46], 0);
      buffer.set([0x57, 0x45, 0x42, 0x50], 8);
      expect(detectReceiptType(buffer)).toBeNull();
    });

    it('refuses an unrecognized binary', () => {
      expect(detectReceiptType(withSignature([0x00, 0x01, 0x02, 0x03]))).toBeNull();
    });

    it('refuses an empty buffer', () => {
      expect(detectReceiptType(new Uint8Array(0))).toBeNull();
    });

    // A buffer shorter than a signature must not read past its end.
    it('refuses a buffer shorter than the signature it starts to match', () => {
      expect(detectReceiptType(new Uint8Array([0x89, 0x50]))).toBeNull();
      expect(detectReceiptType(new Uint8Array([0x25, 0x50]))).toBeNull();
    });
  });

  describe('the declaration is never consulted', () => {
    // The defining case of this module: a `.jpg` named, declared and sent as an
    // image, whose bytes are a PDF. The bytes decide.
    it('classifies a PDF that claims to be a JPEG as a PDF', () => {
      expect(detectReceiptType(ascii('%PDF-1.4'))).toBe('application/pdf');
    });

    it('classifies a JPEG that claims to be a PDF as a JPEG', () => {
      expect(detectReceiptType(withSignature(JPEG))).toBe('image/jpeg');
    });
  });
});

describe('receiptExtensionFor', () => {
  it('maps every accepted type to an extension', () => {
    for (const type of RECEIPT_CONTENT_TYPES) {
      expect(receiptExtensionFor(type)).toMatch(/^[a-z]{3}$/);
    }
  });

  it('derives the extension from the detected type', () => {
    expect(receiptExtensionFor('image/jpeg')).toBe('jpg');
    expect(receiptExtensionFor('image/png')).toBe('png');
    expect(receiptExtensionFor('application/pdf')).toBe('pdf');
  });
});

describe('MAX_RECEIPT_BYTES', () => {
  it('is the 10 MB the bucket also enforces', () => {
    expect(MAX_RECEIPT_BYTES).toBe(10 * 1024 * 1024);
  });
});
