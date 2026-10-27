/**
 * Content sniffing. Routing is decided by the filename extension; sniffing
 * confirms that the contents really are that kind of file so damaged or
 * misnamed files are rejected clearly instead of being "repaired" or converted.
 *
 * All checks are read-only and look at the first few kilobytes only.
 */

import { latin1, readBytes, startsWithBytes } from './bytes.js';

const HEAD_BYTES = 64 * 1024;

/**
 * Identifies the container format from leading bytes.
 *
 * @param {Uint8Array} bytes
 * @returns {string | null} e.g. "jpeg", "png", "webp", "pdf", "postscript", "dos-eps", "psd", "gif", "zip", "gzip", "svg"
 */
export function detectFormat(bytes) {
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (latin1(bytes, 0, 4) === 'RIFF' && latin1(bytes, 8, 12) === 'WEBP') return 'webp';
  if (latin1(bytes, 0, 4) === '8BPS') return 'psd';
  if (startsWithBytes(bytes, [0xc5, 0xd0, 0xd3, 0xc6])) return 'dos-eps';
  if (latin1(bytes, 0, 4) === '%!PS') return 'postscript';
  if (latin1(bytes, 0, 1024).includes('%PDF-')) return 'pdf';
  if (latin1(bytes, 0, 4) === 'GIF8') return 'gif';
  if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWithBytes(bytes, [0x1f, 0x8b])) return 'gzip';
  if (looksLikeSvg(bytes)) return 'svg';
  return null;
}

/**
 * True when the bytes decode to XML/markup whose root contains an <svg> element.
 * Decoding here is for inspection only; the file is never re-encoded.
 *
 * @param {Uint8Array} bytes
 */
export function looksLikeSvg(bytes) {
  const text = decodeTextHead(bytes);
  // TextDecoder already strips a UTF-8 byte-order mark; trimStart() removes a stray one too.
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('<')) return false;
  return /<svg[\s>/:]/i.test(trimmed);
}

/** @param {Uint8Array} bytes */
function decodeTextHead(bytes) {
  if (startsWithBytes(bytes, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(bytes);
  if (startsWithBytes(bytes, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

const FORMAT_NAMES = {
  jpeg: 'a JPEG image',
  png: 'a PNG image',
  webp: 'a WebP image',
  psd: 'a Photoshop document',
  'dos-eps': 'an EPS file',
  postscript: 'a PostScript or EPS file',
  pdf: 'a PDF document',
  gif: 'a GIF image',
  zip: 'a ZIP archive',
  gzip: 'compressed (gzip) data',
  svg: 'an SVG file',
};

/** Which detected formats are acceptable for each extension. */
const EXPECTED_FORMATS = {
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  png: ['png'],
  webp: ['webp'],
  pdf: ['pdf'],
  // Illustrator files are PDF-compatible (%PDF) or PostScript-based (%!PS-Adobe).
  ai: ['pdf', 'postscript'],
  eps: ['postscript', 'dos-eps'],
  svg: ['svg'],
  psd: ['psd'],
};

const EXTENSION_FOR_FORMAT = { jpeg: 'jpg', png: 'png', webp: 'webp', pdf: 'pdf', psd: 'psd', svg: 'svg', gif: 'gif', zip: 'zip' };

/**
 * @typedef {object} SignatureCheck
 * @property {boolean} ok
 * @property {string | null} detected
 * @property {string} [message]   Actionable message when not ok.
 */

/**
 * Confirms that a file's contents match its extension.
 *
 * @param {Blob} file
 * @param {string} extension Lowercase extension.
 * @returns {Promise<SignatureCheck>}
 */
export async function checkSignature(file, extension) {
  const head = await readBytes(file, 0, HEAD_BYTES);
  const detected = detectFormat(head);
  const expected = EXPECTED_FORMATS[extension] ?? [];
  if (expected.includes(detected)) return { ok: true, detected };

  if (extension === 'svg' && detected === 'gzip') {
    return {
      ok: false,
      detected,
      message:
        'This SVG is compressed (SVGZ). Save it as a plain .svg file from your design software and add it again.',
    };
  }
  if (detected && FORMAT_NAMES[detected]) {
    const suggestion = EXTENSION_FOR_FORMAT[detected];
    return {
      ok: false,
      detected,
      message:
        `This file is named .${extension} but contains ${FORMAT_NAMES[detected]}.` +
        (suggestion && suggestion !== extension
          ? ` Rename it with the .${suggestion} extension (or export it again) and add it once more.`
          : ' Export it again from the original software and add it once more.'),
    };
  }
  return {
    ok: false,
    detected,
    message: `This file is named .${extension} but its contents are not recognisable as that format. It may be damaged or misnamed. Export it again and add it once more.`,
  };
}
