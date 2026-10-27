/**
 * Product policy and resource budgets for Compressive.
 *
 * Every number in this file is enforced in code and documented in README.md
 * ("Processing limits"). Byte sizes use decimal units throughout the product:
 * 1 MB = 1,000,000 bytes. Nothing here is "unlimited": browsers run inside the
 * visitor's memory and CPU budget, so the limits are deliberately conservative.
 *
 * Memory reference: one 8000 × 8000 RGBA pixel buffer is 8000 × 8000 × 4 bytes
 * = 256,000,000 bytes (about 256 MB). Image preparation can hold several such
 * buffers at once (decoded source, resized canvas, encoder working copy), which
 * is why the decoded-pixel budget below is checked from file headers *before*
 * any decoding starts.
 */

export const MB = 1_000_000;

/**
 * Vector protection whitelist. Files with these final extensions are returned
 * byte-for-byte unchanged. This list is checked before any other routing rule
 * and is matched on the extension only, so a PDF-compatible Illustrator file
 * reported as `application/pdf` is still protected.
 */
export const PROTECTED_VECTOR_EXTENSIONS = Object.freeze(['ai', 'eps', 'svg']);

/** Single-file raster formats that can be compressed. */
export const RASTER_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp']);

/** Single-file PDF documents that may receive a conservative structural rewrite. */
export const PDF_EXTENSIONS = Object.freeze(['pdf']);

/** Formats passed through unchanged with a header-only resolution check. */
export const LIMITED_PASSTHROUGH_EXTENSIONS = Object.freeze(['psd']);

export const SUPPORTED_EXTENSIONS = Object.freeze([
  ...PROTECTED_VECTOR_EXTENSIONS,
  ...RASTER_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...LIMITED_PASSTHROUGH_EXTENSIONS,
]);

/**
 * Smart image compression policy.
 *
 * `quality` is the single encoder setting used for JPEG and WebP. It is a
 * starting encoder setting, not a guarantee of perceptual quality, and it is
 * never lowered automatically: if the 0.85 encode cannot meet the size limit,
 * the source is preserved and the conflict is explained.
 *
 * For PNG, browser-image-compression 2.0.2 maps quality to a colour budget of
 * `4096 × quality` colours (3481 at 0.85). That budget is only applied when the
 * image already has no more colours than that, so quantisation is exact;
 * otherwise PNG is re-encoded losslessly (pixel-identical apart from the
 * premultiplied-alpha rounding browsers apply to semi-transparent pixels).
 */
export const IMAGE_POLICY = Object.freeze({
  quality: 0.85,
  maxOutputBytes: 40_000_000,
  maxWidth: 8000,
  maxHeight: 8000,
  pngPaletteColors: Math.floor(4096 * 0.85),
  /** A prepared copy must save at least this share of the source size… */
  minSavingRatio: 0.01,
  /** …and at least this many bytes, otherwise the source is kept. */
  minSavingBytes: 4096,
});

/**
 * PDF structural rewrite policy. Rewrites that save less than both thresholds
 * are discarded and the original PDF is kept.
 */
export const PDF_POLICY = Object.freeze({
  minSavingRatio: 0.01,
  minSavingBytes: 4096,
  /** Objects pdf-lib parses or writes before yielding to the worker event loop. */
  objectsPerTick: 2000,
});

/**
 * Default prepress resolution policy. These are product defaults chosen for
 * banners and posters viewed from a short distance, not universal print
 * standards. Viewing distance, substrate and the print provider's own
 * requirements can justify different thresholds.
 */
export const RESOLUTION_POLICY = Object.freeze({
  targetPpi: 150,
  warningBelowPpi: 100,
  criticalBelowPpi: 72,
  /** Relative difference between artwork and print aspect ratios that counts as a mismatch. */
  aspectTolerance: 0.02,
  /** Statuses that require an explicit acknowledgement before the prepared download. */
  acknowledgeStatuses: Object.freeze(['warning', 'critical']),
});

/** Resource budgets. See README "Processing limits" for the customer-facing table. */
export const LIMITS = Object.freeze({
  /** Files per selection. */
  maxFiles: 100,
  /**
   * Total bytes in one ZIP batch. JSZip reads every entry into memory when it is
   * added and the archive is accumulated in memory as well, so the peak is
   * roughly twice this figure.
   */
  maxZipInputBytes: 500_000_000,
  /** Hard ceiling for a generated archive (STORE/DEFLATE overhead is tiny). */
  maxArchiveBytes: 520_000_000,
  /** Safe source budget for a single image to be decoded and compressed. */
  maxRasterInputBytes: 250_000_000,
  /** Decoded-pixel budget for a single image (100 MP ≈ 400 MB as RGBA). */
  maxRasterSourcePixels: 100_000_000,
  /**
   * Lower budget for PNG. The PNG encoder reads the pixels back from the canvas
   * and keeps further full-size working copies, so a PNG needs roughly four
   * RGBA buffers at once: 40 MP ≈ 160 MB each, about 650 MB in total, which
   * stays within what typical laptops can give a single tab.
   */
  maxPngSourcePixels: 40_000_000,
  /** Single PDF documents larger than this are not rewritten. */
  maxPdfInputBytes: 150_000_000,
  /** Single files passed through unchanged are never read in full. */
  maxPassthroughBytes: 4_000_000_000,
  /** Budgets for the main-thread fallback used when background workers are unavailable. */
  mainThread: Object.freeze({
    maxZipInputBytes: 50_000_000,
    maxPdfInputBytes: 20_000_000,
    maxRasterPixels: 25_000_000,
  }),
  /** Per-task timeouts in milliseconds. The worker is terminated when one expires. */
  timeouts: Object.freeze({
    zip: 600_000,
    image: 180_000,
    pdf: 180_000,
  }),
});

/** Canonical MIME types used for downloads, keyed by lowercase extension. */
export const MIME_BY_EXTENSION = Object.freeze({
  ai: 'application/postscript',
  eps: 'application/postscript',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  psd: 'image/vnd.adobe.photoshop',
  zip: 'application/zip',
});

/**
 * MIME types browsers and operating systems plausibly report for each
 * extension. Anything outside this list is "unexpected"; the file is still
 * accepted when its contents match the extension, because MIME information is
 * advisory and frequently missing or generic.
 */
export const ACCEPTED_MIME_BY_EXTENSION = Object.freeze({
  jpg: ['image/jpeg', 'image/pjpeg', 'image/jpg'],
  jpeg: ['image/jpeg', 'image/pjpeg', 'image/jpg'],
  png: ['image/png', 'image/apng', 'image/x-png'],
  webp: ['image/webp'],
  pdf: ['application/pdf', 'application/x-pdf', 'application/acrobat'],
  ai: [
    'application/postscript',
    'application/pdf',
    'application/illustrator',
    'application/vnd.adobe.illustrator',
    'application/x-illustrator',
  ],
  eps: ['application/postscript', 'application/eps', 'application/x-eps', 'image/eps', 'image/x-eps'],
  svg: ['image/svg+xml'],
  psd: [
    'image/vnd.adobe.photoshop',
    'application/x-photoshop',
    'application/photoshop',
    'application/psd',
    'image/psd',
    'image/x-photoshop',
  ],
});

/** Empty or generic MIME values that carry no information and are always acceptable. */
export const GENERIC_MIME_TYPES = Object.freeze([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/x-download',
  'application/unknown',
  'application/force-download',
]);

/**
 * ZIP compression policy. Already-compressed raster formats are STOREd because
 * DEFLATE gains almost nothing on them; everything else is DEFLATEd at level 6.
 * Both methods are lossless: extracted entries are byte-identical to the input.
 */
export const ZIP_POLICY = Object.freeze({
  storeExtensions: Object.freeze(['jpg', 'jpeg', 'png', 'webp']),
  deflateLevel: 6,
});
