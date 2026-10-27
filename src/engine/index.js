/**
 * Compressive processing engine — public API.
 *
 * Framework-independent vanilla JavaScript. The React interface talks to the
 * engine only through `createFileStudio()`; everything else is exported for
 * tests and for reuse in other front ends.
 *
 * Typical use:
 *
 *   const studio = createFileStudio();
 *   const stop = studio.subscribe((snapshot, event) => render(snapshot));
 *   await studio.addFiles(fileList);              // validating → idle
 *   studio.setPrintSize({ width: 10, height: 4, unit: 'ft' });
 *   const result = await studio.prepare();        // processing → ready
 *   const { blob, filename } = studio.getDownload('prepared');
 *   studio.cancel();                              // stop a running job
 *   studio.dispose();                             // release everything
 */

export { createFileStudio, STATUS, PHASE_LABELS } from './studio.js';
export { planRoute, categorize, ROUTES, CATEGORIES } from './router.js';
export { inspectFile, evaluateMime } from './validation.js';
export { executePlan, ASSESSMENT_LIMITATIONS } from './pipeline.js';
export { assessResult, assessEntry, assessFileOutcome } from './health.js';
export {
  assessDimensions,
  classifyPpi,
  compareAspect,
  computePpi,
  compareAssessments,
  HEALTH,
  SEVERITY_RANK,
} from './resolution.js';
export { UNITS, DEFAULT_UNIT, toInches, fromInches, resolvePrintSize, describePrintSize } from './units.js';
export { createTaskRunner } from './task-runner.js';
export { StudioError, CanceledError, isCanceledError } from './errors.js';
export {
  IMAGE_POLICY,
  LIMITS,
  PDF_POLICY,
  RESOLUTION_POLICY,
  PROTECTED_VECTOR_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  ZIP_POLICY,
} from './policy.js';
export { formatBytes, formatDimensions, formatDuration, formatPercent, formatPpi, formatPpiNumber, floorPpi, formatNumber } from './format.js';
