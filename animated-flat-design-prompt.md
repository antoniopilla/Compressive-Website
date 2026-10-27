# Task: Add an animated flat-design command prompt to this website

Add a terminal-style command prompt component to my existing website. It must match the project's current stack and conventions. Do not rewrite or restyle anything outside the new component and its mount point.

## Step 1: Inspect before you build

1. Read the repo structure, `package.json` (or equivalent), and any `CLAUDE.md` or README.
2. Identify the framework (React, Next.js, Vue, Svelte, Astro, plain HTML, etc.), the styling approach (Tailwind, CSS modules, SCSS, plain CSS), and the existing component, naming, and folder conventions.
3. Check whether the site already has CSS variables, a theme system, or dark mode. Reuse them where they exist. Only add the tokens below for anything missing.
4. State your plan in a few lines (files you will add or change, and where the component will mount), then proceed. Only ask me a question if something blocks you.

## Step 2: What to build

A single self-contained component, `CommandPrompt`, built in the project's own framework and style system.

**Layout**
- A flat window with rounded corners (14px), no shadows, no gradients.
- Title bar with three flat dots (coral, amber, mint), a title like `claude-code ~/my-project`, and a "Switch theme" button.
- Two panes below the title bar:
  - Left sidebar titled "Pick a command" with one button per command. Each button shows the command in monospace and a short plain-language description. Each has a 5px colored left edge.
  - Right terminal pane with a scrolling output area, then a prompt bar with a `>` marker and a text input (placeholder: "Type a command or ask Claude"), then a one-line hint: "Press Enter to run. Click any command on the left to try it."
- Under 700px wide, the sidebar moves above the terminal, wraps into a row, and hides the descriptions.

**Colors (flat, no gradients)**

Light:
- background `#EEF2FF`, window `#FFFFFF`, title and prompt bar `#DDE4FA`, sidebar `#F3F5FD`
- text `#1B2340`, muted `#5B6690`
- sky `#0B7FB5`, amber `#B26A00`, coral `#C93C3C`, violet `#5B4BD6`, mint `#0E8F6A`
- chip `#E3E8FB`, chip hover `#CFD8F8`

Dark:
- background `#141A33`, window `#1B2340`, title and prompt bar `#252F57`, sidebar `#18203B`
- text `#EAF0FF`, muted `#9AA6D3`
- sky `#4CC9F0`, amber `#FFB703`, coral `#FF7A7A`, violet `#A89BFF`, mint `#5EE6B8`
- chip `#26305A`, chip hover `#34407A`

Expose these as CSS variables. Follow `prefers-color-scheme` by default, and let the theme button override it. If the site already has a theme toggle, connect to it instead of adding a second one.

**Type**
- UI text: the site's existing body font.
- Command text, output, and prompt bar: the system monospace stack (`ui-monospace, Menlo, Consolas, monospace`).
- Sentence case everywhere. No all-caps labels.

**Commands (sidebar buttons, typeable in the prompt)**
| Command | Description | Edge color | Output |
|---|---|---|---|
| `/help` | See every command | sky | Lists all commands with one-line descriptions |
| `/init` | Set up this project | mint | Success lines: files scanned, CLAUDE.md written |
| `/review` | Check recent changes | amber | One success line, two amber warnings, a closing tip |
| `/model` | Choose a model | violet | Lists models with the current one marked |
| `/compact` | Free up space | sky | One success line about shortened conversation |
| `/clear` | Start fresh | coral | Clears the output, then prints a ready message |

- Unknown slash command: coral "Unknown command: /x" plus a muted "Try /help to see what's available."
- Plain text (not a slash command): spinner, then a sky reply and a muted note that this is a demo.
- Output colors: sky for info, mint for success, amber for warnings, coral for errors, muted for secondary text.
- Make the commands and their output a plain data object at the top of the component so they are easy to edit or replace with real behavior later.

## Step 3: Animation

- Window entrance: scale from 0.94 and fade in, 0.6s, plays once on load.
- On run, the command types itself into the input (about 35ms per character), then a braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) runs for about 1s with "Working…" or "Thinking…".
- Output lines appear one at a time (about 180ms apart), each sliding in 10px from the left and fading in.
- Blinking cursor, sidebar buttons shift 4px right on hover.
- On first load, print a welcome line and auto-run `/help` after 500ms.
- Disable input while a command is running. Auto-scroll the output to the bottom.
- When `prefers-reduced-motion` is set, remove all animation and show results instantly.

## Step 4: Quality requirements

- Fully keyboard accessible: sidebar buttons are real `<button>` elements, Enter runs the command, visible focus ring (2px sky outline).
- Output area uses `aria-live="polite"`. The component has an accessible label.
- Contrast meets WCAG AA in both themes.
- No new runtime dependencies unless the project already uses an animation library. Prefer CSS animations plus a small amount of framework-native state.
- No inline styles except for per-command accent colors. No global CSS leaks: scope all styles to the component.
- Keep to the project's linting and formatting rules.

## Step 5: Mount and verify

- Mount it where it fits best. If I haven't specified a place, add it as its own section or route (for example `/terminal`) and tell me where.
- Run the build, linter, and existing tests. Fix anything you broke.
- If you can run the dev server, load the page and confirm: it renders in both themes, the sidebar and typed commands work, `/clear` works, and the layout holds at 375px wide.

## Step 6: Report back

Reply with: files added or changed, where it is mounted, any assumptions you made, and how to edit the command list. Keep it short.
