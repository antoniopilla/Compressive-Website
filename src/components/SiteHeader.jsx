import { Monitor, Moon, Sun } from 'lucide-react';
import { SECTIONS } from '../ui/sections.js';
import styles from './SiteHeader.module.css';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Auto', Icon: Monitor },
];

/**
 * The name, the main section navigation (desktop and tablet) and the theme
 * switch. On phones the navigation moves to the bottom bar (BottomNav).
 *
 * @param {{ theme: string, onThemeChange: (theme: string) => void, activeSection: string }} props
 */
export default function SiteHeader({ theme, onThemeChange, activeSection }) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a className={styles.brand} href="#tools" aria-label="Compressive, go to the top">
          Compressive
        </a>

        <nav className={styles.nav} aria-label="Main">
          <ul className={styles.navList}>
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  className={styles.navLink}
                  href={`#${section.id}`}
                  aria-current={activeSection === section.id ? 'location' : undefined}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

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
