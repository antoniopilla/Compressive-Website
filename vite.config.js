import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Reads the Cloudflare Pages `_headers` file so `npm run preview` serves the
 * same security headers (including the Content-Security-Policy that blocks
 * network requests to other origins) as the deployed site. Only the global
 * `/*` block is applied; that is the only block this project defines.
 */
function readPagesHeaders() {
  const file = fileURLToPath(new URL('./public/_headers', import.meta.url));
  const headers = {};
  let inGlobalBlock = false;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    if (!/^\s/.test(rawLine)) {
      inGlobalBlock = rawLine.trim() === '/*';
      continue;
    }
    if (!inGlobalBlock) continue;
    const separator = rawLine.indexOf(':');
    if (separator > 0) {
      headers[rawLine.slice(0, separator).trim()] = rawLine.slice(separator + 1).trim();
    }
  }
  return headers;
}

export default defineConfig({
  plugins: [react()],
  worker: {
    // ES module workers keep each worker's dependencies in its own chunk, so
    // JSZip, pdf-lib and browser-image-compression load only when needed.
    format: 'es',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
  preview: {
    headers: readPagesHeaders(),
  },
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
    environment: 'node',
    setupFiles: ['tests/setup/vitest.setup.js'],
    testTimeout: 30_000,
  },
});
