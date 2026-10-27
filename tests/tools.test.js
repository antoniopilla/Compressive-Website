import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/ui/tools.js';
import { ACCEPT } from '../src/ui/files.js';

describe('TOOLS', () => {
  it('gives every tool a label, a hint and either a picker or the print check', () => {
    for (const tool of TOOLS) {
      expect(tool.label).toBeTruthy();
      expect(tool.hint).toBeTruthy();
      expect(tool.action === 'print' || typeof tool.accept === 'string').toBe(true);
    }
    expect(new Set(TOOLS.map((tool) => tool.id)).size).toBe(TOOLS.length);
  });

  it('opens single-file pickers for compressors and a multi-file picker for zipping', () => {
    const byId = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool]));
    expect(byId.png).toMatchObject({ accept: '.png', multiple: false, replace: true });
    expect(byId.jpg).toMatchObject({ accept: '.jpg,.jpeg', multiple: false, replace: true });
    expect(byId.pdf).toMatchObject({ accept: '.pdf', multiple: false, replace: true });
    expect(byId.zip).toMatchObject({ accept: ACCEPT, multiple: true, replace: false });
    expect(byId.print.action).toBe('print');
  });
});
