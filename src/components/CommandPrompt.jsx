/**
 * CommandPrompt: an animated, flat terminal that helps visitors find the right
 * tool. Clicking a command (or typing one, or typing a plain request such as
 * "make my photo.jpg smaller") prints what the tool does and a button that opens
 * the matching file picker. It never reads or uploads files itself.
 *
 * Commands and their output are plain data: edit COMMANDS below, and the tool
 * texts in src/ui/tools.js.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { interpretRequest, TOOLS } from '../ui/tools.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import styles from './CommandPrompt.module.css';

/** Sidebar commands, in order. `tool` links to an entry in TOOLS. */
const COMMANDS = [
  { command: '/help', description: 'See every command', accent: 'sky', run: 'help' },
  ...TOOLS.map((tool) => ({ command: tool.command, description: tool.description, accent: tool.accent, tool: tool.id })),
  { command: '/clear', description: 'Start fresh', accent: 'coral', run: 'clear' },
];

/** Extra spellings the prompt understands. */
const ALIASES = { '/jpeg': '/jpg', '/?': '/help', '/compress': '/help', '/cls': '/clear' };

const WELCOME = { kind: 'success', text: 'Welcome to Compressive. Everything runs in this browser; nothing is uploaded.' };
const TIMING = { typePerCharacter: 35, spinner: 1000, betweenLines: 180, autoRun: 500, spinnerFrame: 80 };
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const toolById = (id) => TOOLS.find((tool) => tool.id === id);
const actionLine = (tool) => ({ kind: 'action', text: tool.actionLabel, toolId: tool.id });

/**
 * Works out what to print for an input. Pure, so it is easy to test and edit.
 *
 * @param {string} input
 * @returns {{ clear?: boolean, spinnerLabel: string, lines: { kind: string, text: string, toolId?: string }[] }}
 */
function respondTo(input) {
  const text = input.trim();
  if (text.startsWith('/')) {
    const name = text.split(/\s+/)[0].toLowerCase();
    const command = COMMANDS.find((item) => item.command === (ALIASES[name] ?? name));
    if (!command) {
      return {
        spinnerLabel: 'Working…',
        lines: [
          { kind: 'error', text: `Unknown command: ${name}` },
          { kind: 'muted', text: "Try /help to see what's available." },
        ],
      };
    }
    if (command.run === 'help') {
      const width = Math.max(...COMMANDS.map((item) => item.command.length)) + 2;
      return {
        spinnerLabel: 'Working…',
        lines: [
          ...COMMANDS.map((item) => ({ kind: 'info', text: `${item.command.padEnd(width)}${item.description}` })),
          { kind: 'muted', text: 'Or just type what you want to shrink, like "my photo.jpg".' },
        ],
      };
    }
    if (command.run === 'clear') {
      return { clear: true, spinnerLabel: 'Working…', lines: [{ kind: 'success', text: 'All clear. Ready for your next command.' }] };
    }
    const tool = toolById(command.tool);
    return { spinnerLabel: 'Working…', lines: [...tool.output, actionLine(tool)] };
  }

  const match = interpretRequest(text);
  if (match && 'tool' in match) {
    return {
      spinnerLabel: 'Thinking…',
      lines: [
        { kind: 'info', text: `Sounds like a job for ${match.tool.command} (${match.tool.label}).` },
        ...match.tool.output.slice(1),
        actionLine(match.tool),
      ],
    };
  }
  if (match && 'keptType' in match) {
    const zip = toolById('zip');
    return {
      spinnerLabel: 'Thinking…',
      lines: [
        { kind: 'warning', text: `${match.keptType.toUpperCase()} files are kept exactly as they are; Compressive never re-saves them.` },
        { kind: 'info', text: 'You can still zip them together with other files.' },
        actionLine(zip),
      ],
    };
  }
  return {
    spinnerLabel: 'Thinking…',
    lines: [
      { kind: 'info', text: 'I can compress PNG, JPG and WebP images, shrink PDFs and zip files.' },
      { kind: 'muted', text: 'This prompt only finds the right tool. Your files never leave this browser.' },
      { kind: 'muted', text: 'Try /help to see every command.' },
    ],
  };
}

/**
 * @param {{
 *   onAction: (toolId: string) => void,
 *   onSwitchTheme: () => void,
 * }} props
 */
export default function CommandPrompt({ onAction, onSwitchTheme }) {
  const reducedMotion = useReducedMotion();
  const [lines, setLines] = useState(() => [{ ...WELCOME, id: 0 }]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [spinnerLabel, setSpinnerLabel] = useState(null);
  const [frame, setFrame] = useState(0);

  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const nextId = useRef(1);
  const runToken = useRef(0);
  const timers = useRef(new Set());
  const reducedRef = useRef(reducedMotion);
  /** Set once the visitor runs something, so the automatic /help never interrupts them. */
  const visitorStarted = useRef(false);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  const sleep = useCallback(
    (ms) =>
      new Promise((resolve) => {
        const id = setTimeout(() => {
          timers.current.delete(id);
          resolve();
        }, ms);
        timers.current.add(id);
      }),
    [],
  );

  const run = useCallback(
    async (raw, { typed = false } = {}) => {
      const text = raw.trim();
      if (!text) return;
      runToken.current += 1;
      const token = runToken.current;
      const current = () => token === runToken.current;
      const instant = () => reducedRef.current;
      const push = (line) => {
        nextId.current += 1;
        const id = nextId.current;
        setLines((previous) => [...previous, { ...line, id }]);
      };
      const restoreFocus = typed;

      setRunning(true);
      setSpinnerLabel(null);
      if (!typed && !instant()) {
        for (let length = 1; length <= text.length; length += 1) {
          setInput(text.slice(0, length));
          await sleep(TIMING.typePerCharacter);
          if (!current()) return;
        }
      }
      setInput('');

      const response = respondTo(text);
      if (response.clear) setLines([]);
      else push({ kind: 'command', text });

      if (!instant()) {
        setSpinnerLabel(response.spinnerLabel);
        await sleep(TIMING.spinner);
        if (!current()) return;
        setSpinnerLabel(null);
      }
      for (const line of response.lines) {
        push(line);
        if (!instant()) {
          await sleep(TIMING.betweenLines);
          if (!current()) return;
        }
      }
      setRunning(false);
      if (restoreFocus) requestAnimationFrame(() => inputRef.current?.focus());
    },
    [sleep],
  );

  /** Runs a command the visitor asked for (as opposed to the automatic /help). */
  const runForVisitor = (text, options) => {
    visitorStarted.current = true;
    run(text, options);
  };

  // First load: the welcome line is already shown; run /help shortly after,
  // unless the visitor has already started a command of their own.
  useEffect(() => {
    const activeTimers = timers.current;
    const id = setTimeout(() => {
      activeTimers.delete(id);
      if (!visitorStarted.current) run('/help');
    }, TIMING.autoRun);
    activeTimers.add(id);
    return () => {
      runToken.current += 1; // abandon any run in progress
      for (const timer of activeTimers) clearTimeout(timer);
      activeTimers.clear();
    };
  }, [run]);

  // Braille spinner while a command is "working".
  useEffect(() => {
    if (!spinnerLabel) return undefined;
    const id = setInterval(() => setFrame((value) => (value + 1) % SPINNER_FRAMES.length), TIMING.spinnerFrame);
    return () => clearInterval(id);
  }, [spinnerLabel]);

  // Keep the newest output in view.
  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [lines, spinnerLabel]);

  const submit = (event) => {
    event.preventDefault();
    if (!running) runForVisitor(input, { typed: true });
  };

  return (
    <section className={styles.window} aria-label="Compressive command prompt">
      <div className={styles.titleBar}>
        <span className={styles.dots} aria-hidden="true">
          <span className={styles.dot} data-color="coral" />
          <span className={styles.dot} data-color="amber" />
          <span className={styles.dot} data-color="mint" />
        </span>
        <span className={styles.title}>compressive ~/your-files</span>
        <button type="button" className={styles.themeButton} onClick={onSwitchTheme}>
          Switch theme
        </button>
      </div>

      <div className={styles.panes}>
        <div className={styles.sidebar} role="group" aria-labelledby="prompt-sidebar-title">
          <h2 id="prompt-sidebar-title" className={styles.sidebarTitle}>
            Pick a command
          </h2>
          <ul className={styles.commandList}>
            {COMMANDS.map((item) => (
              <li key={item.command}>
                <button
                  type="button"
                  className={styles.command}
                  style={{ '--accent': `var(--${item.accent})` }}
                  onClick={() => runForVisitor(item.command)}
                >
                  <span className={styles.commandName}>{item.command}</span>
                  <span className={styles.commandDescription}>{item.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.terminal}>
          <div ref={outputRef} className={styles.output} role="log" aria-live="polite" aria-label="Command output" data-testid="prompt-output">
            {lines.map((line) =>
              line.kind === 'action' ? (
                <p key={line.id} className={styles.line} data-kind="action">
                  <button
                    type="button"
                    className={styles.actionButton}
                    style={{ '--accent': `var(--${toolById(line.toolId)?.accent ?? 'sky'})` }}
                    onClick={() => onAction(line.toolId)}
                  >
                    {line.text} →
                  </button>
                </p>
              ) : (
                <p key={line.id} className={styles.line} data-kind={line.kind}>
                  {line.kind === 'command' ? <span className={styles.echoMarker}>&gt; </span> : null}
                  {line.text}
                </p>
              ),
            )}
            {!running ? <span className={styles.cursor} aria-hidden="true" /> : null}
          </div>
          {spinnerLabel ? (
            <p className={styles.spinner} aria-hidden="true">
              <span className={styles.spinnerFrame}>{SPINNER_FRAMES[frame]}</span> {spinnerLabel}
            </p>
          ) : null}

          <form className={styles.promptBar} onSubmit={submit}>
            <span className={styles.marker} aria-hidden="true">
              &gt;
            </span>
            <input
              ref={inputRef}
              className={styles.input}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={running}
              placeholder="Type a command or what you want to shrink"
              aria-label="Command"
              autoComplete="off"
              spellCheck={false}
            />
          </form>
          <p className={styles.hint}>Press Enter to run. Click any command on the left to try it.</p>
        </div>
      </div>
    </section>
  );
}
