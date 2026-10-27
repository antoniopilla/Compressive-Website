import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { UNITS } from './engine/index.js';
import { useFileStudio } from './hooks/useFileStudio.js';
import { useDownloads } from './hooks/useDownloads.js';
import { readPreference, usePreference, writePreference } from './hooks/usePreference.js';
import { useReducedMotion } from './hooks/useReducedMotion.js';
import { resultHeadline } from './ui/labels.js';
import { TOOLS } from './ui/tools.js';
import { ACCEPT } from './ui/files.js';
import { SECTION_IDS } from './ui/sections.js';
import { useActiveSection } from './hooks/useActiveSection.js';
import { useReveal } from './hooks/useReveal.js';
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
import BottomNav from './components/BottomNav.jsx';
import SiteFooter from './components/SiteFooter.jsx';
import styles from './App.module.css';

const THEMES = ['light', 'dark', 'system'];

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

export default function App() {
  const [theme, setTheme] = usePreference('theme', 'system', THEMES);
  const [studioOptions] = useState(() => ({
    initialPrintSize: { unit: readPreference('unit', 'ft', Object.keys(UNITS)) },
  }));
  const { snapshot, actions } = useFileStudio(studioOptions);
  const downloads = useDownloads();
  const reducedMotion = useReducedMotion();
  const [printOpen, setPrintOpen] = useState(false);
  const toolInputRef = useRef(null);
  const pendingToolRef = useRef(null);
  const activeSection = useActiveSection(SECTION_IDS);
  const workspaceReveal = useReveal();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const { status, selection } = snapshot;
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

  return (
    <div className={styles.app}>
      <a className="skip-link" href="#workspace">
        Skip to your files
      </a>
      <SiteHeader theme={theme} onThemeChange={setTheme} activeSection={activeSection} />
      <main id="main" className={styles.main}>
        <Hero onTool={openTool} onChooseFiles={chooseAnyFiles} />

        <section
          id="workspace"
          ref={workspaceReveal}
          className={styles.workspaceSection}
          tabIndex={-1}
          aria-labelledby="workspace-title"
        >
          <div className={styles.sectionHeading}>
            <h2 id="workspace-title" className={styles.sectionTitle}>
              Compress your files
            </h2>
            <p className={styles.sectionLead}>Add your files, then compress and download them.</p>
          </div>
          <div className={styles.workspace}>
            <Panel
              id="files"
              step={1}
              title="Add files"
              description="One image or PDF is compressed on its own. Several files are packed into one ZIP."
              actions={
                selection.length ? (
                  <button type="button" className="btn btn-ghost" onClick={handleClear} disabled={processing}>
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
              {snapshot.result ? (
                <ResultsPanel
                  snapshot={snapshot}
                  actions={{ ...actions, reset: handleReset }}
                  onDownload={downloads.download}
                  onOpenPrintCheck={openPrintCheck}
                />
              ) : (
                <p className={styles.placeholder}>
                  Your result appears here, with the size before and after and anything worth knowing, followed by the
                  download.
                </p>
              )}
            </Panel>
          </div>
        </section>

        <InfoSection />
        <PrivacySection />
      </main>

      <SiteFooter />
      <BottomNav activeSection={activeSection} />
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
