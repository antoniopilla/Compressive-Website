import { Archive, FileImage, FileText, Image, Layers } from 'lucide-react';
import { formatBytes, formatNumber, IMAGE_POLICY, LIMITS } from '../engine/index.js';
import { useReveal } from '../hooks/useReveal.js';
import styles from './InfoSection.module.css';

const ROWS = [
  {
    formats: 'PNG',
    Icon: Image,
    what: `Re-saved without visible change: transparency and colours kept, never enlarged. Images wider or taller than ${formatNumber(IMAGE_POLICY.maxWidth)} px are scaled down to fit.`,
  },
  {
    formats: 'JPG and WebP',
    Icon: FileImage,
    what: `Re-saved once at quality ${IMAGE_POLICY.quality}, which looks the same to most eyes but is usually much smaller. Camera rotation is fixed.`,
  },
  {
    formats: 'PDF',
    Icon: FileText,
    what: 'Unused data and old saved versions are removed; text, fonts, pictures and pages stay exactly as they are. Signed, password-protected and print-standard (PDF/X, PDF/A) files are returned unchanged.',
  },
  {
    formats: 'Several files at once',
    Icon: Archive,
    what: 'Packed into one ZIP, unchanged, and every file is checked after packing. Photos that are already compressed barely shrink in a ZIP.',
  },
  {
    formats: 'SVG, AI, EPS and PSD',
    Icon: Layers,
    what: 'Kept exactly as they are. Compressive never re-saves vector or layered files; add them with other files to zip them together.',
  },
];

/** "How it works": what happens to each file type, and the limits. */
export default function InfoSection() {
  const ref = useReveal();
  return (
    <section id="how-it-works" ref={ref} className={styles.info} aria-labelledby="info-title">
      <div className={styles.heading}>
        <h2 id="info-title" className={styles.title}>
          What Compressive does with each file
        </h2>
        <p className={styles.lead}>
          Smaller files where that is safe, your original where it is not. Whenever compressing would not help, or could
          change how something looks, you get your original back and the reason why.
        </p>
      </div>
      <ul className={styles.rows}>
        {ROWS.map(({ formats, Icon, what }) => (
          <li key={formats} className={styles.row}>
            <span className={styles.rowIcon} aria-hidden="true">
              <Icon size={20} />
            </span>
            <div>
              <h3 className={styles.rowTitle}>{formats}</h3>
              <p className={styles.rowText}>{what}</p>
            </div>
          </li>
        ))}
      </ul>

      <div id="limits" className={styles.block}>
        <h3 className={styles.blockTitle}>Limits</h3>
        <ul className={styles.list}>
          <li>Up to {LIMITS.maxFiles} files at once, and up to {formatBytes(LIMITS.maxZipInputBytes)} in one ZIP.</li>
          <li>
            Single images up to {formatBytes(LIMITS.maxRasterInputBytes)} and{' '}
            {formatNumber(LIMITS.maxRasterSourcePixels / 1_000_000)} megapixels (PNG:{' '}
            {formatNumber(LIMITS.maxPngSourcePixels / 1_000_000)} megapixels).
          </li>
          <li>Single PDFs up to {formatBytes(LIMITS.maxPdfInputBytes)}.</li>
          <li>
            Compressed images stay within {formatBytes(IMAGE_POLICY.maxOutputBytes)} and{' '}
            {formatNumber(IMAGE_POLICY.maxWidth)} × {formatNumber(IMAGE_POLICY.maxHeight)} px.
          </li>
          <li>Phones and older computers have less memory and may manage less.</li>
        </ul>
      </div>
    </section>
  );
}
