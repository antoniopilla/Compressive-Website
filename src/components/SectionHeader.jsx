import styles from './SectionHeader.module.css';

/**
 * The title and short introduction that open each main section, so every
 * section starts the same way.
 *
 * @param {{ titleId: string, title: string, lead?: import('react').ReactNode }} props
 */
export default function SectionHeader({ titleId, title, lead }) {
  return (
    <div className={styles.heading}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
    </div>
  );
}
