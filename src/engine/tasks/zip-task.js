/**
 * Multi-file JSZip bundler (runs inside zip.worker.js).
 *
 * Original-payload policy: every selected file is stored exactly as supplied.
 * Images and PDFs are not optimised before bundling; protected vectors are
 * never touched. Entries are compressed losslessly (see ZIP_POLICY): STORE for
 * already-compressed raster formats, DEFLATE level 6 for everything else.
 * Already-compressed files may make the archive about the same size as the
 * originals, or slightly larger — that is reported honestly, not hidden.
 *
 * Generation uses JSZip's asynchronous internal stream rather than
 * `generateAsync()` so the task can (a) stop at the next chunk when canceled,
 * (b) enforce the archive size ceiling while generating, and (c) build the
 * final Blob from chunks without an extra full-size concatenation copy.
 * Note that `generateAsync()` itself does not create a thread — the
 * surrounding Web Worker is what keeps this work off the page's main thread.
 *
 * After generation the archive is re-opened and every entry is extracted and
 * compared byte-for-byte with its source file. A mismatch fails the task: a
 * damaged archive is never delivered.
 */

import JSZip from 'jszip';
import { CanceledError, StudioError } from '../errors.js';
import { bytesEqual } from '../inspect/bytes.js';
import { ZIP_POLICY } from '../policy.js';
import { formatBytes } from '../format.js';

/** DOS timestamps cannot represent dates before 1980. */
const EARLIEST_ZIP_DATE = Date.UTC(1980, 0, 2);

/**
 * @typedef {object} ZipEntryInput
 * @property {Blob} file          Original payload.
 * @property {string} entryName   Sanitised, unique entry name.
 * @property {string} extension   Lowercase extension (selects STORE or DEFLATE).
 * @property {number} lastModified
 */

/**
 * @param {string} extension
 * @returns {'STORE'|'DEFLATE'}
 */
export function compressionFor(extension) {
  return ZIP_POLICY.storeExtensions.includes(extension) ? 'STORE' : 'DEFLATE';
}

/**
 * @param {{ entries: ZipEntryInput[], maxArchiveBytes: number }} payload
 * @param {import('../worker-protocol.js').TaskContext} context
 */
export async function buildZipArchive(payload, context) {
  const { entries, maxArchiveBytes } = payload;
  if (!entries?.length) throw new StudioError('empty-batch', 'There are no files to package.');

  let zip = new JSZip();
  const manifest = entries.map((entry) => {
    const compression = compressionFor(entry.extension);
    zip.file(entry.entryName, entry.file, {
      binary: true,
      createFolders: false,
      date: new Date(Math.max(EARLIEST_ZIP_DATE, entry.lastModified || Date.now())),
      compression,
      compressionOptions: compression === 'DEFLATE' ? { level: ZIP_POLICY.deflateLevel } : null,
    });
    return { entryName: entry.entryName, originalBytes: entry.file.size, compression };
  });

  context.onProgress({ phase: 'packaging', fraction: 0 });
  const chunks = await new Promise((resolve, reject) => {
    /** @type {Uint8Array[]} */
    const collected = [];
    let total = 0;
    let stopped = false;
    const stream = zip.generateInternalStream({
      type: 'uint8array',
      compression: 'STORE',
      platform: 'DOS',
      streamFiles: false,
      mimeType: 'application/zip',
    });
    const stop = (error) => {
      if (stopped) return;
      stopped = true;
      stream.pause();
      collected.length = 0;
      reject(error);
    };
    stream
      .on('data', (chunk, meta) => {
        if (stopped) return;
        if (context.isCanceled()) {
          stop(new CanceledError());
          return;
        }
        total += chunk.length;
        if (total > maxArchiveBytes) {
          stop(
            new StudioError('archive-too-large', `The ZIP would exceed ${formatBytes(maxArchiveBytes)}, the largest archive this tool creates in a browser.`),
          );
          return;
        }
        collected.push(chunk);
        context.onProgress({ phase: 'packaging', fraction: (meta.percent / 100) * 0.8, detail: meta.currentFile ?? null });
      })
      .on('error', (error) => stop(error))
      .on('end', () => {
        if (stopped) return;
        stopped = true;
        resolve(collected);
      })
      .resume();
  });

  const archive = new Blob(chunks, { type: 'application/zip' });
  chunks.length = 0;
  // Drop JSZip's references to the input buffers before verification reads the archive back.
  zip = null;

  context.throwIfCanceled();
  const verification = await verifyArchive(archive, entries, context);
  if (!verification.verified) {
    throw new StudioError(
      'archive-verification-failed',
      'The ZIP did not match your original files when it was checked, so it was not delivered. Please try again.',
      { details: { mismatches: verification.mismatches } },
    );
  }
  context.onProgress({ phase: 'verifying', fraction: 1 });
  return { blob: archive, size: archive.size, manifest, verification };
}

/**
 * Extracts every entry and compares it byte-for-byte with its source.
 *
 * @param {Blob} archive
 * @param {ZipEntryInput[]} entries
 * @param {import('../worker-protocol.js').TaskContext} context
 */
export async function verifyArchive(archive, entries, context) {
  context.onProgress({ phase: 'verifying', fraction: 0.8 });
  const loaded = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
  const mismatches = [];
  const storedNames = Object.keys(loaded.files);
  if (storedNames.length !== entries.length) {
    mismatches.push({ entryName: null, reason: `expected ${entries.length} entries, found ${storedNames.length}` });
  }
  for (let index = 0; index < entries.length; index += 1) {
    context.throwIfCanceled();
    const entry = entries[index];
    const stored = loaded.file(entry.entryName);
    if (!stored) {
      mismatches.push({ entryName: entry.entryName, reason: 'missing' });
      continue;
    }
    const extracted = await stored.async('uint8array');
    const original = new Uint8Array(await entry.file.arrayBuffer());
    if (!bytesEqual(extracted, original)) mismatches.push({ entryName: entry.entryName, reason: 'content differs' });
    context.onProgress({ phase: 'verifying', fraction: 0.8 + (0.2 * (index + 1)) / entries.length });
  }
  return {
    method: 'byte-compare',
    verified: mismatches.length === 0,
    checkedEntries: entries.length,
    mismatches,
  };
}
