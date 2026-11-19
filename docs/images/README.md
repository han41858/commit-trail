# README capture notes

## Commit Trail captures (2026-11-19, Asia/Seoul)

- Captured in Chromium from a local Production build of `dev` commit `ec7539b5197a7d5f561eca9411501366b7f5d482`. Its app source, assets and public files match deployed `main` commit `ddc221dc35eff026c645ec3664abbba4963f978f`. The Production domain was unavailable through this environment’s network policy, so these are local browser captures of the same app code.
- The desktop and single-repository mobile captures show [`han41858/commit-trail`](https://github.com/han41858/commit-trail) without a selected commit or open detail panel, leaving the graph fully visible. They include the current logo, branch labels and locale-based date separators.
- Split view uses these public repositories in left-to-right order: [`han41858/commit-trail`](https://github.com/han41858/commit-trail), [`han41858/ai-native`](https://github.com/han41858/ai-native), [`angular/angular`](https://github.com/angular/angular), [`microsoft/vscode`](https://github.com/microsoft/vscode). Its controls are collapsed behind the left-edge `>` bookmark tab.
- Browser API requests were relayed through the environment’s authenticated GitHub CLI to `api.github.com`. Public-repository metadata was verified, response bodies were passed through unchanged, and responses were reused within the capture session. The recorded refresh fetched fresh responses. No fabricated commits, branches or workflow states, UI composition, image overlays or custom CSS were used. No token was entered or stored in the app.
- The browser uses the dark theme, `en-US` locale and `Asia/Seoul` time zone. Mobile uses Chromium touch/viewport emulation at device scale 1. These are app viewport screenshots, not physical-device or OS-level installed-PWA captures. The Split view mobile screenshots use the same browser session and repository order, resized from portrait to landscape without additional GitHub requests.

| File                         | Viewport   | Content                                                                                     |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `desktop.png`                | 1280 × 800 | Commit Trail graph without selection, with current refs, metadata icons and date separators |
| `mobile.png`                 | 390 × 844  | The same repository in the narrow layout, without a detail panel                            |
| `split-desktop.png`          | 1600 × 900 | Four columns with independent graphs, messages, refs, Actions rings and a bookmark tab      |
| `split-mobile-portrait.png`  | 390 × 844  | The same four repositories in narrow, DAG-focused columns                                   |
| `split-mobile-landscape.png` | 844 × 390  | The same layout after rotation, with messages where column width and lane spacing allow     |
| `auto-refresh.gif`           | 900 × 380  | 18 seconds from 144 screenshots sampled at 8 fps                                            |

The captures show currently loaded history, not each repository’s complete DAG. Message visibility depends on each column’s width and actual lane spacing. Select any node to inspect full details even when messages are hidden. The single-repository mobile image is retained as a supporting capture; the README embeds the portrait/landscape Split view comparison.

## Automatic refresh recording

The GIF shows the blue progress fill and a scheduled repository check using the normal one-minute refresh interval. Recording begins near the end of the countdown and continues through its reset after the automatic check. The recording includes five app API requests and the countdown resetting after the check. The browser clock, CSS animation timing and app refresh policy are unchanged. No new commit was created for the recording, so it demonstrates a scheduled check rather than a new node appearing.

## Reproduce the captures

1. Run `npm ci`, `npm run build` and `npm run preview` from the repository root.
2. Open the app in a fresh browser profile, use the dark theme, and enter `han41858/commit-trail`. Use the `en-US` locale and `Asia/Seoul` time zone to reproduce these labels.
3. Set the viewport sizes listed above, leave commit selection clear and move the pointer outside the graph. Wait for history and metadata requests to settle before saving a PNG.
4. For Split view, open `/?repo=han41858/commit-trail&repo=han41858/ai-native&repo=angular/angular&repo=microsoft/vscode`, wait for all four columns and metadata requests to settle, and leave the bookmark controls collapsed. Capture desktop and mobile portrait views. Resize the mobile session to landscape without changing repository order or scroll position.
5. Use the `>` tab and **Manage repositories** to confirm that the current selection and **Apply changes** action are available. Close the dialog before the overview captures.
6. For the GIF, choose a one-minute refresh interval in Options, dismiss the menu, and record at 8 fps from approximately 48 seconds into the countdown through the next scheduled check. Encode the unmodified frames as a looping GIF.

Save the browser’s output without altering the UI or data. Live repository contents and workflow states can change, so later captures need not have the same commit count or timestamps.
