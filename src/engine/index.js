/**
 * Compressive processing engine: what the interface uses.
 *
 * Framework-independent vanilla JavaScript. The React interface drives the
 * engine only through `createFileStudio()`, and uses the policies, units and
 * formatters below for display. Tests import the engine's modules directly.
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

export { createFileStudio } from './studio.js';
export { UNITS, toInches, fromInches, resolvePrintSize, describePrintSize } from './units.js';
export { IMAGE_POLICY, LIMITS, RESOLUTION_POLICY } from './policy.js';
export { formatBytes, formatDimensions, formatDuration, formatNumber, formatPercent, formatPpi } from './format.js';
