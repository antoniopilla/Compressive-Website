# Compressive

Compressive is a free, private file compressor that runs **entirely in the visitor's browser**. Visitors pick a tool (Compress PNG, Compress JPG, Compress WebP, Shrink a PDF, Zip files, Check print sharpness), or simply drop files in:

**Pick a tool or drop files → Compress → review the result → Download.**

- **A single PNG, JPG or WebP** is compressed once at quality 0.85, within 8000 × 8000 px and 40 MB, and never enlarged. The original stays downloadable.
- **A single PDF** gets a conservative structural rewrite. Text, fonts, vectors, page boxes and rotation are verified unchanged; otherwise you get the original back.
- **Several files** become one ZIP of the original payloads, verified against the originals after packaging.
- **Vector files (AI, EPS, SVG) and PSDs** are returned byte for byte. They are never converted, flattened, outlined or re-saved.
- **The optional print check** ("Printing it?") measures effective PPI for an intended print size, warns before low-resolution downloads, and recalculates when the size changes. Resolution details appear only once a print size is entered.

Compressive compresses only where that is safe. Vector and Photoshop files are never altered, a ZIP of already-compressed photos stays about the same size, and whenever compressing would not help or could change how a file looks, the original is returned. The interface says so up front.

## Design

The interface is flat and lightly animated: solid surfaces with 1px borders, no shadows or gradients, sentence case throughout, and one design-token system in `src/styles/global.css` (colours, type scale, 4px spacing steps, radii, control sizes and motion).

- **Palette**: a calm blue primary (`#2456e8` light, `#7ea4ff` dark) for actions and the current place, a violet secondary, and a teal accent for "kept exactly" outcomes, on cool neutral backgrounds. Success, warning, error and info each have a strong shade for text and icons and a soft shade for panels. Every text pairing passes WCAG AA (4.5:1) in both themes. The theme switch offers Light, Dark and Auto (follows the device).
- **Type**: the system font stack, with a fluid display size for the main heading and a fixed scale (`--text-xs` … `--text-2xl`) everywhere else.
- **Navigation**: the page has four sections: Tools, Compress, How it works and Privacy. A sticky header nav (tablet and up) and a bottom bar (phones, 64px tall, 44px+ targets) both mark the section on screen with `aria-current="location"`. The footer repeats the links, adds Limits, and has a Back to top link. A skip link jumps straight to the files.
- **Finding things**: all six tools sit as labelled cards in the first screen, and "Choose files" is the one primary action. There is no search, because a single page with six visible tools doesn't need one.
- **Motion**: the header and hero ease in on load (320 ms, staggered), lower sections fade up once as they scroll into view, buttons and cards lift 2px on hover (140 ms; not on touch screens), the print check opens in 240 ms, and finished results pop a checkmark. Only `transform` and `opacity` animate, so nothing shifts the layout. With reduced motion, everything appears at once and scrolling jumps instead of gliding.
- **Forms**: print-size fields show errors under the field they belong to (`aria-invalid`, `aria-describedby`) and confirm a valid size in a status message.

There is no backend, database, cloud storage, login, payment, API key or analytics. Selected files never leave the device.

For step-by-step setup and deployment on Windows, see **[SETUP-AND-DEPLOY.md](SETUP-AND-DEPLOY.md)**.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload (keeps running; stop with Ctrl+C). |
| `npm run build` | Production build into `dist/`. |
| `npm run preview` | Serves `dist/` locally with the same security headers as Cloudflare Pages (keeps running). |
| `npm run lint` | ESLint over the whole project. |
| `npm run test` | Vitest unit and integration tests (Node and jsdom). |
| `npm run test:e2e` | Playwright browser tests in Chromium, Firefox and WebKit against a fresh production build, served on port 4183 so they never clash with `npm run preview` (4173). Run `npx playwright install chromium firefox webkit` once first. On Windows, Playwright's Firefox also needs the Microsoft Visual C++ Redistributable; without it, run `npm run test:e2e -- --project=chromium --project=webkit`. |

Requirements: Node.js `^22.13.0 || >=24.0.0` (declared in `package.json` `engines`; `.node-version` pins `22.14.0` for Cloudflare's build). The build needs no environment variables.

## Architecture

```
src/
  engine/                 Framework-independent processing engine (vanilla ES modules + JSDoc)
    index.js              Public API (createFileStudio and helpers)
    studio.js             Stateful controller: selection, lifecycle, jobs, acknowledgements
    router.js             Dynamic File Router (routing precedence documented in the file)
    validation.js         Extension, empty-file, MIME plausibility, signature and header checks
    pipeline.js           Executes a route and builds the structured JobResult
    health.js             Resolution health for selections and results
    resolution.js         PPI maths, thresholds, aspect checks, threshold crossings
    units.js              ft / in / cm / mm / m conversions and print-size validation
    image-policy.js       Pure decision rules for image compression
    filenames.js          Extensions, safe/unique ZIP entry names, download names
    policy.js             Every limit and policy value, in one place
    task-runner.js        Worker-or-main-thread selection with bounded fallbacks
    worker-client.js      Main-thread worker protocol: timeouts, cancellation, stale-message rejection
    worker-host.js        Worker-side protocol
    worker-protocol.js    Message protocol documentation
    errors.js, format.js
    inspect/              Read-only inspection: signatures, raster headers, ICC, PDF scan, vector artboards
    tasks/                zip-task.js (JSZip), image-task.js (browser-image-compression), pdf-task.js (pdf-lib)
  workers/                zip.worker.js, image.worker.js, pdf.worker.js (thin entry points)
  hooks/                  React adapter: useFileStudio, useDownloads, usePreference, useReducedMotion, useActiveSection (scrollspy), useReveal (scroll reveal)
  components/             Interface (CSS Modules): SiteHeader, BottomNav, Hero, Panel, DropZone, PrintCheck, InfoSection, PrivacySection, SiteFooter, …
  ui/                     Tool definitions (tools.js), page sections (sections.js), interface labels and drag-and-drop helpers
  styles/global.css       Design tokens, light/dark themes, base styles
tests/                    Vitest suites + generated fixtures (tests/fixtures/builders.js)
e2e/                      Playwright suites
public/_headers           Cloudflare Pages security headers (also applied by `npm run preview`)
public/theme-init.js      Applies the saved light/dark theme before first paint (a same-origin script, allowed by the CSP)
```

### Engine API

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

Lifecycle states: `idle`, `validating`, `processing`, `ready`, `canceled`, `failed`. Any selection change cancels a running job and discards the old result. Each job has an id, and a job that settles after being superseded is ignored.

A `JobResult` carries: job id, route, `startedAt`, `durationMs` (from `performance.now()`), input identities and sizes, the primary artifact (blob, filename, MIME type, size, kind), per-file outcomes (outcome, reason code, message, original/prepared bytes and dimensions, assessability, limitations, ZIP entry name), totals (actual saved bytes and ratio), warnings, limitations, an original-preservation report and an output-constraint report. Original and prepared effective PPI come from `assessResult(result, printSize)`, which is recalculated whenever the print size changes.

### Workers

ZIP generation, PDF rewriting and image encoding each run in a dedicated module Web Worker, which Vite bundles into its own chunk. These are browser Web Workers on the visitor's device, not Cloudflare's server-side Workers product. Each task gets a fresh worker that is terminated when the task settles, so memory is released and cancellation and timeouts are absolute. The protocol (job ids, progress, serialized errors, cancel messages, transferable `ArrayBuffer`s for PDF output) is documented in `src/engine/worker-protocol.js`.

If a browser cannot start workers, or cannot decode images inside one, a task may run on the main thread within smaller budgets (`LIMITS.mainThread`). Safari is the main case: browser-image-compression decodes through `<img>` there, and `<img>` does not exist in workers. Larger work fails with an explanation rather than freezing the tab.

## Supported formats and routing

Routing uses only the file count and each file's final extension, compared case-insensitively. MIME types never change the route; for example, a PDF-compatible `.ai` reported as `application/pdf` stays protected. Contents are sniffed so misnamed or damaged files are rejected with actionable messages instead of being repaired.

| Selection | Strategy |
|---|---|
| none | idle |
| one `.ai` / `.eps` / `.svg` | protected original pass-through (whitelist checked first) |
| two or more supported files | ZIP of original payloads (no per-file optimisation) |
| one `.jpg` / `.jpeg` / `.png` / `.webp` | smart image compression |
| one `.pdf` | conservative PDF structural rewrite |
| one `.psd` | original pass-through, header-only assessment |
| anything unsupported, empty or over budget | validation error |

## Processing limits

| Budget | Value |
|---|---|
| Files per selection | 100 |
| ZIP batch (total input) | 500 MB (JSZip holds inputs and output in memory, so peak memory is about twice this) |
| Generated archive ceiling | 520 MB |
| Single image source | 250 MB and 100 megapixels after orientation (checked from headers before decoding) |
| Single PNG source | 40 megapixels (the PNG encoder keeps about four full-size RGBA copies, roughly 650 MB at this size) |
| Embedded PNG colour profile | 4 MB once decompressed; larger profiles are treated as unidentified and the original is kept |
| Prepared image output | 40,000,000 bytes, 8000 × 8000 px, quality 0.85 |
| Single PDF | 150 MB |
| Single pass-through file | 4 GB (never read in full) |
| Main-thread fallback | ZIP 50 MB, PDF 20 MB, images 25 megapixels |
| Timeouts | ZIP 10 min, image 3 min, PDF 3 min |

Memory reference: one 8000 × 8000 RGBA buffer is 256,000,000 bytes (about 256 MB), and image preparation can hold several such buffers at once. Phones have far less memory than desktops. Allocation failures are caught and reported, and the original is kept.

All sizes in the product use decimal units (1 MB = 1,000,000 bytes).

## Library usage notes

- **browser-image-compression 2.0.2 (pinned).** Its top-level `imageCompression()` loops when the first encode exceeds `maxSizeMB` or is larger than the source. Each pass lowers quality by 5% (JPEG/WebP) or the colour budget by 15% (PNG), and shrinks both dimensions by 5% when over the size limit. `maxSizeMB` is binary (40 MB decimal ≈ 38.147 there). Those silent reductions conflict with the quality policy, so `tasks/image-task.js` uses the library's exported helpers (`drawFileInCanvas`, `handleMaxWidthOrHeight`, `followExifOrientation`, `canvasToFile`, `isAutoOrientationInBrowser`, `cleanupCanvasMemory`) for exactly one encode. `initialQuality: 0.85` is a starting encoder setting, not a guaranteed perceptual quality. If 0.85 cannot meet 40 MB, the source is kept and the conflict is explained. A contract test fails if an upgrade removes these helpers.
  - PNG: the library maps quality to a colour budget of `4096 × quality` (3481 colours at 0.85) through UPNG. That budget is used only when the image has no more colours than that, so the reduction is exact; otherwise the PNG is re-encoded losslessly.
  - EXIF orientation is applied once. Animated, CMYK, 12-bit JPEG, 16-bit PNG, non-sRGB ICC-tagged images, and PNG/WebP files with orientation metadata are kept unchanged. Browser canvas downscaling and wrong output types (for example Safari not encoding WebP) are detected, and the source is kept.
  - The library's nested-worker mode is never used; it would download a copy of itself from a CDN.
- **JSZip.** The archive is generated in a worker through the asynchronous internal stream, which allows cooperative cancel and an output ceiling while generating. Compression is STORE for JPEG/PNG/WebP and DEFLATE level 6 for everything else. Every entry is extracted and compared byte for byte before delivery. Entry names are sanitised (separators, drive letters, `.`/`..`, control and Windows-reserved characters) and duplicates are renamed deterministically as `name (2).ext`.
- **pdf-lib.** Loads with `ignoreEncryption: false`, `updateMetadata: false` and `throwOnInvalidObject: true`. Saves with object streams, `addDefaultPage: false` and `updateFieldAppearances: false`, after pruning objects unreachable from the catalog and Info dictionary. Every reachable object is fingerprinted before and after, together with page boxes and rotation; any difference keeps the original. pdf-lib always writes a `%PDF-1.7` header, keeps only Root/Info/ID in the trailer, does not recompress streams, and cannot guarantee removal of all editing history or application-private data that is still referenced. Encrypted, signed (or usage-rights), PDF/X, PDF/A, PDF 2.0, XFA, malformed and ambiguous files are kept unchanged.
- **PDF.js** page previews are not included; downloads never depend on rendering.

## Resolution display

Effective PPI is calculated from pixel dimensions and the entered print size, with floating-point noise removed (to six decimal places). Classification uses that value, and displayed numbers are rounded **down**: 149.6 PPI reads "149 PPI · Below target", never "150". A label and its number therefore always agree.

## Privacy

- Files are read with `Blob` APIs and processed in workers on the device. Downloads use object URLs created on click and revoked after a minute, or on unmount.
- `public/_headers` sets a Content-Security-Policy with `connect-src 'self'`, so the page cannot send data to other origins. The Playwright suite records every request during real processing and asserts that all of them are same-origin `GET`s for the app's own assets, with no request bodies and no CSP violations.
- Only the theme and default unit are stored in `localStorage`. File contents, previews and filenames are never stored, and a refresh clears the session.
- System fonts only; no external scripts, fonts, analytics or tracking.

## Testing

- `npm run test` covers routing (including casing, MIME ambiguity and PDF-typed AI files), validation, filename sanitising and duplicates, PPI maths and units, header probes (orientation, transparency, animation, ICC, bit depth), image decision rules, ZIP payload preservation by SHA-256, compression policy, cancellation, the archive ceiling, verification failure, PDF fixtures (text, vector grid, paths, page boxes, rotation, incremental revisions, indirect lengths, encrypted, signed, PDF/X, PDF 2.0, malformed, ambiguous), the worker protocol (results, errors, stale messages, timeouts, cancellation, failed start vs crash), task-runner fallbacks, the controller lifecycle (cancel, stale results, removal during inspection, acknowledgement invalidation, retry, reset, dispose), StrictMode adapter cleanup, object-URL revocation and drop-zone behaviour.
- `npm run test:e2e` builds for production and drives Chromium, Firefox and WebKit against `vite preview`. WebKit exercises the Safari path, where images are processed on the page instead of in a worker. It covers the navigation (the current section marked while scrolling, the footer links, Back to top, the theme switch), the phone bottom bar (44px targets, never covering the page), reduced motion, inline print-size errors, the hero's Choose files and tool buttons opening the right picker, byte-for-byte vectors, a verified ZIP, worker JPEG compression with EXIF orientation, PNG transparency, animated images, warning acknowledgement and print-size changes, a threshold crossing at 8000 px, PDF tidy-up, an encrypted PDF, cancel and retry, unsupported and empty files, drag-and-drop, keyboard-only use, worker chunks loading under the production CSP, and no horizontal overflow at 320–1366 px in light and dark modes.
- Fixtures are generated in code (`tests/fixtures/builders.js`); no customer artwork is committed. Keep private test files in `fixtures/private/`, which Git ignores.

## Known limitations

- Resolution is assessed for raster images and PSD headers only. Vector files and PDFs are reported as "not assessed" because they can contain embedded images placed at any size. The PPI thresholds (150 / 100 / 72) are product defaults, not universal standards.
- Re-encoded images drop EXIF and embedded DPI metadata, apply orientation to the pixels, and use sRGB. Images whose profile or colour model would change are kept unchanged instead.
- WebP output depends on the browser's encoder; browsers that cannot encode WebP keep the original.
- In-browser PDF savings vary and can be zero; the tool never rasterises or recompresses content.
- Very large files can exceed a device's memory. Failures are reported and originals kept, but phones manage less than the limits above.
- A refresh clears the session; nothing is persisted.
