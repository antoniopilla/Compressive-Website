import { Archive, FileImage, FileText, Image, Layers } from 'lucide-react';
import { formatBytes, formatNumber, IMAGE_POLICY, LIMITS } from '../engine/index.js';
import styles from './InfoSection.module.css';

const ROWS = [
  {
    formats: 'PNG',
    Icon: Image,
    what: `Optimised losslessly with OxiPNG, so every pixel, the transparency and the colours stay exactly the same; text and editor metadata are removed. Images wider or taller than ${formatNumber(IMAGE_POLICY.maxWidth)} px are scaled down to fit.`,
  },
  {
    formats: 'JPG and WebP',
    Icon: FileImage,
    what: `Compressed with MozJPEG or WebP, starting at quality ${IMAGE_POLICY.qualities[0]}. Each copy is compared with your original area by area, and quality goes up until it looks the same; if it never does, you get your original back. Smooth photos often shrink by 75–90%; detailed or grainy ones by less. Camera rotation is fixed.`,
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

/** "How it works": what happens to each file type, one shelf per type, and the limits. */
export default function InfoSection() {
  return (
    <section id="how-it-works" className={styles.info} aria-labelledby="info-title">
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
            <div className={styles.identity}>
              <span className={styles.rowIcon} aria-hidden="true">
                <Icon size={20} />
              </span>
              <h3 className={styles.rowTitle}>{formats}</h3>
            </div>
            <p className={styles.rowText}>{what}</p>
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
