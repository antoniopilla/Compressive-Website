import styles from './Panel.module.css';

/**
 * A clay cushion with a title row, one per workflow step.
 * `step` numbers the workflow (Add files → Compress and download); `tone`
 * picks the pastel surface ('support' mint, 'cool' blue; cream by default).
 *
 * @param {{ id: string, step?: number, tone?: 'support' | 'cool', title: string, description?: string, actions?: import('react').ReactNode, children: import('react').ReactNode, className?: string }} props
 */
export default function Panel({ id, step, tone, title, description, actions, children, className }) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(' ')} data-tone={tone} aria-labelledby={`${id}-title`}>
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
