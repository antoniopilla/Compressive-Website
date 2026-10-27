import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createFileStudio, STATUS } from '../src/engine/studio.js';
import { createTaskRunner } from '../src/engine/task-runner.js';
import { StudioError } from '../src/engine/errors.js';
import {
  aiPdfCompatibleBytes,
  epsBytes,
  jpegHeaderBytes,
  makeFile,
  pngBytes,
  printPdfBytes,
  psdBytes,
  sha256,
  svgWithMetadata,
} from './fixtures/builders.js';

/** Runner that executes the real ZIP and PDF tasks on the main thread (Node has no Worker). */
const realRunner = () => createTaskRunner({ workersSupported: false });

/** Runner whose tasks wait until released, to test cancellation and stale results. */
function controllableRunner() {
  const calls = [];
  return {
    calls,
    capabilities: { workers: true },
    run(task, payload, options) {
      return new Promise((resolve, reject) => {
        const call = { task, payload, options, resolve, reject };
        calls.push(call);
        options.signal?.addEventListener('abort', () => {
          const error = new Error('canceled');
          error.code = 'canceled';
          reject(error);
        });
      });
    },
  };
}

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

describe('protected pass-through', () => {
  it.each([
    ['Artwork.AI', 'application/pdf', aiPdfCompatibleBytes],
    ['LOGO.EPS', '', async () => epsBytes()],
    ['banner.svg', 'image/svg+xml', async () => svgWithMetadata()],
  ])('returns %s byte-for-byte as the original File', async (name, type, build) => {
    const file = makeFile(await build(), name, type);
    const studio = createFileStudio({ taskRunner: realRunner() });
    await studio.addFiles([file]);
    const result = await studio.prepare();
    expect(result.route).toBe('protected-passthrough');
    expect(result.artifact.blob).toBe(file);
    expect(result.files[0]).toMatchObject({ outcome: 'preserved-exact', reasonCode: 'protected-vector' });
    expect(result.preservation).toMatchObject({ method: 'identity', verified: true });
    const download = studio.getDownload('prepared');
    expect(download.filename).toBe(name);
    expect(sha256(await bytesOf(download.blob))).toBe(sha256(await bytesOf(file)));
    expect(studio.getSnapshot().health.files[result.files[0].fileId]).toMatchObject({ status: 'unknown', measurable: false });
    expect(result.files[0].message).not.toMatch(/print[- ]ready/i);
  });

  it('passes PSD files through and assesses them from the header', async () => {
    const file = makeFile(psdBytes({ width: 7200, height: 3600 }), 'Poster.psd');
    const studio = createFileStudio({ taskRunner: realRunner(), initialPrintSize: { width: 4, height: 2, unit: 'ft' } });
    await studio.addFiles([file]);
    const result = await studio.prepare();
    expect(result.route).toBe('psd-passthrough');
    expect(result.artifact.blob).toBe(file);
    const health = studio.getSnapshot().health.files[result.files[0].fileId];
    expect(health.original.effectivePpi).toBe(150);
    expect(health.status).toBe('meets-target');
    expect(health.limitation).toMatch(/Photoshop file header/);
  });
});

describe('ZIP of originals', () => {
  it('produces a real ZIP whose entries match the originals', async () => {
    const files = [
      makeFile(await aiPdfCompatibleBytes(), 'art.ai', 'application/pdf'),
      makeFile(pngBytes({ width: 30, height: 20 }), 'photo.png', 'image/png'),
      makeFile(pngBytes({ width: 10, height: 10, pixel: () => [1, 2, 3, 255] }), 'photo.PNG', 'image/png'),
    ];
    const studio = createFileStudio({ taskRunner: realRunner(), initialPrintSize: { width: 1, height: 1, unit: 'in' } });
    await studio.addFiles(files);
    const result = await studio.prepare();
    expect(result.route).toBe('zip-originals');
    expect(result.artifact).toMatchObject({ mimeType: 'application/zip', kind: 'archive' });
    expect(result.artifact.filename).toMatch(/^compressive-originals-3-files-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(result.preservation).toMatchObject({ method: 'byte-compare', verified: true });
    expect(result.entryMap.map((entry) => entry.entryName)).toEqual(['art.ai', 'photo.png', 'photo (2).PNG']);
    expect(result.files[2].message).toMatch(/photo \(2\)\.PNG/);

    const zip = await JSZip.loadAsync(await bytesOf(result.artifact.blob));
    expect(sha256(await zip.file('photo (2).PNG').async('uint8array'))).toBe(sha256(await bytesOf(files[2])));

    const health = studio.getSnapshot().health;
    expect(health.files[result.files[1].fileId].measurable).toBe(true);
    expect(health.files[result.files[0].fileId]).toMatchObject({ measurable: false, status: 'unknown' });
    expect(result.limitations.find((item) => item.code === 'zip-unassessed').message).toMatch(/art\.ai/);
  });

  it('fails clearly when the ZIP worker fails', async () => {
    const runner = { capabilities: { workers: true }, run: vi.fn().mockRejectedValue(new StudioError('worker-crashed', 'crash')) };
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(epsBytes(), 'a.eps'), makeFile(epsBytes(), 'b.eps')]);
    expect(await studio.prepare()).toBeNull();
    expect(studio.getSnapshot()).toMatchObject({ status: STATUS.FAILED, error: { code: 'worker-crashed' } });
    expect(studio.getSnapshot().error.message).toMatch(/ran out of memory/);
  });
});

describe('image route decisions', () => {
  const encodedPng = (width, height) => new Blob([pngBytes({ width, height, colorType: 2, pixel: () => [10, 20, 30] })], { type: 'image/png' });

  it('keeps the original when the browser worker reports a decode failure', async () => {
    const runner = { capabilities: { workers: true }, run: vi.fn().mockRejectedValue(new StudioError('decode-failed', 'Could not decode.')) };
    const file = makeFile(jpegHeaderBytes({ width: 2000, height: 1000 }), 'photo.jpg', 'image/jpeg');
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([file]);
    const result = await studio.prepare();
    expect(result.files[0]).toMatchObject({ outcome: 'kept-original', reasonCode: 'decode-failed' });
    expect(result.artifact.blob).toBe(file);
  });

  it('accepts a verified prepared copy and names the download correctly', async () => {
    const source = pngBytes({ width: 300, height: 200 });
    const padded = new Uint8Array(source.length + 200_000);
    padded.set(source);
    const runner = {
      capabilities: { workers: true },
      run: vi.fn().mockResolvedValue({
        status: 'encoded',
        blob: encodedPng(300, 200),
        width: 300,
        height: 200,
        encoding: 'oxipng-original',
        quality: null,
        similarity: null,
        removedChunks: ['tEXt', 'tIME'],
      }),
    };
    const studio = createFileStudio({ taskRunner: runner, initialPrintSize: { width: 2, height: 4 / 3, unit: 'in' } });
    await studio.addFiles([makeFile(padded, 'Logo.PNG', 'image/png')]);
    const result = await studio.prepare();
    expect(result.files[0]).toMatchObject({ outcome: 'optimized', message: 'Optimised losslessly with OxiPNG: every pixel is unchanged.' });
    expect(result.files[0].notes).toContain('Removed text notes and the saved-on date. Colour information and print size (DPI) were kept.');
    expect(result.limitations).toEqual([]);
    expect(result.artifact).toMatchObject({ filename: 'Logo-prepared.PNG', mimeType: 'image/png', kind: 'prepared' });
    expect(result.constraints.satisfied).toBe(true);
    expect(runner.run.mock.calls[0][1]).toMatchObject({ mimeType: 'image/png', policy: { qualities: [75, 85, 90, 95], maxOutputBytes: 40_000_000 } });
    const original = studio.getDownload('original', result.files[0].fileId);
    expect(original.filename).toBe('Logo.PNG');
  });

  it('reports the visual check and any extra quality a lossy copy needed', async () => {
    const source = jpegHeaderBytes({ width: 2000, height: 1000 });
    const padded = new Uint8Array(source.length + 500_000);
    padded.set(source);
    const runner = {
      capabilities: { workers: true },
      run: vi.fn().mockResolvedValue({
        status: 'encoded',
        blob: new Blob([jpegHeaderBytes({ width: 2000, height: 1000 })], { type: 'image/jpeg' }),
        width: 2000,
        height: 1000,
        encoding: 'mozjpeg',
        quality: 85,
        similarity: { luma: 0.99516, chroma: 0.99, worstArea: 0.96118 },
      }),
    };
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(padded, 'photo.jpg', 'image/jpeg')]);
    const result = await studio.prepare();
    expect(result.files[0]).toMatchObject({
      outcome: 'optimized',
      message: 'Compressed with MozJPEG at quality 85, then compared with your original: it looks the same.',
    });
    expect(result.files[0].notes).toEqual(
      expect.arrayContaining([
        'Visual check: 99.5% similar overall, 99% in colour and 96.1% in the least similar area (it needs 97%, 97% and 93%).',
        'Quality 85 was needed: lower qualities visibly changed fine detail or colour edges.',
        'Metadata such as EXIF, camera details and embedded DPI is not copied to the prepared copy.',
      ]),
    );
    expect(result.limitations.map((limitation) => limitation.code)).toEqual(['perceptual-quality']);
    expect(result.details).toMatchObject({ encoding: 'mozjpeg', quality: 85 });
  });

  it.each([
    ['looks-different', { status: 'looks-different' }, /^Compressing this image would visibly change it: even at quality 95/],
    ['no-useful-saving', { status: 'no-saving' }, /^This image is already well compressed/],
  ])('keeps the original when the encoder reports %s', async (reasonCode, response, message) => {
    const file = makeFile(jpegHeaderBytes({ width: 2000, height: 1000 }), 'photo.jpg', 'image/jpeg');
    const runner = { capabilities: { workers: true }, run: vi.fn().mockResolvedValue({ width: 2000, height: 1000, ...response }) };
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([file]);
    const result = await studio.prepare();
    expect(result.files[0]).toMatchObject({ outcome: 'kept-original', reasonCode });
    expect(result.files[0].message).toMatch(message);
    expect(result.artifact.blob).toBe(file);
  });

  it('refuses a prepared copy whose real dimensions differ from what the encoder reported', async () => {
    const runner = {
      capabilities: { workers: true },
      run: vi.fn().mockResolvedValue({ status: 'encoded', blob: encodedPng(100, 50), width: 300, height: 200, encoding: 'oxipng-original', quality: null }),
    };
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(pngBytes({ width: 300, height: 200 }), 'a.png', 'image/png')]);
    const result = await studio.prepare();
    expect(result.files[0]).toMatchObject({ outcome: 'kept-original', reasonCode: 'verification-failed' });
  });

  it('refuses a copy that came out smaller than the resize rule allows', async () => {
    // The encoder's report and the file agree, but a 300 × 200 image needs no resize at all.
    const runner = {
      capabilities: { workers: true },
      run: vi.fn().mockResolvedValue({ status: 'encoded', blob: encodedPng(150, 100), width: 150, height: 100, encoding: 'oxipng', quality: null }),
    };
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(pngBytes({ width: 300, height: 200 }), 'a.png', 'image/png')]);
    const result = await studio.prepare();
    expect(result.files[0]).toMatchObject({ outcome: 'kept-original', reasonCode: 'verification-failed' });
    expect(result.files[0].message).toMatch(/unexpected size/);
  });

  it('keeps animated images without decoding them', async () => {
    const runner = { capabilities: { workers: true }, run: vi.fn() };
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(pngBytes({ width: 20, height: 20, animation: { frames: 4 } }), 'spin.png', 'image/png')]);
    const result = await studio.prepare();
    expect(result.files[0]).toMatchObject({ outcome: 'kept-original', reasonCode: 'animated' });
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('PDF route', () => {
  it('delivers a tidied PDF and keeps the original available', async () => {
    const original = makeFile(await printPdfBytes({ bloatBytes: 200_000 }), 'Proof.pdf', 'application/pdf');
    const studio = createFileStudio({ taskRunner: realRunner(), initialPrintSize: { width: 3, height: 1, unit: 'ft' } });
    await studio.addFiles([original]);
    const result = await studio.prepare();
    expect(result.files[0].outcome).toBe('optimized');
    expect(result.artifact).toMatchObject({ filename: 'Proof-prepared.pdf', mimeType: 'application/pdf' });
    expect(result.totals.savedBytes).toBeGreaterThan(150_000);
    const health = studio.getSnapshot().health.files[result.files[0].fileId];
    expect(health).toMatchObject({ measurable: false, status: 'unknown', aspectMessage: null });
    expect(result.limitations.map((item) => item.code)).toContain('pdf-not-assessed');
  });
});

describe('lifecycle', () => {
  it('moves through validating, idle, processing and ready', async () => {
    const statuses = [];
    const studio = createFileStudio({ taskRunner: realRunner() });
    studio.subscribe((snapshot) => statuses.push(snapshot.status));
    await studio.addFiles([makeFile(epsBytes(), 'a.eps')]);
    await studio.prepare();
    expect(statuses[0]).toBe(STATUS.VALIDATING);
    expect(statuses).toContain(STATUS.IDLE);
    expect(statuses).toContain(STATUS.PROCESSING);
    expect(statuses.at(-1)).toBe(STATUS.READY);
  });

  it('cancels a running job', async () => {
    const runner = controllableRunner();
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(epsBytes(), 'a.eps'), makeFile(epsBytes(), 'b.eps')]);
    const pending = studio.prepare();
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    studio.cancel();
    expect(studio.getSnapshot().status).toBe(STATUS.CANCELED);
    expect(runner.calls[0].options.signal.aborted).toBe(true);
    expect(await pending).toBeNull();
    expect(studio.getSnapshot().status).toBe(STATUS.CANCELED);
  });

  it('ignores a stale result after the selection changes', async () => {
    const runner = controllableRunner();
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(epsBytes(), 'a.eps'), makeFile(epsBytes(), 'b.eps')]);
    const stale = studio.prepare();
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    const [first] = studio.getSnapshot().selection;
    studio.removeFile(first.id);
    // The old job settles late with a result; it must not appear.
    runner.calls[0].resolve({ blob: new Blob(['zip']), manifest: [], verification: { verified: true } });
    expect(await stale).toBeNull();
    const snapshot = studio.getSnapshot();
    expect(snapshot.result).toBeNull();
    expect(snapshot.status).toBe(STATUS.IDLE);
    expect(snapshot.plan.route).toBe('protected-passthrough');
  });

  it('ignores inspection results for files removed while they were being checked', async () => {
    let release;
    const inspectFile = vi.fn(
      (file, id) =>
        new Promise((resolve) => {
          release = () => resolve({ id, file, name: file.name, size: file.size, type: '', lastModified: 0, extension: 'eps', category: 'vector', mime: { status: 'generic', reported: '' }, validation: { ok: true, code: 'ok', message: '' }, notes: [], probe: null, vector: null });
        }),
    );
    const studio = createFileStudio({ taskRunner: realRunner(), inspectFile });
    const adding = studio.addFiles([makeFile(epsBytes(), 'a.eps')]);
    const [entry] = studio.getSnapshot().selection;
    expect(entry.pending).toBe(true);
    studio.removeFile(entry.id);
    release();
    await adding;
    expect(studio.getSnapshot().selection).toHaveLength(0);
    expect(studio.getSnapshot().status).toBe(STATUS.IDLE);
  });

  it('recalculates health and invalidates acknowledgements when the print size changes', async () => {
    const file = makeFile(psdBytes({ width: 3000, height: 2000 }), 'low.psd');
    const studio = createFileStudio({ taskRunner: realRunner(), initialPrintSize: { width: 8, height: 4, unit: 'ft' } });
    await studio.addFiles([file]);
    await studio.prepare();
    let snapshot = studio.getSnapshot();
    expect(snapshot.health.worst).toBe('critical');
    expect(snapshot.acknowledgement).toEqual({ required: true, given: false });
    expect(studio.canDownloadPrepared()).toBe(false);

    studio.acknowledgeWarnings(true);
    expect(studio.getSnapshot().acknowledgement.given).toBe(true);
    expect(studio.canDownloadPrepared()).toBe(true);

    studio.setPrintSize({ width: 10 });
    snapshot = studio.getSnapshot();
    expect(snapshot.acknowledgement).toEqual({ required: true, given: false });

    studio.setPrintSize({ width: 1.5, height: 1 });
    snapshot = studio.getSnapshot();
    expect(snapshot.health.worst).toBe('meets-target');
    expect(snapshot.acknowledgement.required).toBe(false);
    expect(studio.canDownloadPrepared()).toBe(true);
    expect(snapshot.result).not.toBeNull(); // no reprocessing needed
  });

  it('previews selection health before preparing', async () => {
    const studio = createFileStudio({ taskRunner: realRunner(), initialPrintSize: { width: 10, height: 5, unit: 'ft' } });
    await studio.addFiles([makeFile(jpegHeaderBytes({ width: 6000, height: 3000 }), 'photo.jpg', 'image/jpeg')]);
    const [entry] = studio.getSnapshot().selection;
    expect(studio.getSnapshot().selectionHealth[entry.id].assessment).toMatchObject({ status: 'critical', effectivePpi: 50 });
  });

  it('records rejected folders and duplicate selections as notices', async () => {
    const studio = createFileStudio({ taskRunner: realRunner() });
    const file = makeFile(epsBytes(), 'a.eps');
    await studio.addFiles([file], { rejected: [{ name: 'Artwork folder', reason: 'directory' }] });
    await studio.addFiles([file]);
    const notices = studio.getSnapshot().notices.map((notice) => notice.message);
    expect(notices[0]).toMatch(/Artwork folder.*is a folder/);
    expect(notices[1]).toMatch(/already in the list/);
    expect(studio.getSnapshot().selection).toHaveLength(1);
    studio.dismissNotice(studio.getSnapshot().notices[0].id);
    expect(studio.getSnapshot().notices).toHaveLength(1);
  });

  it('allows the same file to be chosen again after removal', async () => {
    const studio = createFileStudio({ taskRunner: realRunner() });
    const file = makeFile(epsBytes(), 'a.eps');
    await studio.addFiles([file]);
    studio.removeFile(studio.getSnapshot().selection[0].id);
    await studio.addFiles([file]);
    expect(studio.getSnapshot().selection).toHaveLength(1);
  });

  it('replaces a file in place and resets the result', async () => {
    const studio = createFileStudio({ taskRunner: realRunner() });
    await studio.addFiles([makeFile(epsBytes(), 'a.eps')]);
    await studio.prepare();
    const [entry] = studio.getSnapshot().selection;
    await studio.replaceFile(entry.id, makeFile(svgWithMetadata(), 'b.svg'));
    const snapshot = studio.getSnapshot();
    expect(snapshot.selection.map((item) => item.name)).toEqual(['b.svg']);
    expect(snapshot.result).toBeNull();
    expect(snapshot.status).toBe(STATUS.IDLE);
  });

  it('retries after a failure and resets completely', async () => {
    const run = vi.fn().mockRejectedValueOnce(new StudioError('timeout', 'slow'));
    const runner = { capabilities: { workers: true }, run };
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(epsBytes(), 'a.eps'), makeFile(epsBytes(), 'b.eps')]);
    await studio.prepare();
    expect(studio.getSnapshot().status).toBe(STATUS.FAILED);
    run.mockResolvedValueOnce({ blob: new Blob(['PK']), manifest: [], verification: { verified: true } });
    await studio.retry();
    expect(studio.getSnapshot().status).toBe(STATUS.READY);
    studio.reset();
    expect(studio.getSnapshot()).toMatchObject({ status: STATUS.IDLE, selection: [], result: null, notices: [] });
  });

  it('stops work and listeners on dispose', async () => {
    const runner = controllableRunner();
    const listener = vi.fn();
    const studio = createFileStudio({ taskRunner: runner });
    await studio.addFiles([makeFile(epsBytes(), 'a.eps'), makeFile(epsBytes(), 'b.eps')]);
    studio.subscribe(listener);
    const pending = studio.prepare();
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    listener.mockClear();
    studio.dispose();
    expect(runner.calls[0].options.signal.aborted).toBe(true);
    expect(await pending).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(studio.getSnapshot().selection).toEqual([]);
  });
});
