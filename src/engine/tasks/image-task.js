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
 *    (in a Safari worker, createImageBitmap takes drawFileInCanvas's place;
 *    see libraryDecodesWithImg)
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
import { nextQuality } from '../image-policy.js';
import { looksTheSame, measureSimilarity } from '../visual-check.js';
import { encodeJpeg, encodePng, encodeWebp, optimisePng } from './codecs.js';
import { stripPngMetadata } from './png-metadata.js';

const insideWorker =
  typeof globalThis.WorkerGlobalScope === 'function' && globalThis instanceof globalThis.WorkerGlobalScope;

/**
 * Throws a fallback-eligible error when this worker cannot decode and draw
 * images (no OffscreenCanvas or createImageBitmap, as in Safari before 16.4).
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
}

/**
 * Whether browser-image-compression would decode through <img>: it skips
 * createImageBitmap on Safari (iOS and desktop). <img> does not exist in
 * workers, so there this task decodes with createImageBitmap itself, and the
 * work stays off the page instead of freezing it.
 */
function libraryDecodesWithImg() {
  let browser = 'ETC';
  try {
    browser = imageCompression.getBrowserName();
  } catch {
    // getBrowserName touches `document` for unknown browsers; treat as generic.
  }
  return browser === 'IOS' || browser === 'DESKTOP_SAFARI';
}

/** @param {Blob} file */
async function decodeWithBitmap(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = createCanvas(bitmap.width, bitmap.height);
    /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * A 2 × 1 JPEG tagged with EXIF orientation 6 (rotate 90°), the same probe the
 * library's isAutoOrientationInBrowser uses. Decoding it the way the image is
 * decoded shows whether createImageBitmap already applies orientation, so it
 * is never applied twice, or not at all.
 */
const ORIENTATION_PROBE = '/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAgMBEQACEQEDEQH/xABKAAEAAAAAAAAAAAAAAAAAAAALEAEAAAAAAAAAAAAAAAAAAAAAAQEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8H//2Q==';
let bitmapOrientation = null;
function bitmapAppliesOrientation() {
  bitmapOrientation ??= (async () => {
    const bytes = Uint8Array.from(atob(ORIENTATION_PROBE), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const rotated = bitmap.width === 1 && bitmap.height === 2;
    bitmap.close();
    return rotated;
  })();
  return bitmapOrientation;
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
 * True when every byte is zero, which is what a canvas returns when the
 * browser failed to draw into it (for example, past a device's canvas limit).
 * A blank reference would pass any comparison, so it must never be encoded.
 *
 * @param {ImageData} pixels
 */
function isBlank(pixels) {
  const words = new Uint32Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength / 4);
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== 0) return false;
  }
  return true;
}

/**
 * Decodes an encoded copy the way the browser will show it. The bitmap and the
 * canvas are released as soon as the pixels are out, so trying several
 * qualities never holds more than one decoded copy at a time.
 *
 * @param {Blob} blob
 * @param {{ width: number, height: number }} expected
 */
async function decodeCopy(blob, expected) {
  const bitmap = await createImageBitmap(blob);
  let canvas = null;
  try {
    if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
      throw new StudioError('verification-failed', 'The compressed copy decoded at a different size.');
    }
    canvas = createCanvas(bitmap.width, bitmap.height);
    /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(bitmap, 0, 0);
    bitmap.close();
    return readPixels(canvas);
  } finally {
    bitmap.close();
    if (canvas) imageCompression.cleanupCanvasMemory(canvas);
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
    const ownDecode = insideWorker && libraryDecodesWithImg();
    let decoded;
    try {
      if (ownDecode) {
        decoded = track(await decodeWithBitmap(file));
      } else {
        const [image, canvas] = await imageCompression.drawFileInCanvas(file, { fileType: mimeType });
        if (image && typeof image.close === 'function') image.close(); // release the ImageBitmap promptly
        decoded = track(canvas);
      }
    } catch (error) {
      if (looksLikeOutOfMemory(error)) throw error;
      throw new StudioError('decode-failed', 'This image could not be decoded. It may be damaged or use a feature browsers do not support.', {
        cause: error,
      });
    }
    context.throwIfCanceled();

    const autoOriented = ownDecode ? await bitmapAppliesOrientation() : await imageCompression.isAutoOrientationInBrowser();
    const expected = autoOriented
      ? { width: probe.orientedWidth, height: probe.orientedHeight }
      : { width: probe.width, height: probe.height };
    if (decoded.width !== expected.width || decoded.height !== expected.height) {
      return { status: 'canvas-limited', decodedWidth: decoded.width, decodedHeight: decoded.height };
    }

    context.onProgress({ phase: 'resizing', fraction: 0.2 });
    const resized = track(imageCompression.handleMaxWidthOrHeight(decoded, { maxWidthOrHeight: policy.maxWidth }));
    // The library returns the same canvas when no resize was needed, and
    // empties every canvas it replaces, so compare canvases, not their sizes.
    const wasResized = resized !== decoded;
    const oriented =
      autoOriented || probe.orientation === 1
        ? resized
        : track(imageCompression.followExifOrientation(resized, probe.orientation));
    const reference = readPixels(oriented);
    const size = { width: oriented.width, height: oriented.height };
    const shape = { ...size, autoOriented, resized: wasResized };
    // Only the pixels are needed from here on: free the canvas now rather than
    // holding a second full-size copy through every quality tried.
    imageCompression.cleanupCanvasMemory(oriented);
    if (isBlank(reference)) {
      throw new StudioError('decode-failed', 'The browser returned a blank image while reading this file, so it was not compressed.');
    }
    context.throwIfCanceled();

    if (mimeType === 'image/png') {
      context.onProgress({ phase: 'encoding', fraction: 0.35 });
      const png = await encodePng(reference, policy.pngLevel);
      return { status: 'encoded', blob: new Blob([png], { type: mimeType }), ...shape, encoding: 'oxipng', quality: null, similarity: null };
    }

    const encoding = mimeType === 'image/jpeg' ? 'mozjpeg' : 'webp';
    const losslessSource = probe.format === 'webp' && probe.lossless;
    const attempts = policy.qualities.length + (losslessSource ? 1 : 0);
    let attempt = 0;
    /**
     * Encodes once and runs the visual check. `similarity` is null when the
     * copy is no smaller than the original and the image was not resized: a
     * higher setting would only be bigger, so the original is the better choice.
     *
     * @param {{ quality: number } | { lossless: true }} setting
     */
    const tryEncoding = async (setting) => {
      const share = 0.3 + (0.65 * attempt) / attempts;
      attempt += 1;
      context.onProgress({ phase: 'encoding', fraction: share });
      const bytes = encoding === 'mozjpeg' ? await encodeJpeg(reference, setting.quality) : await encodeWebp(reference, setting);
      context.throwIfCanceled();
      const blob = new Blob([bytes], { type: mimeType });
      if (!wasResized && blob.size >= file.size) return { blob, similarity: null };
      context.onProgress({ phase: 'comparing', fraction: share + 0.65 / attempts / 2 });
      return { blob, similarity: measureSimilarity(reference, await decodeCopy(blob, size), context) };
    };

    let tried = null;
    let outcome = { status: 'looks-different' };
    for (let index = 0; ; ) {
      const quality = policy.qualities[index];
      const { blob, similarity } = await tryEncoding({ quality });
      if (!similarity) {
        outcome = { status: 'no-saving', quality };
        break;
      }
      if (looksTheSame(similarity, policy.lookalike)) return { status: 'encoded', blob, ...shape, encoding, quality, similarity };
      tried = { quality, similarity };
      const step = nextQuality({ index, similarity, bytes: blob.size, sourceBytes: file.size, resized: wasResized, encoding, policy });
      if ('next' in step) {
        index = step.next;
        continue;
      }
      if (step.stop === 'no-saving') outcome = { status: 'no-saving', quality: step.quality };
      break;
    }
    // A lossless WebP source gets one more, lossless, try.
    if (losslessSource) {
      const { blob, similarity } = await tryEncoding({ lossless: true });
      if (similarity && looksTheSame(similarity, policy.lookalike)) {
        return { status: 'encoded', blob, ...shape, encoding: 'webp-lossless', quality: null, similarity };
      }
    }
    return { ...outcome, ...shape, tried };
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
