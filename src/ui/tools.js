/**
 * The tools Compressive offers, as plain data. The hero's tool buttons read
 * from this list, so adding or renaming a tool here updates the page.
 *
 * - `accept` / `multiple` configure the file picker the tool opens.
 * - `replace`: picking files for a single-file tool starts a fresh selection,
 *   because one image or PDF is compressed at a time; the ZIP tool adds to it.
 * - `action: 'print'` opens the print check instead of a file picker.
 */

import { ACCEPT } from './files.js';

/**
 * @typedef {object} Tool
 * @property {string} id
 * @property {string} label        Button text, e.g. "Compress PNG".
 * @property {string} hint         One short line under the label.
 * @property {string} [accept]
 * @property {boolean} [multiple]
 * @property {boolean} [replace]
 * @property {'print'} [action]
 */

/** @type {Tool[]} */
export const TOOLS = [
  { id: 'png', label: 'Compress PNG', hint: 'Transparency kept', accept: '.png', multiple: false, replace: true },
  { id: 'jpg', label: 'Compress JPG', hint: 'Lighter photos', accept: '.jpg,.jpeg', multiple: false, replace: true },
  { id: 'webp', label: 'Compress WebP', hint: 'Smaller WebP images', accept: '.webp', multiple: false, replace: true },
  { id: 'pdf', label: 'Shrink a PDF', hint: 'Text and pages untouched', accept: '.pdf', multiple: false, replace: true },
  { id: 'zip', label: 'Zip files', hint: 'Many files in one', accept: ACCEPT, multiple: true, replace: false },
  { id: 'print', label: 'Check print sharpness', hint: 'Before you print', action: 'print' },
];
