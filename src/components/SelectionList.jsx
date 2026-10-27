import { useRef } from 'react';
import { CircleAlert, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { formatBytes, formatDimensions } from '../engine/index.js';
import { CATEGORY_LABELS } from '../ui/labels.js';
import { ACCEPT } from '../ui/files.js';
import FileIcon from './FileIcon.jsx';
import HealthBadge from './HealthBadge.jsx';
import styles from './SelectionList.module.css';

/**
 * @param {{
 *   selection: import('../engine/studio.js').StudioSnapshot['selection'],
 *   selectionHealth: import('../engine/studio.js').StudioSnapshot['selectionHealth'],
 *   disabled: boolean,
 *   onRemove: (id: string) => void,
 *   onReplace: (id: string, file: File) => void,
 * }} props
 */
export default function SelectionList({ selection, selectionHealth, disabled, onRemove, onReplace }) {
  const replaceInputRef = useRef(null);
  const replaceTargetRef = useRef(null);

  if (!selection.length) return null;

  const startReplace = (id) => {
    replaceTargetRef.current = id;
    replaceInputRef.current?.click();
  };
  const handleReplaceChange = (event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (file && replaceTargetRef.current) onReplace(replaceTargetRef.current, file);
    replaceTargetRef.current = null;
  };

  return (
    <div className={styles.wrapper}>
      <ul className={styles.list} aria-label="Selected files">
        {selection.map((entry) => (
          <FileRow
            key={entry.id}
            entry={entry}
            health={selectionHealth[entry.id]}
            disabled={disabled}
            onRemove={() => onRemove(entry.id)}
            onReplace={() => startReplace(entry.id)}
          />
        ))}
      </ul>
      <input
        ref={replaceInputRef}
        type="file"
        accept={ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleReplaceChange}
        data-testid="replace-input"
      />
    </div>
  );
}

/**
 * @param {{ entry: any, health: any, disabled: boolean, onRemove: () => void, onReplace: () => void }} props
 */
function FileRow({ entry, health, disabled, onRemove, onReplace }) {
  const invalid = !entry.pending && !entry.validation.ok;
  const dimensions = entry.probe ? { width: entry.probe.orientedWidth, height: entry.probe.orientedHeight } : null;
  const assessment = health?.assessment ?? null;

  return (
    <li className={styles.row} data-invalid={invalid || undefined} data-category={entry.category ?? 'unknown'}>
      <span className={styles.icon}>
        <FileIcon category={entry.category} />
      </span>
      <div className={styles.main}>
        <p className={styles.name}>{entry.name}</p>
        <p className={styles.meta}>
          <span>{formatBytes(entry.size)}</span>
          {entry.category ? <span>{CATEGORY_LABELS[entry.category]}</span> : null}
          {dimensions ? <span>{formatDimensions(dimensions)}</span> : null}
        </p>
        <div className={styles.status}>
          {entry.pending ? (
            <p className={styles.pending}>
              <LoaderCircle size={14} className="spin" aria-hidden="true" /> Checking this file…
            </p>
          ) : invalid ? (
            <p className={styles.error}>
              <CircleAlert size={15} aria-hidden="true" />
              <span>{entry.validation.message}</span>
            </p>
          ) : (
            <>
              {assessment && assessment.status !== 'unknown' ? (
                <p className={styles.health}>
                  <HealthBadge status={assessment.status} ppi={assessment.effectivePpi} size="sm" />
                  <span className="visually-hidden">{assessment.message}</span>
                </p>
              ) : null}
              {entry.notes.map((note) => (
                <p key={note} className={styles.note}>
                  {note}
                </p>
              ))}
            </>
          )}
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onReplace}
          disabled={disabled}
          aria-label={`Replace ${entry.name}`}
          title="Replace"
        >
          <RefreshCw size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${entry.name}`}
          title="Remove"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
