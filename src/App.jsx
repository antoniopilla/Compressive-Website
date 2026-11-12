import { useEffect, useRef, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { formatNumber, UNITS } from './engine/index.js';
import { useFileStudio } from './hooks/useFileStudio.js';
import { useDownloads } from './hooks/useDownloads.js';
import { readPreference, usePreference, writePreference } from './hooks/usePreference.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import { resultHeadline } from './ui/labels.js';
import { TOOLS } from './ui/tools.js';
import { ACCEPT } from './ui/files.js';
import { SECTION_IDS } from './ui/sections.js';
import { useActiveSection } from './hooks/useActiveSection.js';
import SiteHeader from './components/SiteHeader.jsx';
import Hero from './components/Hero.jsx';
import SectionHeader from './components/SectionHeader.jsx';
import Panel from './components/Panel.jsx';
import DropZone from './components/DropZone.jsx';
import NoticeList from './components/NoticeList.jsx';
import SelectionList from './components/SelectionList.jsx';
import PrintCheck from './components/PrintCheck.jsx';
import PreparePanel from './components/PreparePanel.jsx';
import ResultsPanel from './components/ResultsPanel.jsx';
import InfoSection from './components/InfoSection.jsx';
import PrivacySection from './components/PrivacySection.jsx';
import BottomNav from './components/BottomNav.jsx';
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
  const toolInputRef = useRef(null);
  const pendingToolRef = useRef(null);
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

  /** Opens the file picker with the given settings. Runs inside the click, so browsers allow it. */
  const openPicker = (picker) => {
    const input = toolInputRef.current;
    if (!input) return;
    pendingToolRef.current = picker;
    input.accept = picker.accept;
    input.multiple = Boolean(picker.multiple);
    input.click();
  };

  /** Opens the file picker for a tool, or the print check. */
  const openTool = (toolId) => {
    const tool = TOOLS.find((item) => item.id === toolId);
    if (!tool) return;
    if (tool.action === 'print') openPrintCheck();
    else openPicker(tool);
  };

  /** The hero's primary action: any supported files, added to the selection. */
  const chooseAnyFiles = () => openPicker({ accept: ACCEPT, multiple: true, replace: false });

  const handleToolFiles = (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    const tool = pendingToolRef.current;
    pendingToolRef.current = null;
    if (!files.length || !tool) return;
    // Single-file tools start a fresh selection; the ZIP tool adds to it.
    if (tool.replace) actions.clearSelection();
    actions.addFiles(files);
    document.getElementById('workspace')?.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
  };

  const confirmation = confirmationFor(confirming ?? 'clear', { fileCount: selection.length, hasResult: Boolean(result) });

  return (
    <div className={styles.app}>
      <a className="skip-link" href="#workspace">
        Skip to your files
      </a>
      <SiteHeader theme={theme} onThemeChange={setTheme} activeSection={activeSection} />
      <main id="main" className={styles.main}>
        <Hero onTool={openTool} onChooseFiles={chooseAnyFiles} />

        <section id="workspace" className={styles.workspaceSection} tabIndex={-1} aria-labelledby="workspace-title">
          <SectionHeader
            titleId="workspace-title"
            title="Compress your files"
            lead="Add your files, then compress and download them."
          />
          <div className={styles.workspace}>
            <Panel
              id="files"
              step={1}
              title="Add files"
              description="One image or PDF is compressed on its own. Several files are packed into one ZIP."
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
              ) : (
                <div className={styles.placeholder}>
                  <span className="icon-tile" data-tone="neutral" aria-hidden="true">
                    <Download size={20} />
                  </span>
                  <p className={styles.placeholderText}>
                    Your result appears here, with the size before and after and anything worth knowing, followed by the
                    download.
                  </p>
                </div>
              )}
            </Panel>
          </div>
        </section>

        <InfoSection />
        <PrivacySection />
      </main>

      <SiteFooter />
      <BottomNav activeSection={activeSection} />
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
      <input
        ref={toolInputRef}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleToolFiles}
        data-testid="tool-file-input"
      />
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region">
        {announcementFor(snapshot)}
      </div>
    </div>
  );
}
