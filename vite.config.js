import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

/** Codecs compiled into the jSquash WebAssembly packages, with their own licences. */
const BUNDLED_CODECS = {
  '@jsquash/jpeg': 'MozJPEG (based on libjpeg-turbo)',
  '@jsquash/webp': 'libwebp',
  '@jsquash/oxipng': 'OxiPNG',
};

/**
 * Every installed production dependency, found the way Node resolves them
 * (a package's own node_modules first, then its ancestors'). All of them are
 * bundled into the site.
 */
function productionPackages() {
  const found = new Map();
  const resolve = (name, fromDir) => {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      if (path.basename(dir) !== 'node_modules' && existsSync(path.join(candidate, 'package.json'))) return candidate;
      if (dir === ROOT || path.dirname(dir) === dir) return null;
    }
  };
  const visit = (dependencies, fromDir) => {
    for (const name of Object.keys(dependencies ?? {})) {
      const dir = resolve(name, fromDir);
      if (!dir || found.has(dir)) continue;
      const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      found.set(dir, manifest);
      visit(manifest.dependencies, dir);
    }
  };
  visit(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies, ROOT);
  return [...found].map(([dir, manifest]) => ({ dir, manifest })).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/**
 * Writes third-party-licences.txt into the build: the licence of every
 * production dependency plus the licences of the codecs inside the jSquash
 * packages. These licences ask for their notices to travel with the code,
 * and every visitor downloads the code, so the notices ship with the site;
 * the footer links to the file.
 */
function thirdPartyLicences() {
  return {
    name: 'compressive:third-party-licences',
    apply: 'build',
    generateBundle() {
      const packages = productionPackages();
      const rule = '-'.repeat(72);
      const sections = [];
      for (const { dir, manifest } of packages) {
        const licenceFile = readdirSync(dir).find((file) => /^(licen[cs]e|copying)(\.[a-z]+)?$/i.test(file));
        const author = typeof manifest.author === 'string' ? manifest.author.replace(/\s*[<(].*$/, '') : manifest.author?.name;
        const text = licenceFile
          ? readFileSync(path.join(dir, licenceFile), 'utf8').trim()
          : `This package includes no licence file. It is published under ${manifest.license}${author ? ` by ${author}` : ''}.`;
        sections.push(`${rule}\n${manifest.name} ${manifest.version}: ${manifest.license}\n${rule}\n\n${text}`);
        const codecLicence = path.join(dir, 'codec', 'LICENSE.codec.md');
        if (BUNDLED_CODECS[manifest.name] && existsSync(codecLicence)) {
          sections.push(`${rule}\n${BUNDLED_CODECS[manifest.name]}, compiled into ${manifest.name}\n${rule}\n\n${readFileSync(codecLicence, 'utf8').trim()}`);
        }
      }
      const source = [
        'Compressive: third-party licences',
        '',
        'This website includes the open-source software listed below, each used under the licence reproduced in this file.',
        '',
        'This software is based in part on the work of the Independent JPEG Group.',
        '',
        ...packages.map(({ manifest }) => `- ${manifest.name} ${manifest.version}: ${manifest.license}`),
        '',
        ...sections,
        '',
      ].join('\n');
      // The byte-order mark makes browsers read the file as UTF-8 (some names
      // in it are accented) even when the server sends no charset.
      this.emitFile({ type: 'asset', fileName: 'third-party-licences.txt', source: `\uFEFF${source}` });
    },
  };
}

/**
 * Reads the Cloudflare Pages `_headers` file so `npm run preview` serves the
 * same security headers (including the Content-Security-Policy that blocks
 * network requests to other origins) as the deployed site. Only the global
 * `/*` block is applied; that is the only block this project defines.
 */
function readPagesHeaders() {
  const file = path.join(ROOT, 'public', '_headers');
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

/** CSP directives that only work as a header: browsers ignore them in a <meta> tag and log an error. */
const HEADER_ONLY_CSP_DIRECTIVES = new Set(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

/**
 * Writes the Content-Security-Policy from `_headers` into the built
 * index.html as a <meta> tag, so the page keeps it (including
 * `connect-src 'self'`, which backs the "your files stay on your device"
 * promise) even on a host that ignores `_headers`. The header stays the main
 * policy; the tag leaves out what only a header can do.
 */
function contentSecurityPolicyMeta() {
  return {
    name: 'compressive:csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const policy = readPagesHeaders()['Content-Security-Policy'];
        if (!policy) throw new Error('public/_headers defines no Content-Security-Policy.');
        const directives = policy
          .split(';')
          .map((directive) => directive.trim())
          .filter((directive) => directive && !HEADER_ONLY_CSP_DIRECTIVES.has(directive.split(/\s+/)[0].toLowerCase()));
        const content = directives.join('; ').replaceAll('&', '&amp;').replaceAll('"', '&quot;');
        // Right after the charset, so the policy is in force before any script or stylesheet loads.
        const charset = /<meta charset=[^>]*>/i;
        if (!charset.test(html)) throw new Error('index.html has no <meta charset> to place the CSP after.');
        return html.replace(charset, (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${content}" />`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), thirdPartyLicences(), contentSecurityPolicyMeta()],
  optimizeDeps: {
    // The jSquash encoders find their .wasm files next to their own modules;
    // pre-bundling them for the dev server would move the code away from them.
    exclude: ['@jsquash/jpeg', '@jsquash/webp', '@jsquash/oxipng'],
  },
  worker: {
    // ES module workers keep each worker's dependencies in its own chunk, so
    // JSZip, pdf-lib and the image encoders load only when needed.
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
