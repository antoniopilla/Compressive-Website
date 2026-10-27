/**
 * Resolution health for selections and prepared results.
 *
 * Health is derived data: it is recalculated whenever the print size changes,
 * without reprocessing files. Original and prepared resolution are assessed
 * independently from orientation-corrected pixel dimensions. Files whose
 * resolution cannot be measured (vectors, PDFs) get an "unknown" status with
 * an explanation instead of a fabricated pass.
 */

import { IMAGE_POLICY, RESOLUTION_POLICY } from './policy.js';
import {
  assessDimensions,
  compareAspect,
  compareAssessments,
  describeAspectMismatch,
  HEALTH,
  worstStatus,
} from './resolution.js';
import { describePrintSize, resolvePrintSize } from './units.js';
import { formatNumber, formatPpiNumber } from './format.js';
import { ASSESSMENT_LIMITATIONS } from './pipeline.js';
import { CATEGORIES } from './router.js';

/**
 * @typedef {object} FileHealth
 * @property {boolean} measurable
 * @property {import('./resolution.js').Assessment | null} original
 * @property {import('./resolution.js').Assessment | null} prepared  Only when a prepared copy is delivered.
 * @property {ReturnType<typeof compareAssessments> | null} comparison
 * @property {string} status          Status of the file that will be downloaded.
 * @property {string | null} aspectMessage
 * @property {string | null} crossingMessage  Set when processing lowered the resolution band.
 * @property {string | null} limitation
 */

/**
 * @typedef {object} ResultHealth
 * @property {string} printKey
 * @property {boolean} complete
 * @property {Record<string, FileHealth>} files
 * @property {string} worst
 * @property {boolean} requiresAcknowledgement
 * @property {string} acknowledgementKey   Changes with the job and the print size.
 */

/**
 * @param {import('./units.js').PrintSize} printSize
 * @param {{ width: number, height: number } | null} artboard
 */
function vectorAspectMessage(printSize, artboard) {
  const resolved = resolvePrintSize(printSize);
  if (!artboard || !resolved.complete) return null;
  const aspect = compareAspect(artboard, /** @type {any} */ (resolved));
  return aspect.mismatch ? describeAspectMismatch(aspect, printSize) : null;
}

/**
 * @param {import('./pipeline.js').FileOutcome} file
 * @param {import('./units.js').PrintSize} printSize
 * @param {typeof RESOLUTION_POLICY} policy
 * @returns {FileHealth}
 */
function assessFileOutcome(file, printSize, policy = RESOLUTION_POLICY) {
  if (!file.assessable || !file.originalDimensions) {
    return {
      measurable: false,
      original: null,
      prepared: null,
      comparison: null,
      status: HEALTH.UNKNOWN,
      aspectMessage: vectorAspectMessage(printSize, file.artboard),
      crossingMessage: null,
      limitation: file.assessmentLimitation ?? 'Resolution could not be measured for this file.',
    };
  }
  const original = assessDimensions(file.originalDimensions, printSize, policy);
  let prepared = null;
  if (file.outcome === 'optimized' && file.preparedDimensions) {
    const resized =
      file.preparedDimensions.width !== file.originalDimensions.width ||
      file.preparedDimensions.height !== file.originalDimensions.height;
    prepared = resized ? assessDimensions(file.preparedDimensions, printSize, policy) : original;
  }
  const comparison = compareAssessments(original, prepared);
  const delivered = prepared ?? original;
  let crossingMessage = null;
  if (comparison.crossing && prepared?.effectivePpi && original.effectivePpi) {
    crossingMessage =
      `Resizing to fit the ${formatNumber(IMAGE_POLICY.maxWidth)} px limit lowers resolution from about ${formatPpiNumber(original.effectivePpi)} ` +
      `to about ${formatPpiNumber(prepared.effectivePpi)} PPI at ${describePrintSize(printSize)}. ` +
      'Download the original instead if your printer accepts larger files.';
  }
  return {
    measurable: true,
    original,
    prepared,
    comparison,
    status: delivered.status,
    aspectMessage: delivered.aspect?.mismatch ? describeAspectMismatch(delivered.aspect, printSize) : null,
    crossingMessage,
    limitation: file.assessmentLimitation,
  };
}

/**
 * @param {import('./pipeline.js').JobResult} result
 * @param {import('./units.js').PrintSize} printSize
 * @param {typeof RESOLUTION_POLICY} [policy]
 * @returns {ResultHealth}
 */
export function assessResult(result, printSize, policy = RESOLUTION_POLICY) {
  const resolved = resolvePrintSize(printSize);
  /** @type {Record<string, FileHealth>} */
  const files = {};
  let worst = null;
  let requiresAcknowledgement = false;
  for (const file of result.files) {
    const health = assessFileOutcome(file, printSize, policy);
    files[file.fileId] = health;
    worst = worstStatus(worst, health.status);
    if (policy.acknowledgeStatuses.includes(health.status)) requiresAcknowledgement = true;
  }
  return {
    printKey: resolved.key,
    complete: resolved.complete,
    files,
    worst: worst ?? HEALTH.UNKNOWN,
    requiresAcknowledgement,
    acknowledgementKey: `${result.jobId}|${resolved.key}`,
  };
}

/**
 * Preview assessment for a selection before Prepare (original files only).
 *
 * @param {import('./validation.js').SelectionEntry} entry
 * @param {import('./units.js').PrintSize} printSize
 * @param {typeof RESOLUTION_POLICY} [policy]
 * @returns {{ assessment: import('./resolution.js').Assessment | null, aspectMessage: string | null, limitation: string | null }}
 */
export function assessEntry(entry, printSize, policy = RESOLUTION_POLICY) {
  if (!entry.validation?.ok) return { assessment: null, aspectMessage: null, limitation: null };
  if (entry.probe) {
    const assessment = assessDimensions(
      { width: entry.probe.orientedWidth, height: entry.probe.orientedHeight },
      printSize,
      policy,
    );
    return {
      assessment,
      aspectMessage: assessment.aspect?.mismatch ? describeAspectMismatch(assessment.aspect, printSize) : null,
      limitation: entry.category === CATEGORIES.PSD ? ASSESSMENT_LIMITATIONS.psd : null,
    };
  }
  return {
    assessment: null,
    aspectMessage: vectorAspectMessage(printSize, entry.vector?.artboard ?? null),
    limitation:
      entry.category === CATEGORIES.VECTOR
        ? ASSESSMENT_LIMITATIONS.vector
        : entry.category === CATEGORIES.PDF
          ? ASSESSMENT_LIMITATIONS.pdf
          : null,
  };
}
