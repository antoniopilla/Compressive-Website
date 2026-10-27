# Setup and deployment guide (Windows + VS Code)

This guide takes **Compressive** from a folder on your computer to a free public website on Cloudflare Pages. Every step says **what to do**, **where**, the **exact command** when one is needed, **what you should see**, and **what usually goes wrong**.

> **Who does what**
>
> - **Can be automated (and may already be done if the project was set up for you):** creating the project files, installing dependencies (`node_modules`), running lint, tests and the build, and creating an empty Git repository on the `main` branch.
> - **Only you can do:** create or sign in to GitHub and Cloudflare accounts, verify email, complete two-factor authentication, choose whether the repository is public or private, grant GitHub and Cloudflare access, make commits, and approve the public deployment.
> - Never paste passwords, tokens or verification codes into a chat or a terminal command. Sign-ins happen in your browser.

**Project folder:** this guide calls it `compressive`, for example `C:\Users\<your user name>\Downloads\compressive`. Any name and location work. Keep it as its own folder, not inside another website's project.

---

## Part A: Tools

### 1. Install VS Code, Git and Node.js LTS
- **Where:** your web browser.
- **Action:** install each of these if you do not have it yet:
  - VS Code: <https://code.visualstudio.com/download>
  - Git for Windows: <https://git-scm.com/install/windows> (the default installer options are fine)
  - Node.js **LTS**: <https://nodejs.org/en/download>. The project needs Node.js **22.13 or newer in the 22.x line, or 24 or newer**. This is declared in `package.json` under `engines`.
- **Expected result:** all three install without errors.
- **Common failure:** an old Node.js (18 or 20.x). Tests and the build will refuse to run. Install the current LTS.

### 2. Restart the terminal (and VS Code) after installing
- **Why:** an open terminal does not see programs installed after it started.
- **Action:** close every VS Code window and open VS Code again.

### 3. Check the tools
- **Where:** VS Code → **Terminal → New Terminal** (it opens PowerShell at the bottom).
- **Commands:**
  ```powershell
  node --version
  npm --version
  git --version
  ```
- **Expected result:** three version numbers. `node` must print `v22.13` or later (or `v24`+).
- **Common failures:**
  - `'node' is not recognized`: Node.js is not installed, or the terminal was opened before installing. Repeat steps 1–2.
  - `npm.ps1 cannot be loaded because running scripts is disabled`: PowerShell blocks the `npm` script. Use **`npm.cmd`** instead of `npm` in every command in this guide (for example `npm.cmd run dev`).

## Part B: The project folder

### 4. Use a separate folder
- Keep Compressive in its own folder. Do not copy it into another project, and do not copy another project into it.
- **To rename the folder** (for example to `compressive`): close VS Code first, rename the folder in File Explorer, then reopen it in step 5. Renaming while VS Code or a terminal is using it fails with "access denied".

### 5. Open the folder in VS Code
- **Where:** VS Code → **File → Open Folder…** → choose the project folder → **Select Folder**.
- **Expected result:** the Explorer on the left shows `src`, `tests`, `package.json`, `README.md` and this guide.
- **Common failure:** opening the parent folder (such as `Downloads`) instead. The terminal must run *inside* the project folder.

### 6. Open the integrated terminal
- **Where:** **Terminal → New Terminal**.
- **Expected result:** the prompt ends with the project folder's name, for example `...\compressive>`. If it does not, change into it (replace the path with yours):
  ```powershell
  cd C:\Users\<your user name>\Downloads\compressive
  ```

### 7. Scaffold the project (only if it does not exist yet)
- If `package.json` and `src/` are already in the folder, the project exists. Do **not** run `npm create vite`; it would overwrite it. On another computer, get the project with `git clone` from your GitHub repository instead (see step 23).

### 8. Install dependencies (only when `node_modules` is missing)
- **When:** after cloning the project somewhere new, or if `node_modules` was deleted.
- **Command:**
  ```powershell
  npm install
  ```
- **Expected result:** `added … packages` (or `up to date`). It uses `package-lock.json`, so everyone gets the same versions.
- **Common failure:** `EBADENGINE` or `Unsupported engine` means Node.js is too old (see step 1).

## Part C: Run and check it locally

### 9. Start the development server
- **Command:**
  ```powershell
  npm run dev
  ```
- **Expected result:** a line like `Local:   http://localhost:5173/`. Hold **Ctrl** and click the link, or paste it into your browser.
- **Try it:** click a tool such as **Compress PNG**, or drop an image, a PDF or several files together. Select **Compress** (or **Create ZIP**), review the result, then **Download**. To see the resolution warning, open **Printing it?**, pick **Poster** and try a small image.
- **Common failure:** `Port 5173 is in use`. Vite picks the next port automatically; use the address it prints.

### 10. Run the checks
Open a **second** terminal (the **+** button in the terminal panel) so the dev server can keep running, then:

```powershell
npm run lint
npm run test
npm run build
```

- **Expected results:** lint prints nothing after the header. Tests end with `Test Files … passed` and no `failed` lines. The build ends with `✓ built in …` and creates the `dist` folder.

For the browser tests, download the three test browsers once (Chromium, Firefox and WebKit, the engine behind Safari), then run them:

```powershell
npx playwright install chromium firefox webkit
npm run test:e2e
```

- **Expected result:** every test reports `passed` and none `failed`. These tests build the site, start their own preview server on port 4183, and check real processing, downloads, privacy (no network uploads), keyboard use and phone/desktop layouts in all three browsers.
- **Common failures:**
  - `Executable doesn't exist`: run the `npx playwright install …` line first.
  - Every Firefox test fails at once with `browserType.launch: spawn UNKNOWN`: Windows cannot start the test copy of Firefox, usually because the **Microsoft Visual C++ Redistributable** is missing. Install the current "x64" version from Microsoft's Visual C++ downloads page, or run the other two browsers only:
    ```powershell
    npm run test:e2e -- --project=chromium --project=webkit
    ```

To try the production build by hand:

```powershell
npm run preview
```

It opens at `http://localhost:4173/` with the same security headers Cloudflare will serve. Because the browser tests use port 4183, they can run while this preview is open.

### 11. Which commands keep running, and how to stop them
| Command | Keeps running? |
|---|---|
| `npm run dev`, `npm run preview` | **Yes.** They serve the site until you stop them. Click in that terminal and press **Ctrl+C** (answer `Y` if asked). |
| `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`, `npm install` | No. They finish and return to the prompt. |

## Part D: Publish the source to GitHub

### 12. Git repository: initialize only if needed
- Run `git status`.
  - If it says `On branch main`, a repository already exists. **Do not run `git init` again.**
  - If it says `not a git repository`, create one on the `main` branch:
    ```powershell
    git init -b main
    ```

### 13. Commit identity: only if missing
- Git needs your name and email on commits. Check with:
  ```powershell
  git config --global user.name
  git config --global user.email
  ```
- If either prints nothing, set it, replacing the quoted values with **your own name and the email you use for GitHub**:
  ```powershell
  git config --global user.name "Your Name"
  git config --global user.email "you@example.com"
  ```

### 14. Review and make the first commit
- **Where:** VS Code → **Source Control** view (the branching icon on the left, or **Ctrl+Shift+G**).
- **Action:**
  1. Look through **Changes**. You should see `src/`, `tests/`, `e2e/`, `public/`, `package.json`, **`package-lock.json`** (keep it: it locks dependency versions), `README.md`, this guide, and the config files.
  2. You should **not** see `node_modules`, `dist`, `test-results`, `playwright-report` or `.env` files. `.gitignore` excludes them. If you ever see customer artwork listed, do not commit it; keep such files in `fixtures/private/`, which is ignored.
  3. Type a message such as `Initial version of Compressive` in the box at the top, then select **Commit**. If VS Code asks whether to stage all changes, choose **Yes**.
- **Expected result:** the Changes list empties.

### 15. Publish to GitHub (the one path to use)
- **Where:** VS Code → **Ctrl+Shift+P** → type **`Publish to GitHub`** → Enter.
- **Expected result:** VS Code creates the GitHub repository (for example named `compressive`), adds it as the remote and uploads your commits.
- **Common failures:**
  - `Repository already exists`: pick a different name. Do not create a second copy by hand on github.com; use one path only.
  - If a GitHub repository was created separately by mistake, do not publish again. Connect the existing repository as a remote instead (see the GitHub reference at the end).

### 16. Choose public or private
- During step 15, VS Code asks **Publish to GitHub private repository** or **public repository**. Either works with Cloudflare Pages. Private keeps the source code hidden; the website itself is public either way.

### 17. Sign in and complete two-factor authentication
- During step 15, VS Code opens your browser to sign in to GitHub and authorize VS Code. Complete the sign-in and any two-factor prompt **in the browser**, then return to VS Code.
- **Common failure:** the browser window opens behind VS Code. Check the taskbar.

## Part E: Deploy on Cloudflare Pages (free `pages.dev` address)

### 18. Connect the repository to Cloudflare Pages
- **Where:** <https://dash.cloudflare.com> (sign in; verify your email first if Cloudflare asks).
- **Action:** **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** (some versions of the dashboard call it **Import an existing Git repository**) → **GitHub**.
- Cloudflare asks to install its GitHub app. You can allow **only the selected repository** (recommended) or all repositories. Select **Install & Authorize**, choose your repository, then **Begin setup**.

### 19. Build settings
In **Set up builds and deployments**, enter:

| Setting | Value |
|---|---|
| Project name | your choice, for example `compressive`; it becomes `<project-name>.pages.dev` if that name is free |
| Production branch | `main` |
| Framework preset | **React (Vite)** (or "None"; the two fields below are what matter) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory (advanced) | leave empty (repository root) |
| Environment variables | none needed; the site uses no API keys or secrets |

### 20. Node.js version on Cloudflare
- The repository contains a **`.node-version`** file that pins a tested Node.js version. Cloudflare's build system reads it automatically, so you normally do nothing here.
- Only if a build log shows a Node.js version older than 22.13: add an environment variable **`NODE_VERSION`** with the version from `.node-version` under the Pages project's **Settings → Environment variables**, then retry the deployment.

### 21. Publish
- Select **Save and Deploy**. The first build usually takes a few minutes.
- **Expected result:** a success screen with a link such as `https://<project-name>.pages.dev`.
- **Common failures (check the build log):**
  - `npm ERR! … engine`: the Node.js version (step 20).
  - `Could not find dist`: the build output directory must be exactly `dist`.
  - Build succeeds but the page is blank: the root directory must be empty, not `src`.
- **Free plan:** Cloudflare publishes limits for the free Pages plan (builds per month, build time, file counts). See the limits page in the references. This site builds well within them, but limits can change, and no provider promises permanently unlimited free service.

### 22. Check the live site
1. Open your `pages.dev` address.
2. Compress and download one of each: a JPG or PNG, a PDF, and two files together (ZIP). Try a tool card too, such as **Shrink a PDF**.
3. Check that background processing works: press **F12** → **Network**, then prepare an image. You should see `image.worker-….js` and an encoder such as `mozjpeg_enc-….wasm` load from your own `pages.dev` address with status 200, and no request should upload your file. Under **Network → Headers** for the page, `content-security-policy` should include `connect-src 'self'`.
4. In the footer, open **Open-source licences**: a text file listing every library the site uses should open in a new tab.
5. Check on a phone too.

### 23. Update the website later
1. Make changes in VS Code, run `npm run lint`, `npm run test` and `npm run build`.
2. **Source Control** → write a message → **Commit** → **Sync Changes** (or **Push**).
3. Cloudflare rebuilds and redeploys `main` automatically within a few minutes. Previous deployments stay listed in the Pages dashboard if you need to roll back.
4. On another computer: `git clone <your repository URL>`, `cd` into it, then `npm install` and `npm run dev`.

---

## Optional: custom domain
The site works fully on the free `pages.dev` address. A custom domain (for example `compressive.example.com`) is optional and usually costs money to register. If you want one later, use **Custom domains** in the Pages project.

## `.gitignore` summary
Ignored: `node_modules/`, `dist/`, `.env` and `.env.*`, test reports (`test-results/`, `playwright-report/`, `coverage/`), private artwork (`fixtures/private/`, `private-artwork/`, `*.private.*`), logs and OS/editor clutter. **Tracked:** `package-lock.json`.

## Official references
- Vite: <https://vite.dev/guide/>
- VS Code terminal: <https://code.visualstudio.com/docs/terminal/getting-started>
- VS Code, publishing to GitHub: <https://code.visualstudio.com/docs/sourcecontrol/repos-remotes#_publish-to-github>
- GitHub, adding local code: <https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github>
- Cloudflare Pages, React: <https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/>
- Cloudflare Pages, Git integration: <https://developers.cloudflare.com/pages/get-started/git-integration/>
- Cloudflare Pages, build configuration: <https://developers.cloudflare.com/pages/configuration/build-configuration/>
- Cloudflare Pages, build image and Node.js versions: <https://developers.cloudflare.com/pages/configuration/build-image/>
- Cloudflare Pages, limits: <https://developers.cloudflare.com/pages/platform/limits/>
