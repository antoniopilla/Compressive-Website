import { Info, TriangleAlert, X } from 'lucide-react';
import styles from './NoticeList.module.css';

/**
 * Dismissible notices about the selection (rejected folders, duplicates).
 *
 * @param {{ notices: { id: string, kind: 'info'|'warning', message: string }[], onDismiss: (id: string) => void }} props
 */
export default function NoticeList({ notices, onDismiss }) {
  if (!notices.length) return null;
  return (
    <ul className={styles.list} aria-label="Notices">
      {notices.map((notice) => (
        <li key={notice.id} className={`callout ${styles.notice}`} data-tone={notice.kind === 'warning' ? 'warning' : 'info'}>
          {notice.kind === 'warning' ? <TriangleAlert size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}
          <span className={styles.message}>{notice.message}</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => onDismiss(notice.id)} aria-label="Dismiss notice">
            <X size={18} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
