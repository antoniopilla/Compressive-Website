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
  it('exposes the helpers the decoder relies on', () => {
    expect(imageCompression.version).toBe('2.0.2');
    for (const helper of [
      'drawFileInCanvas',
      'handleMaxWidthOrHeight',
      'followExifOrientation',
      'cleanupCanvasMemory',
      'isAutoOrientationInBrowser',
      'getBrowserName',
    ]) {
      expect(typeof imageCompression[helper], helper).toBe('function');
    }
  });

});

describe('IMAGE_POLICY', () => {
  it('only ever raises quality, starting from its first setting', () => {
    expect(IMAGE_POLICY.qualities).toEqual([...IMAGE_POLICY.qualities].sort((a, b) => a - b));
    expect(IMAGE_POLICY.qualities[0]).toBe(75);
    expect(IMAGE_POLICY.qualities.at(-1)).toBeLessThanOrEqual(100);
  });

  it('needs every similarity score to count as looking the same', () => {
    expect(Object.keys(IMAGE_POLICY.lookalike).sort()).toEqual(['chroma', 'luma', 'worstArea']);
    for (const minimum of Object.values(IMAGE_POLICY.lookalike)) {
      expect(minimum).toBeGreaterThan(0.9);
      expect(minimum).toBeLessThan(1);
    }
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
      method: { label: 'MozJPEG at quality 75', lossless: false, exact: false },
    });
    expect(decision).toMatchObject({ outcome: 'optimized', reasonCode: 'compressed' });
    expect(decision.message).toBe('Compressed with MozJPEG at quality 75, then compared with your original: it looks the same.');
  });

  it('says exactly what a lossless copy kept', () => {
    const exact = decideImageOutcome({
      source,
      encoded: { bytes: 6_000_000, width: 4000, height: 3000, type: 'image/png' },
      expectedType: 'image/png',
      method: { label: 'OxiPNG', lossless: true, exact: true },
    });
    expect(exact.message).toBe('Optimised losslessly with OxiPNG: every pixel is unchanged.');
    const visual = decideImageOutcome({
      source,
      encoded: { bytes: 6_000_000, width: 4000, height: 3000, type: 'image/webp' },
      expectedType: 'image/webp',
      method: { label: 'lossless WebP', lossless: true, exact: false },
    });
    expect(visual.message).toBe('Saved as lossless WebP: nothing visible was changed.');
  });

  it('keeps the source when the browser produced a different format', () => {
    const decision = decideImageOutcome({
      source,
      encoded: { bytes: 1_000, width: 4000, height: 3000, type: 'image/png' },
      expectedType: 'image/webp',
      method: { label: 'WebP at quality 75', lossless: false, exact: false },
    });
    expect(decision).toMatchObject({ outcome: 'kept-original', reasonCode: 'encoder-unsupported' });
    expect(decision.message).toMatch(/cannot create WEBP/);
  });

  it('explains a quality/size conflict instead of lowering quality', () => {
    const decision = decideImageOutcome({
      source: { bytes: 90_000_000, width: 8000, height: 8000 },
      encoded: { bytes: 41_000_000, width: 8000, height: 8000, type: 'image/png' },
      expectedType: 'image/png',
      method: { label: 'OxiPNG', lossless: true, exact: false },
    });
    expect(decision).toMatchObject({ outcome: 'kept-original', reasonCode: 'quality-size-conflict' });
    expect(decision.message).toMatch(/^With OxiPNG the compressed copy is 41 MB/);
    expect(decision.message).toMatch(/never lowered to make a file fit/);
    expect(decision.message).toMatch(/does not meet the output limits/);
    expect(decision.constraints.satisfied).toBe(false);
  });

  it('keeps an already-compliant source when the saving is not worthwhile', () => {
    const decision = decideImageOutcome({
      source,
      encoded: { bytes: 9_950_000, width: 4000, height: 3000, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
      method: { label: 'MozJPEG at quality 75', lossless: false, exact: false },
    });
    expect(decision).toMatchObject({ outcome: 'kept-original', reasonCode: 'no-useful-saving' });
    const larger = decideImageOutcome({
      source,
      encoded: { bytes: 11_000_000, width: 4000, height: 3000, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
      method: { label: 'MozJPEG at quality 75', lossless: false, exact: false },
    });
    expect(larger.reasonCode).toBe('no-useful-saving');
  });

  it('never prefers a non-compliant source just because it is smaller', () => {
    const decision = decideImageOutcome({
      source: { bytes: 3_000_000, width: 9000, height: 3000 },
      encoded: { bytes: 3_500_000, width: 8000, height: 2666, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
      method: { label: 'MozJPEG at quality 75', lossless: false, exact: false },
    });
    expect(decision).toMatchObject({ outcome: 'optimized', reasonCode: 'resized-and-compressed' });
    expect(decision.message).toMatch(/Resized from 9,000 × 3,000 px to 8,000 × 2,666 px/);
    expect(decision.message).toMatch(/compared with the resized image: it looks the same\.$/);
  });

  it('rejects any upscaled output', () => {
    const decision = decideImageOutcome({
      source,
      encoded: { bytes: 1_000_000, width: 4001, height: 3000, type: 'image/jpeg' },
      expectedType: 'image/jpeg',
      method: { label: 'MozJPEG at quality 75', lossless: false, exact: false },
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
