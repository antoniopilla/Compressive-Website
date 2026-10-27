/**
 * Customer-facing labels for engine values. Library names and worker details
 * stay out of the interface; they live in README.md.
 */

export const ROUTE_LABELS = Object.freeze({
  idle: 'Waiting for files',
  'protected-passthrough': 'Vector file',
  'zip-originals': 'ZIP',
  'image-compress': 'Image compression',
  'pdf-rewrite': 'PDF compression',
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
 * Label for the main action, matched to what it will actually do.
 *
 * @param {string | undefined} route
 */
export function primaryActionLabel(route) {
  switch (route) {
    case 'image-compress':
      return 'Compress image';
    case 'pdf-rewrite':
      return 'Compress PDF';
    case 'zip-originals':
      return 'Create ZIP';
    case 'protected-passthrough':
    case 'psd-passthrough':
      return 'Check file';
    default:
      return 'Compress';
  }
}

/**
 * @param {string} outcome
 * @param {string} route
 */
export function outcomeLabel(outcome, route) {
  switch (outcome) {
    case 'preserved-exact':
      return 'Kept exactly';
    case 'optimized':
      return route === 'pdf-rewrite' ? 'Smaller' : 'Compressed';
    case 'kept-original':
      return 'Original kept';
    case 'bundled':
      return 'Zipped unchanged';
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
      return 'Sharp';
    case 'below-target':
      return 'Below target';
    case 'warning':
      return 'Low resolution';
    case 'critical':
      return 'Very low resolution';
    default:
      return reason === 'missing-print-size' ? 'Needs print size' : 'Not checked';
  }
}

/** Headline for a finished job. */
export function resultHeadline(result) {
  const [file] = result.files;
  switch (result.route) {
    case 'zip-originals':
      return `Your ZIP of ${result.files.length} files is ready`;
    case 'protected-passthrough':
      return 'Your vector file is ready, kept exactly as it was';
    case 'psd-passthrough':
      return 'Your Photoshop file is ready, kept exactly as it was';
    case 'image-compress':
      return file.outcome === 'optimized' ? 'Your image is compressed' : 'Your original image is ready';
    case 'pdf-rewrite':
      return file.outcome === 'optimized' ? 'Your PDF is smaller' : 'Your original PDF is ready';
    default:
      return 'Ready';
  }
}

/** Label for the primary download button. */
export function downloadLabel(result) {
  if (result.artifact.kind === 'archive') return 'Download ZIP';
  if (result.artifact.kind === 'prepared') return result.route === 'pdf-rewrite' ? 'Download smaller PDF' : 'Download compressed image';
  return 'Download file';
}
