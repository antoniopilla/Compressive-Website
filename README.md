# Compressive

Compressive is a free, private file compressor that runs **entirely in the visitor's browser**. Visitors pick a tool (Compress PNG, Compress JPG, Compress WebP, Shrink a PDF, Zip files, Check print sharpness), or simply drop files in:

**Pick a tool or drop files → Compress → review the result → Download.**

- **A single JPG or WebP** is compressed with MozJPEG or libwebp at the lowest quality that still looks the same: starting at 75, each copy is compared with the original area by area (a visual check), and quality goes up (85, 90, 95) until it passes. If it never does, or the copy would not be smaller, the original is returned. Within 8000 × 8000 px and 40 MB, never enlarged; the original stays downloadable.
- **A single PNG** is optimised losslessly with OxiPNG: every pixel, the transparency, the colour profile and the print size (DPI) are kept; text, EXIF and editor metadata are removed.
- **A single PDF** gets a conservative structural rewrite. Text, fonts, vectors, page boxes and rotation are verified unchanged; otherwise you get the original back.
- **Several files** become one ZIP of the original payloads, verified against the originals after packaging.
- **Vector files (AI, EPS, SVG) and PSDs** are returned byte for byte. They are never converted, flattened, outlined or re-saved.
- **The optional print check** ("Printing it?") measures effective PPI for an intended print size, warns before low-resolution downloads, and recalculates when the size changes. Resolution details appear only once a print size is entered.

Compressive compresses only where that is safe. Vector and Photoshop files are never altered, a ZIP of already-compressed photos stays about the same size, and whenever compressing would not help or could change how a file looks, the original is returned. The interface says so up front.

## Design

The interface is claymorphic: soft, inflated forms lit from the upper left, with dark plum-grey text on a pink lead cushion, cream reading trays and pastel mint, lavender, butter-yellow and pale-blue objects. Every raised form combines a broad outer shadow with a light inset along its upper-left edge and a darker inset along its lower-right edge; recessed wells (fields, the drop zone, status labels) reverse the insets, and text never carries a shadow. Sentence case throughout, and one design-token system in `src/styles/global.css`: the design system's own `--dp-*` tokens (palette, type, spacing, radii, focus width and motion) and the role tokens built on them.

- **Layout**: a pink lead cushion opens the page, with the headline and Choose files on the left and the six tools beside a static clay sculpture on the right; the three promises sit beneath it in pastel cushions. The workspace is one cream tray holding both steps (a mint cushion for adding files, a pale-blue one for compressing and downloading), How it works is a lavender tray of broad shelves (each file type, then what happens to it), Privacy closes the page in pink, and the footer is a cream tray. Trays have a 70px radius, cushions 38px and disclosures 25px; buttons are thick pills.
- **Palette**: ground `#f1f2fa`, ink `#383139` and `#48404b`, pink `#f6a3ca`, cream `#fffdf7`, and mint, lavender, butter-yellow and pale-blue surfaces. Ink and ink-secondary pass WCAG AA (4.5:1) on every surface in both themes. Success, warning, error and info keep a strong shade for icons and short labels; their soft shades reuse the pastels. Dark mode keeps the same roles in deep clay tones. The theme switch offers Light, Dark and Auto (follows the device).
- **Type**: Instrument Sans, bundled with the site (so it loads under the CSP's `font-src 'self'`) and named "Claymorphism Instrument". The main title is bold with tight tracking, growing from 54px at 760px wide to 94px (40px on phones); section headings are bold but smaller; reading text is 16px with 1.55 leading.
- **Navigation**: the page has four sections: Tools, Compress, How it works and Privacy. A floating header bar (sticky from tablet width up) and a bottom bar (phones, 72px tall, 44px+ targets) both mark the section on screen with `aria-current="location"`, shown pressed into the bar. The footer repeats the links, adds Limits, and has a Back to top link. A skip link jumps straight to the files.
- **Finding things**: all six tools sit as labelled clay buttons in the first screen on laptops and desktops, and "Choose files" is the one primary action. There is no search, because a single page with six visible tools doesn't need one.
- **Motion**: only short hover and press responses (180 ms): buttons, tool buttons and size chips rise 2px on hover (not on touch screens) and press down into the surface when clicked. Nothing animates in on load or on scroll, and the sculpture is static. With reduced motion nothing moves, transitions are off and scrolling jumps instead of gliding; pressed states still show.
- **Focus**: a 3px outline, set apart from the clay shading, so it shows on every surface.
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
    index.js              What the interface imports (createFileStudio, policies, units, formatters)
    studio.js             Stateful controller: selection, lifecycle, jobs, acknowledgements
    router.js             Dynamic File Router (routing precedence documented in the file)
    validation.js         Extension, empty-file, MIME plausibility, signature and header checks
    pipeline.js           Executes a route and builds the structured JobResult
    health.js             Resolution health for selections and results
    resolution.js         PPI maths, thresholds, aspect checks, threshold crossings
    units.js              ft / in / cm / mm / m conversions and print-size validation
    image-policy.js       Pure decision rules for image compression, including which quality to try next
    visual-check.js       SSIM comparison that decides whether a compressed copy looks the same
    filenames.js          Extensions, safe/unique ZIP entry names, download names
    policy.js             Every limit and policy value, in one place
    task-runner.js        Worker-or-main-thread selection with bounded fallbacks
    worker-client.js      Main-thread worker protocol: timeouts, cancellation, stale-message rejection
    worker-host.js        Worker-side protocol
    worker-protocol.js    Message protocol documentation
    errors.js, format.js
    inspect/              Read-only inspection: signatures, raster headers, ICC, PDF scan, vector artboards
    tasks/                zip-task.js (JSZip), image-task.js (decode and quality search), codecs.js (MozJPEG, libwebp, OxiPNG),
                          png-metadata.js, pdf-task.js (pdf-lib)
  workers/                zip.worker.js, image.worker.js, pdf.worker.js (thin entry points)
  hooks/                  React adapter: useFileStudio, useDownloads, usePreference, useReducedMotion, useActiveSection (scrollspy)
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

If a browser cannot start workers, or its workers cannot draw images (no `OffscreenCanvas` there, as in Safari before 16.4), a task may run on the main thread within smaller budgets (`LIMITS.mainThread`), where a large photo can pause the page for several seconds. Safari 16.4 and later stay in the worker: browser-image-compression decodes through `<img>` on Safari, which workers lack, so there the image task decodes with `createImageBitmap` itself and checks how that applies EXIF orientation with the library's own 2 × 1 test image. PNGs within the size limits need no decoding by the browser and always stay in the worker. Larger work fails with an explanation rather than freezing the tab.

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
| Single PNG source | 40 megapixels (OxiPNG keeps about four full-size RGBA working copies, roughly 650 MB at this size) |
| Embedded PNG colour profile | 4 MB once decompressed; larger profiles are treated as unidentified and the original is kept |
| Image header | 10,000 segments or chunks before the image data (`MAX_HEADER_STEPS`); real files have a few dozen, so more is reported as damage. Headers are read through a 1 MB window, not one read per segment |
| Prepared image output | 40,000,000 bytes, 8000 × 8000 px; JPG and WebP at quality 75, 85, 90 or 95, whichever is lowest to pass the visual check |
| Single PDF | 150 MB |
| Single pass-through file | 4 GB (never read in full) |
| Main-thread fallback | ZIP 50 MB, PDF 20 MB, images 25 megapixels |
| Timeouts | ZIP 10 min, image 3 min, PDF 3 min |

Memory reference: one 8000 × 8000 RGBA buffer is 256,000,000 bytes (about 256 MB), and image preparation can hold several such buffers at once. To keep that down, every canvas and decoded bitmap is freed as soon as its pixels are read, so trying several qualities holds the reference pixels plus one decoded copy at a time, never one per quality. Phones have far less memory than desktops. Allocation failures are caught and reported, and the original is kept.

All sizes in the product use decimal units (1 MB = 1,000,000 bytes).

## Library usage notes

- **jSquash encoders (pinned): @jsquash/jpeg 1.6.0 (MozJPEG), @jsquash/webp 1.5.0 (libwebp) and @jsquash/oxipng 2.3.0 (OxiPNG).** WebAssembly builds repackaged from Google's Squoosh, loaded on first use from the site's own files (`src/engine/tasks/codecs.js`); each `.wasm` is about 60–130 KB gzipped. Licences are permissive: Apache-2.0 for the packages, IJG/BSD for MozJPEG, BSD for libwebp, MIT for OxiPNG. MozJPEG uses Squoosh's defaults (progressive, optimised Huffman tables, 4:2:0 colour below quality 90 and full colour from 90). OxiPNG runs at level 2 from its single-threaded build; the package's threaded build needs cross-origin isolation, which the site does not enable. OxiPNG copies every chunk through, so `tasks/png-metadata.js` then keeps only the image, transparency, colour, background, print-size and animation chunks. The CSP allows WebAssembly with `'wasm-unsafe-eval'`. If a browser cannot run WebAssembly at all, the original is kept with an explanation.
- **Visual check (`src/engine/visual-check.js`).** SSIM on 8 × 8 windows every 4 px (so blocking at JPEG and WebP block edges is caught), giving three scores: brightness overall, colour overall, and the least similar 64 × 64 area. A copy passes only if all three reach `IMAGE_POLICY.lookalike` (0.97, 0.97 and 0.93). The thresholds were calibrated on photos and interface graphics: below them, enlarged crops showed smoothed grain, blocking, or colour fringes on coloured text; above them, none were found. The copy is decoded by the browser for the check, so it is judged as it will be shown. Lossless WebP sources get a final lossless try. Two shortcuts (`nextQuality` in `image-policy.js`) keep large, detailed photos from trying every quality: a copy that misses a score by more than `IMAGE_POLICY.skipMargins` (0.02 brightness, 0.05 colour, 0.08 area) skips the next quality, since every calibration image that far below also failed one quality up; and a file grows at least `minGrowthPerStep` per step (1.1× MozJPEG, 1.05× WebP; measured 1.11–2.32× and 1.08–2.04×), so once even that would reach the original's size the search stops. Both can only cost a little saving, never quality. A reference that comes back entirely blank (a browser that failed to draw past its canvas limit) is never encoded, and every copy must be exactly the size the resize rule gives.
- **browser-image-compression 2.0.2 (pinned)** is used only to decode, resize and orient: `drawFileInCanvas`, `handleMaxWidthOrHeight`, `followExifOrientation`, `isAutoOrientationInBrowser`, `cleanupCanvasMemory` and `getBrowserName`. Its own encoder and its quality loop (which silently lowers quality and shrinks dimensions) are not used. A contract test fails if an upgrade removes these helpers.
  - EXIF orientation is applied once. In a Safari worker, `createImageBitmap` replaces `drawFileInCanvas` and `isAutoOrientationInBrowser` (both rely on `<img>` there); the resize and rotate helpers work unchanged on `OffscreenCanvas`. Animated, CMYK, 12-bit JPEG, 16-bit PNG, non-sRGB ICC-tagged images, and PNG/WebP files with orientation metadata are kept unchanged. Browser canvas downscaling and wrong output types are detected, and the source is kept.
  - The library's nested-worker mode is never used; it would download a copy of itself from a CDN.
- **JSZip.** The archive is generated in a worker through the asynchronous internal stream, which allows cooperative cancel and an output ceiling while generating. Compression is STORE for JPEG/PNG/WebP and DEFLATE level 6 for everything else. Every entry is extracted and compared byte for byte before delivery. Entry names are sanitised (separators, drive letters, `.`/`..`, control and Windows-reserved characters) and duplicates are renamed deterministically as `name (2).ext`.
- **pdf-lib.** Loads with `ignoreEncryption: false`, `updateMetadata: false` and `throwOnInvalidObject: true`. Saves with object streams, `addDefaultPage: false` and `updateFieldAppearances: false`, after pruning objects unreachable from the catalog and Info dictionary. Every reachable object is fingerprinted before and after, together with page boxes and rotation; any difference keeps the original. pdf-lib always writes a `%PDF-1.7` header, keeps only Root/Info/ID in the trailer, does not recompress streams, and cannot guarantee removal of all editing history or application-private data that is still referenced. Encrypted, signed (or usage-rights), PDF/X, PDF/A, PDF 2.0, XFA, malformed and ambiguous files are kept unchanged.
- **PDF.js** page previews are not included; downloads never depend on rendering.
- **Licences.** `npm run build` writes `third-party-licences.txt` (a plugin in `vite.config.js`): the licence text of every production dependency (including the SIL Open Font License of the bundled Instrument Sans), the MozJPEG/libjpeg-turbo, libwebp and OxiPNG licences from the jSquash packages, and the Independent JPEG Group statement MozJPEG's licence asks for. These licences ask for their notices to travel with the code, and every visitor downloads the code, so the footer links to the file (in a new tab, so the session survives).
- **PNG colour profiles.** OxiPNG turns colour PNGs whose pixels are all grey into greyscale but keeps their colour profile, which is invalid for greyscale PNGs. Only sRGB profiles reach OxiPNG, so `png-metadata.js` swaps such a profile for the equivalent `sRGB` chunk.

## Resolution display

Effective PPI is calculated from pixel dimensions and the entered print size, with floating-point noise removed (to six decimal places). Classification uses that value, and displayed numbers are rounded **down**: 149.6 PPI reads "149 PPI · Below target", never "150". A label and its number therefore always agree.

## Privacy

- Files are read with `Blob` APIs and processed in workers on the device. Downloads use object URLs created on click and revoked after a minute, or on unmount.
- `public/_headers` sets a Content-Security-Policy with `connect-src 'self'`, so the page cannot send data to other origins. The build also writes this policy into `index.html` as a `<meta>` tag (without `frame-ancestors`, which only works as a header), so it still holds on a host that ignores `_headers`. `script-src 'self' 'wasm-unsafe-eval'` lets the image encoders' WebAssembly (served from the site) compile, without allowing JavaScript `eval` or outside scripts. `Strict-Transport-Security` keeps a custom domain on HTTPS; `pages.dev` already is, through the browsers' preload list. The Playwright suite records every request during real processing and asserts that all of them are same-origin `GET`s for the app's own assets, with no request bodies and no CSP violations.
- Only the theme and default unit are stored in `localStorage`. File contents, previews and filenames are never stored, and a refresh clears the session.
- No external scripts, fonts, analytics or tracking. The one font, Instrument Sans, is bundled and served from the site itself.

## Testing

- `npm run test` covers routing (including casing, MIME ambiguity and PDF-typed AI files), validation, filename sanitising and duplicates, PPI maths and units, header probes (orientation, transparency, animation, ICC, bit depth, the windowed reader and the header step cap), image decision rules (including when to skip a quality or stop early, and the resize size check), the visual check (identical copies, lost detail, damage confined to one area, colour-only changes, hidden transparent colour, tiny images), PNG metadata removal (and the greyscale colour-profile swap), ZIP payload preservation by SHA-256, compression policy, cancellation, the archive ceiling, verification failure, PDF fixtures (text, vector grid, paths, page boxes, rotation, incremental revisions, indirect lengths, encrypted, signed, PDF/X, PDF 2.0, malformed, ambiguous), the worker protocol (results, errors, stale messages, timeouts, cancellation, failed start vs crash), task-runner fallbacks, the controller lifecycle (cancel, stale results, removal during inspection, acknowledgement invalidation, retry, reset, dispose), StrictMode adapter cleanup, object-URL revocation and drop-zone behaviour.
- `npm run test:e2e` builds for production and drives Chromium, Firefox and WebKit against `vite preview`. Playwright's WebKit build has no `OffscreenCanvas` in workers (real Safari has since 16.4), so there images are processed on the page; Safari's worker path is covered by running Chromium with Safari's user agent, and the on-page fallback by serving the image worker without `OffscreenCanvas`. It covers the served licences file, the navigation (the current section marked while scrolling, the footer links, Back to top, the theme switch), the phone bottom bar (44px targets, never covering the page), reduced motion, inline print-size errors, the hero's Choose files and tool buttons opening the right picker, byte-for-byte vectors, a verified ZIP, worker JPEG compression with EXIF orientation, a smooth camera-quality photo more than halved at quality 75, WebP through libwebp, lossless PNG through OxiPNG with transparency kept (and a resized PNG), each encoder's `.wasm` loading under the production CSP, animated images, warning acknowledgement and print-size changes, a threshold crossing at 8000 px, PDF tidy-up, an encrypted PDF, cancel and retry, unsupported and empty files, drag-and-drop, keyboard-only use, worker chunks loading under the production CSP, and no horizontal overflow at 320–1366 px in light and dark modes.
- Fixtures are generated in code (`tests/fixtures/builders.js`); no customer artwork is committed. Keep private test files in `fixtures/private/`, which Git ignores.

## Known limitations

- Resolution is assessed for raster images and PSD headers only. Vector files and PDFs are reported as "not assessed" because they can contain embedded images placed at any size. The PPI thresholds (150 / 100 / 72) are product defaults, not universal standards.
- Re-encoded JPG and WebP images (and resized PNGs) drop EXIF and embedded DPI metadata, apply orientation to the pixels, and use sRGB. Images whose profile or colour model would change are kept unchanged instead.
- The visual check is a measurement, not a person: it is deliberately strict, so grainy or very detailed photos often need quality 85–90 and save less (about 25–60%), and lossy WebP never passes for graphics with fine coloured text (WebP always halves colour resolution), which keep their original.
- PNG compression is lossless only. Big lossy PNG savings need colour reduction (the pngquant method), whose library, libimagequant, is GPL-licensed; it is not included.
- The encoders need WebAssembly with `'wasm-unsafe-eval'` support (Chrome and Edge 95+, Firefox 102+, Safari 16+). Older browsers keep the original.
- In-browser PDF savings vary and can be zero; the tool never rasterises or recompresses content.
- Very large files can exceed a device's memory or the 3-minute image timeout: a 64-megapixel grainy photo, the worst case, needs several encodes and checks. Failures are reported and originals kept, but phones manage less than the limits above.
- A refresh clears the session; nothing is persisted.
