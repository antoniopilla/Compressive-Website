/**
 * Chooses where a task runs.
 *
 * ZIP generation, PDF rewriting and image encoding normally run in a dedicated
 * Web Worker on the visitor's device (a Promise alone would still block the
 * page). When a browser cannot start workers, or cannot decode images inside
 * one (no OffscreenCanvas there, as in Safari before 16.4), the task may run
 * on the main thread instead — but
 * only within the smaller `LIMITS.mainThread` budgets the caller passes as
 * `mainThreadAllowed`. Larger work fails with a clear explanation rather than
 * freezing the tab.
 */

import { CanceledError, StudioError } from './errors.js';
import { runInWorker } from './worker-client.js';

/** Worker entry points. Vite bundles each one (and its dependencies) separately. */
const DEFAULT_WORKER_FACTORIES = Object.freeze({
  zip: () => new Worker(new URL('../workers/zip.worker.js', import.meta.url), { type: 'module', name: 'compressive-zip' }),
  image: () =>
    new Worker(new URL('../workers/image.worker.js', import.meta.url), { type: 'module', name: 'compressive-image' }),
  pdf: () => new Worker(new URL('../workers/pdf.worker.js', import.meta.url), { type: 'module', name: 'compressive-pdf' }),
});

/** Task implementations for the main-thread fallback, loaded only when needed. */
const DEFAULT_TASK_LOADERS = Object.freeze({
  zip: () => import('./tasks/zip-task.js').then((module) => module.buildZipArchive),
  image: () => import('./tasks/image-task.js').then((module) => module.compressImage),
  pdf: () => import('./tasks/pdf-task.js').then((module) => module.rewritePdf),
});

/** Worker failures that a main-thread run can work around. */
const FALLBACK_CODES = new Set(['worker-failed-to-start', 'worker-canvas-unsupported']);

/**
 * @typedef {object} RunOptions
 * @property {AbortSignal} [signal]
 * @property {(update: import('./worker-protocol.js').ProgressUpdate) => void} [onProgress]
 * @property {number} timeoutMs
 * @property {Transferable[]} [transfer]
 * @property {boolean} mainThreadAllowed  Whether this payload is within the main-thread budget.
 */

/**
 * @typedef {object} TaskRunner
 * @property {(task: 'zip'|'image'|'pdf', payload: any, options: RunOptions) => Promise<any>} run
 * @property {{ workers: boolean }} capabilities
 */

/**
 * @param {{ workerFactories?: Record<string, () => Worker>, taskLoaders?: Record<string, () => Promise<Function>>, workersSupported?: boolean }} [options]
 * @returns {TaskRunner}
 */
export function createTaskRunner(options = {}) {
  const workerFactories = options.workerFactories ?? DEFAULT_WORKER_FACTORIES;
  const taskLoaders = options.taskLoaders ?? DEFAULT_TASK_LOADERS;
  const workersSupported = options.workersSupported ?? typeof Worker === 'function';

  /**
   * @param {string} task
   * @param {any} payload
   * @param {RunOptions} runOptions
   */
  async function runOnMainThread(task, payload, runOptions) {
    const taskFunction = await taskLoaders[task]();
    const signal = runOptions.signal;
    /** @type {import('./worker-protocol.js').TaskContext} */
    const context = {
      onProgress: (update) => runOptions.onProgress?.(update),
      isCanceled: () => Boolean(signal?.aborted),
      throwIfCanceled() {
        if (signal?.aborted) throw new CanceledError();
      },
    };
    // Main-thread work cannot be preempted; the timeout only stops waiting.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new StudioError('timeout', 'Preparation took too long and was stopped.')),
        runOptions.timeoutMs,
      );
    });
    try {
      const { transfer: _transfer, ...result } = (await Promise.race([taskFunction(payload, context), timeout])) ?? {};
      context.throwIfCanceled();
      return { ...result, ranOnMainThread: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    capabilities: { workers: workersSupported },
    async run(task, payload, runOptions) {
      if (!workerFactories[task] || !taskLoaders[task]) throw new StudioError('unknown-task', `Unknown task "${task}".`);
      if (!workersSupported) {
        if (!runOptions.mainThreadAllowed) {
          throw new StudioError(
            'workers-unavailable',
            'This browser cannot run background processing, which is needed for a file this large. Try a recent version of Chrome, Edge, Firefox or Safari.',
          );
        }
        return runOnMainThread(task, payload, runOptions);
      }
      try {
        return await runInWorker({
          createWorker: workerFactories[task],
          payload,
          transfer: runOptions.transfer,
          timeoutMs: runOptions.timeoutMs,
          signal: runOptions.signal,
          onProgress: runOptions.onProgress,
        });
      } catch (error) {
        if (!FALLBACK_CODES.has(error?.code)) throw error;
        if (!runOptions.mainThreadAllowed) {
          throw new StudioError(
            'background-unsupported',
            'This browser cannot process a file this large in the background. Try a recent desktop version of Chrome, Edge or Firefox.',
            { cause: error },
          );
        }
        return runOnMainThread(task, payload, runOptions);
      }
    },
  };
}
