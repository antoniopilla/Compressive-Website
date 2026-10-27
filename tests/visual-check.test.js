import { describe, expect, it, vi } from 'vitest';
import { looksTheSame, measureSimilarity } from '../src/engine/visual-check.js';
import { IMAGE_POLICY } from '../src/engine/policy.js';

/** RGBA image whose pixels come from `paint(x, y) → [r, g, b, a]`. */
function image(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
}

/** A detailed photo-like texture: smooth shading plus fine deterministic grain. */
const texture = (x, y) => {
  const grain = ((x * 73856093) ^ (y * 19349663)) % 41;
  const shade = 90 + 60 * Math.sin(x / 23) * Math.cos(y / 31);
  return [shade + grain, shade * 0.8 + grain, 120 + grain / 2, 255];
};

/** A copy of `source` with `change(x, y, pixel)` applied to each pixel. */
function altered(source, change) {
  return image(source.width, source.height, (x, y) => {
    const offset = (y * source.width + x) * 4;
    return change(x, y, [...source.data.subarray(offset, offset + 4)]);
  });
}

describe('measureSimilarity', () => {
  const reference = image(256, 192, texture);

  it('scores an identical copy as 1 on every measure', () => {
    expect(measureSimilarity(reference, altered(reference, (x, y, pixel) => pixel))).toEqual({ luma: 1, chroma: 1, worstArea: 1 });
  });

  it('scores lost detail lower than a faithful copy', () => {
    // Replacing the grain with flat shading, as an over-compressed copy would.
    const smoothed = altered(reference, (x, y, [r, g, b, a]) => {
      const flat = texture(x - (x % 8), y - (y % 8));
      return [(r + flat[0]) / 2, (g + flat[1]) / 2, (b + flat[2]) / 2, a];
    });
    const faithful = altered(reference, (x, y, [r, g, b, a]) => [r + 1, g, b - 1, a]);
    const lossy = measureSimilarity(reference, smoothed);
    expect(lossy.luma).toBeLessThan(measureSimilarity(reference, faithful).luma);
    expect(looksTheSame(lossy, IMAGE_POLICY.lookalike)).toBe(false);
    expect(looksTheSame(measureSimilarity(reference, faithful), IMAGE_POLICY.lookalike)).toBe(true);
  });

  it('finds damage confined to one area even when the average stays high', () => {
    const large = image(640, 480, texture);
    const damaged = altered(large, (x, y, pixel) => (x < 32 && y < 32 ? [128, 128, 128, 255] : pixel));
    const similarity = measureSimilarity(large, damaged);
    expect(similarity.luma).toBeGreaterThan(IMAGE_POLICY.lookalike.luma);
    expect(similarity.worstArea).toBeLessThan(IMAGE_POLICY.lookalike.worstArea);
    expect(looksTheSame(similarity, IMAGE_POLICY.lookalike)).toBe(false);
  });

  it('measures colour separately from brightness', () => {
    // Swap red and blue, raising green just enough to keep each pixel's
    // brightness (values stay well inside 0–255, so nothing clips).
    const colourful = image(128, 128, (x, y) => [100 + 40 * Math.sin(x / 5), 128, 150 - 40 * Math.cos(y / 7), 255]);
    const recoloured = altered(colourful, (x, y, [r, g, b, a]) => [b, g + ((0.299 - 0.114) * (r - b)) / 0.587, r, a]);
    const similarity = measureSimilarity(colourful, recoloured);
    expect(similarity.luma).toBeGreaterThan(0.99);
    expect(similarity.chroma).toBeLessThan(IMAGE_POLICY.lookalike.chroma);
  });

  it('ignores colour hidden under full transparency', () => {
    const clear = image(64, 64, (x, y) => [x * 4, y * 4, 200, 0]);
    const different = image(64, 64, () => [0, 255, 0, 0]);
    expect(measureSimilarity(clear, different)).toEqual({ luma: 1, chroma: 1, worstArea: 1 });
  });

  it('handles images smaller than one window', () => {
    const tiny = image(3, 2, (x, y) => [x * 80, y * 120, 40, 255]);
    expect(measureSimilarity(tiny, altered(tiny, (x, y, pixel) => pixel)).luma).toBe(1);
  });

  it('refuses images of different sizes', () => {
    expect(() => measureSimilarity(image(8, 8, texture), image(9, 8, texture))).toThrow(RangeError);
  });

  it('checks for cancellation while it works', () => {
    const throwIfCanceled = vi.fn();
    measureSimilarity(reference, reference, { throwIfCanceled });
    expect(throwIfCanceled).toHaveBeenCalled();
  });
});
