/**
 * Executes a route plan and produces a structured JobResult.
 *
 * Results are data, not UI text inferred after the fact: every file carries an
 * explicit outcome, reason code, byte counts, dimensions and limitations, and
 * the job carries preservation and output-constraint reports. The interface
 * renders these fields directly.
 *
 * Original-file fallbacks: for image and PDF routes, any condition that makes
 * a prepared copy unsafe or pointless (unsupported features, failed
 * verification, no worthwhile saving, timeouts, memory exhaustion, worker
 * failures) produces a "kept-original" outcome whose download is the original
 * File object itself. Only ZIP failures fail the job, because there is no
 * single original to fall back to.
 */

import { IMAGE_POLICY, LIMITS, MIME_BY_EXTENSION, PDF_POLICY } from './policy.js';
import { ROUTES, CATEGORIES } from './router.js';
import { CanceledError, StudioError, isCanceledError } from './errors.js';
import { archiveFileName, assignEntryNames, preparedFileName } from './filenames.js';
import { decideImageOutcome, evaluateImageConstraints, preflightImage } from './image-policy.js';
import { readBytes } from './inspect/bytes.js';
import { detectFormat } from './inspect/signatures.js';
import { probeRaster } from './inspect/raster-probe.js';
import { formatDimensions, formatNumber } from './format.js';

/**
 * @typedef {object} Artifact
 * @property {Blob} blob          The downloadable bytes (the original File for pass-through outcomes).
 * @property {string} filename
 * @property {string} mimeType
 * @property {number} size
 * @property {'original'|'prepared'|'archive'} kind
 */

/**
 * @typedef {object} FileOutcome
 * @property {string} fileId
 * @property {string} name
 * @property {string} extension
 * @property {string | null} category
 * @property {'preserved-exact'|'optimized'|'kept-original'|'bundled'} outcome
 * @property {string} reasonCode
 * @property {string} message
 * @property {number} originalBytes
 * @property {number | null} preparedBytes    null for ZIP members (compressed size is per-archive).
 * @property {{ width: number, height: number } | null} originalDimensions  Orientation-corrected.
 * @property {{ width: number, height: number } | null} preparedDimensions
 * @property {boolean} assessable             Pixel dimensions are known, so PPI can be measured.
 * @property {string | null} assessmentLimitation
 * @property {{ width: number, height: number } | null} artboard  Vector/PDF shape (aspect checks only).
 * @property {string | null} entryName        ZIP entry name for bundled files.
 * @property {boolean | null} constraintsMet
 * @property {string[]} notes
 */

/**
 * @typedef {object} Notice
 * @property {string} code
 * @property {'info'|'warning'|'critical'} [severity]
 * @property {string} message
 * @property {string | null} [fileId]
 */

/**
 * @typedef {object} JobResult
 * @property {string} jobId
 * @property {string} route
 * @property {'ready'} state
 * @property {number} startedAt     Epoch milliseconds.
 * @property {number} durationMs    Measured with performance.now().
 * @property {{ fileId: string, name: string, size: number, type: string, extension: string, lastModified: number }[]} inputs
 * @property {Artifact} artifact     Primary download.
 * @property {FileOutcome[]} files
 * @property {{ originalBytes: number, preparedBytes: number, savedBytes: number, savedRatio: number }} totals
 * @property {Notice[]} warnings
 * @property {Notice[]} limitations
 * @property {{ method: 'identity'|'byte-compare'|'retained-original', verified: boolean, message: string }} preservation
 * @property {{ applicable: boolean, satisfied: boolean | null, limits: Record<string, number> | null, violations: { code: string, message: string }[] }} constraints
 * @property {import('./filenames.js').EntryNameAssignment[] | null} entryMap
 * @property {Record<string, unknown> | null} details
 */

export const ASSESSMENT_LIMITATIONS = Object.freeze({
  vector:
    'Vector artwork scales without losing sharpness, but it can contain embedded images whose resolution is not checked here.',
  pdf: 'PDF resolution is not assessed. Images inside a PDF can be placed at any size, so there is no single PPI value for a document. Check embedded images in your prepress software.',
  psd: 'Pixel size is read from the Photoshop file header. Layers, smart objects and colour settings are not checked.',
});

const FORMAT_TO_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/** @param {import('./validation.js').SelectionEntry} entry */
function orientedDimensions(entry) {
  return entry.probe ? { width: entry.probe.orientedWidth, height: entry.probe.orientedHeight } : null;
}

/**
 * @param {import('./validation.js').SelectionEntry} entry
 * @returns {Omit<FileOutcome, 'outcome'|'reasonCode'|'message'>}
 */
function baseOutcome(entry) {
  const limitation =
    entry.category === CATEGORIES.VECTOR
      ? ASSESSMENT_LIMITATIONS.vector
      : entry.category === CATEGORIES.PDF
        ? ASSESSMENT_LIMITATIONS.pdf
        : entry.category === CATEGORIES.PSD
          ? ASSESSMENT_LIMITATIONS.psd
          : null;
  return {
    fileId: entry.id,
    name: entry.name,
    extension: entry.extension,
    category: entry.category,
    originalBytes: entry.size,
    preparedBytes: entry.size,
    originalDimensions: orientedDimensions(entry),
    preparedDimensions: orientedDimensions(entry),
    assessable: Boolean(entry.probe),
    assessmentLimitation: limitation,
    artboard: entry.vector?.artboard ?? null,
    entryName: null,
    constraintsMet: null,
    notes: [...entry.notes, ...(entry.vector?.notes ?? [])],
  };
}

/**
 * @param {import('./validation.js').SelectionEntry} entry
 * @returns {Artifact}
 */
function originalArtifact(entry) {
  return {
    blob: entry.file,
    filename: entry.name,
    mimeType: entry.type || MIME_BY_EXTENSION[entry.extension] || 'application/octet-stream',
    size: entry.size,
    kind: 'original',
  };
}

const NO_CONSTRAINTS = Object.freeze({ applicable: false, satisfied: null, limits: null, violations: [] });

/**
 * @param {object} options
 * @param {import('./router.js').RoutePlan} options.plan
 * @param {import('./validation.js').SelectionEntry[]} options.entries
 * @param {string} options.jobId
 * @param {import('./task-runner.js').TaskRunner} options.runner
 * @param {AbortSignal} [options.signal]
 * @param {(update: import('./worker-protocol.js').ProgressUpdate) => void} [options.onProgress]
 * @param {typeof LIMITS} [options.limits]
 * @returns {Promise<JobResult>}
 */
export async function executePlan({ plan, entries, jobId, runner, signal, onProgress, limits = LIMITS }) {
  const startedAt = Date.now();
  const started = performance.now();
  const context = { runner, signal, onProgress: onProgress ?? (() => {}), limits };

  let partial;
  switch (plan.route) {
    case ROUTES.PROTECTED_PASSTHROUGH:
      partial = preparePassthrough(entries[0], 'vector');
      break;
    case ROUTES.PSD_PASSTHROUGH:
      partial = preparePassthrough(entries[0], 'psd');
      break;
    case ROUTES.ZIP_ORIGINALS:
      partial = await prepareZip(entries, context);
      break;
    case ROUTES.IMAGE_COMPRESS:
      partial = await prepareImage(entries[0], context);
      break;
    case ROUTES.PDF_REWRITE:
      partial = await preparePdf(entries[0], context);
      break;
    default:
      throw new StudioError('invalid-route', 'This selection cannot be prepared.');
  }
  if (signal?.aborted) throw new CanceledError();

  const durationMs = performance.now() - started;
  const originalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const preparedBytes = partial.artifact.size;
  const savedBytes = originalBytes - preparedBytes;
  return Object.freeze({
    jobId,
    route: plan.route,
    state: 'ready',
    startedAt,
    durationMs,
    inputs: entries.map((entry) => ({
      fileId: entry.id,
      name: entry.name,
      size: entry.size,
      type: entry.type,
      extension: entry.extension,
      lastModified: entry.lastModified,
    })),
    artifact: partial.artifact,
    files: partial.files,
    totals: { originalBytes, preparedBytes, savedBytes, savedRatio: originalBytes ? savedBytes / originalBytes : 0 },
    warnings: partial.warnings,
    limitations: partial.limitations,
    preservation: partial.preservation,
    constraints: partial.constraints,
    entryMap: partial.entryMap,
    details: partial.details,
  });
}

/**
 * Protected vector and PSD pass-through: the download is the original File
 * object, so the bytes are identical by construction.
 *
 * @param {import('./validation.js').SelectionEntry} entry
 * @param {'vector'|'psd'} kind
 */
function preparePassthrough(entry, kind) {
  const base = baseOutcome(entry);
  return {
    artifact: originalArtifact(entry),
    files: [
      {
        ...base,
        outcome: 'preserved-exact',
        reasonCode: kind === 'psd' ? 'photoshop-passthrough' : 'protected-vector',
        message:
          kind === 'psd'
            ? 'Kept exactly as supplied. Photoshop files are never altered.'
            : 'Kept exactly as supplied. Vector files are never converted, flattened or re-saved.',
      },
    ],
    preservation: {
      method: 'identity',
      verified: true,
      message: 'The download is the very file you selected, byte for byte.',
    },
    constraints: NO_CONSTRAINTS,
    warnings: [],
    limitations: [{ code: kind === 'psd' ? 'psd-header-only' : 'vector-not-assessed', message: base.assessmentLimitation }],
    entryMap: null,
    details: null,
  };
}

/**
 * @param {import('./validation.js').SelectionEntry[]} entries
 * @param {{ runner: import('./task-runner.js').TaskRunner, signal?: AbortSignal, onProgress: Function, limits: typeof LIMITS }} context
 */
async function prepareZip(entries, context) {
  const { runner, signal, onProgress, limits } = context;
  const assignments = assignEntryNames(entries.map((entry) => entry.name));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const output = await runner.run(
    'zip',
    {
      entries: entries.map((entry, index) => ({
        file: entry.file,
        entryName: assignments[index].entryName,
        extension: entry.extension,
        lastModified: entry.lastModified,
      })),
      maxArchiveBytes: limits.maxArchiveBytes,
    },
    {
      signal,
      onProgress,
      timeoutMs: limits.timeouts.zip,
      mainThreadAllowed: totalBytes <= limits.mainThread.maxZipInputBytes,
    },
  );

  const filename = archiveFileName(entries.length);
  const archive = new File([output.blob], filename, { type: 'application/zip', lastModified: Date.now() });
  const files = entries.map((entry, index) => {
    const assignment = assignments[index];
    const why = assignment.reasons.includes('duplicate')
      ? ' to avoid a duplicate name'
      : ' because some characters are not safe in archives';
    return {
      ...baseOutcome(entry),
      outcome: /** @type {const} */ ('bundled'),
      reasonCode: 'original-payload',
      message: assignment.changed ? `Stored unchanged as “${assignment.entryName}”${why}.` : 'Stored unchanged.',
      entryName: assignment.entryName,
      preparedBytes: null,
    };
  });

  const warnings = [];
  if (archive.size >= totalBytes * 0.98) {
    warnings.push({
      code: 'little-saving',
      severity: 'info',
      fileId: null,
      message:
        'These files are mostly already compressed, so the ZIP is about the same size as the originals' +
        (archive.size > totalBytes ? ' (slightly larger, because a ZIP adds a small header for each file).' : '.'),
    });
  }
  const renamed = assignments.filter((assignment) => assignment.changed);
  if (renamed.length) {
    warnings.push({
      code: 'renamed-entries',
      severity: 'info',
      fileId: null,
      message: `${renamed.length} ${renamed.length === 1 ? 'file was' : 'files were'} given a different name inside the ZIP. File contents are unchanged.`,
    });
  }

  const unassessed = files.filter((file) => !file.assessable);
  const limitations = unassessed.length
    ? [
        {
          code: 'zip-unassessed',
          message: `Resolution is not assessed for ${unassessed.length} ${unassessed.length === 1 ? 'file' : 'files'} (vector or PDF): ${unassessed.map((file) => file.name).join(', ')}.`,
        },
      ]
    : [];

  return {
    artifact: { blob: archive, filename, mimeType: 'application/zip', size: archive.size, kind: 'archive' },
    files,
    preservation: {
      method: 'byte-compare',
      verified: output.verification.verified,
      message: `All ${entries.length} files were extracted from the finished ZIP and compared byte for byte with your originals.`,
    },
    constraints: {
      applicable: true,
      satisfied: archive.size <= limits.maxArchiveBytes,
      limits: { maxArchiveBytes: limits.maxArchiveBytes },
      violations: [],
    },
    warnings,
    limitations,
    entryMap: assignments,
    details: { manifest: output.manifest, ranOnMainThread: Boolean(output.ranOnMainThread) },
  };
}

/** @param {any} error */
function describeImageFailure(error) {
  switch (error?.code) {
    case 'timeout':
      return 'Compressing this image took too long and was stopped. Your original is kept unchanged.';
    case 'out-of-memory':
      return 'This device ran out of memory while compressing the image. Your original is kept unchanged. Try a device with more memory, or reduce the pixel size first.';
    case 'worker-crashed':
      return 'The background process stopped unexpectedly, which often means the device ran out of memory. Your original is kept unchanged.';
    case 'decode-failed':
    case 'background-unsupported':
    case 'workers-unavailable':
      return `${error.message} Your original is kept unchanged.`;
    default:
      return 'The image could not be compressed. Your original is kept unchanged.';
  }
}

/**
 * @param {import('./validation.js').SelectionEntry} entry
 * @param {{ runner: import('./task-runner.js').TaskRunner, signal?: AbortSignal, onProgress: Function, limits: typeof LIMITS }} context
 */
async function prepareImage(entry, context) {
  const { runner, signal, onProgress, limits } = context;
  const probe = /** @type {import('./inspect/raster-probe.js').RasterProbe} */ (entry.probe);
  const mimeType = MIME_BY_EXTENSION[entry.extension];
  const source = { bytes: entry.size, width: probe.orientedWidth, height: probe.orientedHeight };
  const sourceConstraints = evaluateImageConstraints(source, IMAGE_POLICY);
  const base = baseOutcome(entry);

  const keepOriginal = (reasonCode, message, constraints = sourceConstraints) => ({
    artifact: originalArtifact(entry),
    files: [{ ...base, outcome: /** @type {const} */ ('kept-original'), reasonCode, message, constraintsMet: constraints.satisfied }],
    preservation: {
      method: /** @type {const} */ ('retained-original'),
      verified: true,
      message: 'The file you download is your original, unchanged.',
    },
    constraints: {
      applicable: true,
      satisfied: constraints.satisfied,
      limits: constraints.limits,
      violations: constraints.violations,
    },
    warnings: constraints.satisfied
      ? []
      : [
          {
            code: 'limits-not-met',
            severity: /** @type {const} */ ('warning'),
            fileId: entry.id,
            message: `Your original does not meet the output limits: ${constraints.violations.map((violation) => violation.message).join(' ')}`,
          },
        ],
    limitations: [],
    entryMap: null,
    details: { encoding: null, ranOnMainThread: false },
  });

  const preflight = preflightImage(probe);
  if (!preflight.proceed) return keepOriginal(preflight.reasonCode, preflight.message);

  let encoded;
  try {
    encoded = await runner.run(
      'image',
      { file: entry.file, mimeType, probe, policy: IMAGE_POLICY },
      {
        signal,
        onProgress,
        timeoutMs: limits.timeouts.image,
        mainThreadAllowed: probe.orientedWidth * probe.orientedHeight <= limits.mainThread.maxRasterPixels,
      },
    );
  } catch (error) {
    if (isCanceledError(error)) throw error;
    return keepOriginal(error?.code ?? 'processing-failed', describeImageFailure(error));
  }

  if (encoded.status === 'canvas-limited') {
    return keepOriginal(
      'canvas-limit',
      `This browser could only process this image at ${formatDimensions({ width: encoded.decodedWidth, height: encoded.decodedHeight })}, smaller than its real size, so it was not resized silently. Your original is kept unchanged. Try a desktop browser.`,
    );
  }

  // Verify the actual output type and dimensions from the encoded bytes.
  const detected = detectFormat(await readBytes(encoded.blob, 0, 64));
  const detectedType = detected ? (FORMAT_TO_MIME[detected] ?? `application/${detected}`) : null;
  let outputDimensions = null;
  if (detectedType === mimeType) {
    try {
      const outputProbe = await probeRaster(encoded.blob, entry.extension);
      outputDimensions = { width: outputProbe.orientedWidth, height: outputProbe.orientedHeight };
    } catch {
      outputDimensions = null;
    }
    if (!outputDimensions || outputDimensions.width !== encoded.width || outputDimensions.height !== encoded.height) {
      return keepOriginal('verification-failed', 'The compressed copy could not be verified. Your original is kept unchanged.');
    }
  }

  const decision = decideImageOutcome({
    source,
    encoded: {
      bytes: encoded.blob.size,
      width: outputDimensions?.width ?? encoded.width,
      height: outputDimensions?.height ?? encoded.height,
      type: detectedType,
    },
    expectedType: mimeType,
    policy: IMAGE_POLICY,
  });
  if (decision.outcome === 'kept-original') return keepOriginal(decision.reasonCode, decision.message, decision.constraints);

  const prepared = new File([encoded.blob], preparedFileName(entry.name), { type: mimeType, lastModified: Date.now() });
  const notes = [...base.notes];
  if (encoded.encoding === 'png-palette') {
    notes.push(
      `Every colour was preserved: the image uses ${formatNumber(encoded.colorCount)} colours, within the encoder's ${formatNumber(IMAGE_POLICY.pngPaletteColors)}-colour budget at quality ${IMAGE_POLICY.quality}.`,
    );
  } else if (encoded.encoding === 'png-lossless') {
    notes.push(`Re-encoded losslessly, because this PNG has more colours than quality ${IMAGE_POLICY.quality} would keep.`);
  }
  if (probe.format === 'webp' && probe.lossless) notes.push('The source was lossless WebP; the prepared copy is lossy WebP.');
  if (probe.format === 'jpeg' && probe.orientation !== 1) notes.push('The camera orientation was applied to the pixels.');
  if (probe.hasAlpha) notes.push('Transparency was preserved.');
  notes.push('Metadata such as EXIF, camera details and embedded DPI is not copied to the prepared copy.');
  if (encoded.ranOnMainThread) notes.push('Processed on the page because this browser cannot process images in the background.');

  const lossy = encoded.encoding === 'jpeg' || encoded.encoding === 'webp';
  return {
    artifact: { blob: prepared, filename: prepared.name, mimeType, size: prepared.size, kind: /** @type {const} */ ('prepared') },
    files: [
      {
        ...base,
        outcome: /** @type {const} */ ('optimized'),
        reasonCode: decision.reasonCode,
        message: decision.message,
        preparedBytes: prepared.size,
        preparedDimensions: { width: encoded.width, height: encoded.height },
        constraintsMet: true,
        notes,
      },
    ],
    preservation: {
      method: /** @type {const} */ ('retained-original'),
      verified: true,
      message: 'Your original stays available to download, unchanged.',
    },
    constraints: { applicable: true, satisfied: true, limits: decision.constraints.limits, violations: [] },
    warnings: [],
    limitations: lossy
      ? [
          {
            code: 'perceptual-quality',
            message: `Quality ${IMAGE_POLICY.quality} is intended to be visually near-lossless, but it is not mathematically lossless. If fine detail matters, compare the prepared copy with your original before ordering.`,
          },
        ]
      : [],
    entryMap: null,
    details: {
      encoding: encoded.encoding,
      quality: encoded.quality,
      colorCount: encoded.colorCount,
      ranOnMainThread: Boolean(encoded.ranOnMainThread),
    },
  };
}

/** @param {any} error */
function describePdfFailure(error) {
  switch (error?.code) {
    case 'timeout':
      return 'Tidying this PDF took too long and was stopped. Your original is kept unchanged.';
    case 'out-of-memory':
    case 'worker-crashed':
      return 'This device ran out of memory while reading the PDF. Your original is kept unchanged.';
    case 'background-unsupported':
    case 'workers-unavailable':
      return `${error.message} Your original is kept unchanged.`;
    default:
      return 'The PDF could not be tidied. Your original is kept unchanged.';
  }
}

/**
 * @param {import('./validation.js').SelectionEntry} entry
 * @param {{ runner: import('./task-runner.js').TaskRunner, signal?: AbortSignal, onProgress: Function, limits: typeof LIMITS }} context
 */
async function preparePdf(entry, context) {
  const { runner, signal, onProgress, limits } = context;
  const base = baseOutcome(entry);
  let output;
  try {
    output = await runner.run(
      'pdf',
      { file: entry.file, policy: PDF_POLICY },
      {
        signal,
        onProgress,
        timeoutMs: limits.timeouts.pdf,
        mainThreadAllowed: entry.size <= limits.mainThread.maxPdfInputBytes,
      },
    );
  } catch (error) {
    if (isCanceledError(error)) throw error;
    output = { outcome: 'kept-original', reasonCode: error?.code ?? 'processing-failed', message: describePdfFailure(error), stats: null };
  }

  const stats = output.stats ?? null;
  const artboard = stats?.firstPage ? { width: stats.firstPage.widthPt, height: stats.firstPage.heightPt } : null;
  const limitations = [{ code: 'pdf-not-assessed', message: ASSESSMENT_LIMITATIONS.pdf }];
  if (stats?.embeddedImages) {
    limitations.push({
      code: 'pdf-embedded-images',
      message: `This PDF contains ${formatNumber(stats.embeddedImages)} embedded ${stats.embeddedImages === 1 ? 'image' : 'images'}. ${stats.embeddedImages === 1 ? 'Its' : 'Their'} print resolution was not checked.`,
    });
  }
  limitations.push({
    code: 'pdf-rewrite-scope',
    message: 'Savings depend on how the PDF was made. Saved revisions are merged and unused objects removed; images and fonts are not recompressed.',
  });

  if (output.outcome === 'optimized') {
    const prepared = new File([output.bytes], preparedFileName(entry.name), { type: 'application/pdf', lastModified: Date.now() });
    return {
      artifact: { blob: prepared, filename: prepared.name, mimeType: 'application/pdf', size: prepared.size, kind: 'prepared' },
      files: [
        { ...base, outcome: 'optimized', reasonCode: output.reasonCode, message: output.message, preparedBytes: prepared.size, artboard },
      ],
      preservation: {
        method: 'retained-original',
        verified: true,
        message: 'Every object in the rewritten PDF was checked against your original, and your original stays available to download.',
      },
      constraints: NO_CONSTRAINTS,
      warnings: [],
      limitations,
      entryMap: null,
      details: { stats, ranOnMainThread: Boolean(output.ranOnMainThread) },
    };
  }

  return {
    artifact: originalArtifact(entry),
    files: [{ ...base, outcome: 'kept-original', reasonCode: output.reasonCode, message: output.message, artboard }],
    preservation: { method: 'retained-original', verified: true, message: 'The file you download is your original, unchanged.' },
    constraints: NO_CONSTRAINTS,
    warnings: [],
    limitations,
    entryMap: null,
    details: { stats, ranOnMainThread: Boolean(output.ranOnMainThread) },
  };
}
