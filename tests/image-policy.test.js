import { describe, expect, it } from 'vitest';
import imageCompression from 'browser-image-compression';
import { decideImageOutcome, evaluateImageConstraints, expectedResize, preflightImage } from '../src/engine/image-policy.js';
import { IMAGE_POLICY } from '../src/engine/policy.js';

const probe = (overrides = {}) => ({
  format: 'jpeg',
  width: 4000,
  height: 3000,
  orientation: 1,
  orientedWidth: 4000,
  orientedHeight: 3000,
  animated: false,
  hasAlpha: false,
  bitDepth: 8,
  colorModel: 'rgb',
  icc: null,
  lossless: null,
  ...overrides,
});

describe('library contract (browser-image-compression 2.0.2)', () => {
  it('exposes the helpers the single-pass encoder relies on', () => {
    expect(imageCompression.version).toBe('2.0.2');
    for (const helper of [
      'drawFileInCanvas',
      'handleMaxWidthOrHeight',
      'followExifOrientation',
      'canvasToFile',
      'cleanupCanvasMemory',
      'isAutoOrientationInBrowser',
      'getBrowserName',
    ]) {
      expect(typeof imageCompression[helper], helper).toBe('function');
    }
  });

  it('documents the binary MB conversion the library would need', () => {
    // browser-image-compression multiplies maxSizeMB by 1,048,576. The product's
    // 40 MB limit is decimal, which would be ≈38.147 in library units.
    expect(IMAGE_POLICY.maxOutputBytes / 1_048_576).toBeCloseTo(38.147, 3);
    expect(IMAGE_POLICY.pngPaletteColors).toBe(3481);
  });
});

describe('preflightImage', () => {
  it('allows ordinary sRGB images', () => {
    expect(preflightImage(probe())).toEqual({ proceed: true });
    expect(preflightImage(probe({ icc: { present: true, isSrgb: true, description: 'sRGB IEC61966-2.1' } }))).toEqual({ proceed: true });
    expect(preflightImage(probe({ orientation: 6 }))).toEqual({ proceed: true });
  });

  it.each([
    ['animated', probe({ format: 'webp', animated: true })],
    ['cmyk', probe({ colorModel: 'cmyk' })],
    ['jpeg-precision', probe({ bitDepth: 12 })],
    ['high-bit-depth', probe({ format: 'png', bitDepth: 16 })],
    ['color-profile', probe({ icc: { present: true, isSrgb: false, description: 'Adobe RGB (1998)' } })],
    ['orientation-metadata', probe({ format: 'png', orientation: 6 })],
  ])('keeps the original for %s images', (reasonCode, input) => {
    const result = preflightImage(input);
    expect(result).toMatchObject({ proceed: false, reasonCode });
    expect(result.message).toMatch(/original is kept unchanged/);
  });
});

describe('evaluateImageConstraints', () => {
  it('checks bytes and both dimensions', () => {
    expect(evaluateImageConstraints({ bytes: 40_000_000, width: 8000, height: 8000 }).satisfied).toBe(true);
    const report = evaluateImageConstraints({ bytes: 40_000_001, width: 8001, height: 10 });
    expect(report.satisfied).toBe(false);
    expect(report.violations.map((violation) => violation.code)).toEqual(['bytes', 'width']);
  });
});

describe('decideImageOutcome', () => {
  const source = { bytes: 10_000_000, width: 4000, height: 3000 };

  it('accepts a worthwhile, compliant prepared copy', () => {
    const decision = decideImageOutcome({
      source,
      encoded: { bytes: 2_000_000, width: 4000, height: 3000, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
    });
    expect(decision).toMatchObject({ outcome: 'optimized', reasonCode: 'compressed' });
    expect(decision.message).toMatch(/visually near-lossless/);
  });

  it('keeps the source when the browser produced a different format', () => {
    const decision = decideImageOutcome({
      source,
      encoded: { bytes: 1_000, width: 4000, height: 3000, type: 'image/png' },
      expectedType: 'image/webp',
    });
    expect(decision).toMatchObject({ outcome: 'kept-original', reasonCode: 'encoder-unsupported' });
    expect(decision.message).toMatch(/cannot create WEBP/);
  });

  it('explains a quality/size conflict instead of lowering quality', () => {
    const decision = decideImageOutcome({
      source: { bytes: 90_000_000, width: 8000, height: 8000 },
      encoded: { bytes: 41_000_000, width: 8000, height: 8000, type: 'image/png' },
      expectedType: 'image/png',
    });
    expect(decision).toMatchObject({ outcome: 'kept-original', reasonCode: 'quality-size-conflict' });
    expect(decision.message).toMatch(/never lowered further/);
    expect(decision.message).toMatch(/does not meet the output limits/);
    expect(decision.constraints.satisfied).toBe(false);
  });

  it('keeps an already-compliant source when the saving is not worthwhile', () => {
    const decision = decideImageOutcome({
      source,
      encoded: { bytes: 9_950_000, width: 4000, height: 3000, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
    });
    expect(decision).toMatchObject({ outcome: 'kept-original', reasonCode: 'no-useful-saving' });
    const larger = decideImageOutcome({
      source,
      encoded: { bytes: 11_000_000, width: 4000, height: 3000, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
    });
    expect(larger.reasonCode).toBe('no-useful-saving');
  });

  it('never prefers a non-compliant source just because it is smaller', () => {
    const decision = decideImageOutcome({
      source: { bytes: 3_000_000, width: 9000, height: 3000 },
      encoded: { bytes: 3_500_000, width: 8000, height: 2666, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
    });
    expect(decision).toMatchObject({ outcome: 'optimized', reasonCode: 'resized-and-compressed' });
    expect(decision.message).toMatch(/Resized from 9,000 × 3,000 px to 8,000 × 2,666 px/);
  });

  it('rejects any upscaled output', () => {
    const decision = decideImageOutcome({
      source,
      encoded: { bytes: 1_000_000, width: 4001, height: 3000, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
    });
    expect(decision.reasonCode).toBe('dimension-check-failed');
  });
});

describe('expectedResize', () => {
  it('caps the longest edge without upscaling and keeps the aspect ratio', () => {
    expect(expectedResize({ width: 9000, height: 3000 }, 8000)).toEqual({ width: 8000, height: 2666 });
    expect(expectedResize({ width: 3000, height: 12000 }, 8000)).toEqual({ width: 2000, height: 8000 });
    expect(expectedResize({ width: 500, height: 400 }, 8000)).toEqual({ width: 500, height: 400 });
  });
});
