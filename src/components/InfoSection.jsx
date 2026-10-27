import { formatBytes, formatNumber, IMAGE_POLICY, LIMITS } from '../engine/index.js';
import styles from './InfoSection.module.css';

const ROWS = [
  {
    formats: 'PNG',
    accent: 'mint',
    what: `Re-saved without visible change: transparency and colours kept, never enlarged. Images wider or taller than ${formatNumber(IMAGE_POLICY.maxWidth)} px are scaled down to fit.`,
  },
  {
    formats: 'JPG and WebP',
    accent: 'amber',
    what: `Re-saved once at quality ${IMAGE_POLICY.quality}, which looks the same to most eyes but is usually much smaller. Camera rotation is fixed.`,
  },
  {
    formats: 'PDF',
    accent: 'coral',
    what: 'Unused data and old saved versions are removed; text, fonts, pictures and pages stay exactly as they are. Signed, password-protected and print-standard (PDF/X, PDF/A) files are returned unchanged.',
  },
  {
    formats: 'Several files at once',
    accent: 'violet',
    what: 'Packed into one ZIP, unchanged, and every file is checked after packing. Photos that are already compressed barely shrink in a ZIP.',
  },
  {
    formats: 'SVG, AI, EPS and PSD',
    accent: 'sky',
    what: 'Kept exactly as they are. Compressive never re-saves vector or layered files; add them with other files to zip them together.',
  },
];

export default function InfoSection() {
  return (
    <section className={styles.info} aria-labelledby="info-title">
      <h2 id="info-title" className={styles.title}>
        What Compressive does with each file
      </h2>
      <p className={styles.lead}>
        Smaller files where that is safe, your original where it is not. Whenever compressing would not help, or could
        change how something looks, you get your original back and the reason why.
      </p>
      <ul className={styles.rows}>
        {ROWS.map((row) => (
          <li key={row.formats} className={styles.row} style={{ '--accent': `var(--${row.accent})` }}>
            <h3 className={styles.rowTitle}>{row.formats}</h3>
            <p className={styles.rowText}>{row.what}</p>
          </li>
        ))}
      </ul>

      <div className={styles.columns}>
        <div className={styles.block}>
          <h3>Limits</h3>
          <ul>
            <li>Up to {LIMITS.maxFiles} files at once, and up to {formatBytes(LIMITS.maxZipInputBytes)} in one ZIP.</li>
            <li>
              Single images up to {formatBytes(LIMITS.maxRasterInputBytes)} and{' '}
              {formatNumber(LIMITS.maxRasterSourcePixels / 1_000_000)} megapixels (PNG:{' '}
              {formatNumber(LIMITS.maxPngSourcePixels / 1_000_000)} megapixels).
            </li>
            <li>Single PDFs up to {formatBytes(LIMITS.maxPdfInputBytes)}.</li>
            <li>Compressed images stay within {formatBytes(IMAGE_POLICY.maxOutputBytes)} and {formatNumber(IMAGE_POLICY.maxWidth)} × {formatNumber(IMAGE_POLICY.maxHeight)} px.</li>
            <li>Phones and older computers have less memory and may manage less.</li>
          </ul>
        </div>
        <div className={styles.block}>
          <h3>Privacy</h3>
          <ul>
            <li>Files are read and compressed by your own browser. They are never uploaded.</li>
            <li>No accounts, no tracking, no analytics.</li>
            <li>Only your theme and unit choices are remembered on this device. Your files and filenames are not.</li>
            <li>Refreshing or closing the page clears everything.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
