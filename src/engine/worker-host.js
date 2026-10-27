/**
 * Worker-side half of the protocol (see worker-protocol.js). Each worker entry
 * file calls `serveTask` with one task function.
 */

import { CanceledError, isCanceledError, serializeError } from './errors.js';
import { MESSAGE, PROTOCOL_VERSION } from './worker-protocol.js';

/** Minimum interval between progress messages; keeps the main thread responsive. */
const PROGRESS_INTERVAL_MS = 80;

/**
 * @param {import('./worker-protocol.js').TaskFunction} taskFunction
 * @param {{ postMessage: (message: any, transfer?: Transferable[]) => void, addEventListener: Function }} [scope]
 */
export function serveTask(taskFunction, scope = /** @type {any} */ (globalThis)) {
  /** @type {{ jobId: string, canceled: boolean } | null} */
  let active = null;

  const post = (message, transfer = []) => scope.postMessage({ protocol: PROTOCOL_VERSION, ...message }, transfer);

  scope.addEventListener('message', async (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object' || message.protocol !== PROTOCOL_VERSION) return;

    if (message.type === MESSAGE.CANCEL) {
      if (active && active.jobId === message.jobId) active.canceled = true;
      return;
    }
    if (message.type !== MESSAGE.START) return;
    if (active) {
      post({
        type: MESSAGE.ERROR,
        jobId: message.jobId,
        error: { name: 'StudioError', code: 'worker-busy', message: 'This worker is already running a task.', details: null },
      });
      return;
    }

    const job = { jobId: message.jobId, canceled: false };
    active = job;
    let lastProgressAt = 0;
    let lastFraction = -1;

    /** @type {import('./worker-protocol.js').TaskContext} */
    const context = {
      onProgress(update) {
        const now = Date.now();
        const fraction = Math.max(0, Math.min(1, update.fraction ?? 0));
        if (now - lastProgressAt < PROGRESS_INTERVAL_MS && fraction - lastFraction < 0.05 && fraction < 1) return;
        lastProgressAt = now;
        lastFraction = fraction;
        post({ type: MESSAGE.PROGRESS, jobId: job.jobId, phase: update.phase, fraction, detail: update.detail ?? null });
      },
      isCanceled: () => job.canceled,
      throwIfCanceled() {
        if (job.canceled) throw new CanceledError();
      },
    };

    try {
      const output = await taskFunction(message.payload, context);
      if (job.canceled) {
        post({ type: MESSAGE.CANCELED, jobId: job.jobId });
      } else {
        const { transfer = [], ...result } = output ?? {};
        post({ type: MESSAGE.RESULT, jobId: job.jobId, result }, transfer);
      }
    } catch (error) {
      if (job.canceled || isCanceledError(error)) post({ type: MESSAGE.CANCELED, jobId: job.jobId });
      else post({ type: MESSAGE.ERROR, jobId: job.jobId, error: serializeError(error) });
    } finally {
      active = null;
    }
  });

  post({ type: MESSAGE.READY });
}
