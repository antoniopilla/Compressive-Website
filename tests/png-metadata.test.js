import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import { stripPngMetadata } from '../src/engine/tasks/png-metadata.js';
import { concat, pngBytes, pngChunk } from './fixtures/builders.js';

/** Inserts chunks just before IEND. */
const withChunks = (png, ...chunks) => concat(png.subarray(0, png.length - 12), ...chunks, png.subarray(png.length - 12));

function chunkTypes(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types = [];
  for (let offset = 8; offset < png.length; offset += 12 + view.getUint32(offset)) {
    types.push(String.fromCharCode(...png.subarray(offset + 4, offset + 8)));
  }
  return types;
}

/** The whole chunk (length, type, data and CRC) of the first chunk of `type`. */
function chunkBytes(png, type) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = 8; offset < png.length; offset += 12 + view.getUint32(offset)) {
    if (String.fromCharCode(...png.subarray(offset + 4, offset + 8)) === type) {
      return png.slice(offset, offset + 12 + view.getUint32(offset));
    }
  }
  return null;
}

const text = (keyword, value) => new TextEncoder().encode(`${keyword}\0${value}`);

describe('stripPngMetadata', () => {
  it('removes text, EXIF, time and private chunks but keeps colour and print size', () => {
    const png = withChunks(
      pngBytes({ width: 4, height: 4, icc: new Uint8Array(64).fill(3) }),
      pngChunk('tEXt', text('Software', 'Some Editor')),
      pngChunk('iTXt', text('Comment', 'hello')),
      pngChunk('eXIf', new Uint8Array(16)),
      pngChunk('tIME', new Uint8Array(7)),
      pngChunk('pHYs', new Uint8Array([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
      pngChunk('prVt', new Uint8Array(32)),
    );
    const { bytes, removed } = stripPngMetadata(png);
    expect(chunkTypes(bytes)).toEqual(['IHDR', 'iCCP', 'IDAT', 'pHYs', 'IEND']);
    expect(removed).toEqual(['tEXt', 'iTXt', 'eXIf', 'tIME', 'prVt']);
    // Kept chunks are copied whole, CRC included, so the image data is byte-identical.
    expect(chunkBytes(bytes, 'IDAT')).toEqual(chunkBytes(png, 'IDAT'));
    expect(chunkBytes(bytes, 'iCCP')).toEqual(chunkBytes(png, 'iCCP'));
  });

  it('replaces a colour profile with sRGB when the image is greyscale', () => {
    // What OxiPNG produces from an all-grey, sRGB-tagged colour PNG: greyscale
    // pixels that still carry an RGB profile, which is invalid PNG.
    const grey = pngBytes({ width: 4, height: 4, colorType: 0, pixel: () => [128], icc: new Uint8Array(64).fill(3) });
    expect(chunkTypes(grey)).toEqual(['IHDR', 'iCCP', 'IDAT', 'IEND']);
    const { bytes, removed } = stripPngMetadata(grey);
    expect(chunkTypes(bytes)).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND']);
    expect(removed).toEqual([]);
    const srgb = chunkBytes(bytes, 'sRGB');
    expect(srgb[8]).toBe(0); // perceptual rendering intent
    expect(new DataView(srgb.buffer).getUint32(9)).toBe(crc32(srgb.subarray(4, 9)) >>> 0);
    expect(chunkBytes(bytes, 'IDAT')).toEqual(chunkBytes(grey, 'IDAT'));
  });

  it('keeps the colour profile of a colour image', () => {
    const colour = pngBytes({ width: 4, height: 4, colorType: 2, icc: new Uint8Array(64).fill(3) });
    const result = stripPngMetadata(colour);
    expect(result.bytes).toBe(colour);
    expect(chunkTypes(result.bytes)).toContain('iCCP');
  });

  it('returns the same bytes when there is nothing to remove', () => {
    const png = pngBytes({ width: 2, height: 2 });
    const result = stripPngMetadata(png);
    expect(result.bytes).toBe(png);
    expect(result.removed).toEqual([]);
  });

  it('refuses a PNG that ends in the middle of a chunk', () => {
    const png = withChunks(pngBytes({ width: 2, height: 2 }), pngChunk('tEXt', text('a', 'b')));
    expect(() => stripPngMetadata(png.subarray(0, png.length - 20))).toThrow(RangeError);
  });
});
