/**
 * Filename helpers: extension detection for routing, safe ZIP entry names,
 * deterministic duplicate handling, and download names and types.
 *
 * Entry-name sanitising only changes the *name* stored in the archive. File
 * contents are never touched.
 */

import { MIME_BY_EXTENSION } from './policy.js';

/**
 * Returns the final extension in lowercase, without the dot. Routing uses only
 * this value, so "Logo.AI" and "logo.ai" behave identically.
 *
 * @param {string} name
 */
export function getExtension(name) {
  const value = String(name ?? '');
  const dot = value.lastIndexOf('.');
  if (dot === -1 || dot === value.length - 1) return '';
  return value.slice(dot + 1).toLowerCase();
}

/**
 * Splits a name into stem and extension, keeping the original letter case.
 *
 * @param {string} name
 * @returns {{ stem: string, ext: string }} `ext` excludes the dot ('' when absent).
 */
export function splitName(name) {
  const value = String(name ?? '');
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) return { stem: value, ext: '' };
  return { stem: value.slice(0, dot), ext: value.slice(dot + 1) };
}

// C0/C1 control characters, including NUL, tab, CR/LF and DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
// Path separators: archive paths use "/", Windows tools also treat "\" as one.
const PATH_SEPARATORS = /[\\/]/g;
// Characters Windows cannot extract; ":" also prevents drive-letter paths like "C:".
const WINDOWS_RESERVED_CHARACTERS = /[<>:"|?*]/g;
// Device names Windows refuses as file names, even with an extension.
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_ENTRY_NAME_LENGTH = 180;

/**
 * Produces an archive entry name that cannot express a path: separators,
 * drive letters, "." / ".." segments, control characters and Windows-reserved
 * names are neutralised. Readable Unicode is kept (normalised to NFC) and the
 * extension is preserved.
 *
 * @param {string} rawName
 * @returns {string}
 */
export function sanitizeEntryName(rawName) {
  // Supported extensions are plain ASCII letters, so none of the replacements
  // below can alter the extension that routing relied on.
  let name = String(rawName ?? '')
    .normalize('NFC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(PATH_SEPARATORS, '_')
    .replace(WINDOWS_RESERVED_CHARACTERS, '_')
    .trim();

  if (name === '' || name === '.' || name === '..') name = '_';

  let { stem, ext } = splitName(name);
  // Names such as ".ai" have no stem; keep the extension and give them one.
  if (stem.startsWith('.') && !ext && stem.length > 1 && !stem.slice(1).includes('.')) {
    ext = stem.slice(1);
    stem = 'file';
  }

  if (WINDOWS_DEVICE_NAMES.test(stem.split('.')[0])) stem = `_${stem}`;
  stem = stem.replace(/[. ]+$/, '') || 'file';

  const suffix = ext ? `.${ext}` : '';
  stem = truncateCodePoints(stem, Math.max(1, MAX_ENTRY_NAME_LENGTH - suffix.length));
  return `${stem}${suffix}`;
}

/**
 * Truncates to at most `maxUnits` UTF-16 code units without splitting a
 * surrogate pair (so emoji and other astral characters stay intact).
 *
 * @param {string} value
 * @param {number} maxUnits
 */
function truncateCodePoints(value, maxUnits) {
  if (value.length <= maxUnits) return value;
  let result = '';
  for (const character of value) {
    if (result.length + character.length > maxUnits) break;
    result += character;
  }
  return result;
}

/**
 * @typedef {object} EntryNameAssignment
 * @property {number} index        Position in the original selection.
 * @property {string} sourceName   Name exactly as supplied by the browser.
 * @property {string} entryName    Unique, safe name inside the archive.
 * @property {boolean} changed     True when entryName differs from sourceName.
 * @property {('sanitized'|'duplicate')[]} reasons
 */

/**
 * Assigns unique archive entry names deterministically.
 *
 * Pass 1 keeps every name that is unique (compared case-insensitively, because
 * Windows and macOS file systems are case-insensitive). Pass 2 renames later
 * duplicates to "name (2).ext", "name (3).ext", … skipping any name already
 * claimed, so no entry ever overwrites another.
 *
 * @param {string[]} sourceNames
 * @returns {EntryNameAssignment[]}
 */
export function assignEntryNames(sourceNames) {
  const claimed = new Set();
  const keyOf = (name) => name.normalize('NFC').toLowerCase();
  const assignments = sourceNames.map((sourceName, index) => {
    const safe = sanitizeEntryName(sourceName);
    return {
      index,
      sourceName,
      entryName: safe,
      changed: safe !== sourceName,
      reasons: safe !== sourceName ? ['sanitized'] : [],
      duplicate: false,
    };
  });

  for (const assignment of assignments) {
    const key = keyOf(assignment.entryName);
    if (claimed.has(key)) assignment.duplicate = true;
    else claimed.add(key);
  }

  for (const assignment of assignments) {
    if (!assignment.duplicate) continue;
    const { stem, ext } = splitName(assignment.entryName);
    const suffix = ext ? `.${ext}` : '';
    let counter = 2;
    let candidate = `${stem} (${counter})${suffix}`;
    while (claimed.has(keyOf(candidate))) {
      counter += 1;
      candidate = `${stem} (${counter})${suffix}`;
    }
    claimed.add(keyOf(candidate));
    assignment.entryName = candidate;
    assignment.changed = true;
    assignment.reasons.push('duplicate');
  }

  return assignments.map(({ duplicate: _duplicate, ...rest }) => rest);
}

/**
 * Download name for a prepared (re-encoded or rewritten) copy, keeping the
 * original extension spelling, e.g. "Banner.JPG" → "Banner-prepared.JPG".
 *
 * @param {string} name
 */
export function preparedFileName(name) {
  const { stem, ext } = splitName(name);
  return ext ? `${stem}-prepared.${ext}` : `${stem}-prepared`;
}

/**
 * Download name for a ZIP of originals, e.g. "compressive-originals-3-files-2026-10-26.zip".
 *
 * @param {number} count
 * @param {Date} [date]
 */
export function archiveFileName(count, date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `compressive-originals-${count}-files-${stamp}.zip`;
}

/**
 * MIME type for a download: the canonical type for its extension, or a generic
 * one. The type has to agree with the name, because a browser may rename a
 * download to match its type: Firefox saves "Artwork.ai", reported by the
 * system as a PDF, as "Artwork.pdf".
 *
 * @param {string} filename
 */
export function downloadMimeType(filename) {
  return MIME_BY_EXTENSION[getExtension(filename)] ?? 'application/octet-stream';
}
