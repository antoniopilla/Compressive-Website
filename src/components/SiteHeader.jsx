import { Monitor, Moon, Sun } from 'lucide-react';
import styles from './SiteHeader.module.css';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Auto', Icon: Monitor },
];

/**
 * @param {{ theme: string, onThemeChange: (theme: string) => void }} props
 */
export default function SiteHeader({ theme, onThemeChange }) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a className={styles.brand} href="#main" aria-label="Compressive, go to main content">
          <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <rect className={styles.markTile} width="32" height="32" rx="9" />
            <path className={styles.markArrows} d="M8 8l6 6M14 9v5H9M24 24l-6-6M18 23v-5h5" />
          </svg>
          <span className={styles.name}>Compressive</span>
        </a>
        <fieldset className={styles.theme}>
          <legend className="visually-hidden">Colour theme</legend>
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <label key={value} className={styles.themeOption} data-checked={theme === value || undefined}>
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => onThemeChange(value)}
                className="visually-hidden"
                aria-label={value === 'system' ? 'Auto (match device)' : label}
              />
              <Icon size={16} aria-hidden="true" />
              <span className={styles.themeLabel}>{label}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </header>
  );
}
