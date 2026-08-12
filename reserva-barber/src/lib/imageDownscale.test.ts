import { describe, it, expect, vi } from 'vitest';
import {
  computeTargetDimensions,
  downscaleImage,
  UndecodableImageError,
  MAX_EDGE_PIXELS,
  TARGET_BYTES,
  QUALITY_STEPS,
} from './imageDownscale';
import type { ImageRenderer } from './imageDownscale';

function blobOf(size: number, type = 'image/webp'): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

/** A renderer whose output size is whatever the test dictates. */
function rendererProducing(sizes: number[], width = 4000, height = 3000): ImageRenderer {
  let call = 0;
  return {
    measure: vi.fn().mockResolvedValue({ width, height }),
    render: vi.fn().mockImplementation(() => {
      const size = sizes[Math.min(call, sizes.length - 1)] ?? 1;
      call += 1;
      return Promise.resolve(blobOf(size));
    }),
  };
}

function anyFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
}

describe('computeTargetDimensions', () => {
  it('scales a landscape image by its long edge', () => {
    expect(computeTargetDimensions({ width: 4000, height: 2000 }, 1600)).toEqual({
      width: 1600,
      height: 800,
    });
  });

  it('scales a portrait image by its long edge', () => {
    expect(computeTargetDimensions({ width: 2000, height: 4000 }, 1600)).toEqual({
      width: 800,
      height: 1600,
    });
  });

  it('scales a square image', () => {
    expect(computeTargetDimensions({ width: 3000, height: 3000 }, 1600)).toEqual({
      width: 1600,
      height: 1600,
    });
  });

  it('never enlarges an image that is already small', () => {
    // Upscaling would add bytes and no detail — and would make a small logo
    // blurry for no reason.
    expect(computeTargetDimensions({ width: 400, height: 300 }, 1600)).toEqual({
      width: 400,
      height: 300,
    });
  });

  it('leaves an image exactly at the limit alone', () => {
    expect(computeTargetDimensions({ width: 1600, height: 900 }, 1600)).toEqual({
      width: 1600,
      height: 900,
    });
  });

  it('rounds to whole pixels', () => {
    const result = computeTargetDimensions({ width: 1000, height: 333 }, 500);
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it('never rounds a dimension down to zero', () => {
    // An extreme aspect ratio (a banner 5000x2) would otherwise produce a
    // zero-height canvas, which throws rather than rendering.
    const result = computeTargetDimensions({ width: 5000, height: 2 }, 1600);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});

describe('downscaleImage', () => {
  it('renders at the computed target size rather than the original', async () => {
    const renderer = rendererProducing([1000], 4000, 3000);

    await downscaleImage(anyFile(), renderer);

    const [, target] = vi.mocked(renderer.render).mock.calls[0];
    expect(target).toEqual(computeTargetDimensions({ width: 4000, height: 3000 }, MAX_EDGE_PIXELS));
  });

  it('never returns the original file, so embedded metadata cannot survive', async () => {
    const original = anyFile();
    const renderer = rendererProducing([1000]);

    const result = await downscaleImage(original, renderer);

    // Stripping EXIF is not a separate step: the output is built from freshly
    // encoded pixels, so capture metadata — GPS coordinates above all — has
    // nowhere to survive. What proves it is that the original bytes are never
    // what gets returned.
    expect(result).not.toBe(original);
    expect(renderer.render).toHaveBeenCalled();
  });

  it('stops at the first attempt that fits the target size', async () => {
    const renderer = rendererProducing([TARGET_BYTES - 1]);

    await downscaleImage(anyFile(), renderer);

    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it('lowers quality until the result fits', async () => {
    const renderer = rendererProducing([TARGET_BYTES * 3, TARGET_BYTES * 2, TARGET_BYTES - 1]);

    await downscaleImage(anyFile(), renderer);

    expect(renderer.render).toHaveBeenCalledTimes(3);
    const qualities = vi.mocked(renderer.render).mock.calls.map((call) => call[3]);
    // Strictly decreasing: repeating a quality would burn an attempt on a
    // result we already know the size of.
    expect(qualities).toEqual([...qualities].sort((a, b) => b - a));
    expect(new Set(qualities).size).toBe(qualities.length);
  });

  it('gives up after the last quality step rather than looping', async () => {
    const renderer = rendererProducing([TARGET_BYTES * 10]);

    await downscaleImage(anyFile(), renderer);

    expect(renderer.render).toHaveBeenCalledTimes(QUALITY_STEPS.length);
  });

  it('returns the smallest attempt when none of them fit', async () => {
    const sizes = [TARGET_BYTES * 10, TARGET_BYTES * 4, TARGET_BYTES * 6];
    const renderer = rendererProducing(sizes);

    const result = await downscaleImage(anyFile(), renderer);

    // Returning the best effort rather than throwing: the server still enforces
    // its own bound, and refusing here would block an owner whose photo is
    // merely stubborn.
    expect(result.size).toBe(Math.min(...sizes.slice(0, QUALITY_STEPS.length)));
  });

  it('refuses a file the browser cannot decode', async () => {
    const renderer: ImageRenderer = {
      measure: vi.fn().mockRejectedValue(new Error('decode failed')),
      render: vi.fn(),
    };

    await expect(downscaleImage(anyFile(), renderer)).rejects.toBeInstanceOf(UndecodableImageError);
  });

  it('does not render anything when the file cannot be decoded', async () => {
    const renderer: ImageRenderer = {
      measure: vi.fn().mockRejectedValue(new Error('decode failed')),
      render: vi.fn(),
    };

    await expect(downscaleImage(anyFile(), renderer)).rejects.toBeDefined();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('refuses a file with no intrinsic size', async () => {
    // A zero-dimension decode means the browser produced something that is not
    // an image, and dividing by it would produce NaN dimensions.
    const renderer: ImageRenderer = {
      measure: vi.fn().mockResolvedValue({ width: 0, height: 0 }),
      render: vi.fn(),
    };

    await expect(downscaleImage(anyFile(), renderer)).rejects.toBeInstanceOf(UndecodableImageError);
  });

  it('produces a File the form can submit, named independently of the original', async () => {
    const renderer = rendererProducing([1000]);

    const result = await downscaleImage(anyFile(), renderer);

    expect(result).toBeInstanceOf(File);
    // The server derives the stored key from its own values, but a filename
    // that carries no user input is one less thing to sanitize on the way.
    expect(result.name).not.toContain('photo.jpg');
  });

  it('asks for a type the bucket accepts', async () => {
    const renderer = rendererProducing([1000]);

    await downscaleImage(anyFile(), renderer);

    const [, , contentType] = vi.mocked(renderer.render).mock.calls[0];
    expect(['image/webp', 'image/jpeg', 'image/png']).toContain(contentType);
  });
});
