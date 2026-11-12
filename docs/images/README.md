# README capture notes

## Commit Trail captures (2026-11-12, Asia/Seoul)

- Captured in Chromium from the local Production build of PR #157, based on `dev` commit `621dae7f2a1d0298e00196a7bbecbcb84f08fe3e`. The build includes theme-aware SVG logos, updated icons and bounded first-screen animation; the PR was not merged or deployed to Production at capture time.
- The desktop capture shows [`han41858/commit-trail`](https://github.com/han41858/commit-trail), with actual release commit `16cca3a` selected. The mobile single-repository capture shows its loaded graph without an open detail panel.
- Split view uses these public repositories in left-to-right order: [`han41858/commit-trail`](https://github.com/han41858/commit-trail), [`han41858/ai-native`](https://github.com/han41858/ai-native), [`angular/angular`](https://github.com/angular/angular), [`microsoft/vscode`](https://github.com/microsoft/vscode).
- Browser API requests were relayed through the environment's authenticated GitHub CLI and allowed HTTP proxy to `api.github.com`; response bodies were passed through unchanged and reused within the capture session. No fabricated commits, branches or workflow states, UI composition, or image overlays were used. No token was entered or stored in the app.
- Mobile uses Chromium touch/viewport emulation at device scale 1. These are app viewport screenshots, not physical-device or OS-level installed-PWA captures. The Split view mobile screenshots use the same browser session and repository order, resized from portrait to landscape. Resizing issued no additional GitHub requests.

| File                         | Viewport   | Content                                                                                 |
| ---------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `desktop.png`                | 1280 × 800 | Commit Trail graph with commit, release, tag and workflow details                       |
| `mobile.png`                 | 390 × 844  | The same repository in the narrow layout, without a detail panel                        |
| `split-desktop.png`          | 1600 × 900 | Four columns with independent graphs, commit messages, refs and Actions rings           |
| `split-mobile-portrait.png`  | 390 × 844  | The same four repositories in narrow, DAG-focused columns                               |
| `split-mobile-landscape.png` | 844 × 390  | The same layout after rotation, with messages where column width and lane spacing allow |
| `auto-refresh.gif`           | 900 × 380  | 10 seconds from 80 screenshots sampled at 8 fps                                         |

The captures show currently loaded history, not each repository's complete DAG. Message visibility depends on each column's width and actual lane spacing. Select any node to inspect full details even when messages are hidden.

## Automatic refresh recording

The GIF shows a scheduled repository check using the normal one-minute refresh interval. The browser clock advances past the first 51 seconds before recording the final countdown and refresh; source frames advance at 125 ms intervals. The recording observed five app API requests, relayed using the same live-response cache as the screenshots. No new commit was created for the recording, so it demonstrates the scheduled refresh rather than a new node appearing.

## Reproduce the captures

1. Run `npm ci`, `npm run build` and `npm run preview` from the repository root.
2. Open the app in a fresh browser profile, enter `han41858/commit-trail` in the repository field, submit it and use the dark theme.
3. Set the viewport sizes listed above and select a real release commit through the desktop graph. Leave details closed for the single mobile view. Wait for request activity to settle before saving a PNG.
4. For Split view, open `/?repo=han41858/commit-trail&repo=han41858/ai-native&repo=angular/angular&repo=microsoft/vscode`, wait for all four columns and metadata requests to settle, then capture desktop and mobile portrait views. Resize the mobile session to landscape without changing repository order or scroll position.
5. For the GIF, choose a one-minute refresh interval in Options, dismiss the menu, and record the end of the countdown and the next scheduled check. Browser-clock acceleration may skip the initial wait without changing the app's refresh policy.

Save the browser's output without altering the UI or data. Live repository contents and workflow states can change, so later captures need not have the same commit count or timestamps.
