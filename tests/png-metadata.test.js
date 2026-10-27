import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import { stripPngMetadata } from '../src/engine/tasks/png-metadata.js';
import { pngBytes } from './fixtures/builders.js';

function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set([...type].map((character) => character.charCodeAt(0)), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)) >>> 0);
  return bytes;
}

/** Inserts chunks just before IEND. */
function withChunks(png, ...chunks) {
  const iend = png.length - 12;
  const parts = [png.subarray(0, iend), ...chunks, png.subarray(iend)];
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of parts) {
    output.set(part, position);
    position += part.length;
  }
  return output;
}

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
      chunk('tEXt', text('Software', 'Some Editor')),
      chunk('iTXt', text('Comment', 'hello')),
      chunk('eXIf', new Uint8Array(16)),
      chunk('tIME', new Uint8Array(7)),
      chunk('pHYs', new Uint8Array([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
      chunk('prVt', new Uint8Array(32)),
    );
    const { bytes, removed } = stripPngMetadata(png);
    expect(chunkTypes(bytes)).toEqual(['IHDR', 'iCCP', 'IDAT', 'pHYs', 'IEND']);
    expect(removed).toEqual(['tEXt', 'iTXt', 'eXIf', 'tIME', 'prVt']);
    // Kept chunks are copied whole, CRC included, so the image data is byte-identical.
    expect(chunkBytes(bytes, 'IDAT')).toEqual(chunkBytes(png, 'IDAT'));
    expect(chunkBytes(bytes, 'iCCP')).toEqual(chunkBytes(png, 'iCCP'));
  });

  it('returns the same bytes when there is nothing to remove', () => {
    const png = pngBytes({ width: 2, height: 2 });
    const result = stripPngMetadata(png);
    expect(result.bytes).toBe(png);
    expect(result.removed).toEqual([]);
  });

  it('refuses a PNG that ends in the middle of a chunk', () => {
    const png = withChunks(pngBytes({ width: 2, height: 2 }), chunk('tEXt', text('a', 'b')));
    expect(() => stripPngMetadata(png.subarray(0, png.length - 20))).toThrow(RangeError);
  });
});
