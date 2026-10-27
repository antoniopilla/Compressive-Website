/*
 * Applies the visitor's saved theme before the first paint, so a light/dark
 * choice that differs from the device setting never flashes the wrong colours.
 * Loaded as a blocking same-origin script (inline scripts are blocked by the
 * Content-Security-Policy). Keep the key in sync with src/hooks/usePreference.js.
 */
(function () {
  try {
    var theme = window.localStorage.getItem('compressive:theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // Storage blocked: the theme follows the device setting.
  }
})();
