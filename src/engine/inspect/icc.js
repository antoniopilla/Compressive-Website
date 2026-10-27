/**
 * Read-only ICC profile inspection.
 *
 * Browsers convert images into sRGB when drawing them to a canvas, and canvas
 * encoders do not embed the source profile. Re-encoding an Adobe RGB, Display
 * P3, CMYK or grey-managed image would therefore change its printed colours.
 * The image pipeline uses this module to keep such files unchanged.
 */

import { latin1 } from './bytes.js';

/**
 * @typedef {object} IccInfo
 * @property {boolean} present
 * @property {string | null} description  Profile description, e.g. "sRGB IEC61966-2.1".
 * @property {string | null} colorSpace   ICC data colour space signature, e.g. "RGB", "CMYK", "GRAY".
 * @property {boolean} isSrgb             True only when the description identifies sRGB.
 */

/** @returns {IccInfo} */
export function unknownIcc() {
  return { present: true, description: null, colorSpace: null, isSrgb: false };
}

/**
 * Parses the profile description from raw ICC bytes (v2 "desc" or v4 "mluc").
 *
 * @param {Uint8Array} bytes Complete ICC profile.
 * @returns {IccInfo}
 */
export function describeIccProfile(bytes) {
  if (!bytes || bytes.length < 132) return unknownIcc();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorSpace = latin1(bytes, 16, 20).trim() || null;
  const tagCount = view.getUint32(128);
  let description = null;

  for (let index = 0; index < tagCount && 132 + index * 12 + 12 <= bytes.length; index += 1) {
    const entry = 132 + index * 12;
    if (latin1(bytes, entry, entry + 4) !== 'desc') continue;
    const offset = view.getUint32(entry + 4);
    const size = view.getUint32(entry + 8);
    if (offset + Math.min(size, 12) > bytes.length) break;
    const type = latin1(bytes, offset, offset + 4);
    if (type === 'desc' && offset + 12 <= bytes.length) {
      const length = view.getUint32(offset + 8);
      description = latin1(bytes, offset + 12, Math.min(bytes.length, offset + 12 + length)).replace(/\0+$/, '');
    } else if (type === 'mluc' && offset + 16 <= bytes.length) {
      const records = view.getUint32(offset + 8);
      const recordSize = view.getUint32(offset + 12);
      if (records > 0 && offset + 16 + recordSize <= bytes.length) {
        const length = view.getUint32(offset + 16 + 4);
        const start = offset + view.getUint32(offset + 16 + 8);
        let text = '';
        for (let position = start; position + 1 < Math.min(bytes.length, start + length); position += 2) {
          text += String.fromCharCode(view.getUint16(position));
        }
        description = text.replace(/\0+$/, '');
      }
    }
    break;
  }

  return {
    present: true,
    description,
    colorSpace,
    isSrgb: colorSpace === 'RGB' && isSrgbDescription(description),
  };
}

/** @param {string | null} description */
function isSrgbDescription(description) {
  return Boolean(description) && /\bs ?rgb\b|iec\s*61966-2[.-]1/i.test(description);
}

/**
 * Real ICC profiles are at most a few hundred kilobytes. Inflation stops past
 * this size so a malformed or hostile PNG cannot expand into gigabytes of
 * memory on the page.
 */
const MAX_INFLATED_ICC_BYTES = 4_000_000;

/**
 * Inflates zlib-compressed data (PNG iCCP) with the native DecompressionStream.
 * Returns null when the API is unavailable, the data is invalid or it inflates
 * past `maxBytes`; callers then treat the profile as unidentified and keep the
 * original file.
 *
 * @param {Uint8Array} compressed
 * @param {number} [maxBytes]
 * @returns {Promise<Uint8Array | null>}
 */
export async function inflateZlib(compressed, maxBytes = MAX_INFLATED_ICC_BYTES) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const inflated = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      inflated.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return inflated;
  } catch {
    return null;
  }
}
