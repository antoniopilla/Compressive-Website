/**
 * Formatting helpers shared by engine messages and the interface.
 * All byte figures use decimal units (1 KB = 1,000 bytes, 1 MB = 1,000,000 bytes).
 */

const numberFormatters = new Map();

/**
 * @param {number} value
 * @param {number} [maximumFractionDigits]
 */
export function formatNumber(value, maximumFractionDigits = 0) {
  let formatter = numberFormatters.get(maximumFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits });
    numberFormatters.set(maximumFractionDigits, formatter);
  }
  return formatter.format(value);
}

/**
 * @param {number} bytes
 * @returns {string} e.g. "12.4 MB", "980 KB", "512 bytes"
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const sign = bytes < 0 ? '-' : '';
  const value = Math.abs(bytes);
  if (value < 1000) return `${sign}${formatNumber(value)} ${value === 1 ? 'byte' : 'bytes'}`;
  if (value < 1_000_000) return `${sign}${formatNumber(value / 1000, value < 10_000 ? 1 : 0)} KB`;
  if (value < 1_000_000_000) return `${sign}${formatNumber(value / 1_000_000, value < 10_000_000 ? 2 : 1)} MB`;
  return `${sign}${formatNumber(value / 1_000_000_000, 2)} GB`;
}

/**
 * @param {{ width: number, height: number } | null | undefined} dimensions
 */
export function formatDimensions(dimensions) {
  if (!dimensions) return '—';
  return `${formatNumber(dimensions.width)} × ${formatNumber(dimensions.height)} px`;
}

/**
 * PPI for display, rounded *down* (whole numbers; one decimal below 10). A
 * value just under a threshold, such as 149.6, therefore reads "149", never
 * the threshold it failed. Classification uses the same tidied value
 * (see computePpi), so a label and its number always agree.
 *
 * @param {number | null | undefined} ppi
 * @returns {number | null}
 */
function floorPpi(ppi) {
  if (ppi == null || !Number.isFinite(ppi)) return null;
  return ppi < 10 ? Math.floor(ppi * 10) / 10 : Math.floor(ppi);
}

/** @param {number | null | undefined} ppi e.g. "149", "7.5", or "—" */
export function formatPpiNumber(ppi) {
  const value = floorPpi(ppi);
  return value === null ? '—' : formatNumber(value, value < 10 ? 1 : 0);
}

/** @param {number | null | undefined} ppi e.g. "149 PPI" */
export function formatPpi(ppi) {
  const value = formatPpiNumber(ppi);
  return value === '—' ? value : `${value} PPI`;
}

/** @param {number} milliseconds */
export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '—';
  if (milliseconds < 1000) return `${formatNumber(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${formatNumber(milliseconds / 1000, 1)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/** @param {number} ratio 0–1 */
export function formatPercent(ratio) {
  if (!Number.isFinite(ratio)) return '—';
  const percent = ratio * 100;
  return `${formatNumber(percent, Math.abs(percent) < 10 ? 1 : 0)}%`;
}
