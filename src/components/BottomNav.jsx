import { BookOpen, LayoutGrid, Minimize2, ShieldCheck } from 'lucide-react';
import { SECTIONS } from '../ui/sections.js';
import styles from './BottomNav.module.css';

const ICONS = { tools: LayoutGrid, workspace: Minimize2, 'how-it-works': BookOpen, privacy: ShieldCheck };

/**
 * Phone navigation: the same sections as the header, in a bar along the
 * bottom edge where a thumb reaches easily. Hidden from tablet width up.
 *
 * @param {{ activeSection: string }} props
 */
export default function BottomNav({ activeSection }) {
  return (
    <nav className={styles.bar} aria-label="Main">
      <ul className={styles.list}>
        {SECTIONS.map((section) => {
          const Icon = ICONS[section.id];
          return (
            <li key={section.id}>
              <a
                className={styles.link}
                href={`#${section.id}`}
                aria-current={activeSection === section.id ? 'location' : undefined}
              >
                <Icon size={20} aria-hidden="true" className={styles.icon} />
                <span>{section.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
