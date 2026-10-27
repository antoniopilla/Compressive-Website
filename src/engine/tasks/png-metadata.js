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
 *
 * OxiPNG also turns colour images whose pixels are all grey into greyscale,
 * but keeps their colour profile, and an RGB profile on a greyscale PNG is
 * invalid (libpng-based tools warn about it or drop it). The image route only
 * accepts sRGB profiles, so such a profile is replaced by the equivalent sRGB
 * chunk, which is valid for greyscale images.
 */

const KEPT_CHUNKS = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS',
  'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCv', 'cLLi',
  'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT',
]);

/** PNG colour types without colour channels: greyscale, and greyscale with alpha. */
const GREYSCALE_TYPES = new Set([0, 4]);

/** A complete sRGB chunk (rendering intent 0, perceptual), CRC included. */
const SRGB_CHUNK = Uint8Array.from([0, 0, 0, 1, 0x73, 0x52, 0x47, 0x42, 0, 0xae, 0xce, 0x1c, 0xe9]);

const SIGNATURE_LENGTH = 8;

/**
 * @param {Uint8Array} bytes  A complete PNG file.
 * @returns {{ bytes: Uint8Array, removed: string[] }}  The PNG without metadata, and the chunk types removed.
 */
export function stripPngMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @type {{ type: string, data: Uint8Array }[]} */
  const kept = [];
  const removed = [];
  let colourType = null;
  let ended = false;
  for (let offset = SIGNATURE_LENGTH; offset < bytes.length && !ended; ) {
    const end = offset + 12 + (offset + 4 <= bytes.length ? view.getUint32(offset) : 0);
    if (end > bytes.length) throw new RangeError('This PNG ends in the middle of a chunk.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'IHDR') colourType = bytes[offset + 8 + 9];
    if (KEPT_CHUNKS.has(type)) kept.push({ type, data: bytes.subarray(offset, end) });
    else removed.push(type);
    offset = end;
    ended = type === 'IEND';
  }
  if (!ended) throw new RangeError('This PNG has no end marker.');

  const greyWithProfile = GREYSCALE_TYPES.has(colourType) && kept.some((chunk) => chunk.type === 'iCCP');
  if (!removed.length && !greyWithProfile) return { bytes, removed };

  let chunks = kept;
  if (greyWithProfile) {
    chunks = kept.filter((chunk) => chunk.type !== 'iCCP');
    if (!chunks.some((chunk) => chunk.type === 'sRGB')) chunks.splice(1, 0, { type: 'sRGB', data: SRGB_CHUNK });
  }
  const output = new Uint8Array(SIGNATURE_LENGTH + chunks.reduce((total, chunk) => total + chunk.data.length, 0));
  output.set(bytes.subarray(0, SIGNATURE_LENGTH));
  let position = SIGNATURE_LENGTH;
  for (const chunk of chunks) {
    output.set(chunk.data, position);
    position += chunk.data.length;
  }
  return { bytes: output, removed };
}
