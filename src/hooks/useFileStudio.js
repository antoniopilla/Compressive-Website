/**
 * Thin React adapter for the vanilla FileStudio engine.
 *
 * Lifecycle: the engine is created when the component mounts (in an effect)
 * or, if the visitor acts before that effect has run, at their first action,
 * so a file chosen in the first instant after the page renders is never lost.
 * It is disposed when the component unmounts; after that, actions are no-ops
 * and nothing is re-created. React's development double-mount (StrictMode)
 * therefore disposes one engine and attaches a fresh one. Creating the holder
 * in a state initializer is side-effect free, and the engine itself starts no
 * workers until `prepare()` runs.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createFileStudio } from '../engine/index.js';

/**
 * @param {Parameters<typeof createFileStudio>[0]} createOptions
 */
export function createStudioHolder(createOptions = {}) {
  /** @type {import('../engine/studio.js').FileStudio | null} */
  let studio = null;
  let unsubscribe = null;
  /** True between unmount and the next mount: actions must not create an engine then. */
  let detached = false;
  let lastPrintSize = createOptions.initialPrintSize;
  const placeholder = createFileStudio({ ...createOptions, taskRunner: { capabilities: { workers: true }, run: null } }).getSnapshot();
  let snapshot = placeholder;
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  function ensureStudio() {
    if (studio || detached) return studio;
    studio = createFileStudio({ ...createOptions, initialPrintSize: lastPrintSize });
    snapshot = studio.getSnapshot();
    unsubscribe = studio.subscribe((next) => {
      snapshot = next;
      lastPrintSize = next.printSize;
      notify();
    });
    notify();
    return studio;
  }

  return {
    attach() {
      detached = false;
      ensureStudio();
    },
    detach() {
      detached = true;
      if (!studio) return;
      unsubscribe?.();
      studio.dispose();
      studio = null;
      unsubscribe = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    /** The live engine, created on demand while mounted; null after unmount. */
    getStudio: ensureStudio,
  };
}

/**
 * @param {Parameters<typeof createFileStudio>[0]} [createOptions] Read once, on first render.
 */
export function useFileStudio(createOptions) {
  const [holder] = useState(() => createStudioHolder(createOptions));

  useEffect(() => {
    holder.attach();
    return () => holder.detach();
  }, [holder]);

  const snapshot = useSyncExternalStore(holder.subscribe, holder.getSnapshot, holder.getSnapshot);

  const actions = useMemo(() => {
    const call = (method, fallback) => (...args) => {
      const studio = holder.getStudio();
      return studio ? studio[method](...args) : fallback;
    };
    return {
      addFiles: call('addFiles', Promise.resolve()),
      replaceFile: call('replaceFile', Promise.resolve()),
      removeFile: call('removeFile'),
      clearSelection: call('clearSelection'),
      setPrintSize: call('setPrintSize'),
      prepare: call('prepare', Promise.resolve(null)),
      cancel: call('cancel'),
      retry: call('retry', Promise.resolve(null)),
      acknowledgeWarnings: call('acknowledgeWarnings'),
      getDownload: call('getDownload', null),
      dismissNotice: call('dismissNotice'),
      reset: call('reset'),
    };
  }, [holder]);

  return { snapshot, actions };
}
