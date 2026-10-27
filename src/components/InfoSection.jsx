import { formatBytes, formatNumber, IMAGE_POLICY, LIMITS } from '../engine/index.js';
import styles from './InfoSection.module.css';

const ROWS = [
  {
    formats: 'AI, EPS, SVG',
    what: 'Kept byte for byte. Never converted, flattened, outlined or re-saved.',
    check: 'Not assessed. Vector art scales cleanly, but embedded images are not checked.',
  },
  {
    formats: 'JPG, PNG, WebP (one file)',
    what: `Compressed once at quality ${IMAGE_POLICY.quality}, within ${formatNumber(IMAGE_POLICY.maxWidth)} × ${formatNumber(IMAGE_POLICY.maxHeight)} px and ${formatBytes(IMAGE_POLICY.maxOutputBytes)}, never enlarged. Your original is kept when compressing would not help or would change colours.`,
    check: 'Measured for the original and the prepared copy.',
  },
  {
    formats: 'PDF (one file)',
    what: 'Internal structure tidied; text, fonts, vectors and page sizes untouched. Signed, encrypted, PDF/X and PDF/A files are returned unchanged.',
    check: 'Not assessed. A PDF has no single resolution.',
  },
  {
    formats: 'PSD (one file)',
    what: 'Kept byte for byte.',
    check: 'Measured from the pixel size in the file header.',
  },
  {
    formats: 'Two or more files',
    what: 'Packaged unchanged into one ZIP and checked against your originals. Photos that are already compressed barely shrink in a ZIP.',
    check: 'Measured for images and PSDs; other files are listed as not assessed.',
  },
];

export default function InfoSection() {
  return (
    <section className={styles.info} aria-labelledby="info-title">
      <h2 id="info-title" className={styles.title}>
        What happens to your files
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">You choose</th>
              <th scope="col">What happens</th>
              <th scope="col">Resolution check</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.formats}>
                <th scope="row">{row.formats}</th>
                <td>{row.what}</td>
                <td>{row.check}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.columns}>
        <div className={styles.block}>
          <h3>Limits</h3>
          <ul>
            <li>Up to {LIMITS.maxFiles} files at once.</li>
            <li>ZIP batches up to {formatBytes(LIMITS.maxZipInputBytes)} in total.</li>
            <li>
              Single images up to {formatBytes(LIMITS.maxRasterInputBytes)} and{' '}
              {formatNumber(LIMITS.maxRasterSourcePixels / 1_000_000)} megapixels (PNG:{' '}
              {formatNumber(LIMITS.maxPngSourcePixels / 1_000_000)} megapixels).
            </li>
            <li>Single PDFs up to {formatBytes(LIMITS.maxPdfInputBytes)}.</li>
            <li>Phones and older computers have less memory and may manage less.</li>
          </ul>
        </div>
        <div className={styles.block}>
          <h3>Privacy</h3>
          <ul>
            <li>Files are read and prepared by your own browser. They are never uploaded.</li>
            <li>No accounts, no tracking, no analytics.</li>
            <li>Only your theme and unit choices are remembered on this device. Your files and filenames are not.</li>
            <li>Refreshing or closing the page clears the current session.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
