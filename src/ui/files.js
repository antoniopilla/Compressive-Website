/** File-picker `accept` list matching the supported extensions. */
export const ACCEPT = '.ai,.eps,.svg,.jpg,.jpeg,.png,.webp,.pdf,.psd';

/**
 * True when a drag operation carries files (not text or links).
 *
 * @param {DragEvent | import('react').DragEvent} event
 */
export function carriesFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Splits dropped items into files and rejected directories. Directory entries
 * must be read synchronously during the drop event.
 *
 * @param {DataTransfer | null | undefined} dataTransfer
 * @returns {{ files: File[], rejected: { name: string, reason: string }[] }}
 */
export function readDroppedItems(dataTransfer) {
  const files = [];
  const rejected = [];
  const items = Array.from(dataTransfer?.items ?? []).filter((item) => item.kind === 'file');
  if (items.length) {
    for (const item of items) {
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      const file = item.getAsFile();
      if (entry?.isDirectory) {
        rejected.push({ name: entry.name || file?.name || 'Folder', reason: 'directory' });
      } else if (file) {
        files.push(file);
      }
    }
  } else {
    files.push(...Array.from(dataTransfer?.files ?? []));
  }
  return { files, rejected };
}
