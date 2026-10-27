import { ArrowLeftRight, CircleAlert, CircleCheck } from 'lucide-react';
import { describePrintSize, fromInches, resolvePrintSize, RESOLUTION_POLICY, toInches, UNITS } from '../engine/index.js';
import styles from './PrintSizeForm.module.css';

/** Common print sizes. Selecting one fills both fields and switches to its unit. */
const PRESETS = [
  { name: 'A4', width: 21, height: 29.7, unit: 'cm' },
  { name: 'Letter', width: 8.5, height: 11, unit: 'in' },
  { name: 'Poster', width: 24, height: 36, unit: 'in' },
  { name: 'Banner', width: 6, height: 2, unit: 'ft' },
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
    onChange({ unit: preset.unit, width: String(preset.width), height: String(preset.height) });
  };

  // Each message names the edge it is about, so it can sit under that field.
  const widthError = errors.find((error) => error.includes('width')) ?? null;
  const heightError = errors.find((error) => error.includes('height')) ?? null;
  const complete = resolvePrintSize(printSize).complete && !errors.length;

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
            aria-describedby={widthError ? 'print-width-error' : undefined}
            aria-invalid={widthError ? true : undefined}
          />
          {widthError ? (
            <p id="print-width-error" className={styles.fieldError}>
              <CircleAlert size={16} aria-hidden="true" /> {widthError}
            </p>
          ) : null}
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
            aria-describedby={heightError ? 'print-height-error' : undefined}
            aria-invalid={heightError ? true : undefined}
          />
          {heightError ? (
            <p id="print-height-error" className={styles.fieldError}>
              <CircleAlert size={16} aria-hidden="true" /> {heightError}
            </p>
          ) : null}
        </div>
        <div className={styles.field}>
          <label htmlFor="print-unit">Unit</label>
          <select id="print-unit" value={printSize.unit} onChange={(event) => changeUnit(event.target.value)}>
            {Object.entries(UNITS).map(([value, unit]) => (
              <option key={value} value={value}>
                {unit.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className={styles.success} role="status">
        {complete ? (
          <>
            <CircleCheck size={18} aria-hidden="true" className={styles.successIcon} />
            Checking sharpness for {describePrintSize(printSize)}.
          </>
        ) : null}
      </p>

      <div className={styles.presets} role="group" aria-label="Common print sizes">
        <span className={styles.presetsLabel}>Common sizes:</span>
        {PRESETS.map((preset) => (
          <button key={preset.name} type="button" className={styles.preset} onClick={() => applyPreset(preset)}>
            {preset.name}{' '}
            <span className={styles.presetSize}>
              {preset.width} × {preset.height} {preset.unit}
            </span>
          </button>
        ))}
      </div>

      <p className={styles.policy}>
        <strong>How sharp is sharp?</strong> {RESOLUTION_POLICY.targetPpi} pixels per inch (PPI) or more looks crisp up
        close. Below {RESOLUTION_POLICY.warningBelowPpi} PPI you get a warning, and below{' '}
        {RESOLUTION_POLICY.criticalBelowPpi} PPI a stronger one. Large prints seen from a distance can get by with less, so
        check with your print shop.
      </p>
    </div>
  );
}
