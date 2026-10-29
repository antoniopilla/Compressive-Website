<div align="center">

<img src="public/favicon.svg" alt="Compressive" width="96" />

# Compressive — Private In-Browser File Compressor

**A free file compressor that runs entirely in the visitor's browser — smart JPG and WebP compression checked against the original, lossless PNG optimisation, verified PDF tidy-ups and ZIPs, byte-for-byte protection for vector and Photoshop files, and a print-sharpness check, without a single upload.**

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-MozJPEG_%7C_libwebp_%7C_OxiPNG-654FF0?logo=webassembly&logoColor=white)](https://webassembly.org/)
[![Privacy](https://img.shields.io/badge/Privacy-Nothing_uploaded-0F766E)](#privacy--security)
[![Tests](https://img.shields.io/badge/Tests-Vitest_%2B_Playwright-6E9F18?logo=vitest&logoColor=white)](#available-scripts)
[![Cloudflare Pages](https://img.shields.io/badge/Hosting-Cloudflare_Pages-F38020?logo=cloudflarepages&logoColor=white)](https://compressive.pages.dev)

</div>

---

## Overview

**Compressive** shrinks PNG, JPG and WebP images, tidies PDFs and zips batches of files, all on the visitor's own device. Visitors pick a tool (Compress PNG, Compress JPG, Compress WebP, Shrink a PDF, Zip files, Check print sharpness) or drop files in, see exactly what will happen before anything runs, and download the result: **pick a tool or drop files → compress → review → download**.

It compresses only where that is safe. Every lossy copy must pass a visual check against the original, every PDF rewrite and ZIP is verified before it can be downloaded, vector and Photoshop files are never altered, and whenever compressing would not help or could change how a file looks, the original comes back with the reason.

There is no backend, database, account, upload, analytics or API key. Files are processed in Web Workers on the device, and the site's Content-Security-Policy stops the page from sending data to any other origin. The live site is **[compressive.pages.dev](https://compressive.pages.dev)**, hosted on Cloudflare Pages.

## Key Features

### Smart image compression

- **Visual check on every lossy copy** — MozJPEG and libwebp encode at quality 75 first and step up through 85, 90 and 95 only when needed. The browser decodes each copy and compares it with the original using SSIM on 8 × 8 windows every 4 px: brightness, colour, and the least similar 64 × 64 area, so blocking, smoothed grain or colour fringes anywhere fail it. The first copy that looks the same is used; if none does, the original is kept.
- **Lossless PNG** — the original bytes go straight to OxiPNG, so every pixel, the transparency, the colour profile and the print size (DPI) are kept. Text, EXIF, timestamp and editor metadata chunks are removed afterwards.
- **Colour and orientation safety** — CMYK, non-sRGB colour profiles, 12-bit JPEG, 16-bit PNG and animated images are kept unchanged, because a browser re-encode would change them. Camera (EXIF) orientation is applied to the pixels exactly once.
- **Honest outcomes** — prepared copies stay within 8000 × 8000 px and 40 MB and are never enlarged, a copy that saves too little is discarded, and the original stays downloadable next to every compressed result.

### Files that are never harmed

- **Protected vectors** — AI, EPS and SVG files are returned byte for byte: never converted, flattened, outlined or re-saved. Routing uses only the extension, so a PDF-compatible `.ai` reported as `application/pdf` stays protected.
- **Photoshop pass-through** — PSDs are kept exactly, with their pixel size read from the header for the print check.
- **Verified PDF tidy-up** — pdf-lib merges saved revisions and prunes unreachable objects. Every reachable object is fingerprinted before and after, together with page boxes and rotation, and any difference keeps the original. Encrypted, signed, PDF/X, PDF/A, PDF 2.0 and XFA files are never rewritten.
- **Verified ZIP batches** — several files become one ZIP of the untouched originals. Every entry is extracted again and compared byte for byte before download, and entry names are sanitised and de-duplicated as `name (2).ext`.
- **Content sniffing** — file signatures are checked against extensions, so damaged or misnamed files are rejected with an actionable message instead of being "repaired".

### Print sharpness check

- **Effective PPI** — measured from orientation-corrected pixels and the intended print size in ft, in, cm, mm or m, using the lower of the two axes. Displayed values round down, so 149.6 PPI never reads as 150.
- **Warnings that need a decision** — below 100 PPI (warning) or 72 PPI (critical), the compressed download stays locked until the visitor confirms, changes the size or picks a higher-resolution file. Changing the size re-checks instantly, without reprocessing.
- **Shape and resize checks** — aspect-ratio mismatches are explained (with a swap suggestion), and a resize that drops a file into a lower resolution band is called out. Common sizes (A4, Letter, Poster, Banner) are one click away.

### Privacy & security

- **Nothing is uploaded** — files are read with `Blob` APIs and processed on the device; refreshing or closing the page clears everything. Only the theme and default unit are remembered.
- **Strict Content-Security-Policy** — `connect-src 'self'` and `script-src 'self' 'wasm-unsafe-eval'`, with no inline code and no outside scripts or fonts. The policy is served as a header and also written into the built page, so it holds on any host. HSTS, `no-referrer`, `nosniff`, COOP and a restrictive Permissions-Policy are served alongside it.
- **Checked by the tests** — the Playwright suite records every request during real processing and requires same-origin `GET`s only, with no request bodies and no CSP violations.

### Responsive processing

- **One worker per task** — image, PDF and ZIP work each run in a dedicated module Web Worker that is terminated when the task settles, so memory is released and cancellation and timeouts (ZIP 10 min, image and PDF 3 min) are absolute.
- **Budgets checked up front** — pixel and byte budgets are read from file headers before anything is decoded. Browsers that cannot run a task in a worker fall back to the page within smaller budgets.
- **Stale-result protection** — every job has an id; changing the selection cancels the running job, and a late result is ignored.

### Claymorphism interface

- **Clay design system** — soft, inflated forms lit from the upper left: a pink lead cushion with the six tools beside a static clay sculpture, cream trays, pastel cushions and thick pill buttons, all built from `--dp-*` design tokens in `src/styles/global.css`. Instrument Sans is bundled with the site.
- **Light, Dark and Auto themes** — applied before first paint; dark mode keeps the same roles in deep clay tones, and text meets WCAG AA (4.5:1) on every surface.
- **Accessible by default** — keyboard-only use, a 3px focus outline kept apart from the shading, a skip link, live-region announcements, 44px+ targets, a phone bottom bar, and reduced-motion support. Motion is limited to short hover and press responses.

## Screenshots

No screenshots are tracked in this repository. The live site at [compressive.pages.dev](https://compressive.pages.dev) shows the current interface. `npm run test:e2e` also writes full-page captures at 320, 390, 820 and 1366 px in light and dark modes to `test-results/screens/`, which Git ignores.

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React / React DOM 19.3.1, Vite 8.3.5, CSS Modules with a shared design-token stylesheet, Lucide React 1.61.0 |
| **Image encoders** | WebAssembly builds from Squoosh via jSquash (pinned): `@jsquash/jpeg` 1.6.0 (MozJPEG), `@jsquash/webp` 1.5.0 (libwebp), `@jsquash/oxipng` 2.3.0 (OxiPNG); `browser-image-compression` 2.0.2 for decoding, resizing and orientation only |
| **Documents & archives** | pdf-lib 1.17.1, JSZip 3.10.2 |
| **Processing** | Framework-independent engine (vanilla ES modules + JSDoc), module Web Workers with a versioned message protocol |
| **Fonts** | Instrument Sans through `@fontsource-variable/instrument-sans` 5.3.0, served from the site |
| **Tooling & Tests** | ESLint 10.13, Vitest 5.0.5 with jsdom and Testing Library, Playwright 1.64.1 (Chromium, Firefox and WebKit) |
| **Deployment** | Cloudflare Pages, with security headers from `public/_headers` |

Package versions above come from the committed lockfile.

<details>
<summary><strong>Library notes</strong></summary>

- **jSquash encoders.** Loaded on first use from the site's own files (`src/engine/tasks/codecs.js`); each `.wasm` is about 60–130 KB gzipped. MozJPEG uses Squoosh's defaults (progressive, optimised Huffman tables, 4:2:0 colour below quality 90 and full colour from 90). OxiPNG runs at level 2 from its single-threaded build; the threaded build needs cross-origin isolation, which the site does not enable. OxiPNG copies every chunk through, so `tasks/png-metadata.js` then keeps only the image, transparency, colour, background, print-size and animation chunks. If a browser cannot run WebAssembly at all, the original is kept with an explanation.
- **Visual check (`src/engine/visual-check.js`).** A copy passes only if brightness, colour and the least similar area all reach `IMAGE_POLICY.lookalike` (0.97, 0.97 and 0.93). The thresholds were calibrated on photos and interface graphics: below them, enlarged crops showed smoothed grain, blocking, or colour fringes on coloured text; above them, none were found. Lossless WebP sources get a final lossless try. Two shortcuts in `nextQuality` (`image-policy.js`) keep large, detailed photos from trying every quality: a copy that misses a score by more than `IMAGE_POLICY.skipMargins` skips the next quality, and once even the minimum growth per step (1.1× MozJPEG, 1.05× WebP) would reach the original's size, the search stops. Both can only cost a little saving, never quality. A reference that comes back entirely blank is never encoded, and every copy must be exactly the size the resize rule gives.
- **browser-image-compression 2.0.2 (pinned)** is used only to decode, resize and orient: `drawFileInCanvas`, `handleMaxWidthOrHeight`, `followExifOrientation`, `isAutoOrientationInBrowser`, `cleanupCanvasMemory` and `getBrowserName`. Its own encoder, quality loop and nested-worker mode (which would download a copy of itself from a CDN) are not used, and a contract test fails if an upgrade removes these helpers. In a Safari worker, `createImageBitmap` replaces the two helpers that rely on `<img>`.
- **JSZip.** The archive is generated through the asynchronous internal stream, which allows cooperative cancel and an output ceiling while generating. Compression is STORE for JPEG, PNG and WebP and DEFLATE level 6 for everything else. Entry names are sanitised (separators, drive letters, `.`/`..`, control and Windows-reserved characters).
- **pdf-lib.** Loads with `ignoreEncryption: false`, `updateMetadata: false` and `throwOnInvalidObject: true`, and saves with object streams, `addDefaultPage: false` and `updateFieldAppearances: false`. It always writes a `%PDF-1.7` header, keeps only Root, Info and ID in the trailer, does not recompress streams, and cannot guarantee removal of all editing history or application-private data that is still referenced.
- **PNG colour profiles.** OxiPNG turns colour PNGs whose pixels are all grey into greyscale but keeps their colour profile, which is invalid for greyscale PNGs. Only sRGB profiles reach OxiPNG, so `png-metadata.js` swaps such a profile for the equivalent `sRGB` chunk.
- **Licences.** `npm run build` writes `third-party-licences.txt` (a plugin in `vite.config.js`) with the licence of every production dependency, including the SIL Open Font License of Instrument Sans, plus the MozJPEG/libjpeg-turbo, libwebp and OxiPNG licences and the Independent JPEG Group statement. The footer links to it.

</details>

## Architecture

```text
Cloudflare Pages ── static files only ──▶ Visitor's browser (nothing is sent back)

React interface ──▶ FileStudio engine ──▶ validate · route · plan
                          │
                          ├─ image worker   MozJPEG · libwebp · OxiPNG + visual check
                          ├─ PDF worker     pdf-lib rewrite + object fingerprints
                          └─ ZIP worker     JSZip archive + byte-for-byte check
```

The React interface drives the engine only through `createFileStudio()` in `src/engine/index.js`. The engine inspects each file from its headers, routes the selection by file count and extension, runs the work in a fresh module Web Worker, and returns a structured `JobResult` that the interface renders directly. These are browser Web Workers on the visitor's device, not Cloudflare's server-side Workers product.

If a browser cannot start workers, or its workers cannot draw images (no `OffscreenCanvas`, as in Safari before 16.4), a task may run on the page within smaller budgets, where a large photo can pause the page for several seconds. Safari 16.4 and later stay in the worker by decoding with `createImageBitmap`. PNGs within the size limits need no browser decoding and always stay in the worker.

<details>
<summary><strong>Project structure</strong></summary>

```text
Compressive-Website/
├── src/
│   ├── engine/                  # Framework-independent processing engine
│   │   ├── index.js             # What the interface imports: createFileStudio, policies, units, formatters
│   │   ├── studio.js            # Controller: selection, lifecycle, jobs, acknowledgements
│   │   ├── router.js            # File router (precedence documented in the file)
│   │   ├── validation.js        # Extension, empty-file, MIME, signature and header checks
│   │   ├── pipeline.js          # Runs a route and builds the JobResult
│   │   ├── health.js            # Resolution health for selections and results
│   │   ├── resolution.js        # PPI maths, thresholds, aspect checks, threshold crossings
│   │   ├── units.js             # ft / in / cm / mm / m conversions and print-size validation
│   │   ├── image-policy.js      # Image decision rules, including which quality to try next
│   │   ├── visual-check.js      # SSIM comparison that decides whether a copy looks the same
│   │   ├── filenames.js         # Extensions, safe ZIP entry names, download names and types
│   │   ├── policy.js            # Every limit and policy value, in one place
│   │   ├── task-runner.js       # Worker-or-page selection with bounded fallbacks
│   │   ├── worker-client.js     # Page side of the worker protocol: timeouts, cancel, stale messages
│   │   ├── worker-host.js       # Worker side of the protocol
│   │   ├── worker-protocol.js   # Message protocol documentation
│   │   ├── errors.js, format.js # Structured errors and number formatting
│   │   ├── inspect/             # Read-only signatures, raster headers, ICC, PDF scan, vector artboards
│   │   └── tasks/               # image-task, codecs, png-metadata, pdf-task, zip-task
│   ├── workers/                 # image, pdf and zip worker entry points
│   ├── hooks/                   # useFileStudio, useDownloads, usePreference, useReducedMotion, useActiveSection
│   ├── components/              # Interface (CSS Modules): Hero, Panel, DropZone, PrintCheck, ResultsPanel, …
│   ├── ui/                      # Tool definitions, page sections, labels, drag-and-drop helpers
│   └── styles/global.css        # Design tokens, light/dark themes, base styles
├── tests/                       # Vitest suites + generated fixtures (tests/fixtures/builders.js)
├── e2e/                         # Playwright suites
├── public/
│   ├── _headers                 # Cloudflare Pages security headers (also applied by npm run preview)
│   ├── theme-init.js            # Applies the saved theme before first paint
│   └── favicon.svg
├── vite.config.js               # Licence-file and CSP meta plugins, preview headers, Vitest config
├── playwright.config.js         # Production build + preview on port 4183, three browsers
└── SETUP-AND-DEPLOY.md          # Step-by-step Windows setup and Cloudflare deployment
```

</details>

## Engine API

```js
import { createFileStudio } from './src/engine/index.js';

const studio = createFileStudio();                    // no workers start until prepare()
const stop = studio.subscribe((snapshot, event) => {}); // lifecycle, progress, result events
await studio.addFiles(fileList, { rejected });        // validating → idle
studio.setPrintSize({ width: 10, height: 4, unit: 'ft' }); // recalculates health, no reprocessing
const result = await studio.prepare();                // processing → ready | canceled | failed
studio.cancel();                                      // relays cancel to the worker, then terminates it
studio.acknowledgeWarnings(true);                     // tied to this job and this print size
studio.getDownload('prepared');                       // { blob, filename, mimeType, size }
studio.getDownload('original', fileId);
studio.replaceFile(id, file); studio.removeFile(id); studio.retry(); studio.reset();
studio.dispose();                                     // cancels work, drops file references, removes listeners
```

Lifecycle states are `idle`, `validating`, `processing`, `ready`, `canceled` and `failed`. A `JobResult` carries the job id, route, timing, input identities, the primary download, per-file outcomes (outcome, reason code, message, bytes and dimensions before and after, limitations, ZIP entry name), totals, warnings, an original-preservation report and an output-constraint report.

Routing uses only the file count and each file's final extension, compared case-insensitively; MIME types never change the route.

| Selection | Route | Download |
|---|---|---|
| One `.jpg` / `.jpeg` / `.webp` | Smart compression with the visual check | Compressed copy, or the original with the reason |
| One `.png` | Lossless OxiPNG (a lossless re-encode when resized to 8000 px) | Optimised copy, or the original with the reason |
| One `.pdf` | Verified structural rewrite | Tidied PDF, or the original with the reason |
| One `.ai` / `.eps` / `.svg` | Protected pass-through, checked first | The original, byte for byte |
| One `.psd` | Pass-through with a header-only resolution check | The original, byte for byte |
| Two or more supported files | ZIP of the original payloads, verified | One ZIP |
| Unsupported, empty, damaged or over budget | Validation error with an actionable message | — |

## Getting Started

### Prerequisites

- **Node.js `^22.13.0 || >=24.0.0`** with npm, as declared in `package.json` `engines`. `.node-version` pins 22.14.0 for Cloudflare's build.
- For browser tests, Playwright's browsers: `npx playwright install chromium firefox webkit`. On Windows, Playwright's Firefox also needs the Microsoft Visual C++ Redistributable; if Playwright reports Firefox's executable as missing, reinstall it with `npx playwright install --force firefox`.

### 1. Clone and install

```bash
git clone https://github.com/antoniopilla/Compressive-Website.git
cd Compressive-Website
npm ci
```

### 2. Run locally

```bash
npm run dev
```

Open the address Vite prints (`http://localhost:5173` by default). Nothing else needs to run: there is no API, database or service to configure.

### 3. Build and preview

```bash
npm run build
npm run preview
```

`npm run preview` serves `dist/` at `http://localhost:4173` with the same security headers Cloudflare Pages serves, read from `public/_headers`. For a step-by-step Windows walkthrough, including GitHub and Cloudflare, see **[SETUP-AND-DEPLOY.md](SETUP-AND-DEPLOY.md)**.

## Environment Variables

None. The site and its build need no environment variables, API keys, secrets or service credentials.

## Deployment

- **Cloudflare Pages:** connect the repository with production branch `main`, framework preset **React (Vite)** (or None), build command `npm run build`, output directory `dist`, and an empty root directory. Cloudflare reads `.node-version` for the Node.js version.
- **Automatic deploys:** every push to `main` redeploys production at [compressive.pages.dev](https://compressive.pages.dev), and each deployment also gets its own preview URL.
- **Security headers:** `public/_headers` is copied into `dist/` and applied by Cloudflare Pages. The build also writes the Content-Security-Policy into `index.html` as a `<meta>` tag (without `frame-ancestors`, which only works as a header), so the policy holds on any host. On a host that ignores `_headers`, configure HSTS, `frame-ancestors` and the other headers there.

The production deployment of commit `d6718c0` was checked live during this documentation update: the security headers and the `<meta>` policy were served, and an in-browser compression made same-origin requests only.

## Using Compressive

```text
Add files ──▶ Checked: signature, headers, budgets
     ↓
Plan shown: what will happen, or which file needs attention
     ↓  Compress
Processing in a worker (cancel at any time)
     ↓
Result: sizes before and after, checks, notes ──▶ Download
                                              └─▶ Download original (when a copy was made)
```

1. **Pick a tool or drop files.** Each tool opens a file picker for its type; Choose files and the drop zone accept any supported file. A single-file tool starts a fresh selection, while Zip files adds to it.
2. **Review the plan.** Before anything runs, the Compress step says exactly what will happen to the selection, or which file needs attention and why.
3. **Compress, then download.** The result shows the size before and after, the time taken, what was checked and anything worth knowing. When a single image or PDF gets a compressed copy, **Download original** stays next to it.
4. **Printing it? (optional)** Enter the print width and height, or pick a common size. Each file shows its effective PPI; if the download would print soft, it stays locked until you confirm, change the size or choose a higher-resolution file.

## Processing Limits

| Budget | Value |
|---|---|
| Files per selection | 100 |
| ZIP batch (total input) | 500 MB (JSZip holds the inputs and the archive in memory, and the archive is read back to check it, so peak memory is at least twice this) |
| Generated archive ceiling | 520 MB |
| Single image source | 250 MB and 100 megapixels after orientation, checked from headers before decoding |
| Single PNG source | 40 megapixels (OxiPNG keeps about four full-size RGBA working copies, roughly 650 MB at this size) |
| Embedded PNG colour profile | 4 MB once decompressed; larger profiles are treated as unidentified and the original is kept |
| Image header | 10,000 segments or chunks before the image data; real files have a few dozen, so more is reported as damage |
| Prepared image output | 40,000,000 bytes and 8000 × 8000 px; JPG and WebP at quality 75, 85, 90 or 95, whichever is lowest to pass the visual check |
| Single PDF | 150 MB |
| Single pass-through file | 4 GB (never read in full) |
| Page fallback (no workers) | ZIP 50 MB, PDF 20 MB, images 25 megapixels |
| Timeouts | ZIP 10 min, image 3 min, PDF 3 min |

One 8000 × 8000 RGBA buffer is 256,000,000 bytes, and image preparation can hold several at once, so every canvas and decoded bitmap is freed as soon as its pixels are read: trying several qualities holds the reference pixels plus one decoded copy at a time. Allocation failures are caught and reported, and the original is kept. All sizes use decimal units (1 MB = 1,000,000 bytes).

## Available Scripts

| Command | Runs |
|---|---|
| `npm run dev` | Vite development server with hot reload |
| `npm run build` | Production build into `dist/`, including `third-party-licences.txt` and the CSP `<meta>` tag |
| `npm run preview` | Serves `dist/` on port 4173 with the security headers from `public/_headers` |
| `npm run lint` | ESLint over the whole project |
| `npm run test` | Vitest unit and integration tests (Node and jsdom) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright in Chromium, Firefox and WebKit against a fresh production build on port 4183, so it never clashes with `npm run preview` |

During this documentation update, lint, all 159 unit tests and the Playwright suite (94 passed and 2 skipped by design across Chromium, Firefox and WebKit) passed. Fixtures are generated in code (`tests/fixtures/builders.js`); no customer artwork is committed, and private test files belong in `fixtures/private/`, which Git ignores.

<details>
<summary><strong>Test coverage</strong></summary>

- **`npm run test`** covers routing (including casing, MIME ambiguity and PDF-typed AI files), validation, filename sanitising, duplicates and download types, PPI maths and units, header probes (orientation, transparency, animation, ICC, bit depth, the windowed reader and the header step cap), image decision rules (including when to skip a quality or stop early, and the resize size check), the visual check (identical copies, lost detail, damage confined to one area, colour-only changes, hidden transparent colour, tiny images), PNG metadata removal and the greyscale colour-profile swap, ZIP payload preservation by SHA-256, compression policy, cancellation, the archive ceiling, verification failure, PDF fixtures (text, vector grid, paths, page boxes, rotation, incremental revisions, indirect lengths, encrypted, signed, PDF/X, PDF 2.0, malformed, ambiguous), the worker protocol (results, errors, stale messages, timeouts, cancellation, failed start vs crash), task-runner fallbacks, the controller lifecycle (cancel, stale results, removal during inspection, acknowledgement invalidation, retry, reset, dispose), StrictMode adapter cleanup, object-URL revocation and drop-zone behaviour.
- **`npm run test:e2e`** builds for production and drives Chromium, Firefox and WebKit against `vite preview`. Playwright's WebKit build has no `OffscreenCanvas` in workers (real Safari has since 16.4), so there images are processed on the page; Safari's worker path is covered by running Chromium with Safari's user agent, and the page fallback by serving the image worker without `OffscreenCanvas`. It covers the security headers and the CSP `<meta>` tag, the served licences file, the navigation (the current section marked while scrolling, the footer links, Back to top, the theme switch), the phone bottom bar (44px targets, never covering the page), reduced motion, inline print-size errors, the hero's Choose files and tool buttons, byte-for-byte vectors, a verified ZIP, worker JPEG compression with EXIF orientation, a smooth camera-quality photo more than halved at quality 75, WebP through libwebp, lossless PNG through OxiPNG with transparency kept (and a resized PNG), each encoder's `.wasm` loading under the production CSP, animated images, warning acknowledgement and print-size changes, a threshold crossing at 8000 px, PDF tidy-up, an encrypted PDF, cancel and retry, unsupported and empty files, drag-and-drop, keyboard-only use, and no horizontal overflow at 320–1366 px in light and dark modes.

</details>

## Known Limitations

- Resolution is assessed for raster images and PSD headers only. Vector files and PDFs are reported as not assessed, because they can contain embedded images placed at any size. The PPI thresholds (150 / 100 / 72) are product defaults, not universal print standards.
- Re-encoded JPG and WebP images (and resized PNGs) drop EXIF and embedded DPI metadata, apply orientation to the pixels and use sRGB. Images whose profile or colour model would change are kept unchanged instead.
- The visual check is a measurement, not a person. It is deliberately strict, so grainy or very detailed photos often need quality 85–90 and save less (about 25–60%), and lossy WebP never passes for graphics with fine coloured text, which keep their original.
- PNG compression is lossless only. Big lossy PNG savings need colour reduction (the pngquant method), whose library, libimagequant, is GPL-licensed and not included.
- The encoders need WebAssembly with `'wasm-unsafe-eval'` support (Chrome and Edge 95+, Firefox 102+, Safari 16+). Older browsers keep the original.
- PDF savings vary and can be zero; the tool never rasterises or recompresses content. pdf-lib 1.17.1 has had no release since May 2022; it runs in a worker with a timeout, every rewrite is verified, and any failure keeps the original.
- Very large files can exceed a device's memory or the 3-minute image timeout; a 64-megapixel grainy photo, the worst case, needs several encodes and checks. Failures are reported and originals kept, but phones manage less than the limits above.
- A refresh clears the session; nothing is persisted.

## License

No license file is included. Contact the maintainer for reuse terms. Third-party notices for the bundled libraries, encoders and font ship with the site in `third-party-licences.txt`, linked from the footer. This software is based in part on the work of the Independent JPEG Group.

## Contact

Built and maintained by **[@antoniopilla](https://github.com/antoniopilla)** · [Repository](https://github.com/antoniopilla/Compressive-Website) · [Live site](https://compressive.pages.dev)
