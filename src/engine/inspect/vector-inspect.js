/**
 * Read-only inspection of protected vector files (SVG, EPS, AI).
 *
 * Nothing here modifies, renders, serialises or re-encodes the file. Text is
 * decoded only to read a few header values: the artboard size (for the
 * aspect-ratio check) and whether the file references embedded raster images
 * whose resolution cannot be assessed.
 */

import { latin1, readBytes } from './bytes.js';

const SVG_HEAD_BYTES = 512 * 1024;
const POSTSCRIPT_HEAD_BYTES = 64 * 1024;

/**
 * @typedef {object} VectorInfo
 * @property {{ width: number, height: number } | null} artboard  Size in the file's own units (aspect checks only).
 * @property {boolean | null} containsRaster  true = embedded images found, false = none found in the inspected part, null = unknown.
 * @property {string[]} notes
 */

/**
 * @param {Blob} file
 * @param {string} extension
 * @returns {Promise<VectorInfo>}
 */
export async function inspectVector(file, extension) {
  if (extension === 'svg') return inspectSvg(file);
  if (extension === 'eps' || extension === 'ai') return inspectPostScriptComments(file);
  return { artboard: null, containsRaster: null, notes: [] };
}

/** @param {Blob} file */
async function inspectSvg(file) {
  const bytes = await readBytes(file, 0, SVG_HEAD_BYTES);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const rootMatch = text.match(/<svg\b[^>]*>/i);
  let artboard = null;
  if (rootMatch) {
    const root = rootMatch[0];
    const viewBox = root.match(/viewBox\s*=\s*["']\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*["']/i);
    if (viewBox) {
      artboard = { width: Number(viewBox[3]), height: Number(viewBox[4]) };
    } else {
      const width = root.match(/\swidth\s*=\s*["']\s*([\d.]+)/i);
      const height = root.match(/\sheight\s*=\s*["']\s*([\d.]+)/i);
      if (width && height) artboard = { width: Number(width[1]), height: Number(height[1]) };
    }
    if (artboard && !(artboard.width > 0 && artboard.height > 0)) artboard = null;
  }
  const hasImage = /<(?:[\w-]+:)?image\b/i.test(text);
  const inspectedAll = file.size <= SVG_HEAD_BYTES;
  return {
    artboard,
    containsRaster: hasImage ? true : inspectedAll ? false : null,
    notes: hasImage ? ['This SVG contains embedded or linked images. Their resolution is not checked.'] : [],
  };
}

/**
 * Reads %%HiResBoundingBox / %%BoundingBox DSC comments (in points) from
 * PostScript-based EPS and Illustrator files.
 *
 * @param {Blob} file
 */
async function inspectPostScriptComments(file) {
  const head = latin1(await readBytes(file, 0, POSTSCRIPT_HEAD_BYTES));
  if (!head.startsWith('%!PS') && !/^\xC5\xD0\xD3\xC6/.test(head)) {
    return { artboard: null, containsRaster: null, notes: [] };
  }
  const box =
    head.match(/%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/) ??
    head.match(/%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
  if (!box) return { artboard: null, containsRaster: null, notes: [] };
  const [llx, lly, urx, ury] = box.slice(1, 5).map(Number);
  const width = urx - llx;
  const height = ury - lly;
  return {
    artboard: width > 0 && height > 0 ? { width, height } : null,
    containsRaster: null,
    notes: [],
  };
}
