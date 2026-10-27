/**
 * FileStudio: the framework-independent controller behind the interface.
 *
 * Lifecycle (`snapshot.status`):
 *
 *   idle ──addFiles──▶ validating ──(all inspected)──▶ idle ──prepare──▶ processing
 *                                                                        │   │   │
 *                                       ready ◀──────────── result ──────┘   │   │
 *                                       canceled ◀───────── cancel ──────────┘   │
 *                                       failed ◀─────────── error ───────────────┘
 *
 * Any selection change (add, replace, remove, clear, reset) cancels a running
 * job and discards a previous result, because that result no longer describes
 * the selection. Each job has an id; when a job settles after it was canceled
 * or superseded, its outcome is ignored (stale-result protection). Changing
 * the print size never reprocesses files: resolution health and the warning
 * acknowledgement are recalculated from the existing result, and an
 * acknowledgement given for an older job or older dimensions no longer counts.
 *
 * Resource ownership: workers are created per task and terminated when the
 * task settles or is canceled (see worker-client.js). Snapshots hold File/Blob
 * references only; object URLs are created and revoked by the interface layer.
 * `dispose()` cancels work, drops file references and removes listeners.
 */

import { LIMITS, MIME_BY_EXTENSION } from './policy.js';
import { categorize, planRoute, ROUTES } from './router.js';
import { inspectFile as defaultInspectFile } from './validation.js';
import { executePlan } from './pipeline.js';
import { assessEntry, assessResult } from './health.js';
import { createTaskRunner } from './task-runner.js';
import { getExtension } from './filenames.js';
import { isCanceledError } from './errors.js';
import { DEFAULT_UNIT, resolvePrintSize } from './units.js';

export const STATUS = Object.freeze({
  IDLE: 'idle',
  VALIDATING: 'validating',
  PROCESSING: 'processing',
  READY: 'ready',
  CANCELED: 'canceled',
  FAILED: 'failed',
});

/** Customer-facing labels for progress phases reported by tasks. */
const PHASE_LABELS = Object.freeze({
  starting: 'Starting',
  packaging: 'Packaging your files',
  verifying: 'Checking the result',
  decoding: 'Reading the image',
  resizing: 'Resizing',
  encoding: 'Compressing',
  comparing: 'Comparing with your original',
  reading: 'Reading the PDF',
  parsing: 'Reading the PDF structure',
  checking: 'Checking the PDF',
  writing: 'Rewriting the PDF',
});

/**
 * @param {any} error
 * @returns {{ code: string, message: string }}
 */
function describeFailure(error) {
  const code = error?.code ?? 'unexpected';
  switch (code) {
    case 'timeout':
      return { code, message: 'Preparation took too long and was stopped. Try fewer or smaller files.' };
    case 'out-of-memory':
    case 'worker-crashed':
      return {
        code,
        message: 'This device ran out of memory while preparing your files. Try fewer or smaller files, or a device with more memory.',
      };
    case 'archive-too-large':
    case 'archive-verification-failed':
    case 'workers-unavailable':
    case 'background-unsupported':
      return { code, message: error.message };
    default:
      return { code, message: 'Something went wrong while preparing your files. Please try again.' };
  }
}

/** @param {File} file */
const fileKey = (file) => `${file.name}|${file.size}|${file.lastModified}`;

/**
 * @typedef {object} StudioSnapshot
 * @property {'idle'|'validating'|'processing'|'ready'|'canceled'|'failed'} status
 * @property {(import('./validation.js').SelectionEntry & { pending: boolean })[]} selection
 * @property {import('./router.js').RoutePlan | null} plan   null while files are being inspected.
 * @property {import('./units.js').PrintSize} printSize
 * @property {string[]} printSizeErrors
 * @property {Record<string, ReturnType<typeof assessEntry>>} selectionHealth
 * @property {{ phase: string, fraction: number, label: string, detail: string | null } | null} progress
 * @property {import('./pipeline.js').JobResult | null} result
 * @property {import('./health.js').ResultHealth | null} health
 * @property {string | null} acknowledgedKey
 * @property {{ required: boolean, given: boolean }} acknowledgement
 * @property {{ code: string, message: string } | null} error
 * @property {{ id: string, kind: 'info'|'warning', message: string }[]} notices
 * @property {{ workers: boolean }} capabilities
 */

/**
 * @typedef {object} FileStudio
 * @property {() => StudioSnapshot} getSnapshot
 * @property {(listener: (snapshot: StudioSnapshot, event: { type: string, jobId?: string }) => void) => () => void} subscribe
 * @property {(files: Iterable<File> | ArrayLike<File>, options?: { rejected?: { name: string, reason: string }[] }) => Promise<void>} addFiles
 * @property {(fileId: string, file: File) => Promise<void>} replaceFile
 * @property {(fileId: string) => void} removeFile
 * @property {() => void} clearSelection
 * @property {(printSize: Partial<import('./units.js').PrintSize>) => void} setPrintSize
 * @property {() => Promise<import('./pipeline.js').JobResult | null>} prepare
 * @property {() => void} cancel
 * @property {() => Promise<import('./pipeline.js').JobResult | null>} retry
 * @property {(given?: boolean) => void} acknowledgeWarnings
 * @property {() => boolean} canDownloadPrepared
 * @property {(kind?: 'prepared'|'original', fileId?: string) => { blob: Blob, filename: string, mimeType: string, size: number } | null} getDownload
 * @property {(noticeId: string) => void} dismissNotice
 * @property {() => void} reset
 * @property {() => void} dispose
 */

/**
 * @param {object} [options]
 * @param {typeof LIMITS} [options.limits]
 * @param {import('./task-runner.js').TaskRunner} [options.taskRunner]
 * @param {typeof defaultInspectFile} [options.inspectFile]
 * @param {Partial<import('./units.js').PrintSize>} [options.initialPrintSize]
 * @returns {FileStudio}
 */
export function createFileStudio(options = {}) {
  const limits = options.limits ?? LIMITS;
  const runner = options.taskRunner ?? createTaskRunner();
  const inspect = options.inspectFile ?? defaultInspectFile;
  const listeners = new Set();
  let fileCounter = 0;
  let jobCounter = 0;
  let noticeCounter = 0;
  /** @type {{ id: string, controller: AbortController } | null} */
  let activeJob = null;
  let disposed = false;

  /** @param {Omit<StudioSnapshot, 'plan'|'printSizeErrors'|'selectionHealth'|'health'|'acknowledgement'> & Partial<StudioSnapshot>} raw */
  function derive(raw) {
    const pending = raw.selection.some((entry) => entry.pending);
    const health = raw.result ? assessResult(raw.result, raw.printSize) : null;
    /** @type {StudioSnapshot['selectionHealth']} */
    const selectionHealth = {};
    for (const entry of raw.selection) {
      if (!entry.pending) selectionHealth[entry.id] = assessEntry(entry, raw.printSize);
    }
    return Object.freeze({
      ...raw,
      plan: pending ? null : planRoute(raw.selection, limits),
      printSizeErrors: resolvePrintSize(raw.printSize).errors,
      selectionHealth,
      health,
      acknowledgement: {
        required: Boolean(health?.requiresAcknowledgement),
        given: Boolean(health && raw.acknowledgedKey === health.acknowledgementKey),
      },
    });
  }

  /** @type {StudioSnapshot} */
  let state = derive({
    status: STATUS.IDLE,
    selection: [],
    printSize: {
      width: options.initialPrintSize?.width ?? null,
      height: options.initialPrintSize?.height ?? null,
      unit: options.initialPrintSize?.unit ?? DEFAULT_UNIT,
    },
    progress: null,
    result: null,
    acknowledgedKey: null,
    error: null,
    notices: [],
    capabilities: { workers: runner.capabilities.workers },
  });

  const emit = (event) => {
    for (const listener of [...listeners]) listener(state, event);
  };

  function commit(patch, event = { type: 'state' }) {
    if (disposed) return;
    state = derive({ ...state, ...patch });
    emit(event);
  }

  const clearedResult = () => ({ result: null, progress: null, error: null, acknowledgedKey: null });

  const notice = (kind, message) => {
    noticeCounter += 1;
    return { id: `notice-${noticeCounter}`, kind, message };
  };

  /** @param {File} file */
  function pendingEntry(file) {
    fileCounter += 1;
    const extension = getExtension(file.name);
    return {
      id: `file-${fileCounter}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type ?? '',
      lastModified: file.lastModified ?? 0,
      extension,
      category: categorize(extension),
      mime: { status: 'generic', reported: file.type ?? '' },
      validation: { ok: false, code: 'pending', message: 'Checking this file…' },
      notes: [],
      probe: null,
      vector: null,
      pending: true,
    };
  }

  /** Cancels the running job without announcing it (used for selection changes). */
  function stopActiveJob() {
    if (!activeJob) return;
    const job = activeJob;
    activeJob = null;
    job.controller.abort();
  }

  async function validateEntries(entries) {
    await Promise.all(
      entries.map(async (pending) => {
        let inspected;
        try {
          inspected = await inspect(pending.file, pending.id, limits);
        } catch {
          inspected = {
            ...pending,
            validation: { ok: false, code: 'inspection-failed', message: 'This file could not be inspected. Choose it again.' },
          };
        }
        if (disposed) return;
        const index = state.selection.findIndex((entry) => entry.id === pending.id);
        if (index === -1) return; // removed or replaced while it was being inspected
        const selection = state.selection.slice();
        selection[index] = { ...inspected, pending: false };
        commit(
          { selection, status: selection.some((entry) => entry.pending) ? STATUS.VALIDATING : STATUS.IDLE },
          { type: 'selection' },
        );
      }),
    );
  }

  /** @type {FileStudio} */
  const studio = {
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addFiles(files, addOptions = {}) {
      if (disposed) return Promise.resolve();
      const notices = [...state.notices];
      for (const rejected of addOptions.rejected ?? []) {
        notices.push(
          notice(
            'warning',
            rejected.reason === 'directory'
              ? `“${rejected.name}” is a folder. Folders cannot be added; open it and choose the files inside.`
              : `“${rejected.name}” could not be added.`,
          ),
        );
      }
      const known = new Set(state.selection.map((entry) => fileKey(entry.file)));
      const fresh = [];
      for (const file of Array.from(files ?? [])) {
        const key = fileKey(file);
        if (known.has(key)) {
          notices.push(notice('info', `“${file.name}” is already in the list.`));
          continue;
        }
        known.add(key);
        fresh.push(pendingEntry(file));
      }
      if (!fresh.length) {
        commit({ notices }, { type: 'notice' });
        return Promise.resolve();
      }
      stopActiveJob();
      commit(
        { selection: [...state.selection, ...fresh], notices, ...clearedResult(), status: STATUS.VALIDATING },
        { type: 'selection' },
      );
      return validateEntries(fresh);
    },

    replaceFile(fileId, file) {
      const index = state.selection.findIndex((entry) => entry.id === fileId);
      if (disposed || index === -1 || !file) return Promise.resolve();
      stopActiveJob();
      const entry = pendingEntry(file);
      const selection = state.selection.slice();
      selection[index] = entry;
      commit({ selection, ...clearedResult(), status: STATUS.VALIDATING }, { type: 'selection' });
      return validateEntries([entry]);
    },

    removeFile(fileId) {
      const selection = state.selection.filter((entry) => entry.id !== fileId);
      if (selection.length === state.selection.length) return;
      stopActiveJob();
      commit(
        {
          selection,
          ...clearedResult(),
          status: selection.some((entry) => entry.pending) ? STATUS.VALIDATING : STATUS.IDLE,
        },
        { type: 'selection' },
      );
    },

    clearSelection() {
      stopActiveJob();
      commit({ selection: [], ...clearedResult(), status: STATUS.IDLE }, { type: 'selection' });
    },

    setPrintSize(printSize) {
      commit({ printSize: { ...state.printSize, ...printSize } }, { type: 'health' });
    },

    async prepare() {
      if (disposed || activeJob) return null;
      const { plan } = state;
      if (!plan || plan.route === ROUTES.IDLE || plan.route === ROUTES.INVALID) return null;
      const entries = state.selection;
      jobCounter += 1;
      const job = { id: `job-${jobCounter}`, controller: new AbortController() };
      activeJob = job;
      commit(
        {
          status: STATUS.PROCESSING,
          ...clearedResult(),
          progress: { phase: 'starting', fraction: 0, label: PHASE_LABELS.starting, detail: null },
        },
        { type: 'job-started', jobId: job.id },
      );
      try {
        const result = await executePlan({
          plan,
          entries,
          jobId: job.id,
          runner,
          limits,
          signal: job.controller.signal,
          onProgress(update) {
            if (activeJob !== job || disposed) return;
            state = Object.freeze({
              ...state,
              progress: {
                phase: update.phase,
                fraction: update.fraction,
                label: PHASE_LABELS[update.phase] ?? 'Working',
                detail: update.detail ?? null,
              },
            });
            emit({ type: 'progress', jobId: job.id });
          },
        });
        if (activeJob !== job || disposed) return null; // superseded or canceled: ignore stale result
        activeJob = null;
        commit({ status: STATUS.READY, result, progress: null }, { type: 'result', jobId: job.id });
        return result;
      } catch (error) {
        if (activeJob !== job || disposed) return null;
        activeJob = null;
        if (isCanceledError(error)) {
          commit({ status: STATUS.CANCELED, progress: null }, { type: 'canceled', jobId: job.id });
        } else {
          commit({ status: STATUS.FAILED, progress: null, error: describeFailure(error) }, { type: 'failed', jobId: job.id });
        }
        return null;
      }
    },

    cancel() {
      if (!activeJob) return;
      const job = activeJob;
      activeJob = null;
      job.controller.abort();
      commit({ status: STATUS.CANCELED, progress: null }, { type: 'canceled', jobId: job.id });
    },

    retry() {
      if (state.status === STATUS.PROCESSING || state.status === STATUS.VALIDATING) return Promise.resolve(null);
      return studio.prepare();
    },

    acknowledgeWarnings(given = true) {
      commit({ acknowledgedKey: given ? (state.health?.acknowledgementKey ?? null) : null }, { type: 'acknowledgement' });
    },

    canDownloadPrepared() {
      return Boolean(state.result) && (!state.acknowledgement.required || state.acknowledgement.given);
    },

    getDownload(kind = 'prepared', fileId) {
      if (kind === 'prepared') {
        const artifact = state.result?.artifact;
        return artifact
          ? { blob: artifact.blob, filename: artifact.filename, mimeType: artifact.mimeType, size: artifact.size }
          : null;
      }
      const entry = state.selection.find((candidate) => candidate.id === fileId);
      if (!entry) return null;
      return {
        blob: entry.file,
        filename: entry.name,
        mimeType: entry.type || MIME_BY_EXTENSION[entry.extension] || 'application/octet-stream',
        size: entry.size,
      };
    },

    dismissNotice(noticeId) {
      commit({ notices: state.notices.filter((item) => item.id !== noticeId) }, { type: 'notice' });
    },

    reset() {
      stopActiveJob();
      commit({ selection: [], notices: [], ...clearedResult(), status: STATUS.IDLE }, { type: 'reset' });
    },

    dispose() {
      if (disposed) return;
      stopActiveJob();
      disposed = true;
      listeners.clear();
      state = Object.freeze({ ...state, selection: [], result: null, health: null, progress: null });
    },
  };

  return studio;
}
