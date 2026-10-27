/**
 * Smart Image Compressor (runs inside image.worker.js, or on the main thread
 * within the smaller fallback budget).
 *
 * Library usage (browser-image-compression 2.0.2, pinned):
 * The package's top-level `imageCompression()` iterates when the first encode
 * is over `maxSizeMB` or larger than the source: each pass multiplies quality
 * by 0.95 (JPEG/WebP) or 0.85 (PNG colour budget) and, when over the size
 * limit, also shrinks both dimensions by 5%. Its `maxSizeMB` is binary
 * (×1,048,576), so 40 MB would be 40,000,000 / 1,048,576 ≈ 38.147 there.
 * Those silent reductions conflict with this product's quality policy, so this
 * task calls the library's exported building blocks directly and performs
 * exactly one encode at quality 0.85:
 *
 *   drawFileInCanvas → handleMaxWidthOrHeight → (followExifOrientation) → canvasToFile
 *
 * The 40,000,000-byte limit is then enforced in decimal bytes by
 * image-policy.js. All these helpers are attached to the library's default
 * export in 2.0.2; tests/contract fail loudly if an upgrade removes them.
 *
 * Codec notes:
 *  - JPEG/WebP: canvas `convertToBlob({ type, quality: 0.85 })`.
 *  - PNG: the library encodes with UPNG using a colour budget of 4096 × quality.
 *    The budget (3481 colours) is used only when the image has no more colours
 *    than that, so quantisation is exact; otherwise quality 0 selects UPNG's
 *    lossless mode. Transparency is preserved either way (no white fill —
 *    the library only fills white for JPEG output).
 *  - Orientation: createImageBitmap applies EXIF orientation in current
 *    browsers; `isAutoOrientationInBrowser()` detects this so it is never
 *    applied twice.
 *  - Browser canvas limits: the library silently downsizes images larger than
 *    its per-browser canvas maximum. That is detected by comparing decoded and
 *    expected dimensions, and the source is kept instead.
 */

import imageCompression from 'browser-image-compression';
import { StudioError, looksLikeOutOfMemory } from '../errors.js';

const insideWorker =
  typeof globalThis.WorkerGlobalScope === 'function' && globalThis instanceof globalThis.WorkerGlobalScope;

/**
 * Throws a fallback-eligible error when this environment cannot decode or
 * encode images the way the library expects.
 */
function assertCanvasSupport() {
  if (!insideWorker) return;
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
    throw new StudioError('worker-canvas-unsupported', 'This browser cannot process images in the background.');
  }
  const probe = new OffscreenCanvas(1, 1);
  if (!probe.getContext('2d') || typeof probe.convertToBlob !== 'function') {
    throw new StudioError('worker-canvas-unsupported', 'This browser cannot process images in the background.');
  }
  let browser = 'ETC';
  try {
    browser = imageCompression.getBrowserName();
  } catch {
    // getBrowserName touches `document` for unknown browsers; treat as generic.
  }
  // The library skips createImageBitmap on Safari and decodes through <img>,
  // which does not exist inside workers.
  if (browser === 'IOS' || browser === 'DESKTOP_SAFARI') {
    throw new StudioError('worker-decode-unsupported', 'This browser decodes images on the page rather than in the background.');
  }
}

/**
 * Counts distinct RGBA values, stopping as soon as `limit` is exceeded. Reads
 * the canvas in horizontal strips (~16 MB each) to bound memory.
 *
 * @param {OffscreenCanvas | HTMLCanvasElement} canvas
 * @param {number} limit
 */
export function countColorsUpTo(canvas, limit) {
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const seen = new Set();
  const stripRows = Math.max(1, Math.floor(4_000_000 / canvas.width));
  for (let y = 0; y < canvas.height; y += stripRows) {
    const rows = Math.min(stripRows, canvas.height - y);
    const { data } = context.getImageData(0, y, canvas.width, rows);
    const pixels = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    let previous = -1;
    for (let index = 0; index < pixels.length; index += 1) {
      const pixel = pixels[index];
      if (pixel === previous) continue;
      previous = pixel;
      if (!seen.has(pixel)) {
        seen.add(pixel);
        if (seen.size > limit) return seen.size;
      }
    }
  }
  return seen.size;
}

/**
 * @typedef {object} ImageTaskPayload
 * @property {File} file
 * @property {string} mimeType   Output MIME type (same format as the source).
 * @property {import('../inspect/raster-probe.js').RasterProbe} probe
 * @property {typeof import('../policy.js').IMAGE_POLICY} policy
 */

/**
 * @param {ImageTaskPayload} payload
 * @param {import('../worker-protocol.js').TaskContext} context
 */
export async function compressImage(payload, context) {
  const { file, mimeType, probe, policy } = payload;
  if (policy.maxWidth !== policy.maxHeight) {
    // handleMaxWidthOrHeight takes a single longest-edge limit.
    throw new StudioError('policy-unsupported', 'Width and height limits must be equal for this encoder.');
  }
  assertCanvasSupport();

  /** @type {Set<OffscreenCanvas | HTMLCanvasElement>} */
  const canvases = new Set();
  const track = (canvas) => {
    canvases.add(canvas);
    return canvas;
  };

  try {
    context.onProgress({ phase: 'decoding', fraction: 0.05 });
    let decoded;
    try {
      const [image, canvas] = await imageCompression.drawFileInCanvas(file, { fileType: mimeType });
      if (image && typeof image.close === 'function') image.close(); // release the ImageBitmap promptly
      decoded = track(canvas);
    } catch (error) {
      if (looksLikeOutOfMemory(error)) throw error;
      throw new StudioError('decode-failed', 'This image could not be decoded. It may be damaged or use a feature browsers do not support.', {
        cause: error,
      });
    }
    context.throwIfCanceled();

    const autoOriented = await imageCompression.isAutoOrientationInBrowser();
    const expected = autoOriented
      ? { width: probe.orientedWidth, height: probe.orientedHeight }
      : { width: probe.width, height: probe.height };
    if (decoded.width !== expected.width || decoded.height !== expected.height) {
      return { status: 'canvas-limited', decodedWidth: decoded.width, decodedHeight: decoded.height };
    }

    context.onProgress({ phase: 'resizing', fraction: 0.3 });
    const resized = track(imageCompression.handleMaxWidthOrHeight(decoded, { maxWidthOrHeight: policy.maxWidth }));
    const oriented =
      autoOriented || probe.orientation === 1
        ? resized
        : track(imageCompression.followExifOrientation(resized, probe.orientation));
    context.throwIfCanceled();

    let quality = policy.quality;
    let encoding = mimeType === 'image/jpeg' ? 'jpeg' : 'webp';
    let colorCount = null;
    if (mimeType === 'image/png') {
      context.onProgress({ phase: 'analyzing', fraction: 0.4 });
      colorCount = countColorsUpTo(oriented, policy.pngPaletteColors);
      if (colorCount <= policy.pngPaletteColors) {
        encoding = 'png-palette';
      } else {
        quality = 0; // UPNG colour budget 0 = lossless
        encoding = 'png-lossless';
      }
      context.throwIfCanceled();
    }

    context.onProgress({ phase: 'encoding', fraction: 0.55 });
    const blob = await imageCompression.canvasToFile(oriented, mimeType, file.name, file.lastModified, quality);
    context.onProgress({ phase: 'encoding', fraction: 0.95 });
    return {
      status: 'encoded',
      blob: blob instanceof Blob ? blob : new Blob([blob], { type: mimeType }),
      width: oriented.width,
      height: oriented.height,
      quality,
      encoding,
      colorCount: colorCount !== null && colorCount <= policy.pngPaletteColors ? colorCount : null,
      autoOriented,
    };
  } finally {
    for (const canvas of canvases) imageCompression.cleanupCanvasMemory(canvas);
  }
}
