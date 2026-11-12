import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatNumber, UNITS } from './engine/index.js';
import { useFileStudio } from './hooks/useFileStudio.js';
import { useDownloads } from './hooks/useDownloads.js';
import { readPreference, usePreference, writePreference } from './hooks/usePreference.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import { resultHeadline } from './ui/labels.js';
import { SECTION_IDS } from './ui/sections.js';
import { useActiveSection } from './hooks/useActiveSection.js';
import SiteHeader from './components/SiteHeader.jsx';
import Hero from './components/Hero.jsx';
import Panel from './components/Panel.jsx';
import DropZone from './components/DropZone.jsx';
import NoticeList from './components/NoticeList.jsx';
import SelectionList from './components/SelectionList.jsx';
import PrintCheck from './components/PrintCheck.jsx';
import PreparePanel from './components/PreparePanel.jsx';
import ResultsPanel from './components/ResultsPanel.jsx';
import InfoSection from './components/InfoSection.jsx';
import PrivacySection from './components/PrivacySection.jsx';
import SiteFooter from './components/SiteFooter.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import styles from './App.module.css';

const THEMES = ['light', 'dark', 'system'];

/**
 * Browsers from before 2022 have no modal <dialog>. There the browser's own
 * confirm box asks instead, so Clear all and Start over always work.
 */
const CAN_SHOW_DIALOG =
  typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function';

/**
 * Text for the screen-reader live region, derived from the current state so
 * each meaningful change is announced once (progress phases, not percentages).
 *
 * @param {import('./engine/studio.js').StudioSnapshot} snapshot
 */
function announcementFor(snapshot) {
  const { status, selection, plan, progress, result, error } = snapshot;
  switch (status) {
    case 'validating':
      return selection.length === 1 ? 'Checking your file…' : `Checking ${selection.length} files…`;
    case 'processing':
      return progress ? `${progress.label}…` : 'Working…';
    case 'ready':
      return result ? `Ready. ${resultHeadline(result)}.` : '';
    case 'canceled':
      return 'Canceled.';
    case 'failed':
      return error ? `Something went wrong. ${error.message}` : 'Something went wrong.';
    default:
      if (!selection.length || !plan) return '';
      if (plan.route === 'invalid') {
        return `${plan.errors.length} ${plan.errors.length === 1 ? 'issue needs' : 'issues need'} attention first.`;
      }
      return `${selection.length} ${selection.length === 1 ? 'file' : 'files'} added. ${plan.summary}`;
  }
}

/**
 * What each confirmation says. Both actions only clear this page: the
 * visitor's own files are never touched, and the text says so.
 *
 * @param {'clear' | 'reset'} kind
 * @param {{ fileCount: number, hasResult: boolean }} context
 */
function confirmationFor(kind, { fileCount, hasResult }) {
  if (kind === 'reset') {
    return {
      title: 'Start over without downloading?',
      description:
        'You have not downloaded the result yet. Starting over removes it, along with your files, from this page. The files on your device are not changed.',
      confirmLabel: 'Start over',
      cancelLabel: 'Keep result',
    };
  }
  const files = fileCount === 1 ? 'The file you added' : `All ${formatNumber(fileCount)} files you added`;
  return {
    title: 'Clear all files?',
    description: `${files}${hasResult ? ' and the result' : ''} will be removed from this page. The files on your device are not changed.`,
    confirmLabel: 'Clear all',
    cancelLabel: 'Keep files',
  };
}

export default function App() {
  const [theme, setTheme] = usePreference('theme', 'system', THEMES);
  const [studioOptions] = useState(() => ({
    initialPrintSize: { unit: readPreference('unit', 'ft', Object.keys(UNITS)) },
  }));
  const { snapshot, actions } = useFileStudio(studioOptions);
  const downloads = useDownloads();
  const reducedMotion = useReducedMotion();
  const [printOpen, setPrintOpen] = useState(false);
  /** Which destructive action is waiting for confirmation, if any. */
  const [confirming, setConfirming] = useState(/** @type {'clear' | 'reset' | null} */ (null));
  /** The last result whose main file was downloaded, so starting over afterwards needs no question. */
  const [savedResult, setSavedResult] = useState(null);
  const activeSection = useActiveSection(SECTION_IDS);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const { status, selection, result } = snapshot;
  const processing = status === 'processing';
  const scrollBehavior = reducedMotion ? 'auto' : 'smooth';

  const focusChooseFiles = () => requestAnimationFrame(() => document.getElementById('choose-files-button')?.focus());
  const handleReset = () => {
    actions.reset();
    focusChooseFiles();
  };
  const handleClear = () => {
    actions.clearSelection();
    focusChooseFiles();
  };

  const runConfirmed = (kind) => (kind === 'clear' ? handleClear() : handleReset());
  /** Asks before a destructive action and runs it only if the visitor agrees. */
  const ask = (kind) => {
    if (CAN_SHOW_DIALOG) {
      setConfirming(kind);
      return;
    }
    const { title, description } = confirmationFor(kind, { fileCount: selection.length, hasResult: Boolean(result) });
    if (window.confirm(`${title}\n\n${description}`)) runConfirmed(kind);
  };

  // Clearing everything always asks first; starting over asks only while the result has not been downloaded.
  const requestClear = () => ask('clear');
  const requestReset = () => {
    if (result && result !== savedResult) ask('reset');
    else handleReset();
  };
  const confirmPending = () => {
    const pending = confirming;
    setConfirming(null);
    if (pending) runConfirmed(pending);
  };

  const handleDownload = (blob, filename) => {
    downloads.download(blob, filename);
    if (result && blob === result.artifact.blob) setSavedResult(result);
  };

  const openPrintCheck = () => {
    setPrintOpen(true);
    requestAnimationFrame(() => {
      const input = document.getElementById('print-width');
      input?.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
      input?.focus({ preventScroll: true });
    });
  };

  const confirmation = confirmationFor(confirming ?? 'clear', { fileCount: selection.length, hasResult: Boolean(result) });

  return (
    <div className={styles.app}>
      <a className="skip-link" href="#workspace">
        Skip to your files
      </a>
      <SiteHeader theme={theme} onThemeChange={setTheme} activeSection={activeSection} />
      <main id="main" className={styles.main}>
        <Hero />

        <section id="workspace" className={styles.workspaceSection} tabIndex={-1} aria-labelledby="workspace-title">
          {/* The opening already introduces the workspace; the heading names it for screen readers. */}
          <h2 id="workspace-title" className="visually-hidden">
            Compress your files
          </h2>
          <div className={styles.workspace}>
            <Panel
              id="files"
              step={1}
              title="Add files"
              description="One image or PDF is compressed. Several files go into one ZIP."
              actions={
                selection.length ? (
                  <button type="button" className="btn btn-ghost" onClick={requestClear} disabled={processing}>
                    <Trash2 size={16} aria-hidden="true" /> Clear all
                  </button>
                ) : null
              }
            >
              <DropZone
                onFiles={(files, rejected) => actions.addFiles(files, { rejected })}
                disabled={processing}
                hasFiles={selection.length > 0}
              />
              <NoticeList notices={snapshot.notices} onDismiss={actions.dismissNotice} />
              <SelectionList
                selection={selection}
                selectionHealth={snapshot.selectionHealth}
                disabled={processing}
                onRemove={actions.removeFile}
                onReplace={actions.replaceFile}
              />
              <PrintCheck
                open={printOpen}
                onToggle={() => setPrintOpen((open) => !open)}
                printSize={snapshot.printSize}
                errors={snapshot.printSizeErrors}
                onChange={actions.setPrintSize}
                onUnitPreference={(unit) => writePreference('unit', unit)}
              />
            </Panel>

            <Panel id="compress" step={2} title="Compress and download">
              <PreparePanel snapshot={snapshot} onPrepare={actions.prepare} onCancel={actions.cancel} onRetry={actions.retry} />
              {result ? (
                <ResultsPanel
                  snapshot={snapshot}
                  actions={{ ...actions, reset: requestReset }}
                  onDownload={handleDownload}
                  onOpenPrintCheck={openPrintCheck}
                />
              ) : null}
            </Panel>
          </div>
        </section>

        <InfoSection />
        <PrivacySection />
      </main>

      <SiteFooter />
      {CAN_SHOW_DIALOG ? (
        <ConfirmDialog
          open={confirming !== null}
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          cancelLabel={confirmation.cancelLabel}
          onConfirm={confirmPending}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region">
        {announcementFor(snapshot)}
      </div>
    </div>
  );
}
