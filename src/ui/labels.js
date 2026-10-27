/**
 * Customer-facing labels for engine values. Library names and worker details
 * stay out of the interface; they live in README.md.
 */

export const ROUTE_LABELS = Object.freeze({
  idle: 'Waiting for files',
  'protected-passthrough': 'Protected vector',
  'zip-originals': 'ZIP of originals',
  'image-compress': 'Image compression',
  'pdf-rewrite': 'PDF tidy-up',
  'psd-passthrough': 'Photoshop file',
  invalid: 'Needs attention',
});

export const CATEGORY_LABELS = Object.freeze({
  vector: 'Vector',
  raster: 'Image',
  pdf: 'PDF',
  psd: 'Photoshop',
});

/**
 * @param {string} outcome
 * @param {string} route
 */
export function outcomeLabel(outcome, route) {
  switch (outcome) {
    case 'preserved-exact':
      return 'Kept exactly';
    case 'optimized':
      return route === 'pdf-rewrite' ? 'Tidied' : 'Compressed';
    case 'kept-original':
      return 'Original kept';
    case 'bundled':
      return 'Packaged unchanged';
    default:
      return outcome;
  }
}

/**
 * @param {string} status
 * @param {string} [reason]
 */
export function healthLabel(status, reason) {
  switch (status) {
    case 'meets-target':
      return 'Meets target';
    case 'below-target':
      return 'Below target';
    case 'warning':
      return 'Low resolution';
    case 'critical':
      return 'Very low resolution';
    default:
      return reason === 'missing-print-size' ? 'Needs print size' : 'Not assessed';
  }
}

/** Headline for a finished job. */
export function resultHeadline(result) {
  const [file] = result.files;
  switch (result.route) {
    case 'zip-originals':
      return `Your ZIP of ${result.files.length} original files is ready`;
    case 'protected-passthrough':
      return 'Your vector file is ready, unchanged';
    case 'psd-passthrough':
      return 'Your Photoshop file is ready, unchanged';
    case 'image-compress':
      return file.outcome === 'optimized' ? 'Your image has been compressed' : 'Your original image is ready';
    case 'pdf-rewrite':
      return file.outcome === 'optimized' ? 'Your PDF has been tidied' : 'Your original PDF is ready';
    default:
      return 'Ready';
  }
}

/** Label for the primary download button. */
export function downloadLabel(result) {
  if (result.artifact.kind === 'archive') return 'Download ZIP';
  if (result.artifact.kind === 'prepared') return result.route === 'pdf-rewrite' ? 'Download tidied PDF' : 'Download compressed image';
  return 'Download file';
}
