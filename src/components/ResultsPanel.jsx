import { useRef } from 'react';
import { CircleCheck, CircleAlert, Download, Info, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  describePrintSize,
  formatBytes,
  formatDimensions,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPpi,
  RESOLUTION_POLICY,
} from '../engine/index.js';
import { downloadLabel, outcomeLabel, resultHeadline } from '../ui/labels.js';
import { ACCEPT } from '../ui/files.js';
import FileIcon from './FileIcon.jsx';
import HealthBadge from './HealthBadge.jsx';
import styles from './ResultsPanel.module.css';

/**
 * @param {{
 *   snapshot: import('../engine/studio.js').StudioSnapshot,
 *   actions: ReturnType<typeof import('../hooks/useFileStudio.js').useFileStudio>['actions'],
 *   onDownload: (blob: Blob, filename: string) => void,
 * }} props
 */
export default function ResultsPanel({ snapshot, actions, onDownload }) {
  const replaceInputRef = useRef(null);
  const replaceTargetRef = useRef(null);
  const { result, health, acknowledgement, printSize } = snapshot;
  if (!result || !health) return null;

  const { totals } = result;
  const canDownload = !acknowledgement.required || acknowledgement.given;
  const primaryFile = result.files[0];
  const originalAvailable =
    (result.route === 'image-compress' || result.route === 'pdf-rewrite') && primaryFile.outcome === 'optimized';
  const warnedFiles = result.files.filter((file) => RESOLUTION_POLICY.acknowledgeStatuses.includes(health.files[file.fileId]?.status));

  const downloadPrimary = () => {
    if (canDownload) onDownload(result.artifact.blob, result.artifact.filename);
  };
  const downloadOriginal = () => {
    const original = actions.getDownload('original', primaryFile.fileId);
    if (original) onDownload(original.blob, original.filename);
  };
  const focusPrintSize = () => {
    const input = document.getElementById('print-width');
    input?.scrollIntoView({ block: 'center' });
    input?.focus();
  };
  const chooseReplacement = (fileId) => {
    replaceTargetRef.current = fileId;
    replaceInputRef.current?.click();
  };
  const handleReplacement = (event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (file && replaceTargetRef.current) actions.replaceFile(replaceTargetRef.current, file);
    replaceTargetRef.current = null;
  };

  const saved = totals.savedBytes;
  const savedLabel = saved > 0 ? 'Saved' : saved < 0 ? 'Larger by' : 'Change';
  const savedValue =
    saved === 0 ? 'No change' : `${formatBytes(Math.abs(saved))} (${formatPercent(Math.abs(totals.savedRatio))})`;

  return (
    <div className={styles.results} data-testid="results">
      <div className={styles.summary}>
        <p className={styles.headline}>
          <CircleCheck size={22} aria-hidden="true" className={styles.headlineIcon} />
          {resultHeadline(result)}
        </p>
        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>Before</dt>
            <dd data-testid="bytes-before">{formatBytes(totals.originalBytes)}</dd>
          </div>
          <div className={styles.stat}>
            <dt>After</dt>
            <dd data-testid="bytes-after">{formatBytes(totals.preparedBytes)}</dd>
          </div>
          <div className={styles.stat}>
            <dt>{savedLabel}</dt>
            <dd>{savedValue}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Time</dt>
            <dd>{formatDuration(result.durationMs)}</dd>
          </div>
        </dl>
        <p className={styles.preservation}>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{result.preservation.message}</span>
        </p>
        {result.constraints.applicable && result.constraints.limits?.maxBytes ? (
          <p className={styles.constraints} data-met={result.constraints.satisfied || undefined}>
            {result.constraints.satisfied ? <CircleCheck size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
            <span>
              {result.constraints.satisfied ? 'Meets the output limits' : 'Does not meet the output limits'}: up to{' '}
              {formatBytes(result.constraints.limits.maxBytes)} and {formatNumber(result.constraints.limits.maxWidth)} ×{' '}
              {formatNumber(result.constraints.limits.maxHeight)} px.
            </span>
          </p>
        ) : null}
      </div>

      {result.warnings.length ? (
        <ul className={styles.notices}>
          {result.warnings.map((warning) => (
            <li key={warning.code} className={styles.notice} data-severity={warning.severity ?? 'info'}>
              {warning.severity === 'warning' ? <TriangleAlert size={17} aria-hidden="true" /> : <Info size={17} aria-hidden="true" />}
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {acknowledgement.required ? (
        <div className={styles.ack} role="group" aria-labelledby="ack-title">
          <p id="ack-title" className={styles.ackTitle}>
            <TriangleAlert size={19} aria-hidden="true" /> Check the resolution before you download
          </p>
          <p className={styles.ackText}>
            {warnedFiles.length === 1
              ? `“${warnedFiles[0].name}” has low resolution for ${describePrintSize(printSize)}.`
              : `${warnedFiles.length} files have low resolution for ${describePrintSize(printSize)}.`}{' '}
            You can choose a higher-resolution file, change the print size, or continue anyway.
          </p>
          <label className={styles.ackCheck}>
            <input
              type="checkbox"
              checked={acknowledgement.given}
              onChange={(event) => actions.acknowledgeWarnings(event.target.checked)}
            />
            <span>
              I understand this artwork may print soft or pixelated at {describePrintSize(printSize)} and I want to
              continue.
            </span>
          </label>
          <div className={styles.ackActions}>
            <button type="button" className="btn btn-secondary" onClick={focusPrintSize}>
              Adjust print size
            </button>
            {warnedFiles.length === 1 ? (
              <button type="button" className="btn btn-secondary" onClick={() => chooseReplacement(warnedFiles[0].fileId)}>
                Choose a higher-resolution file
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.downloads}>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={downloadPrimary}
          disabled={!canDownload}
          aria-describedby={!canDownload ? 'download-locked' : 'download-filename'}
          data-testid="download-primary"
        >
          <Download size={19} aria-hidden="true" />
          {downloadLabel(result)} <span className={styles.size}>({formatBytes(result.artifact.size)})</span>
        </button>
        {originalAvailable ? (
          <button type="button" className="btn btn-secondary" onClick={downloadOriginal} data-testid="download-original">
            <Download size={17} aria-hidden="true" /> Download original ({formatBytes(primaryFile.originalBytes)})
          </button>
        ) : null}
      </div>
      {!canDownload ? (
        <p id="download-locked" className={styles.lockHint}>
          Tick the confirmation above to enable the download.
        </p>
      ) : (
        <p id="download-filename" className={styles.filename}>
          Saves as <span className={styles.code}>{result.artifact.filename}</span>
        </p>
      )}

      <h3 className={styles.sectionTitle}>File details</h3>
      <ul className={styles.files}>
        {result.files.map((file) => (
          <FileResult key={file.fileId} file={file} route={result.route} fileHealth={health.files[file.fileId]} details={result.details} />
        ))}
      </ul>

      {result.limitations.length ? (
        <div className={styles.limitations}>
          <h3 className={styles.sectionTitle}>Good to know</h3>
          <ul>
            {result.limitations.map((limitation) => (
              <li key={limitation.code}>{limitation.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.footer}>
        <button type="button" className="btn btn-secondary" onClick={actions.reset}>
          Start over
        </button>
      </div>

      <input
        ref={replaceInputRef}
        type="file"
        accept={ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleReplacement}
      />
    </div>
  );
}

/**
 * @param {{ file: import('../engine/pipeline.js').FileOutcome, route: string, fileHealth: import('../engine/health.js').FileHealth, details: any }} props
 */
function FileResult({ file, route, fileHealth, details }) {
  const dimensionsChanged =
    file.originalDimensions &&
    file.preparedDimensions &&
    (file.originalDimensions.width !== file.preparedDimensions.width ||
      file.originalDimensions.height !== file.preparedDimensions.height);
  const bytesChanged = file.preparedBytes !== null && file.preparedBytes !== file.originalBytes;
  const { original, prepared } = fileHealth;
  const delivered = prepared ?? original;
  const firstPage = route === 'pdf-rewrite' ? details?.stats?.firstPage : null;

  return (
    <li className={styles.file} data-outcome={file.outcome}>
      <div className={styles.fileHeader}>
        <span className={styles.fileIcon}>
          <FileIcon category={file.category} size={18} />
        </span>
        <p className={styles.fileName}>{file.name}</p>
        <span className={styles.outcome} data-outcome={file.outcome}>
          {outcomeLabel(file.outcome, route)}
        </span>
      </div>
      <p className={styles.fileMessage}>{file.message}</p>

      <dl className={styles.facts}>
        <div>
          <dt>File size</dt>
          <dd>
            {bytesChanged ? `${formatBytes(file.originalBytes)} → ${formatBytes(file.preparedBytes)}` : formatBytes(file.originalBytes)}
          </dd>
        </div>
        {file.originalDimensions ? (
          <div>
            <dt>Pixels</dt>
            <dd>
              {dimensionsChanged
                ? `${formatDimensions(file.originalDimensions)} → ${formatDimensions(file.preparedDimensions)}`
                : formatDimensions(file.originalDimensions)}
            </dd>
          </div>
        ) : null}
        {firstPage ? (
          <div>
            <dt>First page</dt>
            <dd>
              {formatNumber(firstPage.widthPt / 72, 2)} × {formatNumber(firstPage.heightPt / 72, 2)} in
            </dd>
          </div>
        ) : null}
        {route === 'pdf-rewrite' && details?.stats?.pageCount ? (
          <div>
            <dt>Pages</dt>
            <dd>{formatNumber(details.stats.pageCount)}</dd>
          </div>
        ) : null}
        {file.entryName && file.entryName !== file.name ? (
          <div>
            <dt>Name in ZIP</dt>
            <dd className={styles.entryName}>{file.entryName}</dd>
          </div>
        ) : null}
      </dl>

      <div className={styles.health}>
        {fileHealth.measurable && original ? (
          <>
            <div className={styles.healthRow}>
              <span className={styles.healthLabel}>{prepared && prepared !== original ? 'Original' : 'Resolution'}</span>
              <HealthBadge status={original.status} reason={original.reason} ppi={original.effectivePpi} />
              {prepared && prepared !== original ? (
                <>
                  <span className={styles.healthLabel}>Prepared</span>
                  <HealthBadge status={prepared.status} reason={prepared.reason} ppi={prepared.effectivePpi} />
                </>
              ) : null}
            </div>
            <p className={styles.healthMessage}>{delivered.message}</p>
            {delivered.ppiX !== null ? (
              <p className={styles.healthDetail}>
                Horizontal {formatPpi(delivered.ppiX)} · Vertical {formatPpi(delivered.ppiY)} · effective PPI is the
                lower of the two.
              </p>
            ) : null}
            {fileHealth.crossingMessage ? (
              <p className={styles.crossing}>
                <TriangleAlert size={16} aria-hidden="true" /> {fileHealth.crossingMessage}
              </p>
            ) : fileHealth.comparison?.sourceBelowTarget && original.status !== 'unknown' ? (
              <p className={styles.healthDetail}>
                Your original is already below the {RESOLUTION_POLICY.targetPpi} PPI target at this size; preparing did
                not lower its resolution.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className={styles.healthRow}>
              <span className={styles.healthLabel}>Resolution</span>
              <HealthBadge status="unknown" />
            </div>
            <p className={styles.healthMessage}>{fileHealth.limitation}</p>
          </>
        )}
        {fileHealth.measurable && fileHealth.limitation ? <p className={styles.healthDetail}>{fileHealth.limitation}</p> : null}
        {fileHealth.aspectMessage ? (
          <p className={styles.aspect}>
            <Info size={16} aria-hidden="true" /> {fileHealth.aspectMessage}
          </p>
        ) : null}
      </div>

      {file.notes.length ? (
        <ul className={styles.notes}>
          {file.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
