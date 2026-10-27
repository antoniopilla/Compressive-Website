/**
 * Non-sensitive preferences (theme, default unit) kept in localStorage.
 * Artwork, previews and filenames are never stored. Storage can be blocked or
 * unavailable (private windows, strict settings), so every access is guarded.
 */

import { useCallback, useState } from 'react';

// public/theme-init.js reads PREFIX + 'theme' before React loads; keep them in sync.
const PREFIX = 'compressive:';

/**
 * @param {string} key
 * @param {string} fallback
 * @param {string[]} allowed
 */
export function readPreference(key, fallback, allowed) {
  try {
    const value = globalThis.localStorage?.getItem(PREFIX + key);
    return value !== null && value !== undefined && (!allowed || allowed.includes(value)) ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {string} value
 */
export function writePreference(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

/**
 * @param {string} key
 * @param {string} fallback
 * @param {string[]} allowed
 * @returns {[string, (value: string) => void]}
 */
export function usePreference(key, fallback, allowed) {
  const [value, setValue] = useState(() => readPreference(key, fallback, allowed));
  const update = useCallback(
    (next) => {
      setValue(next);
      writePreference(key, next);
    },
    [key],
  );
  return [value, update];
}
