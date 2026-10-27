/**
 * Prepress resolution health check.
 *
 * Resolution is measured, never inferred: effective pixels-per-inch comes from
 * the artwork's orientation-corrected pixel dimensions and the intended
 * physical print size entered by the customer.
 *
 *   widthInches  = width  converted to inches (feet × 12 by default)
 *   heightInches = height converted to inches
 *   ppiX = pixelWidth  / widthInches
 *   ppiY = pixelHeight / heightInches
 *   effectivePPI = min(ppiX, ppiY)
 *
 * Byte size, compression percentage and embedded DPI metadata are deliberately
 * ignored: none of them says how many pixels will cover each printed inch.
 * Nothing in this module crops, stretches, rotates or upscales artwork to make
 * a score look better.
 */

import { RESOLUTION_POLICY } from './policy.js';
import { describePrintSize, fromInches, resolvePrintSize, UNITS } from './units.js';
import { formatNumber, formatPpiNumber } from './format.js';

export const HEALTH = Object.freeze({
  MEETS_TARGET: 'meets-target',
  BELOW_TARGET: 'below-target',
  WARNING: 'warning',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown',
});

/** Higher rank = worse. Unknown has no rank because it cannot be compared. */
export const SEVERITY_RANK = Object.freeze({
  [HEALTH.MEETS_TARGET]: 0,
  [HEALTH.BELOW_TARGET]: 1,
  [HEALTH.WARNING]: 2,
  [HEALTH.CRITICAL]: 3,
});

/**
 * @typedef {{ width: number, height: number }} Dimensions
 */

/**
 * @typedef {object} AspectCheck
 * @property {boolean} mismatch           Artwork and print shapes differ beyond the tolerance.
 * @property {number} artworkRatio        width / height of the artwork.
 * @property {number} printRatio          width / height of the print.
 * @property {number} difference          Relative difference (0.1 = 10%).
 * @property {boolean} swappedMatches     Swapping the entered width and height would match.
 */

/**
 * @typedef {object} Assessment
 * @property {'meets-target'|'below-target'|'warning'|'critical'|'unknown'} status
 * @property {boolean} measurable          True when pixel dimensions are known.
 * @property {string} reason               Machine-readable reason for unknown results, else "measured".
 * @property {number | null} ppiX
 * @property {number | null} ppiY
 * @property {number | null} effectivePpi
 * @property {AspectCheck | null} aspect
 * @property {{ width: number, height: number } | null} pixelsForTarget  Pixels needed for the target PPI at this size.
 * @property {{ width: number, height: number, unit: string } | null} maxPrintAtTarget Largest print at the target PPI.
 * @property {string} message              Practical customer-facing explanation.
 */

/**
 * Removes floating-point noise (for example 180 px over 0.1 ft = 149.99999999999997)
 * so classification and the displayed number are based on the same value.
 *
 * @param {number} value
 */
const tidy = (value) => Math.round(value * 1e6) / 1e6;

/**
 * @param {Dimensions} dimensions
 * @param {{ widthIn: number, heightIn: number }} resolved
 */
export function computePpi(dimensions, resolved) {
  const ppiX = tidy(dimensions.width / resolved.widthIn);
  const ppiY = tidy(dimensions.height / resolved.heightIn);
  return { ppiX, ppiY, effectivePpi: Math.min(ppiX, ppiY) };
}

/**
 * @param {number} effectivePpi
 * @param {typeof RESOLUTION_POLICY} [policy]
 * @returns {'meets-target'|'below-target'|'warning'|'critical'}
 */
export function classifyPpi(effectivePpi, policy = RESOLUTION_POLICY) {
  if (effectivePpi < policy.criticalBelowPpi) return HEALTH.CRITICAL;
  if (effectivePpi < policy.warningBelowPpi) return HEALTH.WARNING;
  if (effectivePpi < policy.targetPpi) return HEALTH.BELOW_TARGET;
  return HEALTH.MEETS_TARGET;
}

/**
 * @param {Dimensions} dimensions Artwork width/height in any consistent unit.
 * @param {{ widthIn: number, heightIn: number }} resolved
 * @param {number} tolerance
 * @returns {AspectCheck}
 */
export function compareAspect(dimensions, resolved, tolerance = RESOLUTION_POLICY.aspectTolerance) {
  const artworkRatio = dimensions.width / dimensions.height;
  const printRatio = resolved.widthIn / resolved.heightIn;
  const difference = Math.abs(artworkRatio - printRatio) / printRatio;
  const swappedRatio = resolved.heightIn / resolved.widthIn;
  const swappedDifference = Math.abs(artworkRatio - swappedRatio) / swappedRatio;
  const mismatch = difference > tolerance;
  return {
    mismatch,
    artworkRatio,
    printRatio,
    difference,
    swappedMatches: mismatch && swappedDifference <= tolerance,
  };
}

/** @param {number} ratio */
export function formatRatio(ratio) {
  return ratio >= 1 ? `${formatNumber(ratio, 2)}:1` : `1:${formatNumber(1 / ratio, 2)}`;
}

/**
 * Explains an aspect mismatch in practical terms.
 *
 * @param {AspectCheck} aspect
 * @param {import('./units.js').PrintSize} printSize
 */
export function describeAspectMismatch(aspect, printSize) {
  const base =
    `The artwork's shape (${formatRatio(aspect.artworkRatio)}) does not match ` +
    `${describePrintSize(printSize)} (${formatRatio(aspect.printRatio)}). Printing at this size would need ` +
    'cropping, extra margins or stretching. This tool never does any of those for you.';
  if (!aspect.swappedMatches) return base;
  const swapped = { ...printSize, width: printSize.height, height: printSize.width };
  return `${base} Did you mean ${describePrintSize(swapped)}? You can swap the width and height.`;
}

/**
 * @param {string} status
 * @param {number} effectivePpi
 * @param {import('./units.js').PrintSize} printSize
 * @param {{ width: number, height: number }} pixelsForTarget
 * @param {{ width: number, height: number, unit: string }} maxPrintAtTarget
 * @param {typeof RESOLUTION_POLICY} policy
 */
function describeStatus(status, effectivePpi, printSize, pixelsForTarget, maxPrintAtTarget, policy) {
  const size = describePrintSize(printSize);
  const ppi = formatPpiNumber(effectivePpi);
  const unitShort = UNITS[maxPrintAtTarget.unit]?.short ?? maxPrintAtTarget.unit;
  const advice =
    `For ${policy.targetPpi} PPI at this size, use an image of at least ` +
    `${formatNumber(pixelsForTarget.width)} × ${formatNumber(pixelsForTarget.height)} px, or print at up to ` +
    `${formatNumber(maxPrintAtTarget.width, 1)} × ${formatNumber(maxPrintAtTarget.height, 1)} ${unitShort}.`;
  switch (status) {
    case HEALTH.MEETS_TARGET:
      return `About ${ppi} PPI at ${size}, which meets the ${policy.targetPpi} PPI target for this size.`;
    case HEALTH.BELOW_TARGET:
      return (
        `About ${ppi} PPI at ${size}. That is often acceptable for banners viewed from a few feet away, ` +
        `but below the ${policy.targetPpi} PPI target. ${advice}`
      );
    case HEALTH.WARNING:
      return `About ${ppi} PPI at ${size}. Expect visible softness when viewed up close. ${advice}`;
    default:
      return `About ${ppi} PPI at ${size}. This is likely to look pixelated or blurry. ${advice}`;
  }
}

/**
 * Assesses raster resolution for one set of pixel dimensions.
 *
 * @param {Dimensions | null | undefined} dimensions Orientation-corrected pixel dimensions.
 * @param {import('./units.js').PrintSize} printSize
 * @param {typeof RESOLUTION_POLICY} [policy]
 * @returns {Assessment}
 */
export function assessDimensions(dimensions, printSize, policy = RESOLUTION_POLICY) {
  const resolved = resolvePrintSize(printSize);
  const empty = {
    ppiX: null,
    ppiY: null,
    effectivePpi: null,
    aspect: null,
    pixelsForTarget: null,
    maxPrintAtTarget: null,
  };
  if (!dimensions || !(dimensions.width > 0) || !(dimensions.height > 0)) {
    return {
      ...empty,
      status: HEALTH.UNKNOWN,
      measurable: false,
      reason: 'not-measurable',
      message: 'Pixel dimensions for this file could not be measured, so its resolution is unknown.',
    };
  }
  if (!resolved.complete) {
    return {
      ...empty,
      status: HEALTH.UNKNOWN,
      measurable: true,
      reason: 'missing-print-size',
      message: 'Enter the print width and height to check resolution for this file.',
    };
  }
  const { ppiX, ppiY, effectivePpi } = computePpi(dimensions, resolved);
  const status = classifyPpi(effectivePpi, policy);
  const pixelsForTarget = {
    width: Math.ceil(resolved.widthIn * policy.targetPpi),
    height: Math.ceil(resolved.heightIn * policy.targetPpi),
  };
  const maxPrintAtTarget = {
    width: fromInches(dimensions.width / policy.targetPpi, resolved.unit),
    height: fromInches(dimensions.height / policy.targetPpi, resolved.unit),
    unit: resolved.unit,
  };
  return {
    status,
    measurable: true,
    reason: 'measured',
    ppiX,
    ppiY,
    effectivePpi,
    aspect: compareAspect(dimensions, resolved, policy.aspectTolerance),
    pixelsForTarget,
    maxPrintAtTarget,
    message: describeStatus(status, effectivePpi, printSize, pixelsForTarget, maxPrintAtTarget, policy),
  };
}

/**
 * Compares original and prepared assessments for the same print size.
 *
 * @param {Assessment} original
 * @param {Assessment | null} prepared
 */
export function compareAssessments(original, prepared) {
  const known = (assessment) => assessment && assessment.status !== HEALTH.UNKNOWN;
  const sourceBelowTarget = known(original) ? SEVERITY_RANK[original.status] >= 1 : null;
  if (!known(original) || !known(prepared)) {
    return { sourceBelowTarget, crossing: false, crossedFrom: null, crossedTo: null };
  }
  const crossing = SEVERITY_RANK[prepared.status] > SEVERITY_RANK[original.status];
  return {
    sourceBelowTarget,
    crossing,
    crossedFrom: crossing ? original.status : null,
    crossedTo: crossing ? prepared.status : null,
  };
}

/**
 * Returns the worse of two statuses (unknown never outranks a measured one).
 *
 * @param {string | null} a
 * @param {string | null} b
 */
export function worstStatus(a, b) {
  if (!a || a === HEALTH.UNKNOWN) return b ?? a;
  if (!b || b === HEALTH.UNKNOWN) return a;
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}
