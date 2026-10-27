import { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { ACCEPT, carriesFiles, readDroppedItems } from '../ui/files.js';
import styles from './DropZone.module.css';

/**
 * Drag-and-drop zone and file picker feeding the same handler.
 *
 * @param {{ onFiles: (files: File[], rejected: { name: string, reason: string }[]) => void, disabled?: boolean, hasFiles?: boolean }} props
 */
export default function DropZone({ onFiles, disabled = false, hasFiles = false }) {
  const inputRef = useRef(null);
  const depthRef = useRef(0);
  const [active, setActive] = useState(false);

  // Dropping a file anywhere else on the page must not navigate away and lose
  // the session.
  useEffect(() => {
    const guard = (event) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  const handleDragEnter = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depthRef.current += 1; // child elements fire their own enter/leave pairs
    setActive(true);
  };
  const handleDragOver = (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  };
  const handleDragLeave = (event) => {
    if (!carriesFiles(event)) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setActive(false);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    depthRef.current = 0;
    setActive(false);
    if (disabled) return;
    const { files, rejected } = readDroppedItems(event.dataTransfer);
    if (files.length || rejected.length) onFiles(files, rejected);
  };

  const handleChange = (event) => {
    const files = Array.from(event.target.files ?? []);
    // Reset so choosing the same file again (after removing it) fires `change`.
    event.target.value = '';
    if (files.length) onFiles(files, []);
  };

  return (
    <div
      className={styles.zone}
      data-active={active || undefined}
      data-compact={hasFiles || undefined}
      data-testid="drop-zone"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <UploadCloud className={styles.icon} size={hasFiles ? 26 : 36} aria-hidden="true" />
      <div className={styles.text}>
        <p className={styles.title}>{active ? 'Drop to add these files' : hasFiles ? 'Add more files' : 'Drag your artwork here'}</p>
        <p className={styles.hint} id="drop-zone-hint">
          AI, EPS, SVG, JPG, PNG, WebP, PDF or PSD. On a phone or with a keyboard, use the button.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-describedby="drop-zone-hint"
        id="choose-files-button"
      >
        Choose files
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleChange}
        data-testid="file-input"
      />
    </div>
  );
}
