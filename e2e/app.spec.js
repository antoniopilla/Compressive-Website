import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { probeRaster } from '../src/engine/inspect/raster-probe.js';
import {
  aiPdfCompatibleBytes,
  encryptedPdf,
  epsBytes,
  noiseBytes,
  pngBytes,
  printPdfBytes,
  psdBytes,
  sha256,
  svgWithMetadata,
} from '../tests/fixtures/builders.js';
import { chooseFiles, download, makeImage, prepare, setPrintSize, startOver, withExifOrientation } from './helpers.js';

const SCREENS = 'test-results/screens';

/** Network requests and console errors seen during the current test. */
let requests = [];
let consoleErrors = [];

/**
 * WebKit styles <select> with an internal user-agent stylesheet that its CSP
 * check reports under a strict `style-src 'self'`, even though the page adds no
 * inline styles. The control renders and works normally (checked by the unit
 * selection in the layout tests), so this single browser message is ignored
 * rather than weakening the policy with 'unsafe-inline'.
 */
const KNOWN_BROWSER_MESSAGES = [
  /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/,
];

/**
 * Every test records network traffic and console errors. Artwork must never be
 * sent anywhere: all requests have to be same-origin GETs for the app's own
 * assets, and no Content-Security-Policy violation caused by the app may occur.
 */
test.beforeEach(async ({ page, baseURL, browserName }) => {
  requests = [];
  consoleErrors = [];
  page.on('request', (request) => requests.push(request));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const known = browserName === 'webkit' && KNOWN_BROWSER_MESSAGES.some((pattern) => pattern.test(message.text()));
    if (!known) consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto(baseURL);
});

test.afterEach(async ({ baseURL }) => {
  const origin = new URL(baseURL).origin;
  for (const request of requests) {
    const url = request.url();
    if (url.startsWith('blob:') || url.startsWith('data:')) continue;
    expect(new URL(url).origin, `request to ${url}`).toBe(origin);
    expect(request.method(), `method for ${url}`).toBe('GET');
    expect(request.postData(), `body for ${url}`).toBeNull();
  }
  expect(consoleErrors).toEqual([]);
});

test('serves the security headers that back the privacy promise', async ({ page, request, baseURL }) => {
  const response = await request.get(baseURL);
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("worker-src 'self'");
  await expect(page.getByText('Your files stay on your device.')).toBeVisible();
});

test('applies a saved theme before the first render', async ({ page, baseURL }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    window.localStorage.setItem('compressive:theme', 'dark');
    // Record the theme at the moment React first puts content on the page,
    // before any effect could run.
    new MutationObserver((_, observer) => {
      if (document.getElementById('root')?.childElementCount) {
        window.__themeAtFirstRender = document.documentElement.dataset.theme ?? 'none';
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(baseURL);
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  expect(await page.evaluate(() => window.__themeAtFirstRender)).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(10, 16, 32)');
});

test('protected vectors download byte-for-byte', async ({ page }) => {
  const fixtures = [
    { name: 'Brand Logo.SVG', mimeType: 'image/svg+xml', buffer: svgWithMetadata() },
    { name: 'BANNER.EPS', mimeType: 'application/postscript', buffer: epsBytes() },
    { name: 'Artwork.ai', mimeType: 'application/pdf', buffer: await aiPdfCompatibleBytes() },
  ];
  for (const fixture of fixtures) {
    await chooseFiles(page, [fixture]);
    await expect(page.getByText('Protected vector', { exact: false }).first()).toBeVisible();
    await prepare(page);
    await expect(page.getByText('Kept exactly', { exact: true })).toBeVisible();
    const saved = await download(page, page.getByTestId('download-primary'));
    expect(saved.name).toBe(fixture.name);
    expect(sha256(saved.bytes)).toBe(sha256(fixture.buffer));
    await startOver(page);
  }
});

test('several files become a verified ZIP of the originals', async ({ page }) => {
  const jpeg = await makeImage(page, { width: 400, height: 300 });
  const files = [
    { name: 'Artwork.ai', mimeType: 'application/pdf', buffer: await aiPdfCompatibleBytes() },
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'Photo.JPG', mimeType: 'image/jpeg', buffer: await makeImage(page, { width: 200, height: 100, seed: 3 }) },
    { name: 'Bannière — été.svg', mimeType: 'image/svg+xml', buffer: svgWithMetadata() },
  ];
  await chooseFiles(page, files);
  await expect(page.getByText('ZIP of originals')).toBeVisible();
  await prepare(page);
  await expect(page.getByText(/All 4 files were extracted/)).toBeVisible();
  const saved = await download(page, page.getByTestId('download-primary'));
  expect(saved.name).toMatch(/^compressive-originals-4-files-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = await JSZip.loadAsync(saved.bytes);
  expect(Object.keys(zip.files).sort()).toEqual(['Artwork.ai', 'Bannière — été.svg', 'Photo (2).JPG', 'photo.jpg'].sort());
  expect(sha256(await zip.file('Artwork.ai').async('uint8array'))).toBe(sha256(files[0].buffer));
  expect(sha256(await zip.file('photo.jpg').async('uint8array'))).toBe(sha256(files[1].buffer));
  expect(sha256(await zip.file('Photo (2).JPG').async('uint8array'))).toBe(sha256(files[2].buffer));
  expect(sha256(await zip.file('Bannière — été.svg').async('uint8array'))).toBe(sha256(files[3].buffer));
  expect(requests.some((request) => /zip\.worker-[\w-]+\.js$/.test(request.url()))).toBe(true);
});

test('compresses a JPEG in a worker, applying camera orientation', async ({ page }) => {
  const jpeg = withExifOrientation(await makeImage(page, { width: 3000, height: 2000, quality: 1 }), 6);
  await chooseFiles(page, [{ name: 'Camera Shot.jpg', mimeType: 'image/jpeg', buffer: jpeg }]);
  await expect(page.getByText('2,000 × 3,000 px').first()).toBeVisible();
  await prepare(page);
  await expect(page.getByText('Compressed', { exact: true })).toBeVisible();
  await expect(page.getByText('The camera orientation was applied to the pixels.')).toBeVisible();
  const saved = await download(page, page.getByTestId('download-primary'));
  expect(saved.name).toBe('Camera Shot-prepared.jpg');
  expect(saved.bytes.length).toBeLessThan(jpeg.length);
  const probe = await probeRaster(new Blob([saved.bytes]), 'jpg');
  expect(probe).toMatchObject({ format: 'jpeg', width: 2000, height: 3000, orientation: 1 });

  const original = await download(page, page.getByTestId('download-original'));
  expect(original.name).toBe('Camera Shot.jpg');
  expect(sha256(original.bytes)).toBe(sha256(jpeg));
  expect(requests.some((request) => /image\.worker-[\w-]+\.js$/.test(request.url()))).toBe(true);
});

test('keeps PNG transparency and colours', async ({ page }) => {
  const png = await makeImage(page, { width: 900, height: 600, type: 'image/png', alpha: true });
  await chooseFiles(page, [{ name: 'overlay.png', mimeType: 'image/png', buffer: png }]);
  await prepare(page);
  const saved = await download(page, page.getByTestId('download-primary'));
  const probe = await probeRaster(new Blob([saved.bytes]), 'png');
  expect(probe).toMatchObject({ width: 900, height: 600, hasAlpha: true });

  const comparison = await page.evaluate(
    async ({ source, output }) => {
      const decode = async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas =
          typeof OffscreenCanvas === 'function'
            ? new OffscreenCanvas(bitmap.width, bitmap.height)
            : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        return canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const a = await decode(source);
      const b = await decode(output);
      // Canvases store premultiplied colour, so semi-transparent pixels lose a
      // little colour precision in every browser. Compare what is visible:
      // colour weighted by opacity (premultiplied), plus exact opacity.
      let maxColour = 0;
      let alphaMismatch = 0;
      for (let index = 0; index < a.length; index += 4) {
        if (a[index + 3] !== b[index + 3]) alphaMismatch += 1;
        const alpha = a[index + 3] / 255;
        for (let channel = 0; channel < 3; channel += 1) {
          maxColour = Math.max(maxColour, Math.abs(a[index + channel] - b[index + channel]) * alpha);
        }
      }
      return { maxColour, alphaMismatch };
    },
    { source: png.toString('base64'), output: saved.bytes.toString('base64') },
  );
  expect(comparison.alphaMismatch).toBe(0);
  expect(comparison.maxColour).toBeLessThanOrEqual(2);
  await startOver(page);

  // A PNG wider than 8000 px must be resized, which forces a re-encode: transparency must survive it.
  const wide = await makeImage(page, { width: 8400, height: 300, type: 'image/png', alpha: true });
  await chooseFiles(page, [{ name: 'wide-overlay.png', mimeType: 'image/png', buffer: wide }]);
  await prepare(page);
  await expect(page.getByText('Compressed', { exact: true })).toBeVisible();
  const resized = await download(page, page.getByTestId('download-primary'));
  expect(await probeRaster(new Blob([resized.bytes]), 'png')).toMatchObject({ width: 8000, height: 285, hasAlpha: true });
  const translucent = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const data = canvas.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] < 250) count += 1;
    return count / (data.length / 4);
  }, resized.bytes.toString('base64'));
  expect(translucent).toBeGreaterThan(0.5);
});

test('keeps animated images unchanged', async ({ page }) => {
  const apng = pngBytes({ width: 64, height: 64, animation: { frames: 3 } });
  await chooseFiles(page, [{ name: 'spinner.png', mimeType: 'image/png', buffer: apng }]);
  await prepare(page);
  await expect(page.getByText('Original kept', { exact: true })).toBeVisible();
  await expect(page.getByText(/animated/).first()).toBeVisible();
  const saved = await download(page, page.getByTestId('download-primary'));
  expect(saved.name).toBe('spinner.png');
  expect(sha256(saved.bytes)).toBe(sha256(apng));
});

test('resolution warnings need acknowledgement and follow the print size', async ({ page }) => {
  const jpeg = await makeImage(page, { width: 3000, height: 2000, quality: 0.95 });
  await chooseFiles(page, [{ name: 'small.jpg', mimeType: 'image/jpeg', buffer: jpeg }]);
  await page.getByRole('button', { name: '8 × 4 ft' }).click();
  await prepare(page);

  const downloadButton = page.getByTestId('download-primary');
  const confirm = page.getByRole('checkbox', { name: /I understand this artwork may print soft/ });
  await expect(page.getByText('Check the resolution before you download')).toBeVisible();
  const results = page.getByTestId('results');
  await expect(results.getByText('Very low resolution · 31 PPI')).toBeVisible();
  await expect(downloadButton).toBeDisabled();
  await confirm.check();
  await expect(downloadButton).toBeEnabled();

  await setPrintSize(page, 6, 4);
  await expect(confirm).not.toBeChecked();
  await expect(downloadButton).toBeDisabled();

  await setPrintSize(page, 1.5, 1);
  await expect(page.getByText('Check the resolution before you download')).toHaveCount(0);
  await expect(results.getByText(/Meets target · 166 PPI/)).toBeVisible();
  await expect(downloadButton).toBeEnabled();

  await setPrintSize(page, 1, 1);
  await expect(results.getByText(/does not match 1 × 1 ft/)).toBeVisible();
});

test('reports a threshold crossing when resizing to 8000 px lowers resolution', async ({ page }) => {
  const wide = await makeImage(page, { width: 9000, height: 2250, quality: 0.9 });
  await chooseFiles(page, [{ name: 'panorama.jpg', mimeType: 'image/jpeg', buffer: wide }]);
  await setPrintSize(page, 5, 1.25);
  await prepare(page);
  await expect(page.getByText(/Resized from 9,000 × 2,250 px to 8,000 × 2,000 px/)).toBeVisible();
  await expect(page.getByText(/lowers resolution from about 150 to about 133 PPI/)).toBeVisible();
  const saved = await download(page, page.getByTestId('download-primary'));
  const probe = await probeRaster(new Blob([saved.bytes]), 'jpg');
  expect([probe.width, probe.height]).toEqual([8000, 2000]);
});

test('tidies a PDF without touching its pages and keeps encrypted PDFs', async ({ page }) => {
  const pdf = await printPdfBytes({ bloatBytes: 300_000 });
  await chooseFiles(page, [{ name: 'Proof.pdf', mimeType: 'application/pdf', buffer: pdf }]);
  await prepare(page);
  await expect(page.getByText('Tidied', { exact: true })).toBeVisible();
  const saved = await download(page, page.getByTestId('download-primary'));
  expect(saved.name).toBe('Proof-prepared.pdf');
  expect(saved.bytes.length).toBeLessThan(pdf.length);
  const [before, after] = await Promise.all([PDFDocument.load(pdf), PDFDocument.load(saved.bytes)]);
  expect(after.getPageCount()).toBe(before.getPageCount());
  expect(after.getPage(0).getTrimBox()).toEqual(before.getPage(0).getTrimBox());
  expect(after.getPage(1).getRotation()).toEqual(before.getPage(1).getRotation());
  expect(requests.some((request) => /pdf\.worker-[\w-]+\.js$/.test(request.url()))).toBe(true);
  await startOver(page);

  const locked = encryptedPdf(await printPdfBytes({ pages: 1 }));
  await chooseFiles(page, [{ name: 'Locked.pdf', mimeType: 'application/pdf', buffer: locked }]);
  await prepare(page);
  await expect(page.getByText(/password-protected or encrypted/)).toBeVisible();
  const kept = await download(page, page.getByTestId('download-primary'));
  expect(kept.name).toBe('Locked.pdf');
  expect(sha256(kept.bytes)).toBe(sha256(locked));
});

test('cancels a running job and can try again', async ({ page }) => {
  const big = (seed) => Buffer.concat([Buffer.from(psdBytes({ width: 100, height: 100, extraBytes: 0 })), Buffer.from(noiseBytes(45_000_000, seed))]);
  // Playwright limits in-memory uploads to 50 MB, so large files go through disk.
  const paths = [];
  for (const [index, name] of ['layers-a.psd', 'layers-b.psd', 'layers-c.psd'].entries()) {
    const path = test.info().outputPath(name);
    await writeFile(path, big(index + 1));
    paths.push(path);
  }
  await page.getByTestId('file-input').setInputFiles(paths);
  await expect(page.locator('text=Checking this file…')).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole('button', { name: /^Prepare/ }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Preparation was canceled.')).toBeVisible();
  await expect(page.getByTestId('results')).toHaveCount(0);
  await expect(page.getByTestId('live-region')).toHaveText('Preparation canceled.');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 90_000 });
});

test('shows actionable errors for unsupported and empty files', async ({ page }) => {
  await chooseFiles(page, [
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByText(/\.txt files are not supported/).first()).toBeVisible();
  await expect(page.getByText(/This file is empty/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Prepare/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove notes.txt' }).click();
  await page.getByRole('button', { name: 'Remove empty.png' }).click();
  await expect(page.getByText('Choose at least one file first.')).toBeVisible();
});

test('drag and drop feeds the same pipeline as the picker', async ({ page }) => {
  const svg = Buffer.from(svgWithMetadata()).toString('base64');
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dropped-logo.svg', { type: 'image/svg+xml' }));
    return transfer;
  }, svg);
  const zone = page.getByTestId('drop-zone');
  await zone.dispatchEvent('dragenter', { dataTransfer });
  await expect(zone).toHaveAttribute('data-active', 'true');
  await zone.dispatchEvent('dragover', { dataTransfer });
  await zone.dispatchEvent('drop', { dataTransfer });
  await expect(page.getByText('dropped-logo.svg')).toBeVisible();
  await expect(page.getByText('Protected vector', { exact: false }).first()).toBeVisible();
  await expect(zone).not.toHaveAttribute('data-active', 'true');
});

test('works with the keyboard alone', async ({ page, browserName }) => {
  // Safari/WebKit's default Tab order skips links (users enable "Press Tab to
  // highlight each item" to include them), so the skip link is checked in the
  // other engines; buttons and fields are reachable with Tab everywhere.
  if (browserName !== 'webkit') {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to the file workspace' })).toBeFocused();
  }
  let reached = false;
  for (let index = 0; index < 20 && !reached; index += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.id === 'choose-files-button');
  }
  expect(reached).toBe(true);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
  await chooser.setFiles({ name: 'logo.eps', mimeType: 'application/postscript', buffer: Buffer.from(epsBytes()) });
  await expect(page.getByText('logo.eps')).toBeVisible();
  const prepareButton = page.getByRole('button', { name: /^Prepare/ });
  await prepareButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('results')).toBeVisible();
  await page.getByTestId('download-primary').focus();
  const [event] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(event.suggestedFilename()).toBe('logo.eps');
});

for (const colorScheme of ['light', 'dark']) {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1366, height: 900 },
  ]) {
    test(`layout has no horizontal overflow at ${viewport.width}px in ${colorScheme} mode`, async ({ page, baseURL }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize(viewport);
      await page.goto(baseURL);
      const longName = `Grand-Opening-Banner-Final-Final-v12-approved-by-marketing-${'x'.repeat(60)}.svg`;
      await chooseFiles(page, [
        { name: longName, mimeType: 'image/svg+xml', buffer: svgWithMetadata() },
        { name: 'poster.psd', buffer: psdBytes({ width: 3000, height: 2000 }) },
      ]);
      await page.getByRole('button', { name: '8 × 4 ft' }).click();
      await page.getByLabel('Unit').selectOption('cm');
      await expect(page.getByLabel(/^Width \(cm\)/)).toHaveValue('243.84');
      await page.getByLabel('Unit').selectOption('ft');
      await prepare(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background).toBe(colorScheme === 'dark' ? 'rgb(10, 16, 32)' : 'rgb(244, 246, 251)');
      await mkdir(SCREENS, { recursive: true });
      await page.screenshot({ path: `${SCREENS}/${colorScheme}-${viewport.width}.png`, fullPage: true });
    });
  }
}
