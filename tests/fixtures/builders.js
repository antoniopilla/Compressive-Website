/**
 * Deterministic fixture builders for tests (Node). Every fixture is generated
 * from code, so no customer artwork is ever committed to the repository.
 */

import { crc32, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { degrees, PDFDocument, PDFHexString, PDFName, PDFNumber, StandardFonts, rgb } from 'pdf-lib';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const ascii = (text) => Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
const u16be = (value) => [(value >> 8) & 0xff, value & 0xff];
const u32be = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const u32le = (value) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
const u24le = (value) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];

export function concat(...parts) {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const result = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Builds a File the way browsers hand them to the page. */
export function makeFile(bytes, name, type = '', lastModified = Date.UTC(2026, 0, 15)) {
  return new File([bytes], name, { type, lastModified });
}

/* ------------------------------------------------------------------ ICC */

/**
 * Minimal ICC v2 profile with a 'desc' tag — enough for description parsing.
 *
 * @param {string} description
 * @param {string} colorSpace Four-character signature, e.g. "RGB ".
 */
export function iccProfile(description, colorSpace = 'RGB ') {
  const descText = ascii(`${description}\0`);
  const descTag = concat(ascii('desc'), [0, 0, 0, 0], u32be(descText.length), descText);
  const tagTableOffset = 128;
  const descOffset = tagTableOffset + 4 + 12;
  const size = descOffset + descTag.length;
  const header = new Uint8Array(128);
  header.set(u32be(size), 0);
  header.set(ascii('mntr'), 12);
  header.set(ascii(colorSpace), 16);
  header.set(ascii('XYZ '), 20);
  header.set(ascii('acsp'), 36);
  return concat(header, u32be(1), ascii('desc'), u32be(descOffset), u32be(descTag.length), descTag);
}

/* ------------------------------------------------------------------ PNG */

function pngChunk(type, data = new Uint8Array(0)) {
  const typeBytes = ascii(type);
  const body = concat(typeBytes, data);
  return concat(u32be(data.length), body, u32be(crc32(body) >>> 0));
}

/** TIFF block with a single Orientation tag (big-endian). */
export function tiffOrientation(orientation) {
  return concat(ascii('MM'), u16be(42), u32be(8), u16be(1), u16be(0x0112), u16be(3), u32be(1), u16be(orientation), [0, 0], u32be(0));
}

/**
 * Real, decodable PNG.
 *
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} [options.bitDepth]  8 or 16
 * @param {number} [options.colorType] 2 (RGB) or 6 (RGBA)
 * @param {(x: number, y: number) => number[]} [options.pixel] Channel values per pixel.
 * @param {{ frames: number } } [options.animation]  Adds an acTL chunk (APNG).
 * @param {Uint8Array} [options.icc]   Embeds an iCCP chunk.
 * @param {number} [options.orientation] Adds an eXIf chunk.
 */
export function pngBytes({ width, height, bitDepth = 8, colorType = 6, pixel, animation, icc, orientation }) {
  const channels = colorType === 6 ? 4 : 3;
  const bytesPerSample = bitDepth / 8;
  const rowLength = 1 + width * channels * bytesPerSample;
  const raw = new Uint8Array(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0;
    for (let x = 0; x < width; x += 1) {
      const values = pixel ? pixel(x, y) : [(x * 37) & 0xff, (y * 59) & 0xff, ((x + y) * 13) & 0xff, 255];
      for (let channel = 0; channel < channels; channel += 1) {
        const value = values[channel] ?? 255;
        const offset = y * rowLength + 1 + (x * channels + channel) * bytesPerSample;
        if (bytesPerSample === 2) {
          raw[offset] = value;
          raw[offset + 1] = value;
        } else {
          raw[offset] = value;
        }
      }
    }
  }
  const ihdr = concat(u32be(width), u32be(height), [bitDepth, colorType, 0, 0, 0]);
  const chunks = [pngChunk('IHDR', ihdr)];
  if (icc) chunks.push(pngChunk('iCCP', concat(ascii('profile'), [0, 0], deflateSync(icc))));
  if (orientation) chunks.push(pngChunk('eXIf', tiffOrientation(orientation)));
  if (animation) chunks.push(pngChunk('acTL', concat(u32be(animation.frames), u32be(0))));
  chunks.push(pngChunk('IDAT', deflateSync(raw)));
  chunks.push(pngChunk('IEND'));
  return concat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ...chunks);
}

/* ----------------------------------------------------------------- JPEG */

/**
 * JPEG header structure (SOI, optional APP1 EXIF, APP2 ICC, SOF, SOS, EOI).
 * Not decodable as pixels, but exact for header inspection tests.
 */
export function jpegHeaderBytes({ width, height, components = 3, bitDepth = 8, orientation, icc, iccChunkSize = 40, progressive = false }) {
  const segments = [[0xff, 0xd8]];
  segments.push([0xff, 0xe0, ...u16be(16), ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  if (orientation) {
    const exif = concat(ascii('Exif\0\0'), tiffOrientation(orientation));
    segments.push(concat([0xff, 0xe1], u16be(exif.length + 2), exif));
  }
  if (icc) {
    const chunks = [];
    for (let offset = 0; offset < icc.length; offset += iccChunkSize) chunks.push(icc.subarray(offset, offset + iccChunkSize));
    // Write chunks out of order to prove the parser sorts them by sequence number.
    const order = chunks.map((_, index) => index).reverse();
    for (const index of order) {
      const payload = concat(ascii('ICC_PROFILE\0'), [index + 1, chunks.length], chunks[index]);
      segments.push(concat([0xff, 0xe2], u16be(payload.length + 2), payload));
    }
  }
  const sof = [bitDepth, ...u16be(height), ...u16be(width), components];
  for (let index = 0; index < components; index += 1) sof.push(index + 1, 0x11, 0);
  segments.push(concat([0xff, progressive ? 0xc2 : 0xc0], u16be(sof.length + 2), sof));
  segments.push([0xff, 0xda, ...u16be(8), 1, 1, 0, 0, 0x3f, 0], [0x12, 0x34, 0x56], [0xff, 0xd9]);
  return concat(...segments);
}

/* ----------------------------------------------------------------- WebP */

function riffChunk(fourcc, data) {
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  return concat(ascii(fourcc), u32le(bytes.length), bytes, bytes.length % 2 ? [0] : []);
}

/**
 * WebP container with a VP8, VP8L or VP8X header (header-accurate, not decodable).
 */
export function webpBytes({ kind = 'VP8', width, height, animated = false, alpha = false, icc, orientation }) {
  let body;
  if (kind === 'VP8') {
    body = riffChunk('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f]);
  } else if (kind === 'VP8L') {
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | ((alpha ? 1 : 0) << 28);
    body = riffChunk('VP8L', [0x2f, ...u32le(bits >>> 0), 0, 0, 0]);
  } else {
    const flags = (icc ? 0x20 : 0) | (alpha ? 0x10 : 0) | (orientation ? 0x08 : 0) | (animated ? 0x02 : 0);
    const parts = [riffChunk('VP8X', [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)])];
    if (icc) parts.push(riffChunk('ICCP', icc));
    if (animated) parts.push(riffChunk('ANIM', [0, 0, 0, 0, 0, 0]));
    if (alpha) parts.push(riffChunk('ALPH', [0]));
    parts.push(riffChunk('VP8L', [0x2f, ...u32le((((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)) >>> 0), 0]));
    if (orientation) parts.push(riffChunk('EXIF', tiffOrientation(orientation)));
    body = concat(...parts);
  }
  return concat(ascii('RIFF'), u32le(body.length + 4), ascii('WEBP'), body);
}

/* ------------------------------------------------------------------ PSD */

export function psdBytes({ width, height, colorMode = 3, depth = 8, extraBytes = 2048 }) {
  return concat(ascii('8BPS'), u16be(1), [0, 0, 0, 0, 0, 0], u16be(3), u32be(height), u32be(width), u16be(depth), u16be(colorMode), new Uint8Array(extraBytes));
}

/* --------------------------------------------------------------- Vectors */

/** SVG with metadata, comments, a DOCTYPE-free XML prolog and high-precision paths. */
export function svgWithMetadata() {
  return new TextEncoder().encode(
    '﻿<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      '<!-- Created for Compressive tests -->\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" width="1200.000mm" height="600.000mm" viewBox="0 0 1200.000 600.000">\n' +
      '  <metadata><rdf:RDF><rdf:Description dc:creator="Studio Tests" dc:title="Banner — Ünïcødé"/></rdf:RDF></metadata>\n' +
      '  <defs><linearGradient id="g"><stop offset="0" stop-color="#0057b8"/><stop offset="1" stop-color="#ffd700"/></linearGradient></defs>\n' +
      '  <path d="M 10.123456789 20.987654321 C 100.000000001 200.333333333 300.666666667 -40.5 599.999999999 300.000000001 Z" fill="url(#g)" stroke="#000" stroke-width="0.0001"/>\n' +
      '  <text x="600" y="320" font-family="Inter" font-size="72">Grand opening</text>\n' +
      '</svg>\n',
  );
}

export function epsBytes() {
  return ascii(
    '%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Compressive tests\n%%BoundingBox: 0 0 864 288\n%%HiResBoundingBox: 0.000 0.000 864.000 288.000\n' +
      '%%EndComments\nnewpath 10.5 10.25 moveto 853.75 277.125 lineto 0.01 setlinewidth stroke\n' +
      '/Helvetica findfont 48 scalefont setfont 72 144 moveto (Grand opening) show\nshowpage\n%%EOF\n',
  );
}

/** PDF-compatible Illustrator file: a real PDF with Illustrator-style private data. */
export async function aiPdfCompatibleBytes() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([864, 288]);
  page.drawRectangle({ x: 20, y: 20, width: 824, height: 248, borderColor: rgb(0, 0.34, 0.72), borderWidth: 0.25 });
  const privateData = document.context.flateStream('%AI12_CompressedData Illustrator private editing data '.repeat(200));
  const privateRef = document.context.register(privateData);
  page.node.set(PDFName.of('PieceInfo'), document.context.obj({ Illustrator: { Private: privateRef } }));
  return document.save({ useObjectStreams: false });
}

/* ------------------------------------------------------------------ PDF */

/**
 * Print-style PDF with native text, a vector grid, paths, explicit page boxes
 * and a rotated second page.
 *
 * @param {{ bloatBytes?: number, objectStreams?: boolean, pages?: number }} [options]
 *   bloatBytes adds an unreferenced stream (like leftover editing data).
 */
export async function printPdfBytes({ bloatBytes = 0, objectStreams = false, pages = 2 } = {}) {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.setTitle('Banner proof');
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([2592, 864]); // 36 × 12 in
    page.setBleedBox(-9, -9, 2610, 882);
    page.setTrimBox(0, 0, 2592, 864);
    page.setArtBox(36, 36, 2520, 792);
    for (let x = 0; x <= 2592; x += 72) {
      page.drawLine({ start: { x, y: 0 }, end: { x, y: 864 }, thickness: 0.1, color: rgb(0.8, 0.8, 0.8) });
    }
    for (let y = 0; y <= 864; y += 72) {
      page.drawLine({ start: { x: 0, y }, end: { x: 2592, y }, thickness: 0.1, color: rgb(0.8, 0.8, 0.8) });
    }
    page.drawSvgPath('M 0 0 C 120.125 -40.0625 300.5 80.25 600 0 L 600 -200 Z', {
      x: 200,
      y: 600,
      color: rgb(0, 0.34, 0.72),
    });
    page.drawText(`Grand opening — page ${index + 1}`, { x: 300, y: 400, size: 96, font, color: rgb(0.1, 0.1, 0.1) });
    if (index === 1) page.setRotation(degrees(90));
  }
  if (bloatBytes) {
    const junk = new Uint8Array(bloatBytes);
    for (let index = 0; index < junk.length; index += 1) junk[index] = (index * 31 + 7) & 0xff;
    document.context.register(document.context.stream(junk));
  }
  return document.save({ useObjectStreams: objectStreams });
}

/**
 * Appends a classic incremental update that redefines objects and points its
 * trailer at the previous cross-reference section.
 *
 * @param {Uint8Array} bytes  A PDF written with a classic xref table.
 * @param {{ number: number, body: string }[]} objects
 * @param {string} [extraTrailer] Additional trailer entries, e.g. "/Encrypt 99 0 R".
 */
export function appendIncrementalUpdate(bytes, objects, extraTrailer = '') {
  const text = Buffer.from(bytes).toString('latin1');
  const previousXref = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split(/\s+/)[0]);
  const trailerStart = text.lastIndexOf('trailer');
  const trailer = text.slice(trailerStart, text.lastIndexOf('startxref'));
  const size = Number(trailer.match(/\/Size\s+(\d+)/)[1]);
  const root = trailer.match(/\/Root\s+(\d+\s+\d+\s+R)/)[1];
  const info = trailer.match(/\/Info\s+(\d+\s+\d+\s+R)/)?.[1];

  let body = '\n';
  const offsets = [];
  for (const object of objects) {
    offsets.push({ number: object.number, offset: bytes.length + Buffer.byteLength(body, 'latin1') });
    body += `${object.number} 0 obj\n${object.body}\nendobj\n`;
  }
  const xrefOffset = bytes.length + Buffer.byteLength(body, 'latin1');
  const newSize = Math.max(size, ...objects.map((object) => object.number + 1));
  let xref = 'xref\n0 1\n0000000000 65535 f \n';
  for (const { number, offset } of offsets) xref += `${number} 1\n${String(offset).padStart(10, '0')} 00000 n \n`;
  const trailerText =
    `trailer\n<< /Size ${newSize} /Root ${root}${info ? ` /Info ${info}` : ''} /Prev ${previousXref} ${extraTrailer} >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return concat(bytes, Buffer.from(body + xref + trailerText, 'latin1'));
}

/** Adds an incremental update that makes the document look encrypted. */
export function encryptedPdf(bytes) {
  return appendIncrementalUpdate(
    bytes,
    [{ number: 900, body: '<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <00> /U <00> >>' }],
    '/Encrypt 900 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>]',
  );
}

/** Builds a PDF with a signature field and signature dictionary. */
export async function signedPdfBytes({ objectStreams = false } = {}) {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([612, 792]);
  const context = document.context;
  const signature = context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 100, 200, 300],
    Contents: PDFHexString.of('00'.repeat(64)),
  });
  const signatureRef = context.register(signature);
  const field = context.obj({ FT: 'Sig', T: PDFHexString.fromText('Signature1'), V: signatureRef, Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 0, 0] });
  const fieldRef = context.register(field);
  document.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [fieldRef], SigFlags: PDFNumber.of(3) }));
  return document.save({ useObjectStreams: objectStreams });
}

/** PDF that declares PDF/X conformance through an output intent. */
export async function pdfxBytes({ objectStreams = false } = {}) {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([612, 792]);
  const intent = document.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: PDFHexString.fromText('FOGRA39') });
  document.catalog.set(PDFName.of('OutputIntents'), document.context.obj([document.context.register(intent)]));
  return document.save({ useObjectStreams: objectStreams });
}

/**
 * Hand-written PDF (not produced by pdf-lib) with an indirect /Length, native
 * text with a standard font and a vector path.
 */
export function handwrittenPdfWithIndirectLength({ junkObjects = 0 } = {}) {
  const content = 'q 0.2 w 0 0 1 RG 72 72 m 540 720 l S Q BT /F1 36 Tf 100 400 Td (Native text survives) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /TrimBox [9 9 603 783] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length 6 0 R >>\nstream\n${content}\nendstream`,
    String(content.length),
  ];
  for (let index = 0; index < junkObjects; index += 1) {
    objects.push(`<< /Length ${2000} >>\nstream\n${'J'.repeat(2000)}\nendstream`);
  }
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** Random bytes (incompressible), deterministic. */
export function noiseBytes(length, seed = 1) {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}
