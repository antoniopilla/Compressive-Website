/**
 * PDF Structural Optimizer (runs inside pdf.worker.js).
 *
 * What it does — and only this:
 *  1. Parses the PDF with pdf-lib. pdf-lib reads every revision and keeps the
 *     latest definition of each object, so redundant incremental-update
 *     revisions are merged.
 *  2. Removes objects that are not reachable from the document catalog or the
 *     Info dictionary (by definition unused by any PDF reader).
 *  3. Writes the document again with compressed object streams.
 *
 * What it never does: render pages to images, rasterise or flatten content,
 * re-encode content streams, fonts or images, regenerate form appearances,
 * update metadata, or delete objects that are still referenced. Text, fonts,
 * vector paths, page boxes and rotation are carried over as-is, and this is
 * verified after writing (below).
 *
 * pdf-lib limitations (documented, not hidden):
 *  - It always writes a "%PDF-1.7" header and rebuilds the trailer (keeping
 *    Root, Info and ID; other trailer keys are dropped).
 *  - It does not decompress/recompress streams, deduplicate identical
 *    resources or remove application-private data that is still referenced
 *    (for example Illustrator's private data inside a PDF), so savings vary
 *    and can be zero. It cannot guarantee removal of all editing history.
 *  - It reads objects in file order rather than via the cross-reference table;
 *    ambiguous files are therefore kept unchanged (see pdf-scan.js).
 *
 * The original is kept for: encrypted or password-protected files (never
 * opened with `ignoreEncryption`), signed files or files with usage rights,
 * PDF/X and PDF/A files, PDF 2.0 files, XFA forms, malformed or ambiguous
 * structures, parse/write failures, timeouts, failed verification, and
 * rewrites that do not save a worthwhile amount.
 *
 * Verification: before writing, every reachable object is fingerprinted
 * (dictionary values plus raw stream bytes). The written file is parsed again
 * and every object must produce an identical fingerprint, the page count must
 * match, and every page's MediaBox, CropBox, BleedBox, TrimBox, ArtBox and
 * rotation must match. Any difference keeps the original.
 */

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from 'pdf-lib';
import { Fingerprint, latin1 } from '../inspect/bytes.js';
import { scanPdfBytes } from '../inspect/pdf-scan.js';
import { formatBytes, formatNumber, formatPercent } from '../format.js';

const NAME = {
  AcroForm: PDFName.of('AcroForm'),
  ByteRange: PDFName.of('ByteRange'),
  Count: PDFName.of('Count'),
  DocTimeStamp: PDFName.of('DocTimeStamp'),
  FT: PDFName.of('FT'),
  GTS_PDFA1: PDFName.of('GTS_PDFA1'),
  GTS_PDFX: PDFName.of('GTS_PDFX'),
  Image: PDFName.of('Image'),
  Metadata: PDFName.of('Metadata'),
  OutputIntents: PDFName.of('OutputIntents'),
  Pages: PDFName.of('Pages'),
  Perms: PDFName.of('Perms'),
  S: PDFName.of('S'),
  Sig: PDFName.of('Sig'),
  SigFlags: PDFName.of('SigFlags'),
  Subtype: PDFName.of('Subtype'),
  Type: PDFName.of('Type'),
  V: PDFName.of('V'),
  XFA: PDFName.of('XFA'),
};

const MESSAGES = {
  malformed:
    'This PDF could not be read reliably. It may be damaged or use features that cannot be rewritten safely.',
  encrypted: 'This PDF is password-protected or encrypted. It is not decrypted or rewritten.',
  signed:
    'This PDF is digitally signed or carries usage rights. Rewriting it would invalidate the signature.',
  conformance:
    'This PDF declares PDF/X or PDF/A conformance. Rewriting changes its PDF version and could break that conformance.',
  version: 'This PDF uses version 2.0. The rewrite tool writes version 1.7 files.',
  xfa: 'This PDF contains an XFA form, which this tool does not rewrite.',
  noPages: 'This PDF has no pages.',
  pageTree: "This PDF's page list is inconsistent.",
  ambiguous: 'This PDF defines some objects more than once without an update history, so its structure is ambiguous.',
  rewriteFailed: 'The PDF could not be rewritten safely.',
};

/**
 * @param {{ file: Blob, policy: typeof import('../policy.js').PDF_POLICY }} payload
 * @param {import('../worker-protocol.js').TaskContext} context
 */
export async function rewritePdf(payload, context) {
  const { file, policy } = payload;
  context.onProgress({ phase: 'reading', fraction: 0.02 });
  const original = new Uint8Array(await file.arrayBuffer());
  const scan = scanPdfBytes(original);
  const stats = {
    originalBytes: original.length,
    versionBefore: scan.version,
    revisions: scan.revisions,
    linearized: scan.linearized,
    pageCount: null,
    objectsBefore: null,
    objectsAfter: null,
    prunedObjects: null,
    embeddedImages: null,
    firstPage: null,
  };
  const keep = (reasonCode, message) => ({
    outcome: 'kept-original',
    reasonCode,
    message: `${message} Your original is kept unchanged.`,
    stats,
  });

  if (scan.headerOffset < 0) return keep('malformed', MESSAGES.malformed);
  if (scan.signatureMarkers) return keep('signed', MESSAGES.signed);
  if (scan.pdfxMarker || scan.pdfaMarker) return keep('conformance', MESSAGES.conformance);
  if (scan.version && Number(scan.version) >= 2) return keep('pdf-version', MESSAGES.version);
  if (scan.xfaMarker) return keep('xfa', MESSAGES.xfa);
  if (scan.duplicateObjectNumbers > 0 && scan.revisions === 1) return keep('ambiguous-structure', MESSAGES.ambiguous);
  context.throwIfCanceled();

  const loadOptions = {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: true,
    capNumbers: false,
    parseSpeed: policy.objectsPerTick,
  };

  // The parsed document lives only inside parseAndRewrite, so its object graph
  // can be garbage-collected before the rewritten copy is parsed for checking.
  const rewrite = await parseAndRewrite(original, loadOptions, policy, stats, context);
  if (rewrite.keep) return keep(rewrite.keep.reasonCode, rewrite.keep.message);
  const { rewritten, before } = rewrite;
  context.throwIfCanceled();

  context.onProgress({ phase: 'verifying', fraction: 0.7 });
  let after;
  try {
    const reloaded = await PDFDocument.load(rewritten, loadOptions);
    after = snapshotDocument(reloaded);
  } catch {
    return keep('verification-failed', 'The rewritten copy could not be read back for checking.');
  }
  const differences = compareSnapshots(before, after);
  if (differences.length) {
    return keep('verification-failed', `The rewritten copy did not pass the safety checks (${differences[0]}).`);
  }
  stats.objectsAfter = after.objects.size;

  const saving = original.length - rewritten.length;
  if (saving < Math.max(policy.minSavingBytes, original.length * policy.minSavingRatio)) {
    return keep(
      'no-useful-saving',
      saving > 0
        ? `Tidying would save only ${formatBytes(saving)} (${formatPercent(saving / original.length)}).`
        : 'Tidying would not make this PDF smaller.',
    );
  }

  context.onProgress({ phase: 'verifying', fraction: 1 });
  const notes = ['Rewritten with compact object streams.'];
  if (scan.revisions > 1 && !scan.linearized) notes.push(`${scan.revisions} saved revisions were merged into one.`);
  if (stats.prunedObjects) notes.push(`${formatNumber(stats.prunedObjects)} unused internal objects were removed.`);
  notes.push('Text, fonts, vector paths, page sizes and rotation were checked and are unchanged.');
  return {
    outcome: 'optimized',
    reasonCode: 'rewritten',
    message: notes.join(' '),
    bytes: rewritten,
    stats,
    transfer: [rewritten.buffer],
  };
}

/**
 * Parses, checks, prunes, fingerprints and writes the document.
 *
 * @param {Uint8Array} original
 * @param {object} loadOptions
 * @param {typeof import('../policy.js').PDF_POLICY} policy
 * @param {Record<string, any>} stats  Filled in place.
 * @param {import('../worker-protocol.js').TaskContext} context
 * @returns {Promise<{ keep: { reasonCode: string, message: string } } | { keep?: undefined, rewritten: Uint8Array, before: ReturnType<typeof snapshotDocument> }>}
 */
async function parseAndRewrite(original, loadOptions, policy, stats, context) {
  context.onProgress({ phase: 'parsing', fraction: 0.1 });
  let document;
  try {
    document = await PDFDocument.load(original, loadOptions);
  } catch (error) {
    if (error?.name === 'EncryptedPDFError' || /encrypt/i.test(String(error?.message))) {
      return { keep: { reasonCode: 'encrypted', message: MESSAGES.encrypted } };
    }
    return { keep: { reasonCode: 'malformed', message: MESSAGES.malformed } };
  }
  if (document.isEncrypted) return { keep: { reasonCode: 'encrypted', message: MESSAGES.encrypted } };
  context.throwIfCanceled();

  let before;
  try {
    const structural = inspectStructure(document);
    if (structural) return { keep: structural };

    context.onProgress({ phase: 'checking', fraction: 0.3 });
    stats.objectsBefore = document.context.enumerateIndirectObjects().length;
    // pdf-lib's writer rewrites every stream's /Length as a direct number.
    // Doing it first lets now-unused indirect length objects be pruned and
    // makes the before/after fingerprints comparable.
    normalizeStreamLengths(document.context);
    const reachable = collectReachable(document.context);
    stats.prunedObjects = pruneUnreachable(document.context, reachable);
    before = snapshotDocument(document);
    stats.pageCount = before.pages.length;
    stats.embeddedImages = before.imageCount;
    stats.firstPage = before.firstPage;
  } catch {
    return { keep: { reasonCode: 'malformed', message: MESSAGES.malformed } };
  }
  context.throwIfCanceled();

  context.onProgress({ phase: 'writing', fraction: 0.45 });
  try {
    const rewritten = await document.save({
      useObjectStreams: true,
      addDefaultPage: false,
      updateFieldAppearances: false,
      objectsPerTick: policy.objectsPerTick,
    });
    return { rewritten, before };
  } catch {
    return { keep: { reasonCode: 'rewrite-failed', message: MESSAGES.rewriteFailed } };
  }
}

/**
 * Parse-level safety checks. Returns a reason to keep the original, or null.
 *
 * @param {PDFDocument} document
 */
function inspectStructure(document) {
  const { catalog, context } = document;
  if (catalog.has(NAME.Perms)) return { reasonCode: 'signed', message: MESSAGES.signed };

  const acroForm = catalog.lookup(NAME.AcroForm);
  if (acroForm instanceof PDFDict) {
    const sigFlags = acroForm.lookup(NAME.SigFlags);
    if (sigFlags instanceof PDFNumber && sigFlags.asNumber() > 0) return { reasonCode: 'signed', message: MESSAGES.signed };
    if (acroForm.has(NAME.XFA)) return { reasonCode: 'xfa', message: MESSAGES.xfa };
  }

  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : null;
    if (!dict) continue;
    const type = dict.get(NAME.Type);
    if (dict.has(NAME.ByteRange) || type === NAME.Sig || type === NAME.DocTimeStamp) {
      return { reasonCode: 'signed', message: MESSAGES.signed };
    }
    if (dict.get(NAME.FT) === NAME.Sig && dict.has(NAME.V)) return { reasonCode: 'signed', message: MESSAGES.signed };
  }

  const intents = catalog.lookup(NAME.OutputIntents);
  if (intents instanceof PDFArray) {
    for (const item of intents.asArray()) {
      const intent = context.lookup(item);
      const subtype = intent instanceof PDFDict ? intent.get(NAME.S) : null;
      if (subtype === NAME.GTS_PDFX || subtype === NAME.GTS_PDFA1) {
        return { reasonCode: 'conformance', message: MESSAGES.conformance };
      }
    }
  }
  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof PDFDict && info.keys().some((key) => key.asString().startsWith('/GTS_PDFX'))) {
    return { reasonCode: 'conformance', message: MESSAGES.conformance };
  }
  const metadata = catalog.lookup(NAME.Metadata);
  if (metadata instanceof PDFRawStream) {
    let xmp;
    try {
      xmp = latin1(decodePDFRawStream(metadata).decode());
    } catch {
      xmp = latin1(metadata.getContents());
    }
    if (/pdfaid:part|pdfxid:|GTS_PDFXVersion/i.test(xmp)) return { reasonCode: 'conformance', message: MESSAGES.conformance };
  }

  const pageCount = document.getPageCount();
  if (pageCount === 0) return { reasonCode: 'no-pages', message: MESSAGES.noPages };
  const pages = catalog.lookup(NAME.Pages);
  const declared = pages instanceof PDFDict ? pages.lookup(NAME.Count) : null;
  if (!(declared instanceof PDFNumber) || declared.asNumber() !== pageCount) {
    return { reasonCode: 'page-tree-inconsistent', message: MESSAGES.pageTree };
  }
  return null;
}

/** @param {import('pdf-lib').PDFContext} context */
function normalizeStreamLengths(context) {
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFStream) object.updateDict();
  }
}

/**
 * Collects every indirect object reachable from the trailer's Root and Info.
 * Iterative, so long chains (outlines, threads) cannot overflow the stack.
 *
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Set<string>} Keys in "N G" form.
 */
function collectReachable(context) {
  const reachable = new Set();
  const pending = [context.trailerInfo.Root, context.trailerInfo.Info];
  while (pending.length) {
    const value = pending.pop();
    if (!value) continue;
    if (value instanceof PDFRef) {
      const key = `${value.objectNumber} ${value.generationNumber}`;
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(value);
      if (target !== undefined) pending.push(target);
    } else if (value instanceof PDFDict) {
      for (const [, entry] of value.entries()) pending.push(entry);
    } else if (value instanceof PDFArray) {
      for (const entry of value.asArray()) pending.push(entry);
    } else if (value instanceof PDFStream) {
      pending.push(value.dict);
    }
  }
  return reachable;
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {Set<string>} reachable
 */
function pruneUnreachable(context, reachable) {
  let pruned = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(`${ref.objectNumber} ${ref.generationNumber}`)) {
      context.delete(ref);
      pruned += 1;
    }
  }
  return pruned;
}

/**
 * @param {Fingerprint} fingerprint
 * @param {unknown} value
 */
function addValue(fingerprint, value) {
  if (value instanceof PDFRef) {
    fingerprint.addString(`R${value.objectNumber}.${value.generationNumber};`);
  } else if (value instanceof PDFStream) {
    addValue(fingerprint, value.dict);
    fingerprint.addString('stream');
    fingerprint.addBytes(value.getContents());
  } else if (value instanceof PDFDict) {
    const entries = value
      .entries()
      .map(([key, entry]) => [key.asString(), entry])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    fingerprint.addString(`<<${entries.length}`);
    for (const [key, entry] of entries) {
      fingerprint.addString(key);
      addValue(fingerprint, entry);
    }
    fingerprint.addString('>>');
  } else if (value instanceof PDFArray) {
    const items = value.asArray();
    fingerprint.addString(`[${items.length}`);
    for (const item of items) addValue(fingerprint, item);
    fingerprint.addString(']');
  } else {
    fingerprint.addString(`${String(value)};`);
  }
}

/**
 * Fingerprints every reachable object and records page geometry.
 *
 * @param {PDFDocument} document
 */
function snapshotDocument(document) {
  const { context } = document;
  const reachable = collectReachable(context);
  const objects = new Map();
  let imageCount = 0;
  for (const key of reachable) {
    const [objectNumber, generationNumber] = key.split(' ').map(Number);
    const object = context.lookup(PDFRef.of(objectNumber, generationNumber));
    if (object === undefined) continue;
    if (object instanceof PDFStream && object.dict.get(NAME.Subtype) === NAME.Image) imageCount += 1;
    const fingerprint = new Fingerprint();
    addValue(fingerprint, object);
    objects.set(key, fingerprint.digest());
  }

  const box = (rectangle) => [rectangle.x, rectangle.y, rectangle.width, rectangle.height].map((n) => +n.toFixed(4)).join(',');
  const pages = document.getPages().map((page) => ({
    mediaBox: box(page.getMediaBox()),
    cropBox: box(page.getCropBox()),
    bleedBox: box(page.getBleedBox()),
    trimBox: box(page.getTrimBox()),
    artBox: box(page.getArtBox()),
    rotation: page.getRotation().angle,
  }));

  let firstPage = null;
  const first = document.getPages()[0];
  if (first) {
    const trim = first.getTrimBox();
    const quarterTurn = Math.abs(first.getRotation().angle) % 180 === 90;
    firstPage = {
      widthPt: quarterTurn ? trim.height : trim.width,
      heightPt: quarterTurn ? trim.width : trim.height,
      rotation: first.getRotation().angle,
    };
  }
  return { objects, pages, imageCount, firstPage };
}

/**
 * @param {ReturnType<typeof snapshotDocument>} before
 * @param {ReturnType<typeof snapshotDocument>} after
 * @returns {string[]} Human-readable differences (empty when identical).
 */
function compareSnapshots(before, after) {
  const differences = [];
  if (before.pages.length !== after.pages.length) {
    differences.push(`page count changed from ${before.pages.length} to ${after.pages.length}`);
  }
  before.pages.forEach((page, index) => {
    const other = after.pages[index];
    if (!other) return;
    for (const key of Object.keys(page)) {
      if (page[key] !== other[key]) differences.push(`page ${index + 1} ${key} changed`);
    }
  });
  if (before.objects.size !== after.objects.size) {
    differences.push(`object count changed from ${before.objects.size} to ${after.objects.size}`);
  }
  for (const [key, digest] of before.objects) {
    if (differences.length >= 5) break;
    const other = after.objects.get(key);
    if (other === undefined) differences.push(`object ${key} is missing`);
    else if (other !== digest) differences.push(`object ${key} changed`);
  }
  return differences;
}
