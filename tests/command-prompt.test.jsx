// @vitest-environment jsdom
import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPrompt from '../src/components/CommandPrompt.jsx';

/** Reduced motion makes every command complete instantly, which keeps these tests fast. */
function mockReducedMotion(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: matches && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const renderPrompt = (props = {}) => {
  const onAction = vi.fn();
  const onSwitchTheme = vi.fn();
  render(
    <StrictMode>
      <CommandPrompt onAction={onAction} onSwitchTheme={onSwitchTheme} {...props} />
    </StrictMode>,
  );
  const output = screen.getByTestId('prompt-output');
  const input = screen.getByRole('textbox', { name: 'Command' });
  const typeCommand = (text) => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.submit(input.closest('form'));
  };
  return { onAction, onSwitchTheme, output, input, typeCommand };
};

describe('CommandPrompt', () => {
  beforeEach(() => mockReducedMotion(true));
  afterEach(() => {
    delete window.matchMedia;
  });

  it('welcomes the visitor and runs /help once, even under StrictMode', async () => {
    const { output } = renderPrompt();
    expect(output.textContent).toContain('Welcome to Compressive.');
    await waitFor(() => expect(output.textContent).toContain('Start fresh'));
    expect(within(output).getAllByText('/help', { exact: false }).filter((node) => node.textContent.startsWith('> '))).toHaveLength(1);
  });

  it('prints a tool and an action that opens its picker', async () => {
    const { output, onAction } = renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: /^\/zip/ }));
    await waitFor(() => expect(output.textContent).toContain('ZIP maker ready.'));
    fireEvent.click(within(output).getByRole('button', { name: /Choose files to zip/ }));
    expect(onAction).toHaveBeenCalledWith('zip');
  });

  it('understands plain requests, unknown commands and /clear', async () => {
    const { output, typeCommand } = renderPrompt();
    typeCommand('make my holiday photo.jpg smaller');
    await waitFor(() => expect(output.textContent).toContain('Sounds like a job for /jpg (Compress JPG).'));
    typeCommand('compress this svg');
    await waitFor(() => expect(output.textContent).toContain('SVG files are kept exactly as they are'));
    typeCommand('/teleport');
    await waitFor(() => expect(output.textContent).toContain('Unknown command: /teleport'));
    expect(output.textContent).toContain("Try /help to see what's available.");
    typeCommand('/clear');
    await waitFor(() => expect(output.querySelectorAll('p')).toHaveLength(1));
    expect(output.textContent).toContain('All clear. Ready for your next command.');
  });

  it('accepts aliases and connects the theme button', async () => {
    const { output, typeCommand, onSwitchTheme } = renderPrompt();
    typeCommand('/JPEG');
    await waitFor(() => expect(output.textContent).toContain('JPG compressor ready.'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch theme' }));
    expect(onSwitchTheme).toHaveBeenCalledTimes(1);
  });

  it('animates typing and disables the input while a command runs', async () => {
    mockReducedMotion(false);
    vi.useFakeTimers();
    try {
      const { output, input } = renderPrompt();
      fireEvent.click(screen.getByRole('button', { name: /^\/pdf/ }));
      expect(input.disabled).toBe(true);
      vi.advanceTimersByTime(35 * 2);
      expect(input.value.length).toBeGreaterThan(0);
      expect(input.value.length).toBeLessThan('/pdf'.length + 1);
      await vi.runAllTimersAsync();
      expect(output.textContent).toContain('PDF compressor ready.');
      expect(input.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
