import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { concat, tiffOrientation } from '../tests/fixtures/builders.js';

/**
 * Renders an image in the page with OffscreenCanvas and returns its encoded
 * bytes. Generated in the browser so the test images are real, decodable files.
 */
export async function makeImage(page, { width, height, type = 'image/jpeg', quality = 1, alpha = false, seed = 7 }) {
  const base64 = await page.evaluate(
    async ({ width, height, type, quality, alpha, seed }) => {
      // Some WebKit builds lack OffscreenCanvas; a regular canvas works everywhere.
      const canvas =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement('canvas'), { width, height });
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, alpha ? 'rgba(220, 30, 30, 0.15)' : '#d01e1e');
      gradient.addColorStop(0.5, alpha ? 'rgba(30, 160, 60, 0.6)' : '#1ea03c');
      gradient.addColorStop(1, alpha ? 'rgba(30, 60, 220, 0.95)' : '#1e3cdc');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      let state = seed;
      const random = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
      };
      const blocks = Math.min(4000, Math.round((width * height) / 4000));
      for (let index = 0; index < blocks; index += 1) {
        context.fillStyle = `hsla(${Math.round(random() * 360)}, 70%, 50%, ${alpha ? 0.5 : 1})`;
        context.fillRect(random() * width, random() * height, 4 + random() * 40, 4 + random() * 40);
      }
      const blob =
        typeof canvas.convertToBlob === 'function'
          ? await canvas.convertToBlob({ type, quality })
          : await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    },
    { width, height, type, quality, alpha, seed },
  );
  return Buffer.from(base64, 'base64');
}

/**
 * Encodes a smooth, photo-like test image (soft shading, like a sky or a
 * studio backdrop after a camera's noise reduction) with the same WebAssembly
 * encoders the site uses, run here in Node. Every browser gets identical
 * input, including WebKit, which cannot create WebP files itself.
 *
 * Per-pixel grain is deliberately left out: quality 75 smooths it away, which
 * the visual check rightly counts as a visible change.
 *
 * @param {{ type: 'image/jpeg' | 'image/webp', width: number, height: number, quality: number }} options
 */
export async function encodePhoto({ type, width, height, quality }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shade = Math.sin(x / (width / 3)) * Math.cos(y / (height / 2));
      const ripple = 6 * Math.sin(x / 37 + y / 53);
      data.set([150 + 70 * shade + ripple, 120 + 50 * shade + ripple, 200 - 40 * shade - ripple, 255], (y * width + x) * 4);
    }
  }
  const codec = type === 'image/jpeg' ? { path: 'jpeg/encode.js', wasm: 'jpeg/codec/enc/mozjpeg_enc.wasm' } : { path: 'webp/encode.js', wasm: 'webp/codec/enc/webp_enc_simd.wasm' };
  const root = new URL('../node_modules/@jsquash/', import.meta.url);
  const encoder = await import(new URL(codec.path, root).href);
  await encoder.init(await WebAssembly.compile(await readFile(new URL(codec.wasm, root))));
  return Buffer.from(await encoder.default({ data, width, height }, { quality }));
}

/**
 * Whether this browser's workers have OffscreenCanvas, which image work in the
 * background needs. Checked on a blank page, because the site's CSP rightly
 * blocks the blob: worker used for the check.
 */
export async function workersCanDraw(context) {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      () =>
        new Promise((resolve) => {
          const source = new Blob(['postMessage(typeof OffscreenCanvas === "function")'], { type: 'text/javascript' });
          const worker = new Worker(URL.createObjectURL(source));
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = () => resolve(false);
        }),
    );
  } finally {
    await page.close();
  }
}

/** Inserts an EXIF APP1 segment with the given orientation after the JFIF header. */
export function withExifOrientation(jpeg, orientation) {
  const exif = concat(Uint8Array.from('Exif\0\0', (c) => c.charCodeAt(0)), tiffOrientation(orientation));
  const app1 = concat([0xff, 0xe1, ((exif.length + 2) >> 8) & 0xff, (exif.length + 2) & 0xff], exif);
  let insertAt = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) insertAt = 4 + ((jpeg[4] << 8) | jpeg[5]);
  return Buffer.from(concat(jpeg.subarray(0, insertAt), app1, jpeg.subarray(insertAt)));
}

/** @param {{ name: string, mimeType?: string, buffer: Buffer | Uint8Array }[]} files */
export async function chooseFiles(page, files) {
  await page.getByTestId('file-input').setInputFiles(
    files.map((file) => ({ name: file.name, mimeType: file.mimeType ?? '', buffer: Buffer.from(file.buffer) })),
  );
  await expect(page.locator('text=Checking this file…')).toHaveCount(0, { timeout: 30_000 });
}

export async function prepare(page) {
  await page.getByTestId('prepare-button').click();
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 60_000 });
}

/** Clicks a download control and returns the saved file name and bytes. */
export async function download(page, locator) {
  const [event] = await Promise.all([page.waitForEvent('download'), locator.click()]);
  const path = await event.path();
  return { name: event.suggestedFilename(), bytes: await readFile(path) };
}

export async function startOver(page) {
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByTestId('results')).toHaveCount(0);
}

/** Opens the optional print check if it is folded away. */
export async function openPrintCheck(page) {
  const toggle = page.getByRole('button', { name: /Printing it?/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

export async function setPrintSize(page, width, height) {
  await openPrintCheck(page);
  await page.getByLabel(/^Width/).fill(String(width));
  await page.getByLabel(/^Height/).fill(String(height));
}
