/**
 * WebAssembly image encoders, each loaded on first use from this site's own
 * files (the CSP allows WebAssembly with 'wasm-unsafe-eval' and nothing else):
 *
 *  - MozJPEG via @jsquash/jpeg 1.6.0 and libwebp via @jsquash/webp 1.5.0,
 *    both repackaged from Google's Squoosh (Apache-2.0; MozJPEG IJG/BSD,
 *    libwebp BSD). The WebP package picks its SIMD build when the browser has
 *    WebAssembly SIMD.
 *  - OxiPNG via @jsquash/oxipng 2.3.0 (Apache-2.0; OxiPNG MIT). Its
 *    single-threaded build is imported directly: the package's threaded build
 *    needs cross-origin isolation, which this site does not enable, so it
 *    would never be chosen and only adds a nested worker to the bundle.
 *
 * Each encoder is warmed up with a 1 × 1 image the first time it is needed.
 * If that fails, WebAssembly cannot run here (an older browser, or a blocked
 * download), which is reported as `encoder-unavailable` rather than as a
 * problem with the visitor's file.
 */

import { StudioError } from '../errors.js';

const ONE_PIXEL = Object.freeze({ data: new Uint8ClampedArray([255, 255, 255, 255]), width: 1, height: 1 });

/** Memoises a loader; a failed load is reported once and retried next time. */
function lazily(load) {
  let ready = null;
  return () => {
    ready ??= load().catch((error) => {
      ready = null;
      throw new StudioError(
        'encoder-unavailable',
        'This browser cannot run the image encoder. Try a recent version of Chrome, Edge, Firefox or Safari.',
        { cause: error },
      );
    });
    return ready;
  };
}

const loadJpeg = lazily(async () => {
  const { default: encode } = await import('@jsquash/jpeg/encode.js');
  await encode(ONE_PIXEL);
  return encode;
});

const loadWebp = lazily(async () => {
  const { default: encode } = await import('@jsquash/webp/encode.js');
  await encode(ONE_PIXEL);
  return encode;
});

const loadOxipng = lazily(async () => {
  const oxipng = await import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js');
  await oxipng.default();
  return oxipng;
});

/**
 * @typedef {{ data: Uint8ClampedArray, width: number, height: number }} Pixels
 */

/**
 * MozJPEG with Squoosh's defaults (progressive, optimised Huffman tables);
 * quality 90 and up keeps full colour resolution.
 *
 * @param {Pixels} pixels
 * @param {number} quality  0–100.
 */
export async function encodeJpeg(pixels, quality) {
  const encode = await loadJpeg();
  return new Uint8Array(await encode(pixels, { quality }));
}

/**
 * libwebp, lossy at `quality`, or lossless (transparent pixels may change
 * colour, which cannot be seen).
 *
 * @param {Pixels} pixels
 * @param {{ quality: number } | { lossless: true }} setting
 */
export async function encodeWebp(pixels, setting) {
  const encode = await loadWebp();
  const options = 'lossless' in setting ? { lossless: 1 } : { quality: setting.quality };
  return new Uint8Array(await encode(pixels, options));
}

/**
 * Lossless PNG optimisation of an existing PNG file. Every chunk is copied
 * through; see png-metadata.js for removing metadata afterwards.
 *
 * @param {Uint8Array} png
 * @param {number} level  0–6.
 */
export async function optimisePng(png, level) {
  const oxipng = await loadOxipng();
  return oxipng.optimise(png, level, false, false);
}

/**
 * Lossless PNG from raw RGBA pixels.
 *
 * @param {Pixels} pixels
 * @param {number} level  0–6.
 */
export async function encodePng(pixels, level) {
  const oxipng = await loadOxipng();
  return oxipng.optimise_raw(pixels.data, pixels.width, pixels.height, level, false, false);
}
