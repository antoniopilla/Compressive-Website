// @vitest-environment jsdom
import { StrictMode, useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createStudioHolder, useFileStudio } from '../src/hooks/useFileStudio.js';
import { createDownloadManager, useDownloads } from '../src/hooks/useDownloads.js';
import DropZone from '../src/components/DropZone.jsx';
import { readDroppedItems } from '../src/ui/files.js';
import { epsBytes } from './fixtures/builders.js';

/** Builds a File in the test environment. */
const nodeFile = (bytes, name, type = '') => new File([bytes], name, { type });

describe('createStudioHolder', () => {
  it('creates a fresh engine on each attach and disposes it on detach', () => {
    const holder = createStudioHolder();
    holder.attach();
    const first = holder.getStudio();
    expect(first).not.toBeNull();
    holder.detach();
    expect(holder.getStudio()).toBeNull(); // nothing is re-created after unmount
    holder.attach();
    expect(holder.getStudio()).not.toBe(first);
    holder.detach();
  });

  it('keeps files chosen before the mount effect has run', async () => {
    const holder = createStudioHolder();
    const early = holder.getStudio(); // an action arriving before attach()
    await early.addFiles([nodeFile(epsBytes(), 'early.eps')]);
    holder.attach();
    expect(holder.getStudio()).toBe(early);
    expect(holder.getSnapshot().selection.map((entry) => entry.name)).toEqual(['early.eps']);
    holder.detach();
  });
});

describe('useFileStudio under StrictMode', () => {
  it('keeps one live engine after the double mount and releases it on unmount', async () => {
    let captured;
    function Probe() {
      const { snapshot, actions } = useFileStudio();
      useEffect(() => {
        captured = actions;
      });
      return <p data-testid="count">{snapshot.selection.length}</p>;
    }
    const view = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await act(async () => {
      await captured.addFiles([nodeFile(epsBytes(), 'logo.eps')]);
    });
    expect(screen.getByTestId('count').textContent).toBe('1');

    view.unmount();
    // After unmount the engine is disposed; actions become harmless no-ops.
    expect(captured.removeFile('anything')).toBeUndefined();
    await expect(captured.prepare()).resolves.toBeNull();
  });
});

describe('download object URLs', () => {
  it('creates URLs on demand and revokes them after the delay', () => {
    vi.useFakeTimers();
    const urlApi = { createObjectURL: vi.fn(() => 'blob:test-1'), revokeObjectURL: vi.fn() };
    const manager = createDownloadManager({ urlApi, revokeDelayMs: 1000 });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    manager.download(new Blob(['x']), 'file.zip');
    expect(click).toHaveBeenCalledTimes(1);
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
    expect(manager.pendingCount).toBe(0);
    click.mockRestore();
    vi.useRealTimers();
  });

  it('revokes pending URLs when the component unmounts, including under StrictMode', () => {
    const urlApi = { createObjectURL: vi.fn(() => 'blob:test-2'), revokeObjectURL: vi.fn() };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let manager;
    function Probe() {
      manager = useDownloads({ urlApi, revokeDelayMs: 60_000 });
      return null;
    }
    const view = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    manager.download(new Blob(['x']), 'a.pdf');
    expect(manager.pendingCount).toBe(1);
    view.unmount();
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:test-2');
    expect(manager.pendingCount).toBe(0);
    click.mockRestore();
  });
});

/** Minimal DataTransfer stand-in (jsdom does not implement drag data). */
function dataTransfer({ files = [], directories = [] } = {}) {
  const items = [
    ...files.map((file) => ({ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false, name: file.name }) })),
    ...directories.map((name) => ({ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true, name }) })),
  ];
  return { types: ['Files'], items, files, dropEffect: 'none' };
}

describe('DropZone', () => {
  it('stays active across nested drag-enter/leave events and resets on drop', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);
    const zone = screen.getByTestId('drop-zone');
    const child = screen.getByRole('button', { name: 'Choose files' });
    const transfer = dataTransfer();
    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    fireEvent.dragEnter(child, { dataTransfer: transfer });
    fireEvent.dragLeave(child, { dataTransfer: transfer });
    expect(zone.dataset.active).toBe('true');
    fireEvent.dragLeave(zone, { dataTransfer: transfer });
    expect(zone.dataset.active).toBeUndefined();
  });

  it('prevents navigation on drop and reports folders separately', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);
    const zone = screen.getByTestId('drop-zone');
    const file = nodeFile(epsBytes(), 'logo.eps');
    const dropped = fireEvent.drop(zone, { dataTransfer: dataTransfer({ files: [file], directories: ['Assets'] }) });
    expect(dropped).toBe(false); // default prevented: the browser will not open the file
    expect(onFiles).toHaveBeenCalledWith([file], [{ name: 'Assets', reason: 'directory' }]);
  });

  it('prevents navigation when files are dropped elsewhere on the page', () => {
    render(<DropZone onFiles={vi.fn()} />);
    const event = new Event('drop', { cancelable: true, bubbles: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('feeds picker selections through the same handler and allows reselecting the same file', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);
    const input = screen.getByTestId('file-input');
    const file = nodeFile(epsBytes(), 'logo.eps');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(onFiles).toHaveBeenCalledWith([file], []);
    expect(input.value).toBe('');
  });

  it('uses the same file list for drop and picker (routing parity)', () => {
    const file = nodeFile(epsBytes(), 'logo.eps');
    expect(readDroppedItems(dataTransfer({ files: [file] }))).toEqual({ files: [file], rejected: [] });
    expect(readDroppedItems({ files: [file], items: [] })).toEqual({ files: [file], rejected: [] });
  });
});
