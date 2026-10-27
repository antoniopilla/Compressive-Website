import { describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { rewritePdf } from '../src/engine/tasks/pdf-task.js';
import { scanPdfBytes, countDuplicateObjectHeaders } from '../src/engine/inspect/pdf-scan.js';
import { PDF_POLICY } from '../src/engine/policy.js';
import {
  appendIncrementalUpdate,
  concat,
  encryptedPdf,
  handwrittenPdfWithIndirectLength,
  makeFile,
  pdfxBytes,
  printPdfBytes,
  signedPdfBytes,
} from './fixtures/builders.js';

const context = () => ({ onProgress() {}, isCanceled: () => false, throwIfCanceled() {} });
const run = (bytes) => rewritePdf({ file: makeFile(bytes, 'doc.pdf', 'application/pdf'), policy: PDF_POLICY }, context());

/** Summarises what must survive a rewrite: geometry, text/vector content and fonts. */
async function describePdf(bytes) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFRawStream ? [contents] : contents.asArray().map((ref) => document.context.lookup(ref));
    const contentBytes = concat(...streams.map((stream) => decodePDFRawStream(stream).decode()));
    const fonts = page.node.Resources().lookup(PDFName.of('Font'));
    return {
      mediaBox: page.getMediaBox(),
      trimBox: page.getTrimBox(),
      bleedBox: page.getBleedBox(),
      artBox: page.getArtBox(),
      rotation: page.getRotation().angle,
      content: Buffer.from(contentBytes).toString('latin1'),
      fonts: fonts ? fonts.keys().map((key) => key.asString()) : [],
    };
  });
}

describe('PDF structural rewrite', () => {
  it('removes unused data while preserving text, vectors, fonts and page geometry', async () => {
    const original = await printPdfBytes({ bloatBytes: 400_000 });
    const result = await run(original);
    expect(result.outcome).toBe('optimized');
    expect(result.bytes.length).toBeLessThan(original.length - 300_000);
    expect(result.stats.prunedObjects).toBeGreaterThanOrEqual(1);
    expect(result.stats.pageCount).toBe(2);
    expect(result.stats.firstPage).toMatchObject({ widthPt: 2592, heightPt: 864 });
    expect(result.transfer).toEqual([result.bytes.buffer]);

    const before = await describePdf(original);
    const after = await describePdf(result.bytes);
    expect(after).toEqual(before);
    expect(after[0].content).toContain('Tj'); // native text operators are still there
    expect(after[0].content).toMatch(/ c\n/); // Bézier path segments
    expect(after[1].rotation).toBe(90);
    expect(after[0].fonts.length).toBe(1);
    expect(new TextDecoder().decode(result.bytes.subarray(0, 8))).toBe('%PDF-1.7');
  });

  it('merges incremental-update revisions', async () => {
    const base = await printPdfBytes({ pages: 1 });
    const document = await PDFDocument.load(base, { updateMetadata: false });
    const infoRef = document.context.trailerInfo.Info;
    let updated = base;
    for (let revision = 0; revision < 3; revision += 1) {
      updated = appendIncrementalUpdate(updated, [
        { number: infoRef.objectNumber, body: `<< /Title (Revision ${revision}) /Notes (${'x'.repeat(3000)}) >>` },
        { number: 500 + revision, body: `<< /Length 6000 >>\nstream\n${'R'.repeat(6000)}\nendstream` },
      ]);
    }
    expect(scanPdfBytes(updated).revisions).toBe(4);
    const result = await run(updated);
    expect(result.outcome).toBe('optimized');
    expect(result.message).toMatch(/4 saved revisions were merged/);
    const reloaded = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(reloaded.getTitle()).toBe('Revision 2');
    expect(await describePdf(result.bytes)).toEqual(await describePdf(base));
  });

  it('handles indirect stream lengths written by other producers', async () => {
    const original = handwrittenPdfWithIndirectLength({ junkObjects: 6 });
    const result = await run(original);
    expect(result.outcome).toBe('optimized');
    const [page] = await describePdf(result.bytes);
    expect(page.content).toContain('(Native text survives) Tj');
    expect(page.trimBox).toMatchObject({ x: 9, y: 9, width: 594, height: 774 });
  });

  it('keeps the original when the saving is not worthwhile', async () => {
    const compact = await printPdfBytes({ pages: 1, objectStreams: true });
    const result = await run(compact);
    expect(result).toMatchObject({ outcome: 'kept-original', reasonCode: 'no-useful-saving' });
    expect(result.bytes).toBeUndefined();
  });

  it('never opens encrypted documents', async () => {
    const result = await run(encryptedPdf(await printPdfBytes({ pages: 1 })));
    expect(result).toMatchObject({ outcome: 'kept-original', reasonCode: 'encrypted' });
    expect(result.message).toMatch(/password-protected or encrypted/);
  });

  it('keeps signed documents, whether the signature is visible in raw bytes or inside object streams', async () => {
    const plain = await signedPdfBytes();
    expect(scanPdfBytes(plain).signatureMarkers).toBe(true);
    expect(await run(plain)).toMatchObject({ outcome: 'kept-original', reasonCode: 'signed' });

    const compressed = await signedPdfBytes({ objectStreams: true });
    expect(scanPdfBytes(compressed).signatureMarkers).toBe(false);
    expect(await run(compressed)).toMatchObject({ outcome: 'kept-original', reasonCode: 'signed' });
  });

  it('keeps PDF/X documents and PDF 2.0 documents', async () => {
    expect(await run(await pdfxBytes())).toMatchObject({ reasonCode: 'conformance' });
    expect(await run(await pdfxBytes({ objectStreams: true }))).toMatchObject({ reasonCode: 'conformance' });
    const modern = await printPdfBytes({ pages: 1, bloatBytes: 50_000 });
    modern.set(new TextEncoder().encode('%PDF-2.0'), 0);
    expect(await run(modern)).toMatchObject({ reasonCode: 'pdf-version' });
  });

  it('keeps malformed, truncated and ambiguous documents', async () => {
    expect(await run(new TextEncoder().encode('not a pdf at all'))).toMatchObject({ reasonCode: 'malformed' });
    const garbage = concat(new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 9 0 R'), new Uint8Array(100));
    expect((await run(garbage)).outcome).toBe('kept-original');
    const full = await printPdfBytes({ pages: 1, bloatBytes: 50_000 });
    expect((await run(full.subarray(0, Math.floor(full.length / 3)))).outcome).toBe('kept-original');

    const ambiguous = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
    expect(countDuplicateObjectHeaders(ambiguous)).toBe(1);
    expect(await run(ambiguous)).toMatchObject({ reasonCode: 'ambiguous-structure' });
  });

  it('keeps documents without pages', async () => {
    const document = await PDFDocument.create({ updateMetadata: false });
    document.context.register(document.context.stream(new Uint8Array(20_000)));
    const bytes = await document.save({ addDefaultPage: false, useObjectStreams: false });
    expect(await run(bytes)).toMatchObject({ reasonCode: 'no-pages' });
  });
});
