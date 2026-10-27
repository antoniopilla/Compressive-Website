/**
 * Shared Vitest setup. Node 22 provides File, Blob, DecompressionStream and
 * structuredClone natively, so engine tests run against the same web APIs the
 * browser uses. Component tests opt into jsdom per file.
 */
import { afterEach } from 'vitest';

afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
