import { ArrowLeftRight } from 'lucide-react';
import { fromInches, RESOLUTION_POLICY, toInches, UNITS } from '../engine/index.js';
import styles from './PrintSizeForm.module.css';

/** Common banner sizes in feet (width × height). Selecting one fills both fields. */
const PRESETS = [
  { width: 6, height: 2 },
  { width: 6, height: 3 },
  { width: 8, height: 4 },
  { width: 10, height: 3 },
  { width: 2, height: 6 },
];

/** @param {number} value */
const tidy = (value) => String(Math.round(value * 1000) / 1000);

/**
 * Print width/height inputs with explicit units. Values are passed to the
 * engine as typed; the engine validates them and recalculates resolution
 * health immediately, without reprocessing files.
 *
 * @param {{
 *   printSize: import('../engine/units.js').PrintSize,
 *   errors: string[],
 *   onChange: (printSize: Partial<import('../engine/units.js').PrintSize>) => void,
 *   onUnitPreference: (unit: string) => void,
 * }} props
 */
export default function PrintSizeForm({ printSize, errors, onChange, onUnitPreference }) {
  const unitShort = UNITS[printSize.unit]?.short ?? printSize.unit;

  const changeUnit = (unit) => {
    // Keep the same physical size when switching units.
    const convert = (value) => {
      const number = Number(value);
      if (value === null || value === '' || !Number.isFinite(number) || number <= 0) return value;
      return tidy(fromInches(toInches(number, printSize.unit), unit));
    };
    onChange({ unit, width: convert(printSize.width), height: convert(printSize.height) });
    onUnitPreference(unit);
  };

  const swap = () => onChange({ width: printSize.height, height: printSize.width });

  const applyPreset = (preset) => {
    const width = printSize.unit === 'ft' ? preset.width : tidy(fromInches(toInches(preset.width, 'ft'), printSize.unit));
    const height = printSize.unit === 'ft' ? preset.height : tidy(fromInches(toInches(preset.height, 'ft'), printSize.unit));
    onChange({ width: String(width), height: String(height) });
  };

  const errorId = errors.length ? 'print-size-errors' : undefined;

  return (
    <div className={styles.form}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="print-width">Width ({unitShort})</label>
          <input
            id="print-width"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={printSize.width ?? ''}
            onChange={(event) => onChange({ width: event.target.value })}
            aria-describedby={errorId}
            aria-invalid={errors.some((error) => error.includes('width')) || undefined}
          />
        </div>
        <button type="button" className={`btn btn-ghost btn-icon ${styles.swap}`} onClick={swap} aria-label="Swap width and height" title="Swap width and height">
          <ArrowLeftRight size={18} aria-hidden="true" />
        </button>
        <div className={styles.field}>
          <label htmlFor="print-height">Height ({unitShort})</label>
          <input
            id="print-height"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={printSize.height ?? ''}
            onChange={(event) => onChange({ height: event.target.value })}
            aria-describedby={errorId}
            aria-invalid={errors.some((error) => error.includes('height')) || undefined}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="print-unit">Unit</label>
          <select id="print-unit" value={printSize.unit} onChange={(event) => changeUnit(event.target.value)}>
            {Object.entries(UNITS).map(([value, unit]) => (
              <option key={value} value={value}>
                {unit.label} ({unit.short})
              </option>
            ))}
          </select>
        </div>
      </div>

      {errors.length ? (
        <ul id="print-size-errors" className={styles.errors}>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <div className={styles.presets} role="group" aria-label="Common banner sizes">
        <span className={styles.presetsLabel}>Common sizes:</span>
        {PRESETS.map((preset) => (
          <button key={`${preset.width}x${preset.height}`} type="button" className={styles.preset} onClick={() => applyPreset(preset)}>
            {preset.width} × {preset.height} ft
          </button>
        ))}
      </div>

      <p className={styles.policy}>
        <strong>Resolution guide:</strong> {RESOLUTION_POLICY.targetPpi} PPI or more is the target. Below{' '}
        {RESOLUTION_POLICY.warningBelowPpi} PPI you get a warning, and below {RESOLUTION_POLICY.criticalBelowPpi} PPI a
        critical warning. These are defaults for banners seen up close, not universal print standards; viewing distance,
        material and your printer&apos;s requirements all matter.
      </p>
    </div>
  );
}
