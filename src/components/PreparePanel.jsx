import {
  Ban,
  CircleAlert,
  FileArchive,
  FileImage,
  FileText,
  Info,
  Layers,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
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
 * cancellation. Once the result is in, the result panel takes over: running
 * the same files again would only give the same result.
 *
 * @param {{ snapshot: import('../engine/studio.js').StudioSnapshot, onPrepare: () => void, onCancel: () => void, onRetry: () => void }} props
 */
export default function PreparePanel({ snapshot, onPrepare, onCancel, onRetry }) {
  const { status, plan, selection, progress, error } = snapshot;
  const processing = status === 'processing';
  const done = status === 'ready';
  const limitedBrowser = !snapshot.capabilities.workers;
  if (done && !limitedBrowser) return null;
  const ready = plan && plan.route !== 'idle' && plan.route !== 'invalid';
  const RouteIcon = (plan && ROUTE_ICONS[plan.route]) || Sparkles;
  const percent = progress ? Math.round(progress.fraction * 100) : 0;
  const checking = selection.length > 0 && (status === 'validating' || !plan);

  let disabledReason = null;
  if (!selection.length) disabledReason = 'Choose at least one file first.';
  else if (checking) disabledReason = 'Checking your files…';
  else if (plan.route === 'invalid') disabledReason = 'Fix the issues above first.';

  const filesById = new Map(selection.map((entry) => [entry.id, entry]));

  return (
    <div className={styles.panel}>
      {done ? null : plan && plan.route !== 'idle' ? (
        <div className={styles.plan} data-route={plan.route}>
          <span className="icon-tile" data-tone={plan.route === 'invalid' ? 'error' : undefined} aria-hidden="true">
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
        <p className={styles.empty}>Add files to see exactly what will happen before anything runs.</p>
      )}

      {processing && progress ? (
        <div className={styles.progressBlock}>
          <div className={styles.progressHeader}>
            <span className={styles.progressLabel}>
              <LoaderCircle size={18} className="spin" aria-hidden="true" />
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
            <Ban size={18} aria-hidden="true" /> Cancel
          </button>
        </div>
      ) : done ? null : (
        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-primary btn-lg"
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
                <Sparkles size={18} aria-hidden="true" /> {primaryActionLabel(ready ? plan.route : undefined)}
              </>
            )}
          </button>
          {disabledReason ? (
            <p id="prepare-hint" className={styles.hint}>
              {checking ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}
              {disabledReason}
            </p>
          ) : null}
        </div>
      )}

      {limitedBrowser ? (
        <p className="callout" data-tone="info" role="note">
          <Info size={18} aria-hidden="true" />
          <span>
            This browser cannot run background processing, so only smaller files can be handled here. For large files, use
            a recent version of Chrome, Edge, Firefox or Safari.
          </span>
        </p>
      ) : null}
      {status === 'canceled' ? (
        <p className="callout" role="note">
          <Ban size={18} aria-hidden="true" />
          <span>Canceled. Nothing was changed or downloaded. You can try again or pick other files.</span>
        </p>
      ) : null}
      {status === 'failed' && error ? (
        <p className="callout" data-tone="error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{error.message}</span>
        </p>
      ) : null}
    </div>
  );
}
