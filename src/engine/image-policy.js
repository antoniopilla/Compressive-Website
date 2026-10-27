/**
 * Pure decision rules for the Smart Image Compressor. Kept separate from the
 * canvas code so every rule is unit-tested without a browser.
 *
 * Principles:
 *  - Lossy copies must pass the visual check (visual-check.js). Quality only
 *    ever goes up from the policy's first setting to pass it, never down to
 *    meet the size limit; if a copy that looks the same cannot meet the limit,
 *    the source is kept and the conflict is explained.
 *  - No upscaling, aspect ratio preserved, longest edge capped at 8000 px.
 *  - Re-encoding that would visibly change the artwork in ways a browser
 *    cannot avoid (animation loss, CMYK→RGB, wide-gamut→sRGB, 16→8 bits) is
 *    refused up front and the source is kept.
 *  - A source that already meets the limits is kept unless the prepared copy
 *    saves a worthwhile amount.
 *  - A source that does NOT meet a hard limit is never chosen merely because
 *    it is smaller in bytes than a compliant prepared copy.
 */

import { IMAGE_POLICY } from './policy.js';
import { formatBytes, formatDimensions, formatNumber, formatPercent } from './format.js';

/**
 * @typedef {object} ConstraintReport
 * @property {boolean} satisfied
 * @property {{ code: string, message: string }[]} violations
 * @property {{ maxBytes: number, maxWidth: number, maxHeight: number }} limits
 */

/**
 * Checks bytes and pixel dimensions against the configured output limits.
 *
 * @param {{ bytes: number, width: number, height: number }} subject
 * @param {typeof IMAGE_POLICY} [policy]
 * @returns {ConstraintReport}
 */
export function evaluateImageConstraints(subject, policy = IMAGE_POLICY) {
  const violations = [];
  if (subject.bytes > policy.maxOutputBytes) {
    violations.push({ code: 'bytes', message: `${formatBytes(subject.bytes)} is above the ${formatBytes(policy.maxOutputBytes)} limit.` });
  }
  if (subject.width > policy.maxWidth) {
    violations.push({ code: 'width', message: `${formatNumber(subject.width)} px wide is above the ${formatNumber(policy.maxWidth)} px limit.` });
  }
  if (subject.height > policy.maxHeight) {
    violations.push({ code: 'height', message: `${formatNumber(subject.height)} px tall is above the ${formatNumber(policy.maxHeight)} px limit.` });
  }
  return {
    satisfied: violations.length === 0,
    violations,
    limits: { maxBytes: policy.maxOutputBytes, maxWidth: policy.maxWidth, maxHeight: policy.maxHeight },
  };
}

/**
 * Header-based checks run before any pixels are decoded.
 *
 * @param {import('./inspect/raster-probe.js').RasterProbe} probe
 * @returns {{ proceed: true } | { proceed: false, reasonCode: string, message: string }}
 */
export function preflightImage(probe) {
  const keep = (reasonCode, message) => ({ proceed: false, reasonCode, message: `${message} Your original is kept unchanged.` });
  if (probe.animated) {
    return keep('animated', 'This image is animated. Re-encoding it in a browser would keep only the first frame.');
  }
  if (probe.format === 'jpeg' && probe.colorModel === 'cmyk') {
    return keep('cmyk', 'This JPEG uses CMYK colour. Browsers convert CMYK to RGB when re-encoding, which changes printed colours.');
  }
  if (probe.format === 'jpeg' && probe.bitDepth !== 8) {
    return keep('jpeg-precision', `This JPEG uses ${probe.bitDepth}-bit precision, which browsers cannot re-encode reliably.`);
  }
  if (probe.format === 'png' && probe.bitDepth === 16) {
    return keep('high-bit-depth', 'This PNG stores 16 bits per channel. Browsers re-encode at 8 bits per channel, which can cause banding.');
  }
  if (probe.icc && !probe.icc.isSrgb) {
    const name = probe.icc.description ? `"${probe.icc.description}"` : 'an unidentified profile';
    return keep(
      'color-profile',
      `This image has an embedded colour profile (${name}). Browsers convert images to sRGB when re-encoding, which would change printed colours.`,
    );
  }
  if (probe.format !== 'jpeg' && probe.orientation !== 1) {
    return keep('orientation-metadata', 'This image relies on orientation metadata that browsers handle inconsistently for PNG and WebP.');
  }
  return { proceed: true };
}

/**
 * Chooses between the prepared copy and the source after encoding.
 *
 * @param {object} input
 * @param {{ bytes: number, width: number, height: number }} input.source   Orientation-corrected source.
 * @param {{ bytes: number, width: number, height: number, type: string | null }} input.encoded
 * @param {string} input.expectedType  MIME type that should have been produced.
 * @param {{ label: string, lossless: boolean, exact: boolean }} input.method  How the copy was encoded, e.g. "MozJPEG at quality 75";
 *   `exact` when every pixel of the original file is kept bit for bit.
 * @param {typeof IMAGE_POLICY} [input.policy]
 * @returns {{ outcome: 'optimized'|'kept-original', reasonCode: string, message: string, constraints: ConstraintReport }}
 */
export function decideImageOutcome({ source, encoded, expectedType, method, policy = IMAGE_POLICY }) {
  const sourceReport = evaluateImageConstraints(source, policy);
  const encodedReport = evaluateImageConstraints(encoded, policy);
  const keep = (reasonCode, message) => ({
    outcome: /** @type {const} */ ('kept-original'),
    reasonCode,
    message: `${message} Your original is kept${sourceReport.satisfied ? '' : ', but it does not meet the output limits'}.`,
    constraints: sourceReport,
  });

  if (encoded.type !== expectedType) {
    const format = expectedType.replace('image/', '').toUpperCase();
    return keep('encoder-unsupported', `This browser cannot create ${format} files.`);
  }
  if (encoded.width > source.width || encoded.height > source.height) {
    return keep('dimension-check-failed', 'The prepared copy came out larger than the source, which is never allowed.');
  }
  if (encoded.bytes > policy.maxOutputBytes) {
    return keep(
      'quality-size-conflict',
      `With ${method.label} the compressed copy is ${formatBytes(encoded.bytes)}, above the ${formatBytes(policy.maxOutputBytes)} limit. ` +
        'Quality is never lowered to make a file fit, because the copy would then look different. Reduce the pixel size in an image editor to meet the limit.',
    );
  }
  if (!encodedReport.satisfied) {
    return keep('constraint-check-failed', 'The prepared copy did not meet the output limits.');
  }
  const saving = source.bytes - encoded.bytes;
  const worthwhile = saving >= Math.max(policy.minSavingBytes, source.bytes * policy.minSavingRatio);
  if (sourceReport.satisfied && !worthwhile) {
    return keep(
      'no-useful-saving',
      saving > 0
        ? `Compression would save only ${formatBytes(saving)} (${formatPercent(saving / source.bytes)}). It already meets the size and dimension limits.`
        : `Compression would not make this file smaller (${formatBytes(encoded.bytes)} vs ${formatBytes(source.bytes)}). It already meets the size and dimension limits.`,
    );
  }
  const resized = encoded.width !== source.width || encoded.height !== source.height;
  const resizing = `Resized from ${formatDimensions(source)} to ${formatDimensions(encoded)} to fit within ${formatNumber(policy.maxWidth)} × ${formatNumber(policy.maxHeight)} px`;
  let message;
  if (method.lossless) {
    if (resized) message = `${resizing}, then saved losslessly with ${method.label}.`;
    else if (method.exact) message = `Optimised losslessly with ${method.label}: every pixel is unchanged.`;
    else message = `Saved as ${method.label}: nothing visible was changed.`;
  } else {
    message = resized
      ? `${resizing}, then compressed with ${method.label} and compared with the resized image: it looks the same.`
      : `Compressed with ${method.label}, then compared with your original: it looks the same.`;
  }
  return {
    outcome: 'optimized',
    reasonCode: resized ? 'resized-and-compressed' : 'compressed',
    message,
    constraints: encodedReport,
  };
}

/**
 * After the copy at `qualities[index]` fails the visual check, picks the next
 * quality to try, or says that none can help:
 *
 *  - a copy that misses any score by more than `policy.skipMargins` skips
 *    one quality, because copies that far below also failed one quality up;
 *  - a file grows by at least `policy.minGrowthPerStep` per step, so when
 *    even that would make the next copy as large as the original (and the
 *    image was not resized, which would make any compliant copy worthwhile),
 *    no higher quality can give a smaller file.
 *
 * @param {object} input
 * @param {number} input.index  Position of the failed quality in `policy.qualities`.
 * @param {{ luma: number, chroma: number, worstArea: number }} input.similarity  Its visual-check scores.
 * @param {number} input.bytes  Size of the failed copy.
 * @param {number} input.sourceBytes
 * @param {boolean} input.resized
 * @param {'mozjpeg' | 'webp'} input.encoding
 * @param {typeof IMAGE_POLICY} [input.policy]
 * @returns {{ next: number } | { stop: 'no-saving', quality: number } | { stop: 'exhausted' }}
 */
export function nextQuality({ index, similarity, bytes, sourceBytes, resized, encoding, policy = IMAGE_POLICY }) {
  const last = policy.qualities.length - 1;
  if (index >= last) return { stop: 'exhausted' };
  const farBelow = Object.entries(policy.skipMargins).some(([measure, margin]) => policy.lookalike[measure] - similarity[measure] > margin);
  const next = Math.min(index + (farBelow ? 2 : 1), last);
  if (!resized && bytes * policy.minGrowthPerStep[encoding] ** (next - index) >= sourceBytes) {
    return { stop: 'no-saving', quality: policy.qualities[next] };
  }
  return { next };
}

/**
 * Expected dimensions after the "longest edge ≤ max" resize used by
 * browser-image-compression's handleMaxWidthOrHeight (no upscaling, aspect
 * ratio preserved, fractional sizes truncated by the canvas).
 *
 * @param {{ width: number, height: number }} dimensions
 * @param {number} maxEdge
 */
export function expectedResize(dimensions, maxEdge) {
  const { width, height } = dimensions;
  if (width <= maxEdge && height <= maxEdge) return { width, height };
  if (width > height) return { width: maxEdge, height: Math.trunc((height / width) * maxEdge) };
  return { width: Math.trunc((width / height) * maxEdge), height: maxEdge };
}
