/**
 * Client-side image reduction.
 *
 * This module is the reason `serverActions.bodySizeLimit` stays at its default.
 * That setting is global: raising it to admit a 3–5 MB phone photograph would
 * equally raise the body accepted by `loginAction`, which is reachable
 * unauthenticated and whose only defence against large-body abuse is that
 * ceiling. A branding feature must not widen the authentication surface, so the
 * file is made small here instead (design D2).
 *
 * Re-encoding also discards capture metadata — GPS coordinates above all — which
 * is why removing it is not a separate step anywhere in the codebase. One
 * operation, two requirements (design D3).
 *
 * The browser primitives are injected rather than imported so the sizing and
 * retry logic can be tested without a canvas. The default implementation lives
 * in `browserImageRenderer.ts`, which only runs in the browser.
 */

export interface Dimensions {
  width: number;
  height: number;
}

export interface ImageRenderer {
  /** The image's intrinsic size. Rejects when the file is not a decodable image. */
  measure(file: File): Promise<Dimensions>;
  /** Redraws at `target` and re-encodes. `quality` is ignored by lossless types. */
  render(file: File, target: Dimensions, contentType: string, quality: number): Promise<Blob>;
}

export class UndecodableImageError extends Error {
  constructor() {
    super('The selected file could not be read as an image');
    this.name = 'UndecodableImageError';
  }
}

/**
 * The long edge of a stored image, in pixels.
 *
 * Chosen to cover the cover image at full width on a large display. If B1 ends
 * up rendering larger, this moves and previously uploaded images stay as they
 * are — which is why it is a constant with a name rather than a literal.
 */
export const MAX_EDGE_PIXELS = 1600;

/** What the reduction aims for. Not a limit — the server enforces that. */
export const TARGET_BYTES = 500 * 1024;

/**
 * Tried in order until the result fits. Strictly decreasing, and short: each
 * step is a full re-encode, and an owner waiting on a phone notices.
 */
export const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.5] as const;

/**
 * WEBP over JPEG: it is materially smaller at equal quality and it keeps
 * transparency, which a barbershop logo is likely to have. It is in the bucket's
 * allowed types. The renderer falls back if the browser cannot encode it.
 */
const PREFERRED_TYPE = 'image/webp';

/**
 * Computes the size to redraw at, preserving the aspect ratio.
 *
 * Never enlarges: upscaling adds bytes without adding detail, and makes a small
 * logo blurry for nothing.
 */
export function computeTargetDimensions(source: Dimensions, maxEdge: number): Dimensions {
  const longEdge = Math.max(source.width, source.height);
  if (longEdge <= maxEdge) return { width: source.width, height: source.height };

  const scale = maxEdge / longEdge;

  // Floored to at least one pixel: an extreme aspect ratio (a 5000×2 banner)
  // would otherwise round to a zero-height canvas, which throws rather than
  // rendering.
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * Reduces an image to something small enough to submit through a Server Action.
 *
 * Returns the first attempt that fits the target, or the smallest attempt if
 * none do. It does **not** throw on a stubborn file: the server enforces the
 * real bound, and refusing here would block an owner over a difference the
 * server would have accepted.
 */
export async function downscaleImage(file: File, renderer: ImageRenderer): Promise<File> {
  let source: Dimensions;
  try {
    source = await renderer.measure(file);
  } catch {
    throw new UndecodableImageError();
  }

  // A zero dimension means the browser produced something that is not an image.
  // Scaling from it yields NaN, and a NaN canvas fails in a way that reads as a
  // bug rather than as a bad file.
  if (!(source.width > 0) || !(source.height > 0)) {
    throw new UndecodableImageError();
  }

  const target = computeTargetDimensions(source, MAX_EDGE_PIXELS);

  let smallest: Blob | null = null;
  for (const quality of QUALITY_STEPS) {
    const encoded = await renderer.render(file, target, PREFERRED_TYPE, quality);

    if (smallest === null || encoded.size < smallest.size) {
      smallest = encoded;
    }
    if (encoded.size <= TARGET_BYTES) break;
  }

  // Unreachable — QUALITY_STEPS is non-empty — but expressed as a check rather
  // than a non-null assertion so a future edit to the constant cannot make it a
  // runtime surprise.
  if (smallest === null) throw new UndecodableImageError();

  return toFile(smallest);
}

/**
 * Names the file independently of what the owner selected.
 *
 * The server composes the storage key entirely from its own values, so this is
 * belt and braces — but a filename carrying no user input is one less thing that
 * has to be sanitized on the way there.
 */
function toFile(blob: Blob): File {
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
  return new File([blob], `upload.${extension}`, { type: blob.type });
}
