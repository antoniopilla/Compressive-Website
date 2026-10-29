import { EyeOff, HardDrive, RefreshCcw, UserX } from 'lucide-react';
import styles from './PrivacySection.module.css';

const POINTS = [
  { Icon: HardDrive, text: 'Files are read and compressed by your own browser. They are never uploaded.' },
  { Icon: UserX, text: 'No accounts, no tracking, no analytics.' },
  { Icon: EyeOff, text: 'Only your theme and unit choices are remembered on this device. Your files and filenames are not.' },
  { Icon: RefreshCcw, text: 'Refreshing or closing the page clears everything.' },
];

/** Privacy: how files are handled. The page's closing pink cushion. */
export default function PrivacySection() {
  return (
    <section id="privacy" className={styles.privacy} aria-labelledby="privacy-title">
      <h2 id="privacy-title" className={styles.title}>
        Privacy
      </h2>
      <ul className={styles.points}>
        {POINTS.map(({ Icon, text }) => (
          <li key={text} className={styles.point}>
            <span className={styles.icon} aria-hidden="true">
              <Icon size={20} />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
