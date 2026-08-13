import type { Dimensions, ImageRenderer } from './imageDownscale';

/**
 * The browser half of the image pipeline: decode, redraw, re-encode.
 *
 * Deliberately separate from `imageDownscale.ts`, which holds the sizing and
 * retry logic. Everything here needs a real canvas, so it cannot run in the
 * Node test environment; keeping it thin means the part that can be tested is
 * the part that can be wrong.
 */
export function createBrowserImageRenderer(): ImageRenderer {
  return {
    async measure(file: File): Promise<Dimensions> {
      const bitmap = await decode(file);
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close();
      }
    },

    async render(file: File, target: Dimensions, contentType: string, quality: number): Promise<Blob> {
      const bitmap = await decode(file);

      try {
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;

        const context = canvas.getContext('2d');
        if (context === null) {
          throw new Error('Could not obtain a 2D canvas context');
        }

        context.drawImage(bitmap, 0, 0, target.width, target.height);

        return await encode(canvas, contentType, quality);
      } finally {
        bitmap.close();
      }
    },
  };
}

/**
 * `imageOrientation: 'from-image'` is load-bearing, not a default worth
 * inheriting.
 *
 * A phone photograph records its rotation in EXIF rather than in the pixels. We
 * re-encode through a canvas, which discards EXIF — so without applying the
 * orientation while decoding, a portrait photo would be stored permanently
 * sideways. The metadata that said "rotate me" is exactly the metadata we are
 * removing on purpose.
 */
function decode(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

function encode(canvas: HTMLCanvasElement, contentType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error('Canvas produced no image data'));
          return;
        }
        // A browser that cannot encode the requested type silently returns PNG
        // instead of failing. That is acceptable — PNG is in the bucket's
        // allowed types — but it must not be mistaken for the type we asked
        // for, so the blob's own type is what travels onward.
        resolve(blob);
      },
      contentType,
      quality
    );
  });
}
