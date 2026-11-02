# README capture notes

## Split view (2026-11-02, Asia/Seoul)

- Captured in Chromium from an unmodified local Production build of `dev` commit `8a2d3d5f06bbb14fb854d58bffa6901775d817b2` (the same file tree as Production commit `ee9c29fd65e0453b7fe4f267cba6ca96fe57d6c0`). The hosted app's domain was unavailable under the capture environment's network policy.
- All four repositories were confirmed public by their live GitHub metadata, in this left-to-right order: [`han41858/git-stream`](https://github.com/han41858/git-stream), [`han41858/ai-template`](https://github.com/han41858/ai-template), [`angular/angular`](https://github.com/angular/angular), [`microsoft/vscode`](https://github.com/microsoft/vscode).
- Browser API requests were relayed through the environment's allowed HTTP proxy to `api.github.com`; response bodies were passed through unchanged. No fabricated commits, branches or workflow states, UI composition, or image overlays were used. No token was entered or stored in the app.
- Mobile uses Chromium touch/viewport emulation at device scale 1. These are app viewport screenshots, not physical-device or OS-level installed-PWA captures. The mobile screenshots use the same browser session and repository order, resized from portrait to landscape.

| File | Viewport | Content |
| --- | --- | --- |
| `split-desktop.png` | 1600 × 900 | Four columns with independent graphs, commit messages, refs and Actions rings |
| `split-mobile-portrait.png` | 390 × 844 | The same four repositories in narrow, DAG-focused columns |
| `split-mobile-landscape.png` | 844 × 390 | The same layout after rotation; messages appear in the AI Template and Angular columns |

The captures contrast AI Template's short history with Angular's release branches and VS Code's intertwined active branches. They show the currently loaded history, not each repository's complete DAG. All four portrait columns hide messages; the denser GitStream and VS Code graphs keep them hidden in landscape too. Message visibility depends on each column's width and actual lane spacing, not orientation alone. The captured mobile resize generated no additional API requests. Select any node to inspect full details even when messages are hidden.

The older single-repository `mobile.png` remains available as a historical capture; the README now uses the Split view comparison instead.

## Original graph and refresh captures

- Captured on **2026-10-31 (Asia/Seoul)** using a local Production build.
- App source: `a67e095ca8c1c73ae7eadec83ce4f48e68cf31c0`, with the same file tree as Production commit `026250deb316ec2686c356d358556dd2bfb48f7e`.
- Repository: [`han41858/git-stream`](https://github.com/han41858/git-stream), using live public GitHub data.
- Selected commits: `026250d` on desktop and `9fdf3ad` on mobile.
- Mobile uses Chromium touch/viewport emulation; a physical device or OS-level PWA installation was not captured.

| File | Viewport | Content |
| --- | --- | --- |
| `desktop.png` | 1280 × 800 | Desktop graph with commit, release and workflow details |
| `mobile.png` | 390 × 844 | Mobile graph with touch-selected commit details |
| `auto-refresh.gif` | 900 × 380 | Approximately 10.1 seconds, 81 frames at 8 fps |

The GIF follows `docs/readme-product-page` during a normal one-minute automatic refresh. Commit `b5778ab` (the capture-notes cleanup in the original README PR) was pushed during the wait and appears as a new graph node; the displayed commit count changes from 85 to 86.

## Reproduce the captures

1. Run `npm ci`, `npm run build` and `npm run preview` from the repository root.
2. Open `/?repo=han41858%2Fgit-stream` in a fresh browser profile and use the dark theme.
3. Set the desktop/mobile viewport sizes listed above and select a real commit through the graph. Wait for request activity to settle before saving a PNG.
4. For the GIF, select a branch receiving a real change, choose a one-minute refresh interval in Options, dismiss the menu and click an empty area to clear focus. Record the next scheduled check as the new commit appears.

For Split view, use the same Production-build commands, open `/?repo=han41858/git-stream&repo=han41858/ai-template&repo=angular/angular&repo=microsoft/vscode`, and wait for all four columns and metadata requests to settle. Capture at 1600 × 900 on desktop and at 390 × 844 with mobile touch emulation. Resize that mobile session to 844 × 390 and capture again without changing repository order or scroll position. Use the dark theme and save the browser's PNG output without altering the UI or data.

Live repository contents and workflow states can change, so later captures need not have the same commit count or timestamps.
