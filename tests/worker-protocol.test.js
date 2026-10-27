import { describe, expect, it, vi } from 'vitest';
import { runInWorker } from '../src/engine/worker-client.js';
import { serveTask } from '../src/engine/worker-host.js';
import { MESSAGE, PROTOCOL_VERSION } from '../src/engine/worker-protocol.js';
import { StudioError } from '../src/engine/errors.js';
import { createTaskRunner } from '../src/engine/task-runner.js';

/**
 * In-memory Worker that runs `serveTask` against a fake worker scope and
 * delivers messages asynchronously with structured cloning, like a real worker.
 */
class FakeWorker extends EventTarget {
  constructor(taskFunction, { failToStart = false, crashOnStart = false, silent = false } = {}) {
    super();
    this.terminated = false;
    this.posted = [];
    this.scope = new EventTarget();
    this.scope.postMessage = (message, transfer = []) => {
      queueMicrotask(() => {
        if (this.terminated) return;
        this.dispatchEvent(new MessageEvent('message', { data: structuredClone(message, { transfer }) }));
      });
    };
    queueMicrotask(() => {
      if (failToStart) {
        this.dispatchEvent(Object.assign(new Event('error', { cancelable: true }), { message: 'Failed to load module' }));
        return;
      }
      if (!silent) serveTask(taskFunction, this.scope);
      if (crashOnStart) {
        setTimeout(() => this.dispatchEvent(Object.assign(new Event('error', { cancelable: true }), { message: 'boom' })), 5);
      }
    });
  }

  postMessage(message, transfer = []) {
    this.posted.push(message);
    const data = structuredClone(message, { transfer });
    setTimeout(() => {
      if (!this.terminated) this.scope.dispatchEvent(new MessageEvent('message', { data }));
    }, 0);
  }

  terminate() {
    this.terminated = true;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('worker protocol', () => {
  it('delivers progress and results, transferring ArrayBuffers', async () => {
    const task = async (payload, context) => {
      context.onProgress({ phase: 'encoding', fraction: 0.5 });
      const bytes = new Uint8Array([payload.value, 2, 3]);
      return { bytes, transfer: [bytes.buffer] };
    };
    let worker;
    const progress = [];
    const result = await runInWorker({
      createWorker: () => (worker = new FakeWorker(task)),
      payload: { value: 7 },
      timeoutMs: 1000,
      onProgress: (update) => progress.push(update),
    });
    expect(Array.from(result.bytes)).toEqual([7, 2, 3]);
    expect(result.transfer).toBeUndefined();
    expect(progress).toEqual([{ phase: 'encoding', fraction: 0.5, detail: null }]);
    expect(worker.terminated).toBe(true);
  });

  it('serializes task errors with their codes', async () => {
    const task = async () => {
      throw new StudioError('decode-failed', 'Could not decode.');
    };
    await expect(runInWorker({ createWorker: () => new FakeWorker(task), payload: {}, timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'decode-failed',
      message: 'Could not decode.',
    });
  });

  it('ignores messages from other jobs (stale results)', async () => {
    let worker;
    const promise = runInWorker({
      createWorker: () => (worker = new FakeWorker(null, { silent: true })),
      payload: {},
      timeoutMs: 200,
    });
    await wait(5);
    const jobId = worker.posted[0].jobId;
    worker.dispatchEvent(new MessageEvent('message', { data: { protocol: PROTOCOL_VERSION, type: MESSAGE.RESULT, jobId: 'old-job', result: { stale: true } } }));
    worker.dispatchEvent(new MessageEvent('message', { data: { protocol: PROTOCOL_VERSION, type: MESSAGE.RESULT, jobId, result: { fresh: true } } }));
    await expect(promise).resolves.toEqual({ fresh: true });
  });

  it('times out and terminates a task that never finishes', async () => {
    let worker;
    const never = () => new Promise(() => {});
    await expect(
      runInWorker({ createWorker: () => (worker = new FakeWorker(never)), payload: {}, timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(worker.terminated).toBe(true);
  });

  it('relays cancellation as a message, rejects at once and terminates after a grace period', async () => {
    let worker;
    const controller = new AbortController();
    const slow = (_payload, context) =>
      new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          try {
            context.throwIfCanceled();
          } catch (error) {
            clearInterval(timer);
            reject(error);
          }
        }, 2);
      });
    const promise = runInWorker({
      createWorker: () => (worker = new FakeWorker(slow)),
      payload: {},
      timeoutMs: 5000,
      signal: controller.signal,
    });
    await wait(10);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'canceled' });
    expect(worker.posted.some((message) => message.type === MESSAGE.CANCEL)).toBe(true);
    await wait(250);
    expect(worker.terminated).toBe(true);
  });

  it('distinguishes a worker that fails to start from one that crashes', async () => {
    await expect(
      runInWorker({ createWorker: () => new FakeWorker(null, { failToStart: true }), payload: {}, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'worker-failed-to-start' });
    const forever = () => new Promise(() => {});
    await expect(
      runInWorker({ createWorker: () => new FakeWorker(forever, { crashOnStart: true }), payload: {}, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: 'worker-crashed' });
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const createWorker = vi.fn();
    await expect(runInWorker({ createWorker, payload: {}, timeoutMs: 100, signal: controller.signal })).rejects.toMatchObject({
      code: 'canceled',
    });
    expect(createWorker).not.toHaveBeenCalled();
  });
});

describe('task runner fallbacks', () => {
  const unsupportedWorker = () => new FakeWorker(async () => {
    throw new StudioError('worker-canvas-unsupported', 'No canvas in workers.');
  });
  const taskLoaders = {
    zip: async () => async () => ({ where: 'main' }),
    image: async () => async (_payload, context) => {
      context.onProgress({ phase: 'encoding', fraction: 1 });
      return { where: 'main' };
    },
    pdf: async () => async () => ({ where: 'main' }),
  };

  it('falls back to the main thread within the main-thread budget', async () => {
    const runner = createTaskRunner({ workersSupported: true, workerFactories: { zip: unsupportedWorker, image: unsupportedWorker, pdf: unsupportedWorker }, taskLoaders });
    await expect(runner.run('image', {}, { timeoutMs: 1000, mainThreadAllowed: true })).resolves.toEqual({ where: 'main', ranOnMainThread: true });
  });

  it('explains the limitation when the payload is too large for the main thread', async () => {
    const runner = createTaskRunner({ workersSupported: true, workerFactories: { zip: unsupportedWorker, image: unsupportedWorker, pdf: unsupportedWorker }, taskLoaders });
    await expect(runner.run('image', {}, { timeoutMs: 1000, mainThreadAllowed: false })).rejects.toMatchObject({ code: 'background-unsupported' });
  });

  it('does not fall back for genuine task failures', async () => {
    const failing = () => new FakeWorker(async () => {
      throw new StudioError('decode-failed', 'Broken image.');
    });
    const runner = createTaskRunner({ workersSupported: true, workerFactories: { zip: failing, image: failing, pdf: failing }, taskLoaders });
    await expect(runner.run('image', {}, { timeoutMs: 1000, mainThreadAllowed: true })).rejects.toMatchObject({ code: 'decode-failed' });
  });

  it('handles browsers without Worker support explicitly', async () => {
    const runner = createTaskRunner({ workersSupported: false, taskLoaders });
    expect(runner.capabilities.workers).toBe(false);
    await expect(runner.run('zip', {}, { timeoutMs: 1000, mainThreadAllowed: true })).resolves.toMatchObject({ where: 'main' });
    await expect(runner.run('zip', {}, { timeoutMs: 1000, mainThreadAllowed: false })).rejects.toMatchObject({ code: 'workers-unavailable' });
  });
});
