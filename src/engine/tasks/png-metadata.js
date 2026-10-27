/**
 * Removes metadata from an optimised PNG while keeping everything that
 * affects how it looks or prints. OxiPNG (as built for the browser) copies
 * every chunk through, so text, timestamps and EXIF would otherwise survive.
 *
 * Kept: the image itself (IHDR, PLTE, IDAT, IEND), transparency (tRNS), colour
 * (cHRM, gAMA, iCCP, sBIT, sRGB, cICP, mDCv, cLLi), the background hint
 * (bKGD), print size (pHYs) and animation (acTL, fcTL, fdAT). Everything else
 * is dropped: text (tEXt, zTXt, iTXt), EXIF (eXIf), the modification time
 * (tIME) and private editor chunks. Chunks are copied whole, so their CRCs
 * stay valid.
 */

const KEPT_CHUNKS = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS',
  'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCv', 'cLLi',
  'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT',
]);

const SIGNATURE_LENGTH = 8;

/**
 * @param {Uint8Array} bytes  A complete PNG file.
 * @returns {{ bytes: Uint8Array, removed: string[] }}  The PNG without metadata, and the chunk types removed.
 */
export function stripPngMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept = [bytes.subarray(0, SIGNATURE_LENGTH)];
  const removed = [];
  let length = SIGNATURE_LENGTH;
  let ended = false;
  for (let offset = SIGNATURE_LENGTH; offset < bytes.length && !ended; ) {
    const end = offset + 12 + (offset + 4 <= bytes.length ? view.getUint32(offset) : 0);
    if (end > bytes.length) throw new RangeError('This PNG ends in the middle of a chunk.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (KEPT_CHUNKS.has(type)) {
      kept.push(bytes.subarray(offset, end));
      length += end - offset;
    } else {
      removed.push(type);
    }
    offset = end;
    ended = type === 'IEND';
  }
  if (!ended) throw new RangeError('This PNG has no end marker.');
  if (!removed.length) return { bytes, removed };
  const output = new Uint8Array(length);
  let position = 0;
  for (const part of kept) {
    output.set(part, position);
    position += part.length;
  }
  return { bytes: output, removed };
}
