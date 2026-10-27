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
  await page.getByRole('button', { name: /^Prepare/ }).click();
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

export async function setPrintSize(page, width, height) {
  await page.getByLabel(/^Width/).fill(String(width));
  await page.getByLabel(/^Height/).fill(String(height));
}
