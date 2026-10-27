/**
 * Browser downloads through short-lived object URLs.
 *
 * An object URL is created only when the visitor clicks a download button, and
 * revoked one minute later — long enough for every browser to have started
 * reading the Blob, so revoking never interrupts a download. Any URLs still
 * pending are revoked when the component unmounts.
 */

import { useEffect, useState } from 'react';

/**
 * @param {{ revokeDelayMs?: number, doc?: Document, urlApi?: Pick<typeof URL, 'createObjectURL'|'revokeObjectURL'> }} [options]
 */
export function createDownloadManager(options = {}) {
  const revokeDelayMs = options.revokeDelayMs ?? 60_000;
  const urlApi = options.urlApi ?? URL;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const pending = new Map();

  return {
    /**
     * @param {Blob} blob
     * @param {string} filename
     */
    download(blob, filename) {
      const doc = options.doc ?? document;
      const url = urlApi.createObjectURL(blob);
      const anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      pending.set(
        url,
        setTimeout(() => {
          urlApi.revokeObjectURL(url);
          pending.delete(url);
        }, revokeDelayMs),
      );
      return url;
    },
    revokeAll() {
      for (const [url, timer] of pending) {
        clearTimeout(timer);
        urlApi.revokeObjectURL(url);
      }
      pending.clear();
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

/**
 * @param {Parameters<typeof createDownloadManager>[0]} [options]
 */
export function useDownloads(options) {
  const [manager] = useState(() => createDownloadManager(options));
  useEffect(() => () => manager.revokeAll(), [manager]);
  return manager;
}
