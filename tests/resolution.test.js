import { describe, expect, it } from 'vitest';
import {
  assessDimensions,
  classifyPpi,
  compareAspect,
  compareAssessments,
  computePpi,
  HEALTH,
} from '../src/engine/resolution.js';
import { fromInches, resolvePrintSize, toInches } from '../src/engine/units.js';
import { formatPpi } from '../src/engine/format.js';

describe('unit conversion', () => {
  it('converts every supported unit to inches and back', () => {
    expect(toInches(10, 'ft')).toBe(120);
    expect(toInches(36, 'in')).toBe(36);
    expect(toInches(2.54, 'cm')).toBeCloseTo(1, 10);
    expect(toInches(25.4, 'mm')).toBeCloseTo(1, 10);
    expect(toInches(1, 'm')).toBeCloseTo(39.3700787, 6);
    for (const unit of ['ft', 'in', 'cm', 'mm', 'm']) expect(fromInches(toInches(7.5, unit), unit)).toBeCloseTo(7.5, 10);
  });

  it('validates print sizes', () => {
    expect(resolvePrintSize({ width: '', height: 4, unit: 'ft' }).complete).toBe(false);
    expect(resolvePrintSize({ width: -1, height: 4, unit: 'ft' }).errors[0]).toMatch(/width greater than zero/);
    expect(resolvePrintSize({ width: 2000, height: 4, unit: 'ft' }).errors[0]).toMatch(/larger than/);
    expect(resolvePrintSize({ width: '10', height: '4', unit: 'ft' })).toMatchObject({ complete: true, widthIn: 120, heightIn: 48 });
  });
});

describe('PPI calculation', () => {
  it('uses feet × 12 and the smaller axis as effective PPI', () => {
    const resolved = resolvePrintSize({ width: 10, height: 4, unit: 'ft' });
    const ppi = computePpi({ width: 18_000, height: 6_000 }, resolved);
    expect(ppi.ppiX).toBe(150);
    expect(ppi.ppiY).toBe(125);
    expect(ppi.effectivePpi).toBe(125);
  });

  it('classifies against the configurable thresholds at their boundaries', () => {
    expect(classifyPpi(150)).toBe(HEALTH.MEETS_TARGET);
    expect(classifyPpi(149.99)).toBe(HEALTH.BELOW_TARGET);
    expect(classifyPpi(100)).toBe(HEALTH.BELOW_TARGET);
    expect(classifyPpi(99.99)).toBe(HEALTH.WARNING);
    expect(classifyPpi(72)).toBe(HEALTH.WARNING);
    expect(classifyPpi(71.99)).toBe(HEALTH.CRITICAL);
    expect(classifyPpi(80, { targetPpi: 80, warningBelowPpi: 40, criticalBelowPpi: 20, aspectTolerance: 0.02 })).toBe(HEALTH.MEETS_TARGET);
  });

  it('changes the assessment when print dimensions change', () => {
    const pixels = { width: 3000, height: 2000 };
    const small = assessDimensions(pixels, { width: 1.5, height: 1, unit: 'ft' });
    const large = assessDimensions(pixels, { width: 8, height: 4, unit: 'ft' });
    expect(small.status).toBe(HEALTH.MEETS_TARGET);
    expect(small.effectivePpi).toBeCloseTo(166.67, 1);
    expect(large.status).toBe(HEALTH.CRITICAL);
    expect(large.effectivePpi).toBeCloseTo(31.25, 2);
    expect(large.message).toMatch(/8 × 4 ft/);
    expect(large.message).toMatch(/14,400 × 7,200 px/);
    expect(large.pixelsForTarget).toEqual({ width: 14_400, height: 7_200 });
    expect(large.maxPrintAtTarget.width).toBeCloseTo(1.6667, 3);
  });

  it('never displays a number that contradicts the status near a threshold', () => {
    // 1496 px across 10 in = 149.6 PPI: below target, so it must not read "150".
    const justBelow = assessDimensions({ width: 1496, height: 1496 }, { width: 10, height: 10, unit: 'in' });
    expect(justBelow.status).toBe(HEALTH.BELOW_TARGET);
    expect(justBelow.message).toMatch(/^About 149 PPI/);
    expect(formatPpi(149.6)).toBe('149 PPI');
    expect(formatPpi(99.9)).toBe('99 PPI');
    expect(formatPpi(71.99)).toBe('71 PPI');
    expect(formatPpi(7.56)).toBe('7.5 PPI');
    expect(formatPpi(null)).toBe('—');
  });

  it('classifies exact thresholds consistently despite floating-point noise', () => {
    // 0.1 ft × 12 = 1.2000000000000002 in, so 180 px would compute 149.99999999999997.
    const exact = assessDimensions({ width: 180, height: 180 }, { width: 0.1, height: 0.1, unit: 'ft' });
    expect(exact.effectivePpi).toBe(150);
    expect(exact.status).toBe(HEALTH.MEETS_TARGET);
    expect(exact.message).toMatch(/^About 150 PPI/);
  });

  it('reports unknown instead of guessing', () => {
    expect(assessDimensions({ width: 100, height: 100 }, { width: null, height: 4, unit: 'ft' })).toMatchObject({
      status: HEALTH.UNKNOWN,
      reason: 'missing-print-size',
    });
    expect(assessDimensions(null, { width: 2, height: 4, unit: 'ft' })).toMatchObject({
      status: HEALTH.UNKNOWN,
      reason: 'not-measurable',
      measurable: false,
    });
  });

  it('works in metric units', () => {
    const assessment = assessDimensions({ width: 5906, height: 2953 }, { width: 100, height: 50, unit: 'cm' });
    expect(assessment.effectivePpi).toBeCloseTo(150, 0);
  });
});

describe('aspect ratio', () => {
  it('detects mismatches and suggests swapping when that matches', () => {
    const resolved = resolvePrintSize({ width: 4, height: 8, unit: 'ft' });
    const aspect = compareAspect({ width: 4000, height: 2000 }, resolved);
    expect(aspect.mismatch).toBe(true);
    expect(aspect.swappedMatches).toBe(true);
    const assessment = assessDimensions({ width: 4000, height: 2000 }, { width: 4, height: 8, unit: 'ft' });
    expect(assessment.aspect.mismatch).toBe(true);
  });

  it('accepts shapes within the tolerance', () => {
    const resolved = resolvePrintSize({ width: 6, height: 3, unit: 'ft' });
    expect(compareAspect({ width: 6000, height: 3010 }, resolved).mismatch).toBe(false);
  });
});

describe('compareAssessments', () => {
  it('flags threshold crossings caused by processing', () => {
    const printSize = { width: 5, height: 1.25, unit: 'ft' }; // 60 × 15 in
    const original = assessDimensions({ width: 9000, height: 2250 }, printSize);
    const prepared = assessDimensions({ width: 8000, height: 2000 }, printSize);
    expect(original.status).toBe(HEALTH.MEETS_TARGET);
    expect(prepared.status).toBe(HEALTH.BELOW_TARGET);
    expect(compareAssessments(original, prepared)).toMatchObject({ crossing: true, sourceBelowTarget: false });
  });

  it('distinguishes sources that were already below target', () => {
    const printSize = { width: 10, height: 5, unit: 'ft' };
    const original = assessDimensions({ width: 6000, height: 3000 }, printSize);
    expect(compareAssessments(original, original)).toMatchObject({ crossing: false, sourceBelowTarget: true });
  });
});
