import { ChevronDown, Printer } from 'lucide-react';
import PrintSizeForm from './PrintSizeForm.jsx';
import styles from './PrintCheck.module.css';

/**
 * Optional print check. Most visitors only want smaller files, so the print
 * size form stays folded away until someone asks for it.
 *
 * @param {{
 *   open: boolean,
 *   onToggle: () => void,
 *   printSize: import('../engine/units.js').PrintSize,
 *   errors: string[],
 *   onChange: (printSize: Partial<import('../engine/units.js').PrintSize>) => void,
 *   onUnitPreference: (unit: string) => void,
 * }} props
 */
export default function PrintCheck({ open, onToggle, printSize, errors, onChange, onUnitPreference }) {
  return (
    <div className={styles.printCheck} data-open={open || undefined}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls="print-check-body" onClick={onToggle}>
        <Printer size={18} aria-hidden="true" className={styles.icon} />
        <span className={styles.label}>
          Printing it? <span className={styles.labelHint}>Check that it will look sharp</span>
        </span>
        <ChevronDown size={18} aria-hidden="true" className={styles.chevron} />
      </button>
      {open ? (
        <div id="print-check-body" className={styles.body}>
          <PrintSizeForm printSize={printSize} errors={errors} onChange={onChange} onUnitPreference={onUnitPreference} />
        </div>
      ) : null}
    </div>
  );
}
