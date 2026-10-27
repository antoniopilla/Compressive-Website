/**
 * The tools Compressive offers, as plain data. The hero's tool buttons and the
 * command prompt both read from this list, so adding or renaming a tool here
 * updates both.
 *
 * - `accept` / `multiple` configure the file picker the tool opens.
 * - `replace`: picking files for a single-file tool starts a fresh selection,
 *   because one image or PDF is compressed at a time; the ZIP tool adds to it.
 * - `action: 'print'` opens the print check instead of a file picker.
 * - `types` (file-type words such as "png") and then `keywords` (hints such as
 *   "photo") let plain-text questions in the command prompt find the tool.
 * - `accent` is one of the design system's accent colours.
 */

import { ACCEPT } from './files.js';

/**
 * @typedef {object} Tool
 * @property {string} id
 * @property {string} command      Slash command in the prompt, e.g. "/png".
 * @property {string} label        Button text, e.g. "Compress PNG".
 * @property {string} description  One short line for the prompt sidebar.
 * @property {'sky'|'amber'|'coral'|'violet'|'mint'} accent
 * @property {string} [accept]
 * @property {boolean} [multiple]
 * @property {boolean} [replace]
 * @property {'print'} [action]
 * @property {string} actionLabel  Text of the button the prompt prints.
 * @property {string[]} types      Strong matches: file types named in a request.
 * @property {string[]} keywords   Weaker hints, used only when no type is named.
 * @property {{ kind: 'info'|'success'|'warning'|'error'|'muted', text: string }[]} output
 */

/** @type {Tool[]} */
export const TOOLS = [
  {
    id: 'png',
    command: '/png',
    label: 'Compress PNG',
    description: 'Smaller PNGs, transparency kept',
    accent: 'mint',
    accept: '.png',
    multiple: false,
    replace: true,
    actionLabel: 'Choose a PNG',
    types: ['png'],
    keywords: ['transparent', 'screenshot', 'logo', 'icon'],
    output: [
      { kind: 'success', text: 'PNG compressor ready.' },
      { kind: 'info', text: 'Keeps transparency and every colour it can. Never enlarges your image.' },
      { kind: 'muted', text: 'One image at a time, up to 250 MB.' },
    ],
  },
  {
    id: 'jpg',
    command: '/jpg',
    label: 'Compress JPG',
    description: 'Lighter photos that look the same',
    accent: 'amber',
    accept: '.jpg,.jpeg',
    multiple: false,
    replace: true,
    actionLabel: 'Choose a JPG',
    types: ['jpg', 'jpeg'],
    keywords: ['photo', 'photos', 'picture', 'camera'],
    output: [
      { kind: 'success', text: 'JPG compressor ready.' },
      { kind: 'info', text: 'Re-saves at quality 0.85 and fixes camera rotation.' },
      { kind: 'muted', text: 'One photo at a time, up to 250 MB.' },
    ],
  },
  {
    id: 'webp',
    command: '/webp',
    label: 'Compress WebP',
    description: 'Shrink WebP images',
    accent: 'sky',
    accept: '.webp',
    multiple: false,
    replace: true,
    actionLabel: 'Choose a WebP',
    types: ['webp'],
    keywords: [],
    output: [
      { kind: 'success', text: 'WebP compressor ready.' },
      { kind: 'info', text: 'Re-saves at quality 0.85 and keeps transparency.' },
      { kind: 'muted', text: 'One image at a time, up to 250 MB.' },
    ],
  },
  {
    id: 'pdf',
    command: '/pdf',
    label: 'Shrink a PDF',
    description: 'Remove hidden bloat from PDFs',
    accent: 'coral',
    accept: '.pdf',
    multiple: false,
    replace: true,
    actionLabel: 'Choose a PDF',
    types: ['pdf'],
    keywords: ['document', 'doc', 'scan'],
    output: [
      { kind: 'success', text: 'PDF compressor ready.' },
      { kind: 'info', text: 'Removes unused data and old saved versions. Text, fonts and pages stay untouched.' },
      { kind: 'warning', text: 'Signed or password-protected PDFs are returned unchanged.' },
    ],
  },
  {
    id: 'zip',
    command: '/zip',
    label: 'Zip files',
    description: 'Bundle many files into one',
    accent: 'violet',
    accept: ACCEPT,
    multiple: true,
    replace: false,
    actionLabel: 'Choose files to zip',
    types: ['zip'],
    keywords: ['bundle', 'many', 'multiple', 'several', 'folder', 'batch', 'files'],
    output: [
      { kind: 'success', text: 'ZIP maker ready.' },
      { kind: 'info', text: 'Packs your files into one ZIP and checks every file after packing.' },
      { kind: 'muted', text: 'Files go in unchanged. Photos that are already compressed barely shrink.' },
    ],
  },
  {
    id: 'print',
    command: '/print',
    label: 'Check print sharpness',
    description: 'Will it look sharp printed?',
    accent: 'sky',
    action: 'print',
    actionLabel: 'Open the print check',
    types: ['print', 'printing', 'printed'],
    keywords: ['resolution', 'dpi', 'ppi', 'sharp', 'blurry', 'poster', 'banner'],
    output: [
      { kind: 'success', text: 'Print check ready.' },
      { kind: 'info', text: 'Enter the print size and see if your image has enough pixels for it.' },
      { kind: 'muted', text: 'Works with JPG, PNG, WebP and PSD files.' },
    ],
  },
];

/** File types Compressive keeps exactly as they are (mentioned by the prompt). */
export const KEPT_TYPES = ['svg', 'ai', 'eps', 'psd'];

/** @param {string} text */
const wordsOf = (text) => String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Interprets a plain-text request, e.g. "can you make my logo.jpg smaller?".
 * File types named in the request win over looser hints, so that example finds
 * the JPG tool even though "logo" hints at PNG.
 *
 * @param {string} text
 * @returns {{ tool: Tool } | { keptType: string } | null}
 */
export function interpretRequest(text) {
  const words = wordsOf(text);
  const byType = TOOLS.find((tool) => tool.types.some((type) => words.includes(type)));
  if (byType) return { tool: byType };
  const keptType = KEPT_TYPES.find((type) => words.includes(type));
  if (keptType) return { keptType };
  const byHint = TOOLS.find((tool) => tool.keywords.some((keyword) => words.includes(keyword)));
  return byHint ? { tool: byHint } : null;
}
