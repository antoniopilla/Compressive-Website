import { EyeOff, HardDrive, RefreshCcw, UserX } from 'lucide-react';
import SectionHeader from './SectionHeader.jsx';
import styles from './PrivacySection.module.css';

const POINTS = [
  { Icon: HardDrive, text: 'Files are read and compressed by your own browser. They are never uploaded.' },
  { Icon: UserX, text: 'No accounts, no tracking, no analytics.' },
  { Icon: EyeOff, text: 'Only your theme and unit choices are remembered on this device. Your files and filenames are not.' },
  { Icon: RefreshCcw, text: 'Refreshing or closing the page clears everything.' },
];

/** Privacy: how files are handled, the page's closing section. */
export default function PrivacySection() {
  return (
    <section id="privacy" className={styles.privacy} aria-labelledby="privacy-title">
      <SectionHeader titleId="privacy-title" title="Privacy" />
      <ul className={`card ${styles.points}`}>
        {POINTS.map(({ Icon, text }) => (
          <li key={text} className={styles.point}>
            <span className="icon-tile" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className={styles.text}>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
