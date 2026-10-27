import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildZipArchive } from '../src/engine/tasks/zip-task.js';
import { assignEntryNames } from '../src/engine/filenames.js';
import { getExtension } from '../src/engine/filenames.js';
import {
  aiPdfCompatibleBytes,
  epsBytes,
  makeFile,
  noiseBytes,
  pngBytes,
  sha256,
  svgWithMetadata,
} from './fixtures/builders.js';

function context({ cancelAfter = Infinity } = {}) {
  let calls = 0;
  const progress = [];
  return {
    progress,
    onProgress(update) {
      progress.push(update);
      calls += 1;
    },
    isCanceled: () => calls >= cancelAfter,
    throwIfCanceled() {
      if (calls >= cancelAfter) {
        const error = new Error('canceled');
        error.code = 'canceled';
        throw error;
      }
    },
  };
}

function payloadFor(files, maxArchiveBytes = 100_000_000) {
  const names = assignEntryNames(files.map((file) => file.name));
  return {
    entries: files.map((file, index) => ({
      file,
      entryName: names[index].entryName,
      extension: getExtension(file.name),
      lastModified: file.lastModified,
    })),
    maxArchiveBytes,
  };
}

/** Reads the compression method of each entry from the ZIP central directory. */
function centralDirectoryMethods(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const methods = {};
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const method = view.getUint16(offset + 10, true);
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    methods[name] = method === 0 ? 'STORE' : method === 8 ? 'DEFLATE' : String(method);
  }
  return methods;
}

describe('buildZipArchive', () => {
  it('preserves every original payload byte-for-byte, including protected vectors', async () => {
    const files = [
      makeFile(await aiPdfCompatibleBytes(), 'Artwork.AI', 'application/pdf'),
      makeFile(epsBytes(), 'logo.eps', 'application/postscript'),
      makeFile(svgWithMetadata(), 'Banner — Ünïcødé.svg', 'image/svg+xml'),
      makeFile(pngBytes({ width: 64, height: 64 }), 'photo.PNG', 'image/png'),
      makeFile(noiseBytes(50_000), 'noise.jpg', 'image/jpeg'),
    ];
    const result = await buildZipArchive(payloadFor(files), context());
    expect(result.blob.type).toBe('application/zip');
    expect(result.size).toBe(result.blob.size);
    expect(result.verification).toMatchObject({ method: 'byte-compare', verified: true, checkedEntries: 5 });

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(files.map((file) => file.name).sort());
    for (const file of files) {
      const extracted = await zip.file(file.name).async('uint8array');
      expect(sha256(extracted), file.name).toBe(sha256(new Uint8Array(await file.arrayBuffer())));
    }
  });

  it('applies the documented compression policy per entry', async () => {
    const files = [makeFile(svgWithMetadata(), 'a.svg'), makeFile(noiseBytes(10_000), 'b.jpg'), makeFile(pngBytes({ width: 8, height: 8 }), 'c.png')];
    const result = await buildZipArchive(payloadFor(files), context());
    const methods = centralDirectoryMethods(new Uint8Array(await result.blob.arrayBuffer()));
    expect(methods).toEqual({ 'a.svg': 'DEFLATE', 'b.jpg': 'STORE', 'c.png': 'STORE' });
    expect(result.manifest.map((entry) => entry.compression)).toEqual(['DEFLATE', 'STORE', 'STORE']);
  });

  it('stores duplicate and unsafe names under distinct safe entry names', async () => {
    const files = [
      makeFile(svgWithMetadata(), 'logo.svg'),
      makeFile(epsBytes(), 'LOGO.svg'.replace('svg', 'eps')),
      makeFile(svgWithMetadata(), 'Logo.SVG'),
      makeFile(epsBytes(), '../../evil.eps'),
    ];
    const payload = payloadFor(files);
    expect(payload.entries.map((entry) => entry.entryName)).toEqual(['logo.svg', 'LOGO.eps', 'Logo (2).SVG', '.._.._evil.eps']);
    const result = await buildZipArchive(payload, context());
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names).toHaveLength(4);
    expect(names.every((name) => !name.includes('/') && !name.includes('\\'))).toBe(true);
    expect(sha256(await zip.file('Logo (2).SVG').async('uint8array'))).toBe(sha256(svgWithMetadata()));
  });

  it('reports progress and honest sizes for incompressible content', async () => {
    const files = [makeFile(noiseBytes(200_000, 3), 'a.jpg'), makeFile(noiseBytes(200_000, 4), 'b.jpg')];
    const ctx = context();
    const result = await buildZipArchive(payloadFor(files), ctx);
    expect(result.size).toBeGreaterThan(400_000);
    expect(ctx.progress.some((update) => update.phase === 'packaging')).toBe(true);
    expect(ctx.progress.at(-1)).toMatchObject({ phase: 'verifying', fraction: 1 });
  });

  it('stops when canceled', async () => {
    const files = [makeFile(noiseBytes(300_000), 'a.jpg'), makeFile(noiseBytes(300_000), 'b.jpg')];
    await expect(buildZipArchive(payloadFor(files), context({ cancelAfter: 2 }))).rejects.toMatchObject({ code: 'canceled' });
  });

  it('enforces the archive size ceiling', async () => {
    const files = [makeFile(noiseBytes(100_000), 'a.jpg'), makeFile(noiseBytes(100_000), 'b.jpg')];
    await expect(buildZipArchive(payloadFor(files, 150_000), context())).rejects.toMatchObject({ code: 'archive-too-large' });
  });

  it('refuses to deliver an archive that does not match the originals', async () => {
    // A Blob whose contents change between reads simulates corruption.
    class ShiftingBlob extends Blob {
      reads = 0;
      async arrayBuffer() {
        this.reads += 1;
        const buffer = await super.arrayBuffer();
        if (this.reads > 1) new Uint8Array(buffer)[0] ^= 0xff;
        return buffer;
      }
    }
    const shifting = new ShiftingBlob([epsBytes()]);
    const payload = {
      entries: [
        { file: shifting, entryName: 'a.eps', extension: 'eps', lastModified: 0 },
        { file: makeFile(epsBytes(), 'b.eps'), entryName: 'b.eps', extension: 'eps', lastModified: 0 },
      ],
      maxArchiveBytes: 10_000_000,
    };
    await expect(buildZipArchive(payload, context())).rejects.toMatchObject({ code: 'archive-verification-failed' });
  });
});
