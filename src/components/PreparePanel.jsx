import { Ban, CircleAlert, FileArchive, FileImage, FileText, Layers, LoaderCircle, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { formatBytes } from '../engine/index.js';
import { primaryActionLabel, ROUTE_LABELS } from '../ui/labels.js';
import styles from './PreparePanel.module.css';

const ROUTE_ICONS = {
  'protected-passthrough': ShieldCheck,
  'zip-originals': FileArchive,
  'image-compress': FileImage,
  'pdf-rewrite': FileText,
  'psd-passthrough': Layers,
};

/**
 * Route summary, the main action (labelled for what it will do), progress and
 * cancellation.
 *
 * @param {{ snapshot: import('../engine/studio.js').StudioSnapshot, onPrepare: () => void, onCancel: () => void, onRetry: () => void }} props
 */
export default function PreparePanel({ snapshot, onPrepare, onCancel, onRetry }) {
  const { status, plan, selection, progress, error } = snapshot;
  const processing = status === 'processing';
  const ready = plan && plan.route !== 'idle' && plan.route !== 'invalid';
  const RouteIcon = (plan && ROUTE_ICONS[plan.route]) || Sparkles;
  const percent = progress ? Math.round(progress.fraction * 100) : 0;

  let disabledReason = null;
  if (!selection.length) disabledReason = 'Choose at least one file first.';
  else if (status === 'validating' || !plan) disabledReason = 'Checking your files…';
  else if (plan.route === 'invalid') disabledReason = 'Fix the issues above first.';

  const filesById = new Map(selection.map((entry) => [entry.id, entry]));

  return (
    <div className={styles.panel}>
      {plan && plan.route !== 'idle' ? (
        <div className={styles.plan} data-route={plan.route}>
          <span className={styles.planIcon} aria-hidden="true">
            {plan.route === 'invalid' ? <CircleAlert size={20} /> : <RouteIcon size={20} />}
          </span>
          <div className={styles.planText}>
            <p className={styles.planLabel}>
              {ROUTE_LABELS[plan.route]}
              <span className={styles.planTotals}>
                {' · '}
                {plan.totals.files} {plan.totals.files === 1 ? 'file' : 'files'}, {formatBytes(plan.totals.bytes)}
              </span>
            </p>
            <p className={styles.planSummary}>{plan.summary}</p>
            {plan.errors.length ? (
              <ul className={styles.errors}>
                {plan.errors.map((planError) => (
                  <li key={`${planError.fileId ?? 'batch'}-${planError.code}`}>
                    {planError.fileId && filesById.get(planError.fileId) ? (
                      <strong className={styles.errorName}>{filesById.get(planError.fileId).name}: </strong>
                    ) : null}
                    {planError.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : (
        <p className={styles.empty}>Add a file and you will see exactly what happens to it before anything runs.</p>
      )}

      {processing && progress ? (
        <div className={styles.progressBlock}>
          <div className={styles.progressHeader}>
            <span className={styles.progressLabel}>
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
              {progress.label}…
            </span>
            <span className={styles.progressPercent}>{percent}%</span>
          </div>
          <div
            className={styles.track}
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${progress.label}, ${percent}%`}
          >
            <div className={styles.bar} style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
          <button type="button" className="btn btn-danger" onClick={onCancel}>
            <Ban size={17} aria-hidden="true" /> Cancel
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            // Once a result is ready, Download is the main action and this one steps back.
            className={status === 'ready' ? 'btn btn-secondary' : 'btn btn-primary btn-lg'}
            onClick={status === 'canceled' || status === 'failed' ? onRetry : onPrepare}
            disabled={Boolean(disabledReason) || !ready}
            aria-describedby={disabledReason ? 'prepare-hint' : undefined}
            data-testid="prepare-button"
          >
            {status === 'canceled' || status === 'failed' ? (
              <>
                <RotateCcw size={18} aria-hidden="true" /> Try again
              </>
            ) : (
              <>
                <Sparkles size={18} aria-hidden="true" /> {status === 'ready' ? 'Run again' : primaryActionLabel(ready ? plan.route : undefined)}
              </>
            )}
          </button>
          {disabledReason ? (
            <p id="prepare-hint" className={styles.hint}>
              {disabledReason}
            </p>
          ) : null}
        </div>
      )}

      {snapshot.capabilities.workers ? null : (
        <p className={styles.notice} role="note">
          This browser cannot run background processing, so only smaller files can be handled here. For large files, use a
          recent version of Chrome, Edge, Firefox or Safari.
        </p>
      )}
      {status === 'canceled' ? (
        <p className={styles.notice} role="note">
          Canceled. Nothing was changed or downloaded. You can try again or pick other files.
        </p>
      ) : null}
      {status === 'failed' && error ? (
        <p className={styles.failure}>
          <CircleAlert size={18} aria-hidden="true" />
          <span>{error.message}</span>
        </p>
      ) : null}
    </div>
  );
}
