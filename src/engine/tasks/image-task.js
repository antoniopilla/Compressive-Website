/**
 * Smart Image Compressor (runs inside image.worker.js, or on the main thread
 * within the smaller fallback budget).
 *
 * Two paths:
 *
 *  - PNG within the size limits: OxiPNG optimises the original file's bytes
 *    losslessly, without the browser decoding it at all, so every pixel and
 *    the colour and print-size chunks are kept exactly. Metadata is then
 *    removed (png-metadata.js).
 *
 *  - Everything else (JPEG, WebP, and PNG that must be resized): the browser
 *    decodes the image with browser-image-compression 2.0.2's building blocks
 *
 *      drawFileInCanvas → handleMaxWidthOrHeight → (followExifOrientation)
 *
 *    and those pixels are the reference. JPEG (MozJPEG) and WebP (libwebp)
 *    are encoded at each of IMAGE_POLICY.qualities in turn, lowest first; each
 *    result is decoded again by the browser and compared with the reference
 *    (visual-check.js), and the first one that looks the same is used. A
 *    lossless WebP source gets one more, lossless, try. A PNG that was resized
 *    is encoded losslessly from the resized pixels. The library's own encoder
 *    and its quality loop are not used.
 *
 * Library notes (browser-image-compression 2.0.2, pinned):
 *  - Orientation: createImageBitmap applies EXIF orientation in current
 *    browsers; `isAutoOrientationInBrowser()` detects this so it is never
 *    applied twice.
 *  - Browser canvas limits: the library silently downsizes images larger than
 *    its per-browser canvas maximum. That is detected by comparing decoded and
 *    expected dimensions, and the source is kept instead.
 *  - The helpers used are attached to the library's default export in 2.0.2;
 *    tests/image-policy.test.js fails loudly if an upgrade removes them.
 */

import imageCompression from 'browser-image-compression';
import { StudioError, looksLikeOutOfMemory } from '../errors.js';
import { looksTheSame, measureSimilarity } from '../visual-check.js';
import { encodeJpeg, encodePng, encodeWebp, optimisePng } from './codecs.js';
import { stripPngMetadata } from './png-metadata.js';

const insideWorker =
  typeof globalThis.WorkerGlobalScope === 'function' && globalThis instanceof globalThis.WorkerGlobalScope;

/**
 * Throws a fallback-eligible error when this environment cannot decode
 * images the way the library expects.
 */
function assertCanvasSupport() {
  if (!insideWorker) return;
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
    throw new StudioError('worker-canvas-unsupported', 'This browser cannot process images in the background.');
  }
  const probe = new OffscreenCanvas(1, 1);
  if (!probe.getContext('2d')) {
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

/** @param {number} width @param {number} height */
function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

/** @param {OffscreenCanvas | HTMLCanvasElement} canvas */
function readPixels(canvas) {
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Decodes an encoded copy the way the browser will show it.
 *
 * @param {Blob} blob
 * @param {{ width: number, height: number }} expected
 * @param {(canvas: OffscreenCanvas | HTMLCanvasElement) => OffscreenCanvas | HTMLCanvasElement} track
 */
async function decodeCopy(blob, expected, track) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
      throw new StudioError('verification-failed', 'The compressed copy decoded at a different size.');
    }
    const canvas = track(createCanvas(bitmap.width, bitmap.height));
    /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(bitmap, 0, 0);
    return readPixels(canvas);
  } finally {
    bitmap.close();
  }
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
  if (mimeType === 'image/png' && probe.width <= policy.maxWidth && probe.height <= policy.maxHeight) {
    return optimiseOriginalPng(payload, context);
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

    context.onProgress({ phase: 'resizing', fraction: 0.2 });
    const resized = track(imageCompression.handleMaxWidthOrHeight(decoded, { maxWidthOrHeight: policy.maxWidth }));
    const oriented =
      autoOriented || probe.orientation === 1
        ? resized
        : track(imageCompression.followExifOrientation(resized, probe.orientation));
    const wasResized = resized.width !== decoded.width || resized.height !== decoded.height;
    const reference = readPixels(oriented);
    const size = { width: oriented.width, height: oriented.height };
    const shape = { ...size, autoOriented, resized: wasResized };
    context.throwIfCanceled();

    if (mimeType === 'image/png') {
      context.onProgress({ phase: 'encoding', fraction: 0.35 });
      const png = await encodePng(reference, policy.pngLevel);
      return { status: 'encoded', blob: new Blob([png], { type: mimeType }), ...shape, encoding: 'oxipng', quality: null, similarity: null };
    }

    const encoding = mimeType === 'image/jpeg' ? 'mozjpeg' : 'webp';
    /** @type {({ quality: number } | { lossless: true })[]} */
    const settings = policy.qualities.map((quality) => ({ quality }));
    if (probe.format === 'webp' && probe.lossless) settings.push({ lossless: true });

    let tried = null;
    for (const [index, setting] of settings.entries()) {
      const share = 0.3 + (0.65 * index) / settings.length;
      context.onProgress({ phase: 'encoding', fraction: share });
      const bytes = encoding === 'mozjpeg' ? await encodeJpeg(reference, setting.quality) : await encodeWebp(reference, setting);
      context.throwIfCanceled();
      const blob = new Blob([bytes], { type: mimeType });
      const quality = 'quality' in setting ? setting.quality : null;
      // Higher settings only make bigger files. When the pixels were not
      // resized, the original is then the better choice.
      if (!wasResized && blob.size >= file.size) return { status: 'no-saving', ...shape, quality, bytes: blob.size, tried };

      context.onProgress({ phase: 'comparing', fraction: share + 0.65 / settings.length / 2 });
      const copy = await decodeCopy(blob, size, track);
      const similarity = measureSimilarity(reference, copy, context);
      if (looksTheSame(similarity, policy.lookalike)) {
        return {
          status: 'encoded',
          blob,
          ...shape,
          encoding: quality === null ? 'webp-lossless' : encoding,
          quality,
          similarity,
        };
      }
      tried = { quality, similarity };
    }
    return { status: 'looks-different', ...shape, tried };
  } finally {
    for (const canvas of canvases) imageCompression.cleanupCanvasMemory(canvas);
  }
}

/**
 * The lossless PNG path: the original bytes go straight to OxiPNG.
 *
 * @param {ImageTaskPayload} payload
 * @param {import('../worker-protocol.js').TaskContext} context
 */
async function optimiseOriginalPng({ file, probe, policy }, context) {
  context.onProgress({ phase: 'encoding', fraction: 0.1 });
  const original = new Uint8Array(await file.arrayBuffer());
  let optimised;
  try {
    optimised = await optimisePng(original, policy.pngLevel);
  } catch (error) {
    if (error instanceof StudioError || looksLikeOutOfMemory(error)) throw error;
    throw new StudioError('decode-failed', 'This PNG could not be read. It may be damaged.', { cause: error });
  }
  context.throwIfCanceled();
  const { bytes, removed } = stripPngMetadata(optimised);
  return {
    status: 'encoded',
    blob: new Blob([bytes], { type: 'image/png' }),
    width: probe.width,
    height: probe.height,
    autoOriented: true,
    resized: false,
    encoding: 'oxipng-original',
    quality: null,
    similarity: null,
    removedChunks: removed,
  };
}
