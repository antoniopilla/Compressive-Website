/**
 * Main-thread half of the worker protocol (see worker-protocol.js).
 *
 * One worker is created per task and terminated when the task settles. That
 * releases all memory the task used (decoded images, PDF object graphs, ZIP
 * buffers) as soon as the result has been received, and makes cancellation and
 * timeouts absolute: `terminate()` stops CPU work that never yields.
 */

import { CanceledError, deserializeError, StudioError } from './errors.js';
import { MESSAGE, PROTOCOL_VERSION } from './worker-protocol.js';

/** How long a canceled task may take to acknowledge before it is terminated. */
const CANCEL_GRACE_MS = 200;

let jobCounter = 0;

/**
 * @typedef {object} WorkerRunOptions
 * @property {() => Worker} createWorker
 * @property {any} payload
 * @property {Transferable[]} [transfer]
 * @property {number} timeoutMs
 * @property {AbortSignal} [signal]
 * @property {(update: import('./worker-protocol.js').ProgressUpdate) => void} [onProgress]
 */

/**
 * Runs one task in a fresh worker.
 *
 * Rejects with:
 *  - CanceledError when `signal` aborts (immediately; the worker is told to
 *    stop and is terminated after a short grace period),
 *  - StudioError("timeout") when `timeoutMs` elapses (worker terminated),
 *  - StudioError("worker-failed-to-start") when the worker script cannot load,
 *  - StudioError("worker-crashed") for uncaught worker errors after start,
 *  - the task's own serialized error otherwise.
 *
 * @param {WorkerRunOptions} options
 * @returns {Promise<any>}
 */
export function runInWorker({ createWorker, payload, transfer = [], timeoutMs, signal, onProgress }) {
  if (signal?.aborted) return Promise.reject(new CanceledError());
  jobCounter += 1;
  const jobId = `task-${Date.now().toString(36)}-${jobCounter}`;

  return new Promise((resolve, reject) => {
    /** @type {Worker} */
    let worker;
    try {
      worker = createWorker();
    } catch (error) {
      reject(new StudioError('worker-failed-to-start', 'Background processing could not start in this browser.', { cause: error }));
      return;
    }

    let settled = false;
    let started = false;

    const terminate = () => {
      try {
        worker.terminate();
      } catch {
        // Already terminated.
      }
    };
    const cleanup = () => {
      clearTimeout(timeoutTimer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback, value, { terminateNow = true } = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminateNow) terminate();
      callback(value);
    };

    const onMessage = (event) => {
      const message = event.data;
      if (!message || message.protocol !== PROTOCOL_VERSION) return;
      if (message.type === MESSAGE.READY) {
        started = true;
        return;
      }
      if (message.jobId !== jobId) return; // stale or foreign message
      started = true;
      switch (message.type) {
        case MESSAGE.PROGRESS:
          onProgress?.({ phase: message.phase, fraction: message.fraction, detail: message.detail ?? null });
          break;
        case MESSAGE.RESULT:
          settle(resolve, message.result);
          break;
        case MESSAGE.ERROR:
          settle(reject, deserializeError(message.error));
          break;
        case MESSAGE.CANCELED:
          settle(reject, new CanceledError());
          break;
        default:
          break;
      }
    };

    const onError = (event) => {
      event.preventDefault?.();
      settle(
        reject,
        started
          ? new StudioError('worker-crashed', 'The background process stopped unexpectedly.', {
              details: { message: event.message ?? null },
            })
          : new StudioError('worker-failed-to-start', 'Background processing could not start in this browser.', {
              details: { message: event.message ?? null },
            }),
      );
    };

    const onMessageError = () => {
      settle(reject, new StudioError('worker-message-error', 'The background process returned data that could not be read.'));
    };

    const onAbort = () => {
      try {
        worker.postMessage({ protocol: PROTOCOL_VERSION, type: MESSAGE.CANCEL, jobId });
      } catch {
        // Worker already gone.
      }
      // Reject right away so the interface responds instantly; give the task a
      // moment to stop cooperatively, then terminate it regardless.
      settle(reject, new CanceledError(), { terminateNow: false });
      setTimeout(terminate, CANCEL_GRACE_MS);
    };

    const timeoutTimer = setTimeout(() => {
      settle(
        reject,
        new StudioError('timeout', 'Preparation took too long and was stopped.', { details: { timeoutMs } }),
      );
    }, timeoutMs);

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      worker.postMessage({ protocol: PROTOCOL_VERSION, type: MESSAGE.START, jobId, payload }, transfer);
    } catch (error) {
      settle(reject, new StudioError('worker-message-error', 'The file could not be handed to the background process.', { cause: error }));
    }
  });
}
