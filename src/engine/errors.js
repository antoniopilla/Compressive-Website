/**
 * Structured errors shared by the main thread and the workers.
 *
 * Errors cross the worker boundary as plain objects (functions and class
 * identity do not survive structured cloning), so every error the engine
 * raises carries a stable `code` that the UI maps to customer-facing text.
 */

export class StudioError extends Error {
  /**
   * @param {string} code Stable machine-readable code, e.g. "timeout".
   * @param {string} message Human-readable explanation (customer-safe).
   * @param {{ cause?: unknown, details?: Record<string, unknown> }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StudioError';
    this.code = code;
    this.details = options.details ?? null;
  }
}

export class CanceledError extends StudioError {
  constructor(message = 'Preparation was canceled.') {
    super('canceled', message);
    this.name = 'CanceledError';
  }
}

/** @param {unknown} error */
export function isCanceledError(error) {
  return Boolean(error) && typeof error === 'object' && /** @type {any} */ (error).code === 'canceled';
}

/**
 * Detects allocation failures from canvases, typed arrays and decoders. Browsers
 * report these inconsistently (RangeError, generic Error with "memory" text,
 * or a null 2D context), so the check is intentionally broad.
 *
 * @param {unknown} error
 */
export function looksLikeOutOfMemory(error) {
  if (error instanceof RangeError) return true;
  const message = String(/** @type {any} */ (error)?.message ?? '').toLowerCase();
  return /out of memory|allocation|array buffer|too large|exceeds the maximum/.test(message);
}

/**
 * Converts any thrown value into a structured-clone-safe object.
 *
 * @param {unknown} error
 * @returns {{ name: string, code: string, message: string, details: Record<string, unknown> | null }}
 */
export function serializeError(error) {
  if (error instanceof StudioError) {
    return { name: error.name, code: error.code, message: error.message, details: error.details };
  }
  if (looksLikeOutOfMemory(error)) {
    return {
      name: 'StudioError',
      code: 'out-of-memory',
      message: 'This device ran out of memory while preparing the file.',
      details: null,
    };
  }
  const anyError = /** @type {any} */ (error);
  return {
    name: typeof anyError?.name === 'string' ? anyError.name : 'Error',
    code: 'unexpected',
    message: typeof anyError?.message === 'string' && anyError.message ? anyError.message : String(error),
    details: null,
  };
}

/**
 * Rebuilds an error object received from a worker.
 *
 * @param {{ code?: string, message?: string, details?: Record<string, unknown> | null } | undefined} data
 */
export function deserializeError(data) {
  if (data?.code === 'canceled') return new CanceledError(data.message);
  return new StudioError(data?.code ?? 'unexpected', data?.message ?? 'Unknown error', {
    details: data?.details ?? undefined,
  });
}
