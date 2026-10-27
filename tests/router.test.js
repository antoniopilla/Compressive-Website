import { describe, expect, it } from 'vitest';
import { categorize, planRoute, ROUTES } from '../src/engine/router.js';
import { inspectFile } from '../src/engine/validation.js';
import { LIMITS } from '../src/engine/policy.js';
import {
  aiPdfCompatibleBytes,
  epsBytes,
  jpegHeaderBytes,
  makeFile,
  pngBytes,
  printPdfBytes,
  psdBytes,
  svgWithMetadata,
  concat,
} from './fixtures/builders.js';

const inspectAll = (files) => Promise.all(files.map((file, index) => inspectFile(file, `f${index}`)));
const routeOf = async (files) => planRoute(await inspectAll(files));

describe('categorize', () => {
  it('checks the protected vector whitelist first', () => {
    expect(categorize('ai')).toBe('vector');
    expect(categorize('eps')).toBe('vector');
    expect(categorize('svg')).toBe('vector');
    expect(categorize('psd')).toBe('psd');
    expect(categorize('jpg')).toBe('raster');
    expect(categorize('jpeg')).toBe('raster');
    expect(categorize('png')).toBe('raster');
    expect(categorize('webp')).toBe('raster');
    expect(categorize('pdf')).toBe('pdf');
    expect(categorize('gif')).toBeNull();
    expect(categorize('')).toBeNull();
  });
});

describe('planRoute', () => {
  it('is idle for an empty selection', () => {
    expect(planRoute([]).route).toBe(ROUTES.IDLE);
  });

  it('routes a single protected vector to pass-through regardless of extension case', async () => {
    expect((await routeOf([makeFile(svgWithMetadata(), 'Logo.SVG')])).route).toBe(ROUTES.PROTECTED_PASSTHROUGH);
    expect((await routeOf([makeFile(epsBytes(), 'BANNER.EPS', 'application/postscript')])).route).toBe(
      ROUTES.PROTECTED_PASSTHROUGH,
    );
  });

  it('keeps a PDF-compatible Illustrator file protected even when its MIME type says PDF', async () => {
    const ai = makeFile(await aiPdfCompatibleBytes(), 'Artwork.Ai', 'application/pdf');
    const [entry] = await inspectAll([ai]);
    expect(entry.validation.ok).toBe(true);
    expect(entry.category).toBe('vector');
    expect(planRoute([entry]).route).toBe(ROUTES.PROTECTED_PASSTHROUGH);
  });

  it('routes single images, PDFs and PSDs to their strategies', async () => {
    expect((await routeOf([makeFile(pngBytes({ width: 4, height: 4 }), 'a.PNG', 'image/png')])).route).toBe(ROUTES.IMAGE_COMPRESS);
    expect((await routeOf([makeFile(jpegHeaderBytes({ width: 40, height: 20 }), 'photo.JPEG')])).route).toBe(ROUTES.IMAGE_COMPRESS);
    expect((await routeOf([makeFile(await printPdfBytes({ pages: 1 }), 'doc.Pdf')])).route).toBe(ROUTES.PDF_REWRITE);
    expect((await routeOf([makeFile(psdBytes({ width: 100, height: 50 }), 'layered.psd', '')])).route).toBe(ROUTES.PSD_PASSTHROUGH);
  });

  it('packages two or more supported files as a ZIP of originals', async () => {
    const plan = await routeOf([
      makeFile(svgWithMetadata(), 'logo.svg', 'image/svg+xml'),
      makeFile(pngBytes({ width: 4, height: 4 }), 'photo.png', 'image/png'),
      makeFile(await printPdfBytes({ pages: 1 }), 'proof.pdf', 'application/pdf'),
    ]);
    expect(plan.route).toBe(ROUTES.ZIP_ORIGINALS);
    expect(plan.totals.files).toBe(3);
  });

  it('rejects the whole selection when any file is unsupported', async () => {
    const plan = await routeOf([
      makeFile(svgWithMetadata(), 'logo.svg'),
      makeFile(new Uint8Array([1, 2, 3]), 'notes.txt', 'text/plain'),
    ]);
    expect(plan.route).toBe(ROUTES.INVALID);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].code).toBe('unsupported-extension');
  });

  it('keeps a single image larger than 40 MB eligible for compression within the safe input budget', async () => {
    const header = pngBytes({ width: 4000, height: 3000, colorType: 2, pixel: () => [0, 0, 0] });
    const padded = concat(header, new Uint8Array(45_000_000 - header.length));
    const [entry] = await inspectAll([makeFile(padded, 'large-photo.png', 'image/png')]);
    expect(entry.size).toBeGreaterThan(40_000_000);
    expect(planRoute([entry]).route).toBe(ROUTES.IMAGE_COMPRESS);
  });

  it('applies the lower pixel budget to PNG, which needs more working memory', async () => {
    const [png] = await inspectAll([makeFile(pngBytes({ width: 4, height: 4 }), 'big.png', 'image/png')]);
    const [jpeg] = await inspectAll([makeFile(jpegHeaderBytes({ width: 8000, height: 6000 }), 'big.jpg', 'image/jpeg')]);
    const pngAt48mp = { ...png, probe: { ...png.probe, orientedWidth: 8000, orientedHeight: 6000 } };
    const plan = planRoute([pngAt48mp]);
    expect(plan.route).toBe(ROUTES.INVALID);
    expect(plan.errors[0]).toMatchObject({ code: 'image-too-many-pixels' });
    expect(plan.errors[0].message).toMatch(/PNG images up to 40 megapixels/);
    expect(planRoute([jpeg]).route).toBe(ROUTES.IMAGE_COMPRESS);
    expect(LIMITS.maxPngSourcePixels).toBeLessThan(LIMITS.maxRasterSourcePixels);
  });

  it('rejects a single image above the safe input budget or pixel budget with an actionable message', async () => {
    const tooManyPixels = await inspectAll([makeFile(jpegHeaderBytes({ width: 12000, height: 9000 }), 'huge.jpg', 'image/jpeg')]);
    const plan = planRoute(tooManyPixels);
    expect(plan.route).toBe(ROUTES.INVALID);
    expect(plan.errors[0].code).toBe('image-too-many-pixels');
    expect(plan.errors[0].message).toMatch(/ZIP/);

    const fakeEntry = { ...tooManyPixels[0], size: LIMITS.maxRasterInputBytes + 1, probe: { orientedWidth: 10, orientedHeight: 10 } };
    expect(planRoute([fakeEntry]).errors[0].code).toBe('image-too-large');
  });

  it('enforces file-count and ZIP batch budgets', async () => {
    const [entry] = await inspectAll([makeFile(svgWithMetadata(), 'logo.svg')]);
    const many = Array.from({ length: LIMITS.maxFiles + 1 }, (_, index) => ({ ...entry, id: `f${index}` }));
    expect(planRoute(many).errors[0].code).toBe('too-many-files');

    const heavy = [
      { ...entry, id: 'a', size: LIMITS.maxZipInputBytes },
      { ...entry, id: 'b', size: 1 },
    ];
    expect(planRoute(heavy).errors[0].code).toBe('batch-too-large');
  });

  it('rejects oversized single PDFs', async () => {
    const [entry] = await inspectAll([makeFile(await printPdfBytes({ pages: 1 }), 'doc.pdf')]);
    expect(planRoute([{ ...entry, size: LIMITS.maxPdfInputBytes + 1 }]).errors[0].code).toBe('pdf-too-large');
  });
});
