import { downscaleImage } from './imageDownscale';
import { createBrowserImageRenderer } from './browserImageRenderer';

/**
 * Everything the profile form needs from the browser to handle an image.
 *
 * Grouped behind one interface and injected, for the same reason the Server
 * Action is: none of it exists in the Node test environment, and a form that
 * cannot be rendered in a test is a form whose states go unverified.
 */
export interface ImagePipeline {
  /** Downscales and re-encodes. Rejects when the file is not a decodable image. */
  process(file: File): Promise<File>;
  /**
   * Writes a processed file back into the input the form submits.
   *
   * The form cannot simply submit what the owner picked: that is the original
   * multi-megabyte photograph, and keeping the Server Action body limit at its
   * default is the whole point of the downscale (design D2).
   */
  attach(input: HTMLInputElement, file: File): void;
  previewUrl(file: File): string;
  revokePreview(url: string): void;
}

export function createBrowserImagePipeline(): ImagePipeline {
  const renderer = createBrowserImageRenderer();

  return {
    process: (file) => downscaleImage(file, renderer),

    attach(input, file) {
      // `input.files` is only assignable from a FileList, and `DataTransfer` is
      // the only way to build one. Availability is not checked: every browser
      // that can decode an image to a canvas has it, and a silent fallback to
      // the original file would send the multi-megabyte version the framework
      // then rejects — a failure with no message anywhere.
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    },

    previewUrl: (file) => URL.createObjectURL(file),
    revokePreview: (url) => URL.revokeObjectURL(url),
  };
}
