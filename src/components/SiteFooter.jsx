import { ArrowUp } from 'lucide-react';
import { SECTIONS } from '../ui/sections.js';
import styles from './SiteFooter.module.css';

/**
 * Footer with the links people look for. Compressive has no accounts,
 * contact form or separate legal pages, so the footer links to the sections
 * that answer those questions (privacy, limits, how it works).
 */
export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <p className={styles.name}>Compressive</p>
          <p className={styles.tagline}>Free, private file compression in your browser. No uploads, no accounts and no tracking.</p>
        </div>
        <nav className={styles.links} aria-label="Footer">
          <ul>
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.label}</a>
              </li>
            ))}
            <li>
              <a href="#limits">Limits</a>
            </li>
          </ul>
        </nav>
        <a className={styles.top} href="#tools">
          <ArrowUp size={16} aria-hidden="true" /> Back to top
        </a>
      </div>
    </footer>
  );
}
