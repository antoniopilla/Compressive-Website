/**
 * Dynamic File Router.
 *
 * The processing strategy depends only on how many files are selected and on
 * each file's final extension (case-insensitive). MIME types never change the
 * route: they are advisory and often empty, generic or misleading — most
 * importantly, PDF-compatible Illustrator files are frequently reported as
 * `application/pdf` and must still be protected.
 *
 * Routing precedence (first matching rule wins):
 *   1. No files                          → idle
 *   2. Any file failed validation        → invalid (nothing is processed partially)
 *   3. More than LIMITS.maxFiles         → invalid
 *   4. Two or more files                 → ZIP of the original payloads, no per-file optimisation
 *   5. One .ai / .eps / .svg             → protected original pass-through (whitelist checked first)
 *   6. One .psd                          → original pass-through with header-only assessment
 *   7. One .jpg / .jpeg / .png / .webp   → smart image compression
 *   8. One .pdf                          → conservative PDF structural rewrite
 * Each processing route also enforces its own resource budget (see policy.js).
 */

import {
  LIMITED_PASSTHROUGH_EXTENSIONS,
  LIMITS,
  PDF_EXTENSIONS,
  PROTECTED_VECTOR_EXTENSIONS,
  RASTER_EXTENSIONS,
} from './policy.js';
import { formatBytes, formatNumber } from './format.js';

export const ROUTES = Object.freeze({
  IDLE: 'idle',
  PROTECTED_PASSTHROUGH: 'protected-passthrough',
  ZIP_ORIGINALS: 'zip-originals',
  IMAGE_COMPRESS: 'image-compress',
  PDF_REWRITE: 'pdf-rewrite',
  PSD_PASSTHROUGH: 'psd-passthrough',
  INVALID: 'invalid',
});

export const CATEGORIES = Object.freeze({
  VECTOR: 'vector',
  RASTER: 'raster',
  PDF: 'pdf',
  PSD: 'psd',
});

/**
 * Maps an extension to its category. The protected vector whitelist is checked
 * first so no other rule can ever claim an .ai, .eps or .svg file.
 *
 * @param {string} extension Lowercase extension without the dot.
 * @returns {'vector'|'raster'|'pdf'|'psd'|null}
 */
export function categorize(extension) {
  if (PROTECTED_VECTOR_EXTENSIONS.includes(extension)) return CATEGORIES.VECTOR;
  if (LIMITED_PASSTHROUGH_EXTENSIONS.includes(extension)) return CATEGORIES.PSD;
  if (RASTER_EXTENSIONS.includes(extension)) return CATEGORIES.RASTER;
  if (PDF_EXTENSIONS.includes(extension)) return CATEGORIES.PDF;
  return null;
}

/**
 * @typedef {object} RouteError
 * @property {string | null} fileId
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {object} RoutePlan
 * @property {string} route            One of ROUTES.
 * @property {string} summary          Customer-facing description of what Prepare will do.
 * @property {RouteError[]} errors
 * @property {{ files: number, bytes: number }} totals
 */

/**
 * Decides the processing strategy for a validated selection.
 *
 * @param {import('./validation.js').SelectionEntry[]} entries
 * @param {typeof LIMITS} [limits]
 * @returns {RoutePlan}
 */
export function planRoute(entries, limits = LIMITS) {
  const totals = { files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0) };
  const invalid = (errors) => ({
    route: ROUTES.INVALID,
    summary: 'Fix the issues below before preparing.',
    errors,
    totals,
  });

  if (entries.length === 0) {
    return { route: ROUTES.IDLE, summary: 'Choose files to get started.', errors: [], totals };
  }

  const fileErrors = entries
    .filter((entry) => !entry.validation.ok)
    .map((entry) => ({ fileId: entry.id, code: entry.validation.code, message: entry.validation.message }));
  if (fileErrors.length) return invalid(fileErrors);

  if (entries.length > limits.maxFiles) {
    return invalid([
      {
        fileId: null,
        code: 'too-many-files',
        message: `${formatNumber(entries.length)} files are selected. Up to ${limits.maxFiles} files can be prepared together. Remove some and try again.`,
      },
    ]);
  }

  if (entries.length > 1) {
    if (totals.bytes > limits.maxZipInputBytes) {
      return invalid([
        {
          fileId: null,
          code: 'batch-too-large',
          message: `These files total ${formatBytes(totals.bytes)}. A ZIP can hold up to ${formatBytes(limits.maxZipInputBytes)} in the browser. Split them into smaller batches.`,
        },
      ]);
    }
    return {
      route: ROUTES.ZIP_ORIGINALS,
      summary: `Your ${entries.length} files will be packaged unchanged into one ZIP. Images and PDFs are not altered when packaged together.`,
      errors: [],
      totals,
    };
  }

  const [entry] = entries;
  switch (entry.category) {
    case CATEGORIES.VECTOR:
      return {
        route: ROUTES.PROTECTED_PASSTHROUGH,
        summary: 'Vector artwork is kept exactly as supplied: it is not converted, flattened or re-saved.',
        errors: [],
        totals,
      };
    case CATEGORIES.PSD:
      return {
        route: ROUTES.PSD_PASSTHROUGH,
        summary: 'Photoshop files are kept exactly as supplied. Resolution is checked from the pixel size in the file header.',
        errors: [],
        totals,
      };
    case CATEGORIES.RASTER: {
      if (entry.size > limits.maxRasterInputBytes) {
        return invalid([
          {
            fileId: entry.id,
            code: 'image-too-large',
            message: `This image is ${formatBytes(entry.size)}. Images up to ${formatBytes(limits.maxRasterInputBytes)} can be compressed in the browser. Reduce it in an image editor, or add it with other files to package the original in a ZIP.`,
          },
        ]);
      }
      const pixels = entry.probe ? entry.probe.orientedWidth * entry.probe.orientedHeight : 0;
      const pixelBudget = entry.extension === 'png' ? limits.maxPngSourcePixels : limits.maxRasterSourcePixels;
      if (pixels > pixelBudget) {
        return invalid([
          {
            fileId: entry.id,
            code: 'image-too-many-pixels',
            message: `This image has ${formatNumber(pixels / 1_000_000, 1)} megapixels. ${entry.extension === 'png' ? 'PNG images' : 'Images'} up to ${formatNumber(pixelBudget / 1_000_000)} megapixels can be processed safely in the browser. Reduce its pixel size in an image editor, or add it with other files to package the original in a ZIP.`,
          },
        ]);
      }
      return {
        route: ROUTES.IMAGE_COMPRESS,
        summary: 'This image will be compressed at quality 0.85 within 8000 × 8000 px and 40 MB. Your original stays available to download.',
        errors: [],
        totals,
      };
    }
    case CATEGORIES.PDF:
      if (entry.size > limits.maxPdfInputBytes) {
        return invalid([
          {
            fileId: entry.id,
            code: 'pdf-too-large',
            message: `This PDF is ${formatBytes(entry.size)}. PDFs up to ${formatBytes(limits.maxPdfInputBytes)} can be tidied in the browser. Add it with other files to package the original in a ZIP instead.`,
          },
        ]);
      }
      return {
        route: ROUTES.PDF_REWRITE,
        summary: "This PDF's internal structure will be tidied without touching text, fonts, vectors or page sizes. If that can't be done safely, you get your original back.",
        errors: [],
        totals,
      };
    default:
      return invalid([{ fileId: entry.id, code: 'unsupported-extension', message: 'This file type is not supported.' }]);
  }
}
