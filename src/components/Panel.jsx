import styles from './Panel.module.css';

/**
 * A numbered workflow card. `step` matches the four workflow steps shown in
 * the introduction (Choose files → Print size → Prepare → Download).
 *
 * @param {{ id: string, step?: number, title: string, description?: string, actions?: import('react').ReactNode, children: import('react').ReactNode, className?: string }} props
 */
export default function Panel({ id, step, title, description, actions, children, className }) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(' ')} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          {step ? (
            <span className={styles.step} aria-hidden="true">
              {step}
            </span>
          ) : null}
          <div className={styles.titles}>
            <h2 id={`${id}-title`} className={styles.title}>
              {step ? <span className="visually-hidden">Step {step}: </span> : null}
              {title}
            </h2>
            {description ? <p className={styles.description}>{description}</p> : null}
          </div>
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
