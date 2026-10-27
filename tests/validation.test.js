import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { evaluateMime, inspectFile } from '../src/engine/validation.js';
import { epsBytes, jpegHeaderBytes, makeFile, pngBytes, svgWithMetadata } from './fixtures/builders.js';

describe('evaluateMime', () => {
  it('accepts expected, empty and generic MIME values', () => {
    expect(evaluateMime('png', 'image/png')).toBe('expected');
    expect(evaluateMime('ai', 'application/pdf')).toBe('expected');
    expect(evaluateMime('ai', '')).toBe('generic');
    expect(evaluateMime('psd', 'application/octet-stream')).toBe('generic');
    expect(evaluateMime('jpg', 'IMAGE/JPEG; charset=binary')).toBe('expected');
    expect(evaluateMime('jpg', 'application/pdf')).toBe('unexpected');
  });
});

describe('inspectFile', () => {
  it('rejects empty files with an actionable message', async () => {
    const entry = await inspectFile(makeFile(new Uint8Array(0), 'empty.png', 'image/png'), 'x');
    expect(entry.validation).toMatchObject({ ok: false, code: 'empty-file' });
    expect(entry.validation.message).toMatch(/empty/i);
  });

  it('rejects unsupported and missing extensions', async () => {
    expect((await inspectFile(makeFile(new Uint8Array([1]), 'animation.gif', 'image/gif'), 'x')).validation.code).toBe(
      'unsupported-extension',
    );
    const noExtension = await inspectFile(makeFile(new Uint8Array([1]), 'README', ''), 'x');
    expect(noExtension.validation.code).toBe('unsupported-extension');
    expect(noExtension.validation.message).toMatch(/no extension/);
  });

  it('rejects files whose contents do not match their extension and suggests the right one', async () => {
    const entry = await inspectFile(makeFile(pngBytes({ width: 2, height: 2 }), 'photo.jpg', 'image/jpeg'), 'x');
    expect(entry.validation.code).toBe('signature-mismatch');
    expect(entry.validation.message).toMatch(/contains a PNG image/);
    expect(entry.validation.message).toMatch(/\.png/);
  });

  it('rejects compressed SVGZ content in an .svg file', async () => {
    const entry = await inspectFile(makeFile(deflateSync(svgWithMetadata()), 'logo.svg'), 'x');
    expect(entry.validation.ok).toBe(false);
    const gzipped = await inspectFile(
      makeFile(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3]), 'logo.svg', 'image/svg+xml'),
      'y',
    );
    expect(gzipped.validation.message).toMatch(/SVGZ/);
  });

  it('accepts an unexpected MIME type when the contents match, with a note', async () => {
    const entry = await inspectFile(makeFile(jpegHeaderBytes({ width: 10, height: 10 }), 'photo.jpg', 'application/pdf'), 'x');
    expect(entry.validation.ok).toBe(true);
    expect(entry.mime.status).toBe('unexpected');
    expect(entry.notes[0]).toMatch(/labeled this file/);
  });

  it('rejects images whose headers are damaged', async () => {
    const truncated = pngBytes({ width: 20, height: 20 }).subarray(0, 40);
    const entry = await inspectFile(makeFile(truncated, 'broken.png', 'image/png'), 'x');
    expect(entry.validation.ok).toBe(false);
    expect(entry.validation.message).toMatch(/damaged/);
  });

  it('reads vector artboards for aspect checks without altering anything', async () => {
    const svg = await inspectFile(makeFile(svgWithMetadata(), 'logo.svg', 'image/svg+xml'), 'x');
    expect(svg.vector.artboard).toEqual({ width: 1200, height: 600 });
    const eps = await inspectFile(makeFile(epsBytes(), 'art.eps', ''), 'y');
    expect(eps.vector.artboard).toEqual({ width: 864, height: 288 });
  });
});
