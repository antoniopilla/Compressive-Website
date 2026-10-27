import { FileArchive, FileImage, FileText, FolderOpen, Image, Images, Printer, ShieldCheck, Undo2, Zap } from 'lucide-react';
import { TOOLS } from '../ui/tools.js';
import styles from './Hero.module.css';

const TOOL_ICONS = { png: Image, jpg: FileImage, webp: Images, pdf: FileText, zip: FileArchive, print: Printer };

const PROMISES = [
  {
    title: 'Your files stay on your device.',
    text: 'Everything runs in this browser tab. Nothing is uploaded, and closing the page clears it.',
    Icon: ShieldCheck,
  },
  {
    title: 'Free, with no sign-up',
    text: 'No account, no queue and no watermark. Use it as often as you like.',
    Icon: Zap,
  },
  {
    title: 'Your original is always there',
    text: 'If compressing would not help, or could change how a file looks, you get it back untouched.',
    Icon: Undo2,
  },
];

/**
 * Home section: what Compressive is, the primary action (Choose files) and
 * one card per tool. Every tool card opens the matching file picker.
 *
 * @param {{ onTool: (toolId: string) => void, onChooseFiles: () => void }} props
 */
export default function Hero({ onTool, onChooseFiles }) {
  return (
    <section id="tools" className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.intro}>
        <p className={styles.kicker}>Free, private and no sign-up</p>
        <h1 id="hero-title" className={styles.title}>
          Make your files smaller, right here in your browser
        </h1>
        <p className={styles.lead}>
          Compress PNG, JPG and WebP images, shrink PDFs or zip a batch of files. Pick a tool to start, or drop files
          below.
        </p>
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary btn-lg" onClick={onChooseFiles}>
            <FolderOpen size={20} aria-hidden="true" /> Choose files
          </button>
          <a className={styles.secondaryLink} href="#how-it-works">
            How it works
          </a>
        </div>
      </div>

      <div className={styles.toolsBlock}>
        <h2 className={styles.toolsTitle} id="tools-title">
          Tools
        </h2>
        <ul className={styles.tools} aria-labelledby="tools-title">
          {TOOLS.map((tool) => {
            const Icon = TOOL_ICONS[tool.id] ?? FileImage;
            return (
              <li key={tool.id}>
                <button type="button" className={styles.tool} onClick={() => onTool(tool.id)}>
                  <span className={styles.toolIcon} aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span className={styles.toolText}>
                    <span className={styles.toolLabel}>{tool.label}</span>
                    <span className={styles.toolHint}>{tool.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <ul className={styles.promises} aria-label="Why Compressive">
        {PROMISES.map(({ title, text, Icon }) => (
          <li key={title} className={styles.promise}>
            <Icon size={20} aria-hidden="true" className={styles.promiseIcon} />
            <div>
              <p className={styles.promiseTitle}>{title}</p>
              <p className={styles.promiseText}>{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
