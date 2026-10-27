import { describe, expect, it } from 'vitest';
import {
  archiveFileName,
  assignEntryNames,
  getExtension,
  preparedFileName,
  sanitizeEntryName,
  splitName,
} from '../src/engine/filenames.js';

describe('getExtension', () => {
  it('uses the final extension, case-insensitively', () => {
    expect(getExtension('Logo.AI')).toBe('ai');
    expect(getExtension('archive.tar.EPS')).toBe('eps');
    expect(getExtension('.svg')).toBe('svg');
    expect(getExtension('no-extension')).toBe('');
    expect(getExtension('trailing.')).toBe('');
  });
});

describe('sanitizeEntryName', () => {
  it('removes path traversal, separators and absolute paths', () => {
    expect(sanitizeEntryName('../../etc/passwd.png')).toBe('.._.._etc_passwd.png');
    expect(sanitizeEntryName('C:\\Users\\me\\logo.svg')).toBe('C__Users_me_logo.svg');
    expect(sanitizeEntryName('/absolute/path/art.ai')).toBe('_absolute_path_art.ai');
    expect(sanitizeEntryName('..')).toBe('_');
    for (const name of ['../../etc/passwd.png', 'C:\\Users\\me\\logo.svg', '/absolute/path/art.ai']) {
      const safe = sanitizeEntryName(name);
      expect(safe).not.toMatch(/[\\/:]/);
      expect(safe.split('/').includes('..')).toBe(false);
    }
  });

  it('strips control characters and Windows-reserved characters', () => {
    expect(sanitizeEntryName('ban\u0000ner\u0007\r\n.png')).toBe('banner.png');
    expect(sanitizeEntryName('what?<>|*".jpg')).toBe('what______.jpg');
    expect(sanitizeEntryName('CON.eps')).toBe('_CON.eps');
    expect(sanitizeEntryName('lpt1.pdf')).toBe('_lpt1.pdf');
  });

  it('keeps readable Unicode (normalised to NFC) and the extension', () => {
    expect(sanitizeEntryName('Cafe\u0301 Ünïcødé 横断幕.PNG')).toBe('Café Ünïcødé 横断幕.PNG');
    expect(sanitizeEntryName('.ai')).toBe('file.ai');
  });

  it('truncates long names without splitting emoji or losing the extension', () => {
    const long = `${'🎨'.repeat(150)}.svg`;
    const safe = sanitizeEntryName(long);
    expect(safe.endsWith('.svg')).toBe(true);
    expect(safe.length).toBeLessThanOrEqual(180);
    expect(safe.replace('.svg', '')).toMatch(/^(🎨)+$/u);
  });
});

describe('assignEntryNames', () => {
  it('renames duplicates deterministically without overwriting', () => {
    const result = assignEntryNames(['logo.png', 'Logo.PNG', 'logo (2).png', 'logo.png']);
    expect(result.map((item) => item.entryName)).toEqual(['logo.png', 'Logo (3).PNG', 'logo (2).png', 'logo (4).png']);
    expect(result[1].reasons).toEqual(['duplicate']);
    expect(result[0].changed).toBe(false);
    expect(new Set(result.map((item) => item.entryName.toLowerCase())).size).toBe(4);
    // Same input, same output.
    expect(assignEntryNames(['logo.png', 'Logo.PNG', 'logo (2).png', 'logo.png'])).toEqual(result);
  });

  it('records sanitised names in the source-to-entry mapping', () => {
    const [item] = assignEntryNames(['folder/art.ai']);
    expect(item).toMatchObject({ sourceName: 'folder/art.ai', entryName: 'folder_art.ai', changed: true, reasons: ['sanitized'] });
  });
});

describe('download names', () => {
  it('keeps the original extension spelling for prepared copies', () => {
    expect(preparedFileName('Banner.JPG')).toBe('Banner-prepared.JPG');
    expect(preparedFileName('proof.final.pdf')).toBe('proof.final-prepared.pdf');
    expect(splitName('x.tar.gz')).toEqual({ stem: 'x.tar', ext: 'gz' });
  });

  it('names archives meaningfully', () => {
    expect(archiveFileName(3, new Date(2026, 9, 26))).toBe('compressive-originals-3-files-2026-10-26.zip');
  });
});
