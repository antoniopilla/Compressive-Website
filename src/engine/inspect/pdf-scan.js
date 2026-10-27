/**
 * Raw byte scan of a PDF, run before parsing. It finds markers that make a
 * structural rewrite unsafe even when they sit in places a parser might gloss
 * over (for example in a later incremental update). The parse-level checks in
 * the PDF task confirm or extend these findings; either source is enough to
 * keep the original file.
 */

import { asciiBytes, countBytes, indexOfBytes, latin1 } from './bytes.js';

const MARKERS = {
  byteRange: asciiBytes('/ByteRange'),
  docMdp: asciiBytes('/DocMDP'),
  ur3: asciiBytes('/UR3'),
  pdfx: asciiBytes('GTS_PDFX'),
  pdfxid: asciiBytes('pdfxid:'),
  pdfaid: asciiBytes('pdfaid:part'),
  xfa: asciiBytes('/XFA'),
  eof: asciiBytes('%%EOF'),
  linearized: asciiBytes('/Linearized'),
  obj: asciiBytes('obj'),
};

/**
 * @typedef {object} PdfScan
 * @property {number} headerOffset   Byte offset of "%PDF-" (-1 when missing).
 * @property {string | null} version Declared header version, e.g. "1.4".
 * @property {number} revisions      Count of %%EOF markers (1 = no incremental updates).
 * @property {boolean} signatureMarkers  /ByteRange, /DocMDP or /UR3 found.
 * @property {boolean} pdfxMarker
 * @property {boolean} pdfaMarker
 * @property {boolean} xfaMarker
 * @property {boolean} linearized
 * @property {number} duplicateObjectNumbers  Object numbers defined more than once in uncompressed object headers.
 */

/**
 * @param {Uint8Array} bytes Whole PDF.
 * @returns {PdfScan}
 */
export function scanPdfBytes(bytes) {
  const headerOffset = indexOfBytes(bytes.subarray(0, 1024), asciiBytes('%PDF-'));
  const version =
    headerOffset >= 0 ? (latin1(bytes, headerOffset + 5, headerOffset + 8).match(/^\d\.\d/)?.[0] ?? null) : null;
  const has = (marker) => indexOfBytes(bytes, marker) !== -1;
  return {
    headerOffset,
    version,
    revisions: Math.max(1, countBytes(bytes, MARKERS.eof, 10_000)),
    signatureMarkers: has(MARKERS.byteRange) || has(MARKERS.docMdp) || has(MARKERS.ur3),
    pdfxMarker: has(MARKERS.pdfx) || has(MARKERS.pdfxid),
    pdfaMarker: has(MARKERS.pdfaid),
    xfaMarker: has(MARKERS.xfa),
    linearized: indexOfBytes(bytes.subarray(0, 4096), MARKERS.linearized) !== -1,
    duplicateObjectNumbers: countDuplicateObjectHeaders(bytes),
  };
}

const isWhitespace = (byte) => byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00;
const isDelimiter = (byte) => '()<>[]{}/%'.includes(String.fromCharCode(byte));
const isDigit = (byte) => byte >= 0x30 && byte <= 0x39;

/**
 * Counts object numbers that appear in more than one "N G obj" header.
 *
 * pdf-lib reads objects in file order (later definitions win) rather than
 * through the cross-reference table. That matches what PDF readers do for
 * incremental updates, but a single-revision file that defines an object
 * twice is ambiguous, so the PDF task keeps the original in that case.
 * Objects inside compressed object streams are not visible to this scan.
 *
 * @param {Uint8Array} bytes
 */
export function countDuplicateObjectHeaders(bytes) {
  const needle = MARKERS.obj;
  const counts = new Map();
  let duplicates = 0;
  let position = indexOfBytes(bytes, needle, 0);
  while (position !== -1) {
    const after = bytes[position + 3];
    if (after === undefined || isWhitespace(after) || isDelimiter(after)) {
      let cursor = position - 1;
      const walk = (predicate, maxLength) => {
        const end = cursor;
        while (cursor >= 0 && predicate(bytes[cursor]) && end - cursor < maxLength + 1) cursor -= 1;
        return end - cursor;
      };
      if (walk(isWhitespace, 64) > 0) {
        const generationLength = walk(isDigit, 6);
        if (generationLength > 0 && generationLength <= 5 && walk(isWhitespace, 64) > 0) {
          const numberEnd = cursor;
          const numberLength = walk(isDigit, 11);
          const boundary = cursor < 0 || isWhitespace(bytes[cursor]) || isDelimiter(bytes[cursor]);
          if (numberLength > 0 && numberLength <= 10 && boundary) {
            const objectNumber = Number(latin1(bytes, cursor + 1, numberEnd + 1));
            const seen = (counts.get(objectNumber) ?? 0) + 1;
            counts.set(objectNumber, seen);
            if (seen === 2) duplicates += 1;
          }
        }
      }
    }
    position = indexOfBytes(bytes, needle, position + 3);
  }
  return duplicates;
}
