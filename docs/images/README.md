# README capture notes

## Commit Trail captures (2026-11-04, Asia/Seoul)

- Captured in Chromium from an unmodified local Production build of `feat/commit-trail-brand`, based on `dev` commit `debb754c8415f9d127db739ac72dd4f99ed6899d`. The rename was not yet merged or deployed to Production at capture time.
- The single-repository captures show [`han41858/commit-trail`](https://github.com/han41858/commit-trail), with release commit `3a27a15` selected. The graph shows a single release marker while the details retain both tag and release links.
- All four Split view repositories were confirmed public by their live GitHub metadata, in this left-to-right order: [`han41858/commit-trail`](https://github.com/han41858/commit-trail), [`han41858/ai-template`](https://github.com/han41858/ai-template), [`angular/angular`](https://github.com/angular/angular), [`microsoft/vscode`](https://github.com/microsoft/vscode).
- Browser API requests were relayed through the environment's allowed HTTP proxy to `api.github.com`; response bodies were passed through unchanged and reused within the capture session. No fabricated commits, branches or workflow states, UI composition, or image overlays were used. No token was entered or stored in the app.
- Mobile uses Chromium touch/viewport emulation at device scale 1. These are app viewport screenshots, not physical-device or OS-level installed-PWA captures. The Split view mobile screenshots use the same browser session and repository order, resized from portrait to landscape. Resizing issued no additional GitHub requests.

| File | Viewport | Content |
| --- | --- | --- |
| `desktop.png` | 1280 × 800 | Commit Trail graph with commit, release, tag and workflow details |
| `mobile.png` | 390 × 844 | The same selected real commit in the single-repository narrow layout |
| `split-desktop.png` | 1600 × 900 | Four columns with independent graphs, commit messages, refs and Actions rings |
| `split-mobile-portrait.png` | 390 × 844 | The same four repositories in narrow, DAG-focused columns |
| `split-mobile-landscape.png` | 844 × 390 | The same layout after rotation, with messages where column width and lane spacing allow |
| `auto-refresh.gif` | 900 × 380 | Approximately 10.64 seconds, 72 encoded frames from an 8 fps source recording |

The captures show currently loaded history, not each repository's complete DAG. Message visibility depends on each column's width and actual lane spacing. Select any node to inspect full details even when messages are hidden.

## Automatic refresh recording

The GIF shows a scheduled repository check using the normal one-minute refresh interval. The browser clock advances past the first 51 seconds before recording the final countdown and refresh; source frames advance at 125 ms intervals. The check issued five ordinary GitHub requests. No new commit was created for the recording, so it demonstrates the scheduled refresh rather than a new node appearing.

## Reproduce the captures

1. Run `npm ci`, `npm run build` and `npm run preview` from the repository root.
2. Open the app in a fresh browser profile, enter `han41858/commit-trail` in the repository field, submit it and use the dark theme.
3. Set the viewport sizes listed above and select a real release commit through the graph. Wait for request activity to settle before saving a PNG.
4. For Split view, open `/?repo=han41858/commit-trail&repo=han41858/ai-template&repo=angular/angular&repo=microsoft/vscode`, wait for all four columns and metadata requests to settle, then capture desktop and mobile portrait views. Resize the mobile session to landscape without changing repository order or scroll position.
5. For the GIF, choose a one-minute refresh interval in Options, dismiss the menu, and record the end of the countdown and the next scheduled check. Browser-clock acceleration may skip the initial wait without changing the app's refresh policy.

Save the browser's output without altering the UI or data. Live repository contents and workflow states can change, so later captures need not have the same commit count or timestamps.
