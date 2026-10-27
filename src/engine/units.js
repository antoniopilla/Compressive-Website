/**
 * Physical print-size units. Feet are the default because banner and
 * large-format orders are usually specified in feet. Every unit converts to
 * inches, which is what pixels-per-inch calculations need.
 */

export const DEFAULT_UNIT = 'ft';

/** @type {Readonly<Record<string, { label: string, short: string, inches: number }>>} */
export const UNITS = Object.freeze({
  ft: Object.freeze({ label: 'Feet', short: 'ft', inches: 12 }),
  in: Object.freeze({ label: 'Inches', short: 'in', inches: 1 }),
  cm: Object.freeze({ label: 'Centimeters', short: 'cm', inches: 1 / 2.54 }),
  mm: Object.freeze({ label: 'Millimeters', short: 'mm', inches: 1 / 25.4 }),
  m: Object.freeze({ label: 'Meters', short: 'm', inches: 100 / 2.54 }),
});

/** Largest accepted print edge: 1,000 ft (12,000 in). */
export const MAX_PRINT_EDGE_INCHES = 12_000;

/**
 * @param {number} value
 * @param {string} unit
 */
export function toInches(value, unit) {
  const definition = UNITS[unit];
  if (!definition) throw new RangeError(`Unknown unit "${unit}"`);
  return value * definition.inches;
}

/**
 * @param {number} inches
 * @param {string} unit
 */
export function fromInches(inches, unit) {
  const definition = UNITS[unit];
  if (!definition) throw new RangeError(`Unknown unit "${unit}"`);
  return inches / definition.inches;
}

/**
 * @typedef {object} PrintSize
 * @property {number | null} width  Intended print width in `unit` (null when not entered).
 * @property {number | null} height Intended print height in `unit`.
 * @property {string} unit          One of the keys of UNITS.
 */

/**
 * @typedef {object} ResolvedPrintSize
 * @property {boolean} complete     True when both edges are valid positive numbers.
 * @property {number | null} widthIn
 * @property {number | null} heightIn
 * @property {string} unit
 * @property {string} key           Stable identity for acknowledgement invalidation.
 * @property {string[]} errors      Customer-facing validation messages.
 */

/**
 * Validates a print size and converts it to inches.
 *
 * @param {PrintSize} printSize
 * @returns {ResolvedPrintSize}
 */
export function resolvePrintSize(printSize) {
  const unit = UNITS[printSize?.unit] ? printSize.unit : DEFAULT_UNIT;
  const errors = [];
  const edges = /** @type {const} */ (['width', 'height']).map((edge) => {
    const value = printSize?.[edge];
    if (value === null || value === undefined || value === '') return null;
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      errors.push(`Enter a print ${edge} greater than zero.`);
      return null;
    }
    const inches = toInches(number, unit);
    if (inches > MAX_PRINT_EDGE_INCHES) {
      errors.push(`The print ${edge} is larger than this tool supports (1,000 ft).`);
      return null;
    }
    return inches;
  });
  const [widthIn, heightIn] = edges;
  const complete = widthIn !== null && heightIn !== null;
  return {
    complete,
    widthIn,
    heightIn,
    unit,
    key: complete ? `${unit}:${printSize.width}x${printSize.height}` : `${unit}:incomplete`,
    errors,
  };
}

/**
 * Formats a print size for messages, e.g. "10 × 4 ft".
 *
 * @param {PrintSize} printSize
 */
export function describePrintSize(printSize) {
  const short = UNITS[printSize.unit]?.short ?? printSize.unit;
  const format = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));
  return `${format(printSize.width)} × ${format(printSize.height)} ${short}`;
}
