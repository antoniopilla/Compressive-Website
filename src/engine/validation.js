/**
 * Selection validation: extension, empty files, size budgets, MIME
 * plausibility and content signatures, followed by read-only header inspection.
 *
 * MIME types are advisory. An empty or generic MIME value is normal (Windows
 * often reports "" for .ai, .eps and .psd), and an unexpected MIME value is
 * accepted when the file's contents match its extension, with a note.
 */

import { ACCEPTED_MIME_BY_EXTENSION, GENERIC_MIME_TYPES, LIMITS, SUPPORTED_EXTENSIONS } from './policy.js';
import { categorize, CATEGORIES } from './router.js';
import { getExtension } from './filenames.js';
import { formatBytes } from './format.js';
import { checkSignature } from './inspect/signatures.js';
import { probeRaster } from './inspect/raster-probe.js';
import { inspectVector } from './inspect/vector-inspect.js';

/**
 * @typedef {object} SelectionEntry
 * @property {string} id
 * @property {File} file
 * @property {string} name
 * @property {number} size
 * @property {string} type              MIME type reported by the browser ('' when unknown).
 * @property {number} lastModified
 * @property {string} extension         Lowercase final extension.
 * @property {'vector'|'raster'|'pdf'|'psd'|null} category
 * @property {{ status: 'expected'|'generic'|'unexpected', reported: string }} mime
 * @property {{ ok: boolean, code: string, message: string }} validation
 * @property {string[]} notes           Informational, customer-facing notes.
 * @property {import('./inspect/raster-probe.js').RasterProbe | null} probe
 * @property {import('./inspect/vector-inspect.js').VectorInfo | null} vector
 */

/**
 * @param {string} extension
 * @param {string} type
 * @returns {'expected'|'generic'|'unexpected'}
 */
export function evaluateMime(extension, type) {
  const reported = String(type ?? '').toLowerCase().split(';')[0].trim();
  if (GENERIC_MIME_TYPES.includes(reported)) return 'generic';
  return (ACCEPTED_MIME_BY_EXTENSION[extension] ?? []).includes(reported) ? 'expected' : 'unexpected';
}

/**
 * Validates and inspects one file. Never throws for problems with the file
 * itself; those are reported through `validation`.
 *
 * @param {File} file
 * @param {string} id
 * @param {typeof LIMITS} [limits]
 * @returns {Promise<SelectionEntry>}
 */
export async function inspectFile(file, id, limits = LIMITS) {
  const name = String(file.name ?? '');
  const extension = getExtension(name);
  const type = String(file.type ?? '');
  /** @type {SelectionEntry} */
  const entry = {
    id,
    file,
    name,
    size: file.size,
    type,
    lastModified: file.lastModified ?? 0,
    extension,
    category: categorize(extension),
    mime: { status: evaluateMime(extension, type), reported: type },
    validation: { ok: true, code: 'ok', message: '' },
    notes: [],
    probe: null,
    vector: null,
  };
  const fail = (code, message) => {
    entry.validation = { ok: false, code, message };
    return entry;
  };

  if (!entry.category) {
    const supported = SUPPORTED_EXTENSIONS.map((ext) => ext.toUpperCase()).join(', ');
    return fail(
      'unsupported-extension',
      extension
        ? `.${extension} files are not supported. Supported types: ${supported}.`
        : `This file has no extension, so its type is unknown. Supported types: ${supported}.`,
    );
  }
  if (file.size === 0) {
    return fail('empty-file', 'This file is empty (0 bytes). Export it again and add it once more.');
  }
  if (file.size > limits.maxPassthroughBytes) {
    return fail('too-large', `This file is ${formatBytes(file.size)}, which is larger than this tool can handle in a browser.`);
  }

  try {
    const signature = await checkSignature(file, extension);
    if (!signature.ok) return fail('signature-mismatch', signature.message ?? 'The file contents do not match its extension.');
    if (entry.mime.status === 'unexpected') {
      entry.notes.push(
        `Your browser labeled this file "${type}". Its contents match a .${extension} file, so it is handled as one.`,
      );
    }

    if (entry.category === CATEGORIES.RASTER || entry.category === CATEGORIES.PSD) {
      try {
        entry.probe = await probeRaster(file, extension);
      } catch (error) {
        return fail(
          error?.code ?? 'corrupt-image',
          `${error?.message ?? 'The image header could not be read.'} The file may be damaged. Export it again and add it once more.`,
        );
      }
    } else if (entry.category === CATEGORIES.VECTOR) {
      entry.vector = await inspectVector(file, extension);
    }
  } catch (error) {
    if (error?.name === 'NotReadableError' || error?.name === 'NotFoundError') {
      return fail('unreadable', 'The browser could not read this file. It may have been moved or deleted. Choose it again.');
    }
    throw error;
  }
  return entry;
}
