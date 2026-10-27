import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { UNITS } from './engine/index.js';
import { useFileStudio } from './hooks/useFileStudio.js';
import { useDownloads } from './hooks/useDownloads.js';
import { readPreference, usePreference, writePreference } from './hooks/usePreference.js';
import { resultHeadline } from './ui/labels.js';
import SiteHeader from './components/SiteHeader.jsx';
import Intro from './components/Intro.jsx';
import Panel from './components/Panel.jsx';
import DropZone from './components/DropZone.jsx';
import NoticeList from './components/NoticeList.jsx';
import SelectionList from './components/SelectionList.jsx';
import PrintSizeForm from './components/PrintSizeForm.jsx';
import PreparePanel from './components/PreparePanel.jsx';
import ResultsPanel from './components/ResultsPanel.jsx';
import InfoSection from './components/InfoSection.jsx';
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
      return progress ? `${progress.label}…` : 'Preparing…';
    case 'ready':
      return result ? `Ready. ${resultHeadline(result)}.` : '';
    case 'canceled':
      return 'Preparation canceled.';
    case 'failed':
      return error ? `Preparation failed. ${error.message}` : 'Preparation failed.';
    default:
      if (!selection.length || !plan) return '';
      if (plan.route === 'invalid') {
        return `${plan.errors.length} ${plan.errors.length === 1 ? 'issue needs' : 'issues need'} attention before preparing.`;
      }
      return `${selection.length} ${selection.length === 1 ? 'file' : 'files'} selected. ${plan.summary}`;
  }
}

export default function App() {
  const [theme, setTheme] = usePreference('theme', 'system', THEMES);
  const [studioOptions] = useState(() => ({
    initialPrintSize: { unit: readPreference('unit', 'ft', Object.keys(UNITS)) },
  }));
  const { snapshot, actions } = useFileStudio(studioOptions);
  const downloads = useDownloads();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const { status, selection } = snapshot;
  const processing = status === 'processing';

  const focusChooseFiles = () => requestAnimationFrame(() => document.getElementById('choose-files-button')?.focus());
  const handleReset = () => {
    actions.reset();
    focusChooseFiles();
  };
  const handleClear = () => {
    actions.clearSelection();
    focusChooseFiles();
  };

  return (
    <div className={styles.app}>
      <a className="skip-link" href="#workspace">
        Skip to the file workspace
      </a>
      <SiteHeader theme={theme} onThemeChange={setTheme} />
      <main id="main" className={styles.main}>
        <Intro />

        <div id="workspace" className={styles.workspace} tabIndex={-1}>
          <div className={styles.column}>
            <Panel
              id="artwork"
              step={1}
              title="Choose your artwork"
              description="Add one file to prepare it, or several to package your originals together."
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
            </Panel>

            <Panel
              id="print-size"
              step={2}
              title="Set the print size"
              description="The finished size of the print. Used only for the resolution check; your files are never resized to match it."
            >
              <PrintSizeForm
                printSize={snapshot.printSize}
                errors={snapshot.printSizeErrors}
                onChange={actions.setPrintSize}
                onUnitPreference={(unit) => writePreference('unit', unit)}
              />
            </Panel>
          </div>

          <div className={styles.column}>
            <Panel id="prepare" step={3} title="Prepare">
              <PreparePanel snapshot={snapshot} onPrepare={actions.prepare} onCancel={actions.cancel} onRetry={actions.retry} />
            </Panel>

            <Panel id="results" step={4} title="Review and download">
              {snapshot.result ? (
                <ResultsPanel snapshot={snapshot} actions={{ ...actions, reset: handleReset }} onDownload={downloads.download} />
              ) : (
                <p className={styles.placeholder}>
                  After you prepare, you will see file sizes before and after, pixel dimensions, resolution for your print
                  size and anything you should check, followed by the download.
                </p>
              )}
            </Panel>
          </div>
        </div>

        <InfoSection />
      </main>

      <footer className={styles.footer}>
        <p>
          Compressive prepares files in your browser. No uploads, no accounts and no tracking. Resolution
          thresholds are guidance, so confirm final requirements with your print provider.
        </p>
      </footer>

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region">
        {announcementFor(snapshot)}
      </div>
    </div>
  );
}
