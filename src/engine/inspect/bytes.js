/**
 * Small, allocation-conscious byte helpers. Inspection reads only the slices it
 * needs (`Blob.slice`), so checking a 2 GB file's header costs a few kilobytes.
 */

/**
 * Reads `length` bytes starting at `start`, clamped to the blob size.
 *
 * @param {Blob} blob
 * @param {number} [start]
 * @param {number} [length]
 * @returns {Promise<Uint8Array>}
 */
export async function readBytes(blob, start = 0, length = blob.size - start) {
  const end = Math.min(blob.size, start + Math.max(0, length));
  if (start >= end) return new Uint8Array(0);
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/**
 * @param {Uint8Array} bytes
 * @param {ArrayLike<number>} signature
 * @param {number} [offset]
 */
export function startsWithBytes(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

/**
 * Decodes bytes as Latin-1 (one character per byte). Used for ASCII markers.
 *
 * @param {Uint8Array} bytes
 * @param {number} [start]
 * @param {number} [end]
 */
export function latin1(bytes, start = 0, end = bytes.length) {
  let result = '';
  const stop = Math.min(end, bytes.length);
  for (let index = start; index < stop; index += 1) result += String.fromCharCode(bytes[index]);
  return result;
}

/** @param {string} text */
export function asciiBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/**
 * Finds `needle` in `haystack` from `from`. Uses the native TypedArray#indexOf
 * to jump between candidate first bytes, which keeps large PDF scans fast.
 *
 * @param {Uint8Array} haystack
 * @param {Uint8Array} needle
 * @param {number} [from]
 * @returns {number} Index or -1.
 */
export function indexOfBytes(haystack, needle, from = 0) {
  if (needle.length === 0) return from;
  const first = needle[0];
  const last = haystack.length - needle.length;
  let position = haystack.indexOf(first, from);
  while (position !== -1 && position <= last) {
    let match = true;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (haystack[position + offset] !== needle[offset]) {
        match = false;
        break;
      }
    }
    if (match) return position;
    position = haystack.indexOf(first, position + 1);
  }
  return -1;
}

/**
 * Counts non-overlapping occurrences of `needle` (stops at `limit`).
 *
 * @param {Uint8Array} haystack
 * @param {Uint8Array} needle
 * @param {number} [limit]
 */
export function countBytes(haystack, needle, limit = Infinity) {
  let count = 0;
  let position = indexOfBytes(haystack, needle, 0);
  while (position !== -1 && count < limit) {
    count += 1;
    position = indexOfBytes(haystack, needle, position + needle.length);
  }
  return count;
}

/**
 * Compares two byte arrays for exact equality.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
export function bytesEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  // Compare 4 bytes at a time when both views are aligned.
  if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
    const words = Math.floor(a.byteLength / 4);
    const a32 = new Uint32Array(a.buffer, a.byteOffset, words);
    const b32 = new Uint32Array(b.buffer, b.byteOffset, words);
    for (let index = 0; index < words; index += 1) if (a32[index] !== b32[index]) return false;
    for (let index = words * 4; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false;
    return true;
  }
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * Two independent 32-bit FNV-1a hashes combined into a 16-hex-digit digest.
 * Used only to compare a document with itself before and after a rewrite;
 * it is not a security hash.
 */
export class Fingerprint {
  constructor() {
    this.h1 = 0x811c9dc5;
    this.h2 = 0x01000193 ^ 0x5bd1e995;
  }

  /** @param {Uint8Array} bytes */
  addBytes(bytes) {
    let h1 = this.h1;
    let h2 = this.h2;
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index];
      h1 = Math.imul(h1 ^ byte, 0x01000193);
      h2 = Math.imul(h2 ^ byte, 0x01000193) ^ (h2 >>> 15);
    }
    this.h1 = h1;
    this.h2 = h2;
    return this;
  }

  /** @param {string} text */
  addString(text) {
    let h1 = this.h1;
    let h2 = this.h2;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      h1 = Math.imul(h1 ^ (code & 0xff), 0x01000193);
      h1 = Math.imul(h1 ^ (code >>> 8), 0x01000193);
      h2 = Math.imul(h2 ^ code, 0x01000193) ^ (h2 >>> 15);
    }
    this.h1 = h1;
    this.h2 = h2;
    return this;
  }

  digest() {
    return (this.h1 >>> 0).toString(16).padStart(8, '0') + (this.h2 >>> 0).toString(16).padStart(8, '0');
  }
}
