import { ShieldCheck } from 'lucide-react';
import styles from './Hero.module.css';

/**
 * The opening: what Compressive does, in a few words. It stays short so the
 * workspace, where files are added, starts within the first screen.
 */
export default function Hero() {
  return (
    <section id="top" className={styles.hero} aria-labelledby="hero-title">
      <p className={styles.kicker}>
        <ShieldCheck size={16} aria-hidden="true" /> Free, private and no sign-up
      </p>
      <h1 id="hero-title" className={styles.title}>
        Make your files smaller, right here in your browser
      </h1>
      <p className={styles.lead}>Compress PNG, JPG and WebP images and shrink PDFs. Nothing is uploaded.</p>
    </section>
  );
}
