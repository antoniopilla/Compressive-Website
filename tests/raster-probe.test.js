import { describe, expect, it } from 'vitest';
import { MAX_HEADER_STEPS, probeRaster } from '../src/engine/inspect/raster-probe.js';
import { crc32, deflateSync } from 'node:zlib';
import { createBlobReader, readBytes } from '../src/engine/inspect/bytes.js';
import { describeIccProfile, inflateZlib } from '../src/engine/inspect/icc.js';
import { concat, iccProfile, jpegHeaderBytes, makeFile, pngBytes, psdBytes, webpBytes } from './fixtures/builders.js';

const blob = (bytes) => makeFile(bytes, 'x');

/** A PNG chunk with a valid CRC. */
function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set([...type].map((character) => character.charCodeAt(0)), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)) >>> 0);
  return bytes;
}

/** Inserts chunks straight after a PNG's 25-byte IHDR chunk. */
const afterHeader = (png, chunks) => concat(png.subarray(0, 33), ...chunks, png.subarray(33));

describe('header scanning', () => {
  it('reads through a window, returning exactly what direct reads return', async () => {
    const source = blob(Uint8Array.from({ length: 5000 }, (_, index) => (index * 7) & 0xff));
    const reader = createBlobReader(source, 1024);
    // Inside the window, across its edge, larger than it, and past the end.
    for (const [start, length] of [[0, 10], [1000, 20], [1015, 30], [3000, 2048], [4990, 50], [6000, 4]]) {
      expect(await reader.read(start, length)).toEqual(await readBytes(source, start, length));
    }
  });

  it('reads a header of thousands of chunks in a handful of reads', async () => {
    const png = afterHeader(pngBytes({ width: 4, height: 4 }), Array.from({ length: 5000 }, () => chunk('zzZz', [1])));
    let reads = 0;
    const counting = new (class extends Blob {
      slice(...args) {
        reads += 1;
        return super.slice(...args);
      }
    })([png]);
    expect((await probeRaster(counting, 'png')).width).toBe(4);
    expect(reads).toBeLessThan(10);
  });

  it('treats an unusually long header as damage', async () => {
    const png = afterHeader(pngBytes({ width: 4, height: 4 }), Array.from({ length: MAX_HEADER_STEPS + 1 }, () => chunk('zzZz', [1])));
    await expect(probeRaster(blob(png), 'png')).rejects.toMatchObject({ code: 'corrupt-image', message: expect.stringMatching(/unusually long/) });

    // JPEG markers may be preceded by 0xFF fill bytes: a few are fine, a flood is not.
    const header = jpegHeaderBytes({ width: 10, height: 10 });
    const filled = (count) => concat(header.subarray(0, 2), new Uint8Array(count).fill(0xff), header.subarray(2));
    expect((await probeRaster(blob(filled(5)), 'jpg')).width).toBe(10);
    await expect(probeRaster(blob(filled(MAX_HEADER_STEPS + 10)), 'jpg')).rejects.toMatchObject({ code: 'corrupt-image' });
  });
});

describe('ICC description parsing', () => {
  it('identifies sRGB and non-sRGB profiles', () => {
    expect(describeIccProfile(iccProfile('sRGB IEC61966-2.1'))).toMatchObject({ isSrgb: true, colorSpace: 'RGB' });
    expect(describeIccProfile(iccProfile('Adobe RGB (1998)'))).toMatchObject({ isSrgb: false, description: 'Adobe RGB (1998)' });
    expect(describeIccProfile(iccProfile('Dot Gain 20%', 'GRAY'))).toMatchObject({ isSrgb: false, colorSpace: 'GRAY' });
  });
});

describe('PNG', () => {
  it('reads dimensions, alpha and bit depth', async () => {
    const probe = await probeRaster(blob(pngBytes({ width: 33, height: 17 })), 'png');
    expect(probe).toMatchObject({ format: 'png', width: 33, height: 17, orientedWidth: 33, hasAlpha: true, bitDepth: 8, animated: false });
    const opaque = await probeRaster(blob(pngBytes({ width: 3, height: 2, colorType: 2 })), 'png');
    expect(opaque.hasAlpha).toBe(false);
    const deep = await probeRaster(blob(pngBytes({ width: 2, height: 2, bitDepth: 16, colorType: 2 })), 'png');
    expect(deep.bitDepth).toBe(16);
  });

  it('detects APNG animation, embedded profiles and eXIf orientation', async () => {
    expect((await probeRaster(blob(pngBytes({ width: 2, height: 2, animation: { frames: 3 } })), 'png')).animated).toBe(true);
    const adobe = await probeRaster(blob(pngBytes({ width: 2, height: 2, icc: iccProfile('Adobe RGB (1998)') })), 'png');
    expect(adobe.icc).toMatchObject({ isSrgb: false, description: 'Adobe RGB (1998)' });
    const srgb = await probeRaster(blob(pngBytes({ width: 2, height: 2, icc: iccProfile('sRGB IEC61966-2.1') })), 'png');
    expect(srgb.icc.isSrgb).toBe(true);
    const rotated = await probeRaster(blob(pngBytes({ width: 40, height: 10, orientation: 6 })), 'png');
    expect(rotated).toMatchObject({ orientation: 6, orientedWidth: 10, orientedHeight: 40 });
  });

  it('stops inflating an embedded profile that expands beyond a safe size', async () => {
    const started = Date.now();
    const oversized = new Uint8Array(20_000_000); // compresses to ~20 KB, inflates to 20 MB
    const probe = await probeRaster(blob(pngBytes({ width: 2, height: 2, icc: oversized })), 'png');
    expect(probe.icc).toMatchObject({ present: true, isSrgb: false, description: null });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await inflateZlib(deflateSync(new Uint8Array(1000)), 500)).toBeNull();
    expect(await inflateZlib(deflateSync(new Uint8Array(1000)), 5000)).toHaveLength(1000);
  });

  it('rejects truncated files', async () => {
    await expect(probeRaster(blob(pngBytes({ width: 9, height: 9 }).subarray(0, 50)), 'png')).rejects.toMatchObject({ code: 'corrupt-image' });
  });
});

describe('JPEG', () => {
  it('reads dimensions and applies EXIF orientation to the displayed size', async () => {
    const probe = await probeRaster(blob(jpegHeaderBytes({ width: 4000, height: 3000, orientation: 6 })), 'jpg');
    expect(probe).toMatchObject({ width: 4000, height: 3000, orientation: 6, orientedWidth: 3000, orientedHeight: 4000, colorModel: 'rgb' });
  });

  it('detects CMYK, 12-bit precision and multi-segment ICC profiles', async () => {
    expect((await probeRaster(blob(jpegHeaderBytes({ width: 10, height: 10, components: 4 })), 'jpeg')).colorModel).toBe('cmyk');
    expect((await probeRaster(blob(jpegHeaderBytes({ width: 10, height: 10, bitDepth: 12 })), 'jpeg')).bitDepth).toBe(12);
    const icc = iccProfile('Display P3');
    const probe = await probeRaster(blob(jpegHeaderBytes({ width: 10, height: 10, icc, iccChunkSize: 37 })), 'jpg');
    expect(probe.icc).toMatchObject({ description: 'Display P3', isSrgb: false });
  });

  it('rejects files without a frame header', async () => {
    await expect(probeRaster(blob(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), 'jpg')).rejects.toMatchObject({ code: 'corrupt-image' });
  });
});

describe('WebP', () => {
  it('reads lossy, lossless and extended headers', async () => {
    expect(await probeRaster(blob(webpBytes({ kind: 'VP8', width: 640, height: 480 })), 'webp')).toMatchObject({
      width: 640,
      height: 480,
      lossless: false,
    });
    expect(await probeRaster(blob(webpBytes({ kind: 'VP8L', width: 300, height: 200, alpha: true })), 'webp')).toMatchObject({
      width: 300,
      height: 200,
      lossless: true,
      hasAlpha: true,
    });
    const extended = await probeRaster(
      blob(webpBytes({ kind: 'VP8X', width: 5000, height: 2500, animated: true, alpha: true, icc: iccProfile('sRGB built-in') })),
      'webp',
    );
    expect(extended).toMatchObject({ width: 5000, height: 2500, animated: true, hasAlpha: true });
    expect(extended.icc.isSrgb).toBe(true);
  });
});

describe('PSD', () => {
  it('reads pixel size and colour mode from the header', async () => {
    expect(await probeRaster(blob(psdBytes({ width: 12000, height: 6000, colorMode: 4 })), 'psd')).toMatchObject({
      format: 'psd',
      width: 12000,
      height: 6000,
      colorModel: 'cmyk',
    });
  });
});
