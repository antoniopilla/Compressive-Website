import { useEffect, useId, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';
import styles from './ConfirmDialog.module.css';

/**
 * Asks before an action that throws work away, and says what will be lost.
 *
 * A native modal <dialog>: the rest of the page is inert while it is open,
 * Escape and a click outside both cancel, and focus starts on the safe choice
 * and goes back to the control that opened it. `open` drives it, so the
 * parent always knows whether it is showing.
 *
 * @param {{
 *   open: boolean,
 *   title: string,
 *   description: string,
 *   confirmLabel: string,
 *   cancelLabel?: string,
 *   onConfirm: () => void,
 *   onCancel: () => void,
 * }} props
 */
export default function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const openerRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof dialog.showModal !== 'function') return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement;
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      // Browsers that do not restore focus themselves: back to the opener, if it is still there.
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected && (document.activeElement === document.body || !document.activeElement)) opener.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Escape: the parent closes it, so its state never disagrees with the page.
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // The dialog itself is only the target when the click lands on the backdrop.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className={styles.content}>
        <span className="icon-tile" data-tone="error" aria-hidden="true">
          <TriangleAlert size={20} />
        </span>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
        <div className={styles.actions}>
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger-solid" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
