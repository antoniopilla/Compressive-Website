import { FileArchive, FileImage, FileText, Image, Images, Printer, ShieldCheck, Undo2, Zap } from 'lucide-react';
import { TOOLS } from '../ui/tools.js';
import CommandPrompt from './CommandPrompt.jsx';
import styles from './Hero.module.css';

const TOOL_ICONS = { png: Image, jpg: FileImage, webp: Images, pdf: FileText, zip: FileArchive, print: Printer };

const PROMISES = [
  {
    title: 'Your files stay on your device.',
    text: 'Everything runs in this browser tab. Nothing is uploaded, and closing the page clears it.',
    Icon: ShieldCheck,
    accent: 'mint',
  },
  {
    title: 'Free, with no sign-up',
    text: 'No account, no queue and no watermark. Use it as often as you like.',
    Icon: Zap,
    accent: 'sky',
  },
  {
    title: 'Your original is always there',
    text: 'If compressing would not help, or could change how a file looks, you get it back untouched.',
    Icon: Undo2,
    accent: 'violet',
  },
];

/**
 * Introduction: what Compressive is, one button per tool, and the command
 * prompt. Every tool button opens the matching file picker straight away.
 *
 * @param {{ onTool: (toolId: string) => void, onSwitchTheme: () => void }} props
 */
export default function Hero({ onTool, onSwitchTheme }) {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.top}>
        <div className={styles.copy}>
          <p className={styles.kicker}>Free, private and no sign-up</p>
          <h1 id="hero-title" className={styles.title}>
            Make your files smaller, right here in your browser
          </h1>
          <p className={styles.lead}>
            Compress PNG, JPG and WebP images, shrink PDFs or zip a batch of files. Pick a tool to start, or drop files
            below.
          </p>

          <ul className={styles.tools} aria-label="Tools">
            {TOOLS.map((tool) => {
              const Icon = TOOL_ICONS[tool.id] ?? FileImage;
              return (
                <li key={tool.id}>
                  <button
                    type="button"
                    className={styles.tool}
                    style={{ '--accent': `var(--${tool.accent})` }}
                    onClick={() => onTool(tool.id)}
                  >
                    <Icon size={18} aria-hidden="true" className={styles.toolIcon} />
                    {tool.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <ul className={styles.promises} aria-label="Why Compressive">
          {PROMISES.map(({ title, text, Icon, accent }) => (
            <li key={title} className={styles.promise} style={{ '--accent': `var(--${accent})` }}>
              <Icon size={20} aria-hidden="true" className={styles.promiseIcon} />
              <div>
                <p className={styles.promiseTitle}>{title}</p>
                <p className={styles.promiseText}>{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <CommandPrompt onAction={onTool} onSwitchTheme={onSwitchTheme} />
    </section>
  );
}
