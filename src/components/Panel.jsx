import styles from './Panel.module.css';

/**
 * A flat window with a title bar, matching the command prompt's look.
 * `step` numbers the workflow (Add files → Compress and download).
 *
 * @param {{ id: string, step?: number, title: string, description?: string, actions?: import('react').ReactNode, children: import('react').ReactNode, className?: string }} props
 */
export default function Panel({ id, step, title, description, actions, children, className }) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(' ')} aria-labelledby={`${id}-title`}>
      <header className={styles.titleBar}>
        <div className={styles.heading}>
          {step ? (
            <span className={styles.step} aria-hidden="true">
              {step}
            </span>
          ) : null}
          <h2 id={`${id}-title`} className={styles.title}>
            {step ? <span className="visually-hidden">Step {step}: </span> : null}
            {title}
          </h2>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={styles.body}>
        {description ? <p className={styles.description}>{description}</p> : null}
        {children}
      </div>
    </section>
  );
}
