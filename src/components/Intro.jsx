import { Download, FolderOpen, Ruler, ShieldCheck, Sparkles } from 'lucide-react';
import styles from './Intro.module.css';

const STEPS = [
  { title: 'Choose files', text: 'Vector, image, PDF or Photoshop artwork', Icon: FolderOpen },
  { title: 'Set print size', text: 'Width and height of the finished print', Icon: Ruler },
  { title: 'Prepare', text: 'Files are prepared right here in your browser', Icon: Sparkles },
  { title: 'Download', text: 'Review sizes and resolution, then save', Icon: Download },
];

export default function Intro() {
  return (
    <section className={styles.intro} aria-labelledby="intro-title">
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Artwork preparation for banners and large-format print</p>
        <h1 id="intro-title" className={styles.title}>
          Get your artwork ready for print, without uploading it anywhere
        </h1>
        <p className={styles.lead}>
          Compressive makes images and PDFs smaller where that is safe, and leaves everything else exactly as you made
          it. You also get a clear resolution check for your print size.
        </p>
        <p className={styles.expectations}>
          Not every file gets smaller: vector and Photoshop files are never altered, and a ZIP of photos that are already
          compressed stays about the same size. Whenever compressing would not help or could change your artwork, you
          get your original back.
        </p>
        <div className={styles.privacy}>
          <ShieldCheck size={22} aria-hidden="true" className={styles.privacyIcon} />
          <p>
            <strong>Your files stay on your device.</strong> Everything happens in this browser tab and nothing is
            uploaded. Refreshing or closing the page clears your files.
          </p>
        </div>
      </div>
      <ol className={styles.steps} aria-label="How it works">
        {STEPS.map(({ title, text, Icon }, index) => (
          <li key={title} className={styles.step}>
            <span className={styles.stepIcon} aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>
                <span className={styles.stepNumber}>{index + 1}.</span> {title}
              </span>
              <span className={styles.stepDescription}>{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
