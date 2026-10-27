import { describe, expect, it } from 'vitest';
import { interpretRequest, TOOLS } from '../src/ui/tools.js';

const toolFor = (text) => interpretRequest(text)?.tool?.id ?? null;

describe('interpretRequest', () => {
  it('finds tools from file types named in plain language', () => {
    expect(toolFor('compress my png')).toBe('png');
    expect(toolFor('make holiday.JPEG smaller')).toBe('jpg');
    expect(toolFor('shrink this pdf please')).toBe('pdf');
    expect(toolFor('webp')).toBe('webp');
    expect(toolFor('zip these up')).toBe('zip');
    expect(toolFor('will it look ok printed?')).toBe('print');
  });

  it('prefers a named file type over looser hints', () => {
    // "logo" hints at PNG, but the request names a JPG.
    expect(toolFor('my logo.jpg is too big')).toBe('jpg');
    expect(toolFor('compress my logo')).toBe('png');
    expect(toolFor('I have many photos')).toBe('jpg');
  });

  it('recognises file types that are kept unchanged', () => {
    expect(interpretRequest('compress my svg')).toEqual({ keptType: 'svg' });
    expect(interpretRequest('zip my svg files')).toEqual({ tool: TOOLS.find((tool) => tool.id === 'zip') });
  });

  it('returns null when nothing matches', () => {
    expect(interpretRequest('hello there')).toBeNull();
  });

  it('gives every tool a command, label, accent and output', () => {
    for (const tool of TOOLS) {
      expect(tool.command).toMatch(/^\/[a-z]+$/);
      expect(tool.label).toBeTruthy();
      expect(['sky', 'amber', 'coral', 'violet', 'mint']).toContain(tool.accent);
      expect(tool.output.length).toBeGreaterThan(0);
      expect(tool.action === 'print' || typeof tool.accept === 'string').toBe(true);
    }
  });
});
