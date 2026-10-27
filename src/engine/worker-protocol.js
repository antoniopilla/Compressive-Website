/**
 * Message protocol between the main thread and processing workers.
 *
 * Main → worker
 *   { type: 'start',  protocol, jobId, payload }   Begin a task. Files/Blobs are
 *                                                  structured-cloned (no byte copy).
 *   { type: 'cancel', protocol, jobId }            Ask the task to stop at its next
 *                                                  checkpoint. AbortSignal is not
 *                                                  transferable, so cancellation is
 *                                                  relayed as this explicit message.
 *
 * Worker → main
 *   { type: 'ready',    protocol }                 Worker script loaded.
 *   { type: 'progress', protocol, jobId, phase, fraction, detail }
 *   { type: 'result',   protocol, jobId, result }  ArrayBuffers in `result` are
 *                                                  transferred, not copied.
 *   { type: 'error',    protocol, jobId, error }   error = serializeError(...)
 *   { type: 'canceled', protocol, jobId }
 *
 * The main thread ignores any message whose jobId is not the job it is waiting
 * for (stale-result rejection), terminates the worker when a timeout expires,
 * and terminates it shortly after relaying a cancel even if the task never
 * reaches a checkpoint. Functions are never sent across the boundary.
 */

export const PROTOCOL_VERSION = 1;

export const MESSAGE = Object.freeze({
  START: 'start',
  CANCEL: 'cancel',
  READY: 'ready',
  PROGRESS: 'progress',
  RESULT: 'result',
  ERROR: 'error',
  CANCELED: 'canceled',
});

/**
 * @typedef {object} ProgressUpdate
 * @property {string} phase      Machine-readable phase, e.g. "packaging", "encoding".
 * @property {number} fraction   0–1 overall progress for the task.
 * @property {string | null} [detail]
 */

/**
 * Context passed to every task function, in a worker or on the main thread.
 *
 * @typedef {object} TaskContext
 * @property {(update: ProgressUpdate) => void} onProgress
 * @property {() => boolean} isCanceled
 * @property {() => void} throwIfCanceled  Throws CanceledError when cancellation was requested.
 */

/**
 * A task function receives a structured-clone-safe payload and returns a
 * structured-clone-safe result. It may include `transfer: ArrayBuffer[]` in the
 * result to have those buffers transferred instead of copied.
 *
 * @typedef {(payload: any, context: TaskContext) => Promise<any>} TaskFunction
 */
