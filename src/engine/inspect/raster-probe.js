/**
 * Header-only raster inspection for JPEG, PNG, WebP and PSD.
 *
 * Reads pixel dimensions, EXIF orientation, animation, alpha, bit depth,
 * colour model and ICC profile information without decoding pixels. This lets
 * the engine apply memory budgets and colour-safety rules before any canvas is
 * allocated, and lets the resolution check run on files that are never
 * re-encoded (PSD, ZIP members).
 */

import { StudioError } from '../errors.js';
import { createBlobReader, latin1, readBytes, startsWithBytes } from './bytes.js';
import { describeIccProfile, inflateZlib, unknownIcc } from './icc.js';

/**
 * @typedef {object} RasterProbe
 * @property {'jpeg'|'png'|'webp'|'psd'} format
 * @property {number} width              Stored pixel width (before orientation).
 * @property {number} height             Stored pixel height (before orientation).
 * @property {number} orientation        EXIF orientation 1–8 (1 = as stored).
 * @property {number} orientedWidth      Width as displayed after orientation.
 * @property {number} orientedHeight     Height as displayed after orientation.
 * @property {boolean} animated
 * @property {boolean | null} hasAlpha
 * @property {number | null} bitDepth     Bits per channel.
 * @property {string | null} colorModel   "rgb", "gray", "cmyk", "indexed", "lab", …
 * @property {import('./icc.js').IccInfo | null} icc
 * @property {boolean | null} lossless    WebP: VP8L bitstream.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** @param {string} message */
const corrupt = (message) => new StudioError('corrupt-image', message);

/**
 * Header segments (and JPEG fill bytes) walked before a file counts as
 * damaged. Real images have a few dozen, a few hundred at most; without a cap,
 * a crafted or corrupted file could keep the check busy for hours.
 */
export const MAX_HEADER_STEPS = 10_000;
const tooLong = () => corrupt('The image header is unusually long, which usually means the file is damaged.');

/**
 * Reads the EXIF orientation from a TIFF structure (used by JPEG APP1, PNG eXIf
 * and WebP EXIF).
 *
 * @param {Uint8Array} bytes
 * @param {number} tiffStart Offset of the "II"/"MM" byte-order mark.
 * @returns {number | null}
 */
function parseTiffOrientation(bytes, tiffStart) {
  if (bytes.length < tiffStart + 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = view.getUint16(tiffStart);
  const little = order === 0x4949 ? true : order === 0x4d4d ? false : null;
  if (little === null || view.getUint16(tiffStart + 2, little) !== 42) return null;
  const ifd = tiffStart + view.getUint32(tiffStart + 4, little);
  if (ifd + 2 > bytes.length) return null;
  const count = view.getUint16(ifd, little);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > bytes.length) return null;
    if (view.getUint16(entry, little) !== 0x0112) continue;
    if (view.getUint16(entry + 2, little) !== 3) return null;
    const value = view.getUint16(entry + 8, little);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/**
 * Orientations 5–8 rotate by 90°, swapping displayed width and height.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} orientation
 */
export function orientedDimensions(width, height, orientation) {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

/**
 * @param {Blob} blob
 * @param {string} extension Lowercase extension used to pick the parser.
 * @returns {Promise<RasterProbe>}
 */
export async function probeRaster(blob, extension) {
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return probeJpeg(blob);
    case 'png':
      return probePng(blob);
    case 'webp':
      return probeWebp(blob);
    case 'psd':
      return probePsd(blob);
    default:
      throw new StudioError('unsupported-extension', `No raster parser for ".${extension}".`);
  }
}

/**
 * @param {Partial<RasterProbe> & { format: RasterProbe['format'], width: number, height: number }} fields
 * @returns {RasterProbe}
 */
function finishProbe(fields) {
  const orientation = fields.orientation ?? 1;
  const oriented = orientedDimensions(fields.width, fields.height, orientation);
  return {
    animated: false,
    hasAlpha: null,
    bitDepth: null,
    colorModel: null,
    icc: null,
    lossless: null,
    ...fields,
    orientation,
    orientedWidth: oriented.width,
    orientedHeight: oriented.height,
  };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** @param {Blob} blob */
async function probeJpeg(blob) {
  const reader = createBlobReader(blob);
  const start = await reader.read(0, 2);
  if (!startsWithBytes(start, [0xff, 0xd8])) throw corrupt('The file does not start with a JPEG header.');

  let offset = 2;
  let orientation = 1;
  let frame = null;
  /** @type {{ sequence: number, data: Uint8Array }[]} */
  const iccChunks = [];
  let reachedScan = false;

  let steps = 0;
  while (offset + 4 <= blob.size) {
    if (++steps > MAX_HEADER_STEPS) throw tooLong();
    const head = await reader.read(offset, 4);
    if (head[0] !== 0xff) throw corrupt('The JPEG marker structure is damaged.');
    const marker = head[1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // markers without a length field
      continue;
    }
    if (marker === 0xda) {
      reachedScan = true; // start of scan: pixel data follows
      break;
    }
    if (marker === 0xd9) break; // end of image
    const length = (head[2] << 8) | head[3];
    if (length < 2) throw corrupt('A JPEG segment has an invalid length.');
    const segmentStart = offset + 4;
    const segmentLength = length - 2;

    if (marker === 0xe1) {
      const data = await reader.read(segmentStart, Math.min(segmentLength, 65_533));
      if (latin1(data, 0, 6) === 'Exif\0\0') orientation = parseTiffOrientation(data, 6) ?? orientation;
    } else if (marker === 0xe2) {
      const data = await reader.read(segmentStart, segmentLength);
      if (latin1(data, 0, 12) === 'ICC_PROFILE\0' && data.length > 14) {
        iccChunks.push({ sequence: data[12], data: data.subarray(14) });
      }
    } else if (JPEG_SOF_MARKERS.has(marker)) {
      const data = await reader.read(segmentStart, 6);
      if (data.length < 6) throw corrupt('The JPEG frame header is truncated.');
      frame = {
        bitDepth: data[0],
        height: (data[1] << 8) | data[2],
        width: (data[3] << 8) | data[4],
        components: data[5],
      };
    }
    offset = segmentStart + segmentLength;
  }

  if (!frame || frame.width === 0 || frame.height === 0) {
    throw corrupt('The JPEG does not declare its pixel dimensions.');
  }
  if (!reachedScan) throw corrupt('The JPEG ends before its image data.');

  let icc = null;
  if (iccChunks.length) {
    iccChunks.sort((a, b) => a.sequence - b.sequence);
    const total = iccChunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const profile = new Uint8Array(total);
    let position = 0;
    for (const chunk of iccChunks) {
      profile.set(chunk.data, position);
      position += chunk.data.length;
    }
    icc = describeIccProfile(profile);
  }

  // Four-component JPEGs are CMYK or YCCK; both are CMYK artwork for print purposes.
  const colorModel = frame.components === 1 ? 'gray' : frame.components === 4 ? 'cmyk' : 'rgb';
  return finishProbe({
    format: 'jpeg',
    width: frame.width,
    height: frame.height,
    orientation,
    hasAlpha: false,
    bitDepth: frame.bitDepth,
    colorModel,
    icc,
  });
}

const PNG_COLOR_MODELS = { 0: 'gray', 2: 'rgb', 3: 'indexed', 4: 'gray', 6: 'rgb' };

/** @param {Blob} blob */
async function probePng(blob) {
  const reader = createBlobReader(blob);
  const header = await reader.read(0, 33);
  if (!startsWithBytes(header, PNG_SIGNATURE)) throw corrupt('The file does not start with a PNG signature.');
  if (latin1(header, 12, 16) !== 'IHDR') throw corrupt('The PNG header chunk is missing.');
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = header[24];
  const colorType = header[25];
  if (width === 0 || height === 0) throw corrupt('The PNG declares zero pixel dimensions.');

  let offset = 8;
  let animated = false;
  let hasTransparencyChunk = false;
  let orientation = 1;
  let icc = null;
  let reachedImageData = false;

  let steps = 0;
  while (offset + 8 <= blob.size) {
    if (++steps > MAX_HEADER_STEPS) throw tooLong();
    const chunkHead = await reader.read(offset, 8);
    const length = new DataView(chunkHead.buffer, chunkHead.byteOffset, 8).getUint32(0);
    const type = latin1(chunkHead, 4, 8);
    const dataStart = offset + 8;
    if (dataStart + length + 4 > blob.size) throw corrupt(`The PNG is truncated inside its ${type} chunk.`);
    if (type === 'IDAT') {
      reachedImageData = true;
      break;
    }
    if (type === 'IEND') break;
    if (type === 'acTL') {
      const data = await reader.read(dataStart, 8);
      animated = new DataView(data.buffer, data.byteOffset, 8).getUint32(0) > 1;
    } else if (type === 'tRNS') {
      hasTransparencyChunk = true;
    } else if (type === 'eXIf') {
      const data = await reader.read(dataStart, length);
      orientation = parseTiffOrientation(data, 0) ?? orientation;
    } else if (type === 'iCCP') {
      const data = await reader.read(dataStart, length);
      const nameEnd = data.indexOf(0);
      const profile = nameEnd > 0 ? await inflateZlib(data.subarray(nameEnd + 2)) : null;
      icc = profile ? describeIccProfile(profile) : unknownIcc();
    }
    offset = dataStart + length + 4;
  }
  if (!reachedImageData) throw corrupt('The PNG ends before its image data.');

  return finishProbe({
    format: 'png',
    width,
    height,
    orientation,
    animated,
    hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
    bitDepth,
    colorModel: PNG_COLOR_MODELS[colorType] ?? null,
    icc,
  });
}

/** @param {Blob} blob */
async function probeWebp(blob) {
  const reader = createBlobReader(blob);
  const header = await reader.read(0, 12);
  if (latin1(header, 0, 4) !== 'RIFF' || latin1(header, 8, 12) !== 'WEBP') {
    throw corrupt('The file does not have a WebP container header.');
  }
  let offset = 12;
  let width = 0;
  let height = 0;
  let animated = false;
  let hasAlpha = false;
  let lossless = null;
  let orientation = 1;
  let icc = null;

  let steps = 0;
  while (offset + 8 <= blob.size) {
    if (++steps > MAX_HEADER_STEPS) throw tooLong();
    const chunkHead = await reader.read(offset, 8);
    const fourcc = latin1(chunkHead, 0, 4);
    const size = new DataView(chunkHead.buffer, chunkHead.byteOffset, 8).getUint32(4, true);
    const dataStart = offset + 8;
    if (dataStart + size > blob.size) throw corrupt(`The WebP is truncated inside its ${fourcc.trim()} chunk.`);

    if (fourcc === 'VP8X') {
      const data = await reader.read(dataStart, 10);
      const flags = data[0];
      animated = Boolean(flags & 0x02);
      hasAlpha = Boolean(flags & 0x10);
      width = 1 + (data[4] | (data[5] << 8) | (data[6] << 16));
      height = 1 + (data[7] | (data[8] << 8) | (data[9] << 16));
    } else if (fourcc === 'VP8 ') {
      const data = await reader.read(dataStart, 10);
      if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) throw corrupt('The WebP VP8 frame header is invalid.');
      lossless = lossless ?? false;
      if (!width) {
        width = (data[6] | (data[7] << 8)) & 0x3fff;
        height = (data[8] | (data[9] << 8)) & 0x3fff;
      }
    } else if (fourcc === 'VP8L') {
      const data = await reader.read(dataStart, 5);
      if (data[0] !== 0x2f) throw corrupt('The WebP lossless header is invalid.');
      const bits = data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24);
      lossless = lossless ?? true;
      if (!width) {
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        hasAlpha = hasAlpha || Boolean((bits >>> 28) & 1);
      }
    } else if (fourcc === 'ICCP') {
      icc = describeIccProfile(await reader.read(dataStart, size));
    } else if (fourcc === 'EXIF') {
      const data = await reader.read(dataStart, Math.min(size, 65_536));
      const tiffStart = latin1(data, 0, 6) === 'Exif\0\0' ? 6 : 0;
      orientation = parseTiffOrientation(data, tiffStart) ?? orientation;
    } else if (fourcc === 'ALPH') {
      hasAlpha = true;
    }
    offset = dataStart + size + (size % 2);
  }

  if (!width || !height) throw corrupt('The WebP does not declare its pixel dimensions.');
  if (!animated && lossless === null) throw corrupt('The WebP has no image data.');
  return finishProbe({
    format: 'webp',
    width,
    height,
    orientation,
    animated,
    hasAlpha,
    bitDepth: 8,
    colorModel: 'rgb',
    icc,
    lossless,
  });
}

const PSD_COLOR_MODES = { 0: 'bitmap', 1: 'gray', 2: 'indexed', 3: 'rgb', 4: 'cmyk', 7: 'multichannel', 8: 'duotone', 9: 'lab' };

/** @param {Blob} blob */
async function probePsd(blob) {
  const header = await readBytes(blob, 0, 26);
  if (header.length < 26 || latin1(header, 0, 4) !== '8BPS') {
    throw corrupt('The file does not have a Photoshop header.');
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const version = view.getUint16(4);
  if (version !== 1 && version !== 2) throw corrupt('The Photoshop header has an unknown version.');
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  if (!width || !height) throw corrupt('The Photoshop file declares zero pixel dimensions.');
  return finishProbe({
    format: 'psd',
    width,
    height,
    bitDepth: view.getUint16(22),
    colorModel: PSD_COLOR_MODES[view.getUint16(24)] ?? null,
  });
}
