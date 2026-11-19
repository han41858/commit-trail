# Commit Trail 개발·운영 가이드

Commit Trail은 React, TypeScript, Vite, Canvas 2D로 GitHub 커밋 DAG를 표시하는 읽기 전용 웹앱이다.
별도 백엔드나 데이터베이스 없이 동작한다. 제품 소개와 화면은 [README](../README.md),
기능별 규칙은 [문서 안내](README.md)에 연결한 전용 명세에서 확인한다.

## 개발 환경과 검증

[`.nvmrc`](../.nvmrc)와 [`package.json`](../package.json)의 `engines.node`에 맞춰 Node.js **24.x**와 npm을 사용한다.
`npm ci`로 잠금 파일에 맞춰 의존성을 설치하고 `npm run dev`로 개발 서버를 시작한다.

```sh
npm ci
npm run dev
```

`npm run format:check`는 파일을 고치지 않고 검사한다. `npm test`는 하위 모듈을 포함해 `src/**/*.test.ts`를 실행하고,
`node --test --test-isolation=none .github/scripts/*.test.mjs`는 저장소 자동화를 검증한다.
`npm run build`는 TypeScript 검사와 Vite 빌드를 실행하며, `npm run preview -- --port 4173`으로 빌드 결과를 로컬에서 확인한다.

```sh
npm run format:check
npm test
node --test --test-isolation=none .github/scripts/*.test.mjs
npm run build
npm run preview -- --port 4173
```

포맷은 `package.json`에 고정한 Prettier `3.9.10`과 `prettier.config.mjs`의 공통 설정을 사용한다.
`npm run format`은 저장소에서 지원하는 파일에 포맷을 적용한다. 생성물, 로컬 캐시와 npm이 관리하는
`package-lock.json`은 `.prettierignore`로 제외하며 별도 플러그인이나 Git 훅은 필요하지 않다.
문서만 변경해도 PR CI는 포맷을 검사한다.

빌드 산출물 `dist/`는 정적 호스트에서 제공할 수 있다. `?repo=owner%2Frepo`로 저장소를 지정하므로
별도 서버 rewrite 없이 새로고침해도 선택을 복원한다.

**Options** 하단에는 빌드 시각을 오른쪽에 `Built at`으로 표시한다. Vite가 빌드 때 삽입한 UTC 시각 하나를
브라우저 현지 날짜와 시간대의 24시간제 `HH:mm`으로 표시하며 AM/PM·초·시간대 이름은 붙이지 않는다.
같은 빌드에서는 오프라인이나 새로고침 후에도 시각이 바뀌지 않는다. 메뉴는 화면 안에서 한 줄을 유지하도록
넓어지고, 공간이 부족하면 말줄임과 툴팁을 사용한다. 캐시된 PWA는 업데이트를 적용할 때까지 이전 시각을
유지한다. 같은 커밋을 다시 빌드해도 시각과 번들 해시가 바뀌므로 PWA 업데이트가 생길 수 있다.
개발 서버는 `Development`를 표시한다.

## 제품 이름과 브라우저 데이터

제품과 Vercel 프로젝트 이름은 각각 **Commit Trail**과 `commit-trail`이다. GitHub 저장소는
`han41858/commit-trail`, Production 도메인은 `https://commit-trail-view.vercel.app/`이다.
저장소·프로젝트·도메인은 각 서비스의 대시보드에서 관리하며 소스 이름을 바꿔도 외부 리소스는 바뀌지 않는다.
설정을 점검할 때는 기존 프로젝트 ID·팀 소유권·Git 배포 설정을 유지하고, 저장소 연결과 Production Branch
`main`, 공개 도메인을 확인한다.

PAT, 최근 저장소, 브랜치 선택, Split view 구성과 표시 옵션은 `commit-trail.*` localStorage 키를 사용한다.
`commit-trail.view-options`는 `theme`, `autoRefresh`, `interval`을 저장한다. 이전 제품의 키는 읽거나
이전하지 않으므로 사용자가 토큰을 다시 입력하고 저장소와 옵션을 설정한다. 도메인이 달라져도 localStorage,
Service Worker와 PWA 설치가 분리된다. 링크·리디렉션·분석을 통해 토큰이나 설정을 이전하지 않는다.
PWA 매니페스트의 표시 이름은 Commit Trail이며 `id`, `start_url`, `scope`는 모두 `/`이다.

## 익명 웹 분석

Production에서는 공식 `@vercel/analytics/react` 컴포넌트로 Vercel Web Analytics의 페이지 조회만 수집한다.
앱은 사용자 동작에 대한 커스텀 이벤트를 보내거나 Google Analytics를 연동하지 않는다. 분석이 실패하거나
차단돼도 GitHub 이력 조회를 막지 않는다.

`beforeSend`는 URL의 검색 파라미터·fragment·인증 정보를 제거하며, 잘못된 URL이나 HTTP(S)가 아닌 URL은
전송하지 않는다. 비공개 이름이 포함될 수 있는 `repo`와 `branch` 역시 전송 URL에서 제거한다. 문서당 첫
페이지 조회만 집계하므로 같은 문서에서 저장소·브랜치·Split view 순서나 브라우저 이력을 바꿔도 집계가 늘지
않는다. PAT, GitHub API 응답, 커밋 상세와 선택한 저장소 이름을 커스텀 이벤트로 보내지 않는다.

`Referrer-Policy: no-referrer`와 제한적인 CSP를 유지한다. 분석 스크립트와 수집 경로는 Vercel 배포의 같은
출처에서 제공해야 한다. 앱은 쿠키나 사용자 식별자를 추가하지 않지만 Vercel이 요청 수준 메타데이터를 받지
않는다는 보장은 아니다. 활성화 전에 Vercel 문서와 적용되는 개인정보 보호 요구사항을 확인한다.

분석은 Vercel 프로젝트의 **commit-trail → Analytics → Enable**에서 별도로 활성화하고 Production에 배포한다.
브라우저 Network 패널에서 스크립트와 페이지 조회 요청을 확인하고 `repo`·`branch` 값이 전송되지 않는지,
같은 문서에서 저장소 전환이나 Split view 재정렬 후 조회 수가 늘지 않는지 점검한다. 브라우저 확장과 네트워크
필터가 수집을 막을 수 있다. 새 커스텀 이벤트는 별도 개인정보 검토 없이 추가하지 않는다.

## 링크 미리보기와 검색 메타데이터

`index.html`의 초기 HTML에 제품 제목·설명·canonical URL·Open Graph 메타데이터·X `summary` 카드를 제공한다.
크롤러는 JavaScript를 실행하거나 GitHub API를 호출할 필요가 없다. 두 카드 모두 공개 512×512 정사각형 PNG
로고 `https://commit-trail-view.vercel.app/icons/app-logo-512.png`를 사용한다.

단일 저장소와 Split view 링크의 쿼리는 앱에서 그대로 사용하지만, 미리보기는 항상 Commit Trail을 소개한다.
canonical URL과 `og:url`은 공개 Production 루트이며 저장소 이름·PAT·기타 쿼리 값은 메타데이터에 넣지 않는다.
`public/robots.txt`는 크롤링을 허용하고 제품 루트만 나열하는 `public/sitemap.xml`을 안내한다.

배포 후 `/`, `/?repo=owner/repo`, `repo`가 반복되는 Split view URL의 원본 HTML을 JavaScript 실행 없이 확인한다.
이미지 URL, `/robots.txt`, `/sitemap.xml`의 공개 응답과 콘텐츠 유형을 점검한다. Vercel Preview 보호와 자동
`noindex` 동작은 유지하므로 채팅 미리보기는 공개 Production URL로 확인한다. 이미 붙여 넣은 링크는 서비스가
다시 가져올 때까지 캐시된 카드를 표시할 수 있다. 메타데이터는 카드 데이터를 제공할 뿐, 외부 서비스의 표시
여부나 형식을 보장하지 않는다.

## Use

The **Split view** icon opens repository selection. Select one to 32 recent repositories, add GitHub addresses, or look up an owner and confirm a checked batch of repositories. Selected items disappear from the recent suggestions; drag handles in the upper selected list to reorder them, or focus a handle and use Up/Down. **Start split view** divides the current app window into one horizontal row in that order, with independent scrolling, one active commit-details popup, a shared refresh button with the existing countdown, and a **Return to single view** control. Larger, underlined repository names align with their columns in the header; only the visible repository text is a link, opening its GitHub repository in a new tab. Empty header space does not navigate. A bookmark-style `>` tab at the left edge slides out Return, Refresh and Manage repositories in that order. The toolbar starts collapsed; the `<` tab or Escape within the controls collapses it and returns focus to the tab. Hidden buttons are inert and excluded from accessibility navigation. The state is not persisted. While collapsed, the tab background fills from bottom to top; expanding exposes the existing refresh-button pie. Both follow the same deadline without restarting the refresh schedule. Reduced motion disables the slide transition and hides both progress fills. Repository headings remain on one row, reserving only the tab width; the expanded toolbar overlays them until collapsed. Activating a toolbar action or pressing outside the controls, including a commit node, collapses the toolbar. Actions return focus to the bookmark tab; outside presses preserve the chosen target and its focus. Closing repository management returns focus to the bookmark tab. The graph still uses one equal-width horizontal row. The refresh button uses the existing manual refresh flow for all selected repositories, skips repositories whose previous refresh or initial/base load is still running (pending boundary, branch discovery or metadata loads do not block it) and remains usable with automatic refresh off; rate-limit cooldown or dispatch temporarily disables it. Return or Escape restores the normal graph. The app does not enter or exit browser fullscreen; use the browser's own control, such as F11, when needed. Browser fullscreen changes do not switch app modes.

**Manage repositories** uses the Lucide list-plus icon and opens the existing setup dialog with the active membership and order. It changes the title to **Manage repositories** and the confirmation action to **Apply changes**; normal entry keeps **Split view** / **Start split view**. Draft edits do not change the active session, URL or saved selection. Close, Escape and backdrop dismissal discard them and restore focus to the bookmark tab. Owner lookup, batch selection, recent repositories and pointer/keyboard ordering use the same implementation in both modes.

Applying reconciles entries by repository ID: shared entries retain their History, CommitInfoStore, graph, scrolling, branch/direction, selected commit, valid pinned path, caches and pending requests. Only added repositories initialize, and removed entries unsubscribe and cancel their work; stale results cannot throttle the new composition. Removing the shared primary also cancels its stores, which reopen normally on return to single view. Details for retained entries stay open and reposition; removal closes them. Membership changes push browser history, ordering alone replaces it, and identical configurations do neither. Back/forward restoration also reconciles shared entries. One repository stays in Split view with mode=monitor; zero cannot be applied. The common refresh scope remains stable while Split view is active, preserving the deadline and completions of retained work instead of restarting the timer on membership changes.

Adjacent columns retain the existing 1px gap. A Split view-only `--monitor-divider` mixes the existing muted color at 40% with the graph background, making the neutral separator slightly darker in light mode and brighter in dark mode. Header separators occupy the matching gaps and use the same color, without changing column widths or hit areas. One column has no separator; shared border colors and drag, scroll and click behavior are unchanged. The lines add no hover effect or resize cursor.

Each column uses the normal graph's existing responsive text and badge rules, measured against that column's width. Narrow columns show one-line messages when the existing 12px lane-spacing threshold allows them; otherwise the graph uses the full column. Wide columns also show the short SHA and author. The single view's existing policy is unchanged.

The common `MONITOR_LIMIT` caps selection, storage, URLs and sessions at 32 after normalization and deduplication. Every selected repository remains visible in one equal-width N×1 row, without minimum column widths, horizontal scrolling, additional rows or automatic count reduction. A split column whose rounded width is at most the existing 48px graph origin centers that origin so its nodes remain visible and fractional column widths cannot put the node center into the neighboring column; DAG lanes, spacing and row heights are unchanged. Header padding also stays inside each column. The setup dialog keeps its title, Close control and bottom count/Copy link/Start split view actions visible while only its middle repository-selection content scrolls. Long selections remain usable in short windows and mobile landscape. Drag-edge auto-scroll targets that middle area. Its 4px padding and matching negative margin preserve the layout while keeping outside focus rings visible; scroll padding also reserves that space when a control is revealed. Recent repositories share the same scroll area instead of a nested scroller.

The existing selection key still stores only normalized repository names. Reopening setup restores the previous Split view configuration, including one opened from a URL, or the saved selection with its exact membership and order. The current single-view repository is a default only when no prior configuration or saved selection exists; removing it and starting Split view must not add it back on the next setup opening or reload. A companion `commit-trail.monitor-public-repositories` array stores at most 32 selected names confirmed public by existing metadata, so eviction from the unchanged ten-entry recent list does not truncate restored selections. It adds no API request, token or response payload. Selections saved under the new product keys restore without a schema migration; private or unclassified selections are still removed on PAT changes, and a public-to-private metadata change removes its public classification. The applied/saved-token write boundary also protects this companion key.

Active Split view has a small **Drag to reorder** handle before each repository link. Mouse dragging starts immediately; touch requires a 400ms hold, and movement before activation cancels it. The source header fades to 35%. A raised 95% card with a grip, repository name and target position follows the pointer; touch places it 24px above the finger when space permits, or 32px below near the top. A 3px insertion line extends from the header to the bottom safe area. A changed drop briefly highlights the moved header for 600ms using a cancellable Web Animation, skipped for reduced motion. Graphs and the actual array stay fixed until drop. Escape and pointer cancellation restore the original order; a same-position drop does nothing. The existing setup dialog still provides keyboard ordering.

A confirmed drop reorders existing MonitorSession entries by repository identity and reuses History, metadata stores, canvases, scroll positions, branches, selection and in-flight work. An active-session refresh scope preserves the common timer. The existing navigation utility replaces the current history entry, moving repo/branch pairs together without requests or a reload. Opening a shared URL alone leaves the saved selection intact; an explicit drop persists its order using the existing names-only settings. Storage failure leaves the current view and URL usable. Handles shrink with their cells, and the reserved left tab band prevents overlap with the collapsed bookmark. At extreme density, setup-dialog ordering remains available for clipped edge controls. Pending hold timers, pointer capture and listeners are cleaned up on cancellation or exit; there is no external drag library.

Split-view commit details can extend into neighboring columns, up to 480px wide. A panel centers on its originating column where space permits, stays within the visible monitor area with an 8px margin, and identifies its repository at the top. Its height is capped at 65% of that area, accounting for safe areas and the visual viewport. The app keeps one repository-and-commit selection for the entire split view. Clicking or tapping another column replaces the previous popup, node highlight and selected metadata target, even when the SHA matches across repositories. Hover focuses a path within its own graph and keeps existing tooltips, without selecting a commit or requesting its details. Returning to single view closes a secondary repository's popup; reopening the split does not resurrect it. A primary selection keeps the existing single-view panel placement. Position observation runs only while a panel is open and adds no API requests. Single-view popup placement remains unchanged.

Use **Copy link** in the selection dialog to share the ordered configuration. After a successful copy, the button shows **Copied!** for two seconds, then returns to **Copy link**; a failed copy shows **Copy failed**. Multiple repositories use repeated `repo` parameters (`?repo=owner/one&repo=owner/two`); one repository uses `?repo=owner/one&mode=monitor`. A single `repo` without the mode flag keeps the original single view. The current URL follows mode changes, and Back/Forward or reload restores its configuration. Invalid/duplicate names are sanitized and at most 32 valid repositories are opened. Links contain repository and confirmed branch names, order and mode only; debug settings, tokens and other context are excluded. Private repository names remain visible in the URL, and recipients need their own access. Copying, selecting already listed repositories and reordering make no API calls. Explicit owner submission and Load more fetch the owner list separately. See [Monitor mode](monitor-mode.md) for authentication, scheduling, verification and device limits.

Owner results use an anchored dropdown in single view. In Split view setup, the same filter and list appear directly in the existing form body, without a second panel border, title bar or close button. The inline list is a named region rather than a nested dialog; selection, pagination and Escape behavior remain shared.

The repository field suggests up to ten recent successful visits from this browser. When it still contains the open repository's address, focusing shows all recent visits without clearing the field or forcing text selection. A click/tap places the caret using the browser's native behavior, including after returning from Split view and at every screen width. Once you type, suggestions filter your input. Use the arrow keys and Enter or select an item to open it, and remove entries individually or with **Clear history**. Changing/removing the applied PAT clears private visits; public visits and the current graph remain independent of history deletion. Selecting the current repository reuses its graph. Suggestions add no GitHub requests. See [recent repositories](recent-repositories.md) for storage, authentication, keyboard and PWA behavior.

Enter `owner/repo` or `https://github.com/owner/repo` to open a repository directly, or submit a bare owner to choose from its repository list. The field accepts lowercase only: typed, pasted and `?repo=` values are lowercased, and mobile auto-capitalization, autocorrect and spellcheck are off. GitHub resolves repository paths case-insensitively. The graph fills the viewport. Its transparent toolbar uses a compact repository field with an inline clear control and a search icon. Clearing edits the address and keeps loaded history. Choose a **Branch**: its first-parent history forms the straight main line, while other histories use side lanes connected by actual parent SHAs. Merged ancestry is not flattened onto the base line; unrelated histories remain separate. When neither the URL nor a saved user choice selects a branch, `main` is preferred, then `master` if `main` is absent, then the repository default. History starts at the selected branch only. In newest-first mode, visible gaps fetch ancestry from their actual parent SHAs, including merge parents with no surviving branch name. Branch names never decide which histories to fetch. In oldest-first mode, the API’s last-page link finds the oldest history directly, then scrolling down loads preceding API pages toward newer commits under a pinned head SHA. Both modes scroll down in their chosen direction. Actual roots and already loaded joins do not trigger requests. Branch-name pages serve the picker and labels only. Repository activity, including PR merges and merge queues, discovers independent branches such as active release branches, even when they have not merged into the base. Their histories enter only within the selected timeline’s date window, ordered by activity time rather than branch names. Activity pagination follows GitHub’s opaque `after` cursor; it never increments a numeric page or repeats a cursor. Empty date-filtered histories are reconsidered when exploration reaches older dates. In oldest-first mode, current active heads enter after the base traversal reaches the present. Dormant branches with no activity in the API’s last-year window remain available by selecting them explicitly. Loading stops at the history boundary or an API error; use Retry after an error. Loaded history is a partial view of the selected branch and discovered active branches until traversal ends. Dashed edges indicate unloaded parents. Badges first seek clear space on either side close to their own path, then alternative anchors along that path; short-path vertical adjustments stay within one commit row. Nearby positions beside the path are tried before positions covering its x coordinate, including the opposite side and later path anchors. Only when no nearby node-clear placement fits do they fall back to more distant horizontal space. Compact, borderless badges use unique path suffixes and tinted branch-color backgrounds; references sharing a commit have individually named badges stacked vertically, with the selected base first and the remaining names in alphabetical order. Each branch badge keeps its own name, with its beginning preserved and a trailing ellipsis when needed. Full names remain in picker choices and hover tooltips. Branch-name badges follow the visible first-parent path near its line while scrolling, and disappear when that path leaves the viewport. Merge connectors and visible curve crossings also carry their branch names; nearby badges move apart to avoid covering each other. Colors are recalculated without stored assignments; identical refs, loaded history and selected base/HEAD SHA produce identical colors across browsers. Late references or ancestry can change path boundaries and collision neighborhoods, so affected colors may change. Side-branch names stop at a join into another path, while references already sharing the base follow that shared history. Hover a node for a tooltip, or tap/click it for a dismissible detail panel. Select a commit node to open the compact detail panel. Options contains theme and common refresh settings. The short SHA and right-aligned authored timestamp share one row; the message ends with a small muted `by author`, with a GitHub icon beside Close. Field headings, parents, and the commit selector are omitted. The narrow-screen commit-status panel uses only its content width. Time direction has a top-bar toggle labeled **↓ Older** or **↓ Newer**, describing the history below; its arrow always points down; theme remains under Options. Loading uses a circular spinner with an active GitHub request count such as `x5`, excluding queued work. Rotation has slow (1–4), medium (5–8), and fast (9+) speeds; reduced-motion mode keeps the count visible without rotation. The Token panel explains repository selection and required permissions before opening GitHub’s token form. Responsive layout depends on width, not device type: at most 800px is narrow, above 800px is wide. Single view uses the browser viewport; Split view uses each column’s actual width. Hover capability and touch hit-testing are independent of this width rule. Graphs keep 100% viewport width by reducing lane spacing as branch count grows. In wide layouts, branch lanes and badges use their natural width up to 50% of the viewport. Messages, SHAs and authors start immediately beside them and are independently capped at 50% of the viewport, with ellipses and full text available in details. Narrow layouts show a one-line commit message beside the graph, capped at 50% of the viewport with ellipses, only while branch lanes remain at least 12px apart. If reserving message space would make lanes closer, messages are hidden and the graph uses the full viewport width. Tap a node (or a visible message) for full details; SHAs and authors remain in the detail panel.

Commit details use compact message spacing in both single and Split view: title line height is 1.4, body line height is 1.45, and the body starts with an 8px margin. Leading and trailing blank separator lines are omitted from the displayed body; indentation, internal blank lines and content-line spaces are preserved. The access-token popup uses 1.5 paragraph line height and a 12px heading margin, while control and permission-table spacing remain unchanged. Only the commit content scrolls; Close, the GitHub link and the Split view repository header remain visible. Keyboard, wheel and touch scrolling continue to load metadata near the content boundary. Selecting another commit resets its content to the top. Pressing outside the popup dismisses the shared selection, including blank areas in other Split view columns; clicking a node, version icon or rendered message still selects that commit. Blank space beyond the rendered message width does not reopen a popup.

Badge placement accounts for the entire stack height so nearby stacks and individual labels can move apart without changing commit coordinates, lanes or row spacing. A badge whose visible text is shortened by an ellipsis or omitted path prefix shows its full name immediately on mouse hover using an in-app tooltip instead of the browser's delayed title. A badge already showing its complete name has no tooltip. Long names wrap, and the tooltip stays within the visual viewport, flipping above the badge when needed. Leaving the badge, scrolling, clicking, Escape, blur or a layout change dismisses it; Escape dismisses the tooltip before other screen-level Escape actions. Touch interaction and native commit/Actions tooltips are unchanged. Badge and line clicks/taps select only the path highlight without opening commit details; node and message clicks still open commit details. A stack taller than the visible graph stays anchored to its HEAD and reserves enough scrollable space to reveal every name. The same rules apply to single and Split view, both time directions and narrow/wide layouts, without extra API requests or timers.

Badge collision avoidance considers only other branch-name boxes. Commit nodes, Actions rings and lines may be overlaid rather than pushing a badge to another row or side. When messages are visible, label placement, painting and hit areas stop before the message/SHA/author column; otherwise labels can use the full graph width. Text width is based on the graph column width and does not change with the current path anchor. The leading/base group keeps priority, then wider side badges reserve space before shorter names. Visible HEADs first try their own row, including positions that cover their node/path, before moving to another path segment to avoid other names. Offscreen HEADs keep labels near their visible path and follow its curves; short-path fallbacks first stay within one 31px commit row, then use the nearest free position only if other names leave no room within that range. Shared-head names remain vertically stacked. The surface fill stays at 35% with a faint branch-color overlay (6% in light mode, 8% in dark mode), giving about 40% combined background opacity; text stays fully opaque. Node/ring hit areas retain priority over badge hover and click interception when they overlap.

Initial base selection uses a valid URL `branch`, then this repository's last direct user choice, then `main`, `master`, the GitHub default and the existing fallback. Partial catalogs use the existing exact-name endpoint to validate missing candidates; a complete current catalog confirms absence without another request. Confirmed missing saved choices can be removed, while network, authentication and rate-limit errors retain them. Failed URL lookups keep an existing graph and can be retried. Priorities apply only to initialization or explicit URL navigation; refresh never reapplies them. `model.ts`, recommendations, DAG lanes and rendering are unchanged.

Both modes use the same loading indicator and request-count policy. Single view shows the total active GitHub HTTP count; each Split view column shows only that repository's count, including history and metadata requests. Counts cover dispatch through response-body parsing, exclude queued work, and clear on completion, failure or cancellation. A count of 1–4 uses the slow spinner, 5–8 medium and 9 or more fast; zero hides the number while the spinner can remain for unfinished processing. Reduced motion stops rotation while retaining the count. Repository counts exist only in memory while requests are active and add no API request, timer, persisted state or debug output.

The branch picker shows **Branch** before a branch is selected and only the current branch name afterwards, regardless of screen width. It recommends up to 30 currently existing branches. `main`, `master`, and the repository default are pinned first in that order, without duplicates; the rest rank by PRs merged into each branch in the last 90 days. Remembered choices do not reorder recommendations. PR counting starts only when the picker opens and processes up to three pages per batch. Partial counts are labeled with `+`; **Continue PR ranking** completes further batches. Deleted branches are excluded. Search filters loaded names; **Find exact branch** can select any branch outside the recommendations.

`commit-trail.branch-selections` stores only repository, branch and visibility for direct picker changes. Repository names are lowercase; branch case is preserved. Existing metadata updates visibility without another API call. PAT registration, replacement and removal clear private records while retaining public choices; stale authentication tabs cannot expose private entries or overwrite another context. Storage failures leave normal branch selection working. URL restoration, automatic opening and refresh never write user choices. Repeated `branch` query values correspond to repeated `repo` values by index, including empty middle slots, and normalization removes each repository together with its branch. Browser history tracks direct branch changes. Copy link includes only confirmed branches, excludes token/settings/scroll data and retains repository order. Branch names, including private ones, are visible in shared URLs.

For private repositories, supply a fine-grained PAT limited to selected repositories with **Contents: Read-only**. PR recommendations additionally require **Pull requests: Read-only**. Applying it saves it in this browser’s localStorage and restores it after refresh. It is sent only to `api.github.com`. Removing it deletes the saved token and clears displayed history. Storage failures are shown in the token panel; no analytics. Public repositories work without a token, normally at 60 REST requests per hour per IP. Authenticated requests normally allow 5,000 per hour. A rate-limit error displays its retry time and pauses retries until then; permission errors are reported separately. PR-ranking failures do not clear the graph. GitHub limits can vary by authentication and secondary limits.

The access-token panel, view options and Split view setup share a 45% black backdrop (`--popup-backdrop`) in both themes. View options stay below the header's Options button on the right; the token panel and Split view setup are centered within the safe area. Their surfaces stay opaque and scroll internally when space is limited. `PopupBackdrop` closes them only when a press starts and ends on the background, after click completion so covered controls are not activated. Dragging across the panel boundary or cancelling a gesture leaves it open. Escape also closes it.

## Owner repository selection

Submitting a bare GitHub owner opens a repository picker below the existing field. Typing in the address or the picker's name filter makes no API requests. Direct repository paths and GitHub repository URLs keep the existing parsing, branch selection and loading path; they do not fetch owner lists. The current graph remains visible until a repository is selected. Recent suggestions stay local and owner lookup alone does not create a visit record.

The picker merges anonymous `GET /users/{owner}/repos` results with `GET /user/repos` results from the applied PAT, filtering the latter to the exact owner case-insensitively. The public request carries no token, so an invalid PAT does not prevent public discovery. Repository IDs deduplicate the merged list; loaded entries sort by latest push descending, then by repository name. Names, Public/Private visibility and one-line descriptions are shown. Private entries are limited to what GitHub actually returns; absence is not proof that a repository does not exist or is inaccessible. No additional token grants are requested.

Public and authenticated sources each keep their own 100-item pages, caches, errors and retry deadlines. For an initial lookup, their first pages are requested in parallel and the list is published once all requests actually started by that action have settled, whether successful or failed. Successful results are merged, deduplicated and sorted together. Without a PAT, only the public request is needed; valid cached sources do not trigger another request. A public success and an authentication error are shown together after the action settles.

**Load more** advances available healthy sources by one page; it does not scan through other owners automatically. Load more and Retry retain the previously displayed list until all requests started by that action settle, then publish the combined result. The endpoints and request count are unchanged by this presentation policy. An authenticated page with no matching owner can still have another page. Filtering matches loaded repository names case-insensitively and never starts a search request. Later-page errors retain earlier rows. Retry follows the existing GitHub error and rate-limit policy and only repeats failed sources.

`OwnerRepositories.ts` shares the query model across `RepositoryInput.tsx` and `MonitorSetup.tsx`; `OwnerRepositoryPicker.tsx` shares the list UI. It reuses `GitHubReader` for conditional requests, cancellation and in-flight request sharing. Successful source pages are cached in memory for 60 seconds from each source’s first-page completion, with at most ten recently used owners. Loading more does not extend the expiry. Owner case is normalized. Applying a different PAT or removing it closes the picker and invalidates its cached results. A token storage change from another tab also closes and clears this feature's authenticated context until the token is explicitly applied in this tab; the existing graph's token policy is unchanged. No owner history, API response or extra localStorage key is persisted.

Escape and outside interaction close the list, and changing the input context cancels or ignores stale work. Arrow keys and Enter support keyboard selection. The list stays within the available viewport and scrolls internally. Single-view selection immediately opens one repository.

Split view places an inline checklist in the existing setup body, without another popup frame, heading or Close button: check multiple repositories, then choose **Add N repositories** to append them in check order while preserving the existing selection order. Already added repositories are checked, disabled and labelled **Already added**. Existing and pending repositories together cannot exceed 32. Filtering and loading another page preserve pending checks, including those hidden by the filter. Checking, unchecking and confirming the batch add no API requests. Closing the list or changing its owner, PAT or input context discards pending checks. Confirmed additions use the existing Split view persistence, sharing and reordering policy.

Owner discovery requests participate in the existing global active-request count, without being attributed to an unrelated Split view repository column. See the [Owner selection specification](owner-repositories.md) for the shared input, cache and error contracts.

## DAG hover and selection highlight

Hover a branch badge, commit or connecting line, or click/tap a commit, to follow that branch's own flow with both visible start and terminal merge boundaries. Every screen size and Split view column uses the same resolver. A middle commit focuses the whole flow, including its HEAD side, fork node and terminal merge. The first-parent edge into the start boundary and the exact connector from the terminal merge to this flow HEAD are included. Older common history, the terminal merge's other parents and subsequent destination history remain dim.

When a focused path `b` forks from `a` and ends in `c`, the existing branch-name badges on the directly connected source and destination paths also stay bright, even when their current ref HEADs are outside the focused node range. Include every known alias on those boundary paths, without choosing a representative name. Their other nodes, messages and lines stay dim. Badge hover and click/tap keep only the explicitly selected name on `b`, together with these boundary names. Unknown or deleted names are not invented, badges are not moved or created, and existing placement and viewport visibility still apply. The same rule serves hover and retained click/tap highlights in wide, narrow and Split views without traversing more ancestors or requesting more data.

Color, badge tracks and highlight share one path index. Its node owners are path IDs; first-parent edges belong to the child path and secondary merge connectors to the incoming parent path. Intermediate refs do not split a continuous path. Equal palette entries, shared coordinates and lane reuse never combine unrelated IDs. The ID is the path HEAD SHA within the current snapshot, not a claim about the exact historical branch-creation event. Deleted branch names are not reconstructed.

Ownership first fixes the selected base HEAD, then the repository default HEAD, even when either has a loaded first-parent child. If the default HEAD already belongs to the selected base path, that existing ownership takes precedence rather than splitting the path. A new feature diverging directly from an unadvanced default HEAD therefore cannot take its existing history. Only other refs require terminal HEADs with no loaded first-parent child; they use own-stem integration evidence, then the first exclusive commit’s `commitTime()` in ascending order, then HEAD SHA. Same-SHA refs share a candidate. A secondary merge child does not disqualify a terminal head. Unnamed flows claim afterwards; interior refs remain aliases, including on deleted paths. This is separate from the existing `main` → `master` → repository default policy for choosing the initial base branch.

Integration evidence must lie on the exclusive segment between that tip and its nearest loaded first-parent fork or selected-base/default join. Inherited shared merge ancestry does not qualify. A secondary parent must belong to another loaded path; redundant first-parent ancestors and known selected-base/default sync imports are excluded. Names and HEAD dates receive no special priority. Git does not record branch age or arbitrary merge intent, and partial history can hide evidence or leave an unknown sync ambiguous. Those cases use the observed first-exclusive-commit time and SHA rather than reconstructing intent or requesting extra data. This heuristic cannot guarantee original-trunk identity for every arbitrary name and incomplete history. The first exclusive commit is the topologically oldest commit on that tip’s exclusive first-parent segment, not the minimum timestamp across its history or its current HEAD date. The existing `commitTime()` prefers a valid committer date, then a valid author date. Missing or malformed dates sort after known dates; equal or entirely unknown times use HEAD SHA. Rebase, clock errors and newly loaded boundaries can change this observed start and ownership order; it is not a historical branch-birth guarantee.

`graphColors()` uses no localStorage or previous color assignment. It derives a canonical graph from SHA-normalized commits with no prior lane state for color adjacency only; the rendered lane positions remain unchanged. The reference path takes priority, followed by each path’s oldest loaded owned commit SHA, with HEAD SHA breaking ties. This observable start is not necessarily the historical branch-creation point; older pages may reveal an earlier start and change that priority. The reference keeps palette index 0. Other paths prefer a hash of their full HEAD-ref name (same-HEAD aliases use code-unit name order); a path without a HEAD ref uses its HEAD SHA, even if interior refs exist. Interior aliases therefore do not redefine the path. Adjacent collisions cycle indices 1–7 from the preferred index, then try index 0, with a deterministic least-conflict fallback when all eight colors are used. The existing six colors remain, with pink and lime added. Tests check the added colors against both themes' graph and actual translucent badge backgrounds at 4.5:1 or better.

The reproducibility contract is **the same refs, loaded history, selected base/HEAD SHA and repository default-branch metadata produce the same palette assignments**, including separate browser contexts and reordered input arrivals. Width, time direction and theme do not change palette indices. New refs, default-branch metadata or older pages may change path boundaries, integration evidence or neighbors and therefore collision-adjusted colors. Different snapshots, ambiguous historical branch identity and collision-free adjacency for arbitrary path counts are outside that guarantee. Previous assignments are deliberately not retained, so an old tab cannot disagree with a fresh browser solely because it remembers an earlier allocation. Automatic refresh, page reload, older-history loading and new branch discovery are checked against independent calculations of the same final snapshot.

For `merge → (base, feature)` and `feature → base → root`, the feature flow includes `merge → feature → base`, with the merge and base nodes as its two boundaries; `merge → base` and `base → root` remain dim. The merge node's main flow keeps its first-parent line; it does not highlight the incoming feature or that secondary-parent connector. Terminal merges consume a non-reference work flow HEAD as a second or later parent from another flow. The current `baseHead` flow is excluded, so work syncing the reference HEAD does not mark the reference as ended. First-parent continuations are not endings, whether the child is an ordinary commit or a merge; this rule uses SHA roles rather than branch names. Merging an older work commit does not end a branch that continued afterwards; a simple one-parent fork is not an ending. Multiple observed terminal merges can be shown without traversing their other history. Unmerged or unloaded endings remain at the current HEAD without a new request. For `d4 → d3 → d2 → d1`, with `dev=d4`, `main=d2` and main selected as the base, the dev flow includes `d4,d3,d2` and stops before `d1`. A shared boundary node directly selected belongs to its parent flow. Same-HEAD badge aliases keep separate name targets; a commit target may show the names sharing its path. A ref in the middle of an already claimed path follows that same path instead of adding a boundary.

Ending detection is a heuristic over loaded parents/refs, with an exemption only for the currently selected reference flow. It cannot infer arbitrary merge intent. For `P = merge(m1, d2)`, `F3 = merge(f1, d2)` and refs `main=P`, `dev=d2`, `feature=F3`, selecting main makes dev include both the promotion P and sync F3 as endings. Selecting dev suppresses both, including the real promotion P. These endpoints do not establish historical branch creation, deletion or integration completion. No branch names are hardcoded and no additional API request attempts to infer that intent.

`resolveGraphHover()` serves badges, commit hover and selection, caching only two recent flows. Moving between commits in one flow reuses the same result. Loaded-data/HEAD changes rebuild ownership; missing targets clear. Unloaded parents keep the existing dashed stub without a highlight-triggered fetch.

Settled highlight factors have only two levels: 100% of existing alpha for targets, including source/destination name badges, and 25% for non-targets. Non-target nodes/messages use 25% opacity, and lines, badges, SHA/author text and Actions rings multiply their existing alpha by 0.25. This includes the running background, progress arc, queued/cancelled/skipped states and the DOM spinner before job counts arrive. Colors, widths, radii, job ratios and animation start times stay unchanged. Tag/release icons use their commit node's opacity and the same transition frame, including the 0.25 factor when that commit is outside the focus. Existing tooltips, truncation, hit areas, selected-node size and detail panels remain available; hidden messages have no hit area.

Connecting lines accept hover within 5 CSS pixels of their actual curve. First-parent lines normally resolve the child path. Explicit secondary merge connectors follow the incoming parent's shared color path to its start boundary and add only the selected merge node and connector. Future incoming work and other merge points are excluded; previously integrated commits on that same path are not a new stopping boundary. Thus `e1ac3b8 → a4304a2` follows the dev path from `a4304a2` to its observable start, rather than stopping at a previous promotion. Badges on the incoming path stay bright only when their actual ref HEAD is in this interval; its current HEAD badge stays dim if that branch continued beyond the selected merge. Known badges on the directly connected start-boundary path and selected destination path also stay bright, even when their current HEADs are outside the interval. Other merge destinations contribute no names. Each merge/parent SHA pair has a distinct cached identity, sharing the same two-entry cache as ordinary paths. No destination-ancestor search, branch-name hardcoding or additional API request is needed.

Moving from a scoped merge connector along a first-parent line in that interval keeps the scope. Nodes, badges and visible messages still take priority. A selected dev commit cannot override the explicit historical interval; leaving hover restores the retained selection. Nearly tied curves (within 0.5px) retain an existing hover/selection flow; an indistinguishable crossing without a preferred flow chooses neither. Unknown incoming parents do not invent a flow or trigger a request. Line clicks/taps retain that path highlight without detail inspection, and leaves the ordinary branch/commit ending policy unchanged. `visibleGraphEdges()` supplies one viewport geometry cache for drawing and hit paths. Path2D construction happens only when data/viewport geometry changes; hit testing uses bounds and native isPointInStroke in graph CSS coordinates with Canvas state saved/restored. Scroll, reverse direction and DPR use the same policy.

Opacity eases to its next target over 140ms using smoothstep. Interruptions start from each element's currently displayed alpha, including when focus clears; they never reset the graph to full brightness first. `GraphOpacity` keeps a shared background fade plus sparse exceptions. Target changes visit only the previous/next focus and unfinished exceptions, including older A when rapidly moving A→B→C. Existing commit, edge-color and reference Maps supply membership/size without a copied or scanned element universe. Transition setup scales with focus and unfinished exception sizes, rather than all loaded history; viewport/data edge indexing and existing node traversal/drawing costs remain.

A bounded `requestAnimationFrame` loop draws the Canvas and updates DOM spinner opacity with the same timestamp, preserving spinner rotation. Frames stop when settled or when no displayed factor changes, and are canceled on effect replacement, deactivation and unmount. Equivalent focus/data updates do not restart the deadline, removed/finished exceptions are pruned, and newly loaded unfocused elements join the current common fade. There are no per-frame React state updates, DAG layout calls or API requests. No app setting or toggle is added. When the browser restores a lost Canvas 2D context (`contextrestored`), the blank canvas is redrawn immediately.

Hover-capable pointers use `(any-hover: hover)` independently of width. Hover temporarily takes precedence over selection without inspecting a commit. A gap holds the previous hover for at most 100ms; entering any target cancels the pending exit and sets the transition target immediately. Repeated empty-space moves do not extend the deadline. Pointer leave, scroll, blur, resize or reorder clears the hover target immediately, fading toward a retained selection or normal opacity. Node/message/version-icon clicks or taps open the existing details and select the flow; badge/line clicks or taps retain only the path highlight. Closing details, pressing outside or switching repository selection clears it. Touch start, swipe, cancellation and long press alone create no new selection highlight.

Each Graph is independent. Hover adds no API request, periodic timer or DAG layout call. Only one cancellable 100ms exit timeout can exist per graph, cleaned up on click/touch, deactivation and unmount. Existing metadata inspection, refresh scheduling, APIs and caches are unchanged. See the [flow specification](dag-hover-highlight.md) for complete rules and verification scope.

### Shared path click and tap selection

All widths and Split view columns support the same path selection: clicking/tapping a branch badge or line retains its highlight without inspecting a commit. Node/message/version-icon clicks still open details. Retained paths are independent per column. Badge/line clicks close the one shared detail popup without clearing other columns’ retained paths. Empty space, detail close or deleted targets clear the relevant selection; valid targets survive resize and reordering. Hover temporarily overrides it. Truncated badge taps also show the full-name tooltip until another press or any graph scroll. Mouse line hits use 5 CSS pixels; touch uses 12. The cursor is a pointer only over actual click targets. Touch movement beyond 8 CSS pixels, cancellation and holds over 500ms do not create a selection; native scrolling is preserved. The common resolver and opacity transition are reused without additional API requests.

## 코드 구조와 기술적 한계

`src/main.tsx`가 진입점이며 앱 상태·인증·내비게이션·갱신 수명을 관리한다. 화면 컨트롤은 명시적인 props로
상태를 받아 렌더링하고 별도 세션이나 구독을 만들지 않는다. `PopupBackdrop.tsx`는 토큰·설정·Split view
팝업의 배경과 포인터 처리를 공유한다. 설정 패널은 헤더 밖에 렌더링해 배경이 앱 전체를 덮도록 한다.
파일은 관련 기능별로 모으고 스타일과 테스트를 구현 옆에 두며 모듈은 명시적 상대 경로로 가져온다.

- `src/app/`은 공통 화면·알림·표시 옵션·분석·전역 스타일을, `src/app/pwa/`는 앱 업데이트를 담당한다.
- `src/graph/`는 그래프 렌더링·입력·경로 강조·커밋 상세를 담당한다. `Graph.tsx`는 배치·입력·스크롤·
  애니메이션을 조정하고 `graphCanvas.ts`는 DPR을 반영해 그린 배지와 메시지의 클릭 판정 범위를 반환한다.
  Canvas는 선택 상태나 요청 수명을 소유하지 않는다.
- `src/repository/`는 저장소와 브랜치 선택, Owner 조회, 내비게이션, 이력·메타데이터를 담당한다.
  `history.ts`가 탐색 방향·페이지 요청·취소를 조정하고, `HistoryCommitPages.ts`가 요청 풀·중복 제거·불변
  페이지 캐시·HEAD 검증을 맡는다. `historyTraversal.ts`는 탐색 경계·조회 범위·조상 관계를 계산한다.
- `src/monitor/`는 Split view의 선택·정렬·세션·열·상세 위치를, `src/token/`은 토큰 저장·권한 검사·
  토큰 컨트롤을 담당한다.
- `src/shared/`는 공통 Git 모델과 이모지 변환, `github/`·`refresh/`·`debug/`·`ui/`의 공통 기능을 담당한다.
  `model.ts`는 SHA로 중복을 제거하고 날짜가 아닌 부모 관계로 위상 배치를 계산한다. 가능한 경우 부모 레인과
  이전 배치를 재사용한다. `src/shared/github/api.ts`는 페이지 단위 REST 요청을 담당한다.

브랜치 참조·경로·화면 레인은 별개다. `graphColors.ts`는 배치와 별도로 색상을 결정하고 강조와 배지 트랙에
같은 경로 ID를 사용한다. 페이지 추가로 경계나 인접 관계가 바뀌면 색이 달라질 수 있지만, 최종 스냅샷과 기준
HEAD가 같으면 새 브라우저에서도 같은 색을 배정한다. `branchLabels.ts`는 브랜치 HEAD뿐 아니라 가시 곡선
구간에도 라벨을 배치한다. 상세 규칙은 [경로 색상과 하이라이트](dag-hover-highlight.md)와
[월·일 날짜 구분선](date-separators.md)을 따른다. 날짜 구분선은 별도 설정·의존성·API 요청을 추가하지 않는다.

Canvas는 뷰포트와 작은 여유 영역만 그리지만 배치와 선 탐색은 메모리에 올라온 이력을 처리한다.
합성 커밋 10,000개를 자동 테스트로 검증하며, 실제 대형 저장소와 100,000개 커밋의 성능은 따로 실측해야 한다.
무한 스크롤은 점진적 로딩이며 무제한 메모리나 성능을 보장하지 않는다. 오프라인 Git 이력 캐시는 없고 비공개
이력은 지우거나 새로고침할 때까지 메모리에서 보일 수 있다. 접속 여부와 조회량은 브라우저 네트워크 정책과
GitHub API 한도에 좌우된다.

추가 로딩은 가로로 보이는 레인의 현재 화면 하단까지를 기준으로 한다. 큰 점프 뒤에는 화면 위의 미완료 경계도
이어 읽으며, 화면 아래 경계와 최신 추적 애니메이션의 중간 위치는 조회하지 않는다. 이전 방문 범위를 누적하거나
필요한 경로를 임의로 자르지 않는다. 이미 예약된 작업은 화면 밖으로 나가도 유지하고, 대기열 정리 뒤 남은 경계를
다시 검사한다. 각 `History`의 커밋 요청은 최대 16개까지 병렬 처리한다. Split view의 저장소와 메타데이터 요청은
별도로 동작하므로 앱 전체의 HTTP 상한은 아니다. 느린 분기가 다른 빈 슬롯을 막지 않고 동일한 진행 요청은 공유한다.

빈 응답이나 요청 SHA와 맞지 않는 응답은 완료로 처리하지 않고 **Retry**를 제공한다. 오류가 나면 새 자동 요청을
멈추되 이미 시작한 독립 요청의 결과는 유지하고, 실패한 소스만 재시도한다. 저장소·방향·토큰을 바꾸면 대기 및
진행 요청을 취소한다. 이름 조회만으로 커밋을 요청하지 않고, 활동 탐색은 배치당 메타데이터 한 페이지와 독립 이력
최대 세 개를 처리하며 이미 읽은 HEAD와 공유 조상은 다시 받지 않는다. 활동 탐색 실패 시 **Retry branches**를
제공한다. 오래된 순에는 마지막 페이지 정보가 필요하며, 없으면 전체 이력을 훑는 대신 오류를 표시한다.

미조회 부모는 현재 메모리의 커밋을 기준으로 판정하며 다시 필요한 조상은 유효한 불변 페이지 캐시에서 복원한다.
날짜 필터 없는 40자 SHA 고정 첫 페이지는 해당 커밋이 있어야 캐시한다. 갱신 HEAD가 이 조건을 통과하지 못하면
이전 그래프·참조·HEAD를 유지하고 다음 갱신에서 재시도한다. 날짜 필터를 사용한 활동 조회와 오래된 순의 후속
페이지는 HEAD 포함 검증에서 제외한다.

전체 참조 갱신을 마치면 삭제된 참조에만 속한 경로를 정리한다. 남은 참조의 도달 가능한 조상과 이전 HEAD는 공유
이력과 미조회 경계 너머를 보호한다. 실제 머지 부모는 남고 squash로 통합된 뒤 불필요해진 경로는 사라진다. 선택한
기준 브랜치가 삭제돼도 캐시 이력과 안내를 유지한다. 뒤늦게 도착한 활동·추천·이름 조회 응답은 완료된 갱신 버전과
비교해 옛 이름이나 HEAD를 되살리지 않으며, 전체 참조 목록이 확인되면 이전 선택 목록의 페이지 탐색을 끝낸다.
이미 사라진 부모 경계의 응답은 그래프에 합치지 않는다. 그 요청에만 해당하는 오류는 무시하지만 인증·한도 오류는
계속 알린다. 자세한 판정은 [제품 명세의 API 및 로딩](specification.md#52-api-및-로딩)을 따른다.

## Vercel 배포

[`vercel.json`](../vercel.json)에 맞춰 Node.js **24.x**, Framework Preset **Vite**, 저장소 루트, 설치 명령
`npm ci --no-audit --no-fund`, 빌드 명령 `npm run build`, 출력 경로 `dist`를 사용한다. 백엔드·Functions·
빌드 환경변수·빌드용 GitHub 토큰은 필요하지 않다. `VITE_*` 값은 브라우저 번들에 공개되므로 PAT를 넣지 않는다.

### Git 연동

Vercel 프로젝트 `commit-trail`을 `han41858/commit-trail`과 연결하고 Production Branch는 **main**, GitHub 기본
브랜치는 **dev**로 유지한다. `vercel.json`의 `git.deploymentEnabled: true`는 Git 자동 배포를 활성화한다.
Vercel Preview도 켜 둔다(`previewDeploymentsDisabled: false`). `gitProviderOptions.createDeployments`는
GitHub 배포 기록을 제어하며 Vercel 빌드 스위치와는 다르다.

기능·수정·문서·설정 작업은 최신 `dev`에서 분기하고 `dev` 대상 PR로 먼저 반영한다. `feature/*`, 기존 `feat/*`
및 `dev`는 Preview 대상이며 `main`에 승격 PR을 머지하면 Production 빌드를 시작한다. 확인된 빌드 비대상
문서만 변경한 경우에는 아래의 문서 전용 규칙으로 빌드를 취소한다.

GitHub Actions는 검증을, Vercel Git Integration은 배포를 담당한다. Preview는 CI와 병렬로 빌드할 수 있다.
`main` PR의 필수 검사는 머지를 제어할 뿐, 머지 후 검사까지 Production 도메인 반영을 보류하려면 별도의
Vercel Deployment Checks가 필요하다.

### CI 이벤트 처리

`.github/workflows/ci.yml`은 `dev`·`main` 대상 PR의 열기·다시 열기·커밋 추가·수정과 두 브랜치의 push를
검증한다. 대상 변경뿐 아니라 제목·본문만 고쳐도 고정 이름 **Test and build**로 실행한다. 항상 러너에서 승격
경로를 검사하고 `.nvmrc`와 npm 다운로드 캐시를 사용해 Node와 의존성을 준비한 다음 `npm run format:check`를
실행한다. 문서 전용으로 확인한 경우에만 작업 내부의 앱 테스트·자동화 테스트·빌드를 생략한다. 추가 Secret은
필요하지 않다.

필수 작업 전체를 건너뛰거나 이름을 동적으로 바꾸지 않는다. 스킵된 작업의 이름 표현식이 평가되지 않은 채
기록되면 성공했던 실행을 다시 돌려도 필수 검사가 대기 상태에 남을 수 있다. PR 또는 브랜치마다 같은 동시성
그룹을 사용해 최신 실행이 이전 검증을 대체한다.

`.github/rulesets/`의 정의에서 `dev`는 최신 기준 브랜치를 요구하고 `main`은 요구하지 않지만, 어느 쪽이든
PR의 병합 결과를 검증한다. `dev` Ruleset에 PR 자체를 강제하는 규칙은 없으나 운영 절차는 PR을 거친다.
PR에서 검사한 트리가 이후 push와 같다고 단정할 수 없고 릴리즈 진입점 검사도 대상 브랜치에 따라 다르므로
push 검증을 유지한다. 저장소의 JSON을 변경해도 GitHub에서 활성화된 Ruleset은 자동으로 바뀌지 않는다.

### AI 개발과 교차 리뷰

저장소 쓰기 권한자가 열린 Issue에 실행 라벨 하나를 추가하면 기본 브랜치 `dev`에서 `AI development`가 GitHub
호스팅 Ubuntu 러너로 실행한다. 필요한 라벨은 저장소에 미리 만든다. 실행 라벨이 여러 개면 시작하지 않는다.

- `ai:develop` 또는 `ai:develop:codex`: OpenAI Codex가 개발하고 Anthropic Claude가 리뷰한다.
- `ai:develop:claude`: Anthropic Claude가 개발하고 OpenAI Codex가 리뷰한다.

한 PR로 끝낼 변경과 완료·검증 조건을 Issue에 적는다. 첫 실행은 역할과 Issue·`dev`의 기준 상태를 기록한다.
컨트롤러는 개발 모델의 편집을 검증한 뒤 `ai/issue-<number>-<developer>`에 커밋하고 `dev` 대상 Draft PR 하나를
연다. 리뷰 모델은 Git 스냅샷과 전체 diff를 읽고, 컨트롤러는 구조화한 지적 사항을 PR 댓글로 남긴다. 수정 요청은
원래 개발 모델에 돌려보내며 통과하지 못한 채 리뷰 한도 3회에 도달하거나, 같은 결함이 반복되거나, 모델이 사람의
판단을 요청하면 멈춘다. 댓글만 요청하면 리뷰할 Draft PR이 없으므로 상태 댓글의 사유를 확인하고 구체적인 편집을
새 Issue에 적는다.

리뷰가 통과하면 현재 PR HEAD의 **Test and build**를 확인한다. CI가 없거나 승인 대기 또는 실패 상태라면
`needs_human`으로 멈춘다. 저장소 정책에 따라 **Approve workflows to run**을 눌러야 할 수 있다. 같은 SHA의
교차 리뷰와 CI가 모두 통과하면 Draft를 해제하고 그 SHA로 `dev`에 스쿼시 머지를 요청한다. GitHub가 기존 브랜치
규칙을 적용하며, 성공하면 Issue에 `merged`와 머지 커밋을 기록하고 연결된 Issue가 닫힌다. 충돌·PR 또는 HEAD
변경·머지 거부는 사람의 확인이 필요하다. `main` 승격은 AI 스쿼시 머지와 별도의 수동 절차다.

#### 공유 큐와 한 Issue의 CI 후속 처리

개발·정리·머지 후속 작업은 저장소 단위의 공유 동시성 그룹(`queue: max`, `cancel-in-progress: false`)을 사용한다.
여러 작은 Issue에는 각각 실행 라벨을 붙여 큐에 넣는다. 작업은 대기한 순서대로 한 번에 하나씩 실행하며, 앞선
작업이 머지됐다면 다음 새 Issue는 그 변경을 포함한 `dev`를 사용한다. 앞선 Issue가 CI 대기로 큐를 비우면 다른
작업이 먼저 진행될 수 있다. 큐는 Issue 의존성을 해석하거나 다음 Issue를 자동으로 시작하는 기능이 아니다.

`AI development CI follow-up`은 `ai/issue-*` 브랜치에서 완료된 `CI`를 받는다. 성공한 같은 저장소의 PR 실행과
정확한 `ai/issue-<number>-(codex|claude)` 이름을 확인한 뒤, 이미 리뷰를 통과해 CI를 기다리는 **같은 Issue의 같은
HEAD**만 자동으로 이어서 처리한다. CI를 기다리는 사이 다른 머지 등으로 `dev`가 바뀌면 `needs_human`으로
멈춘다. 후속 작업에는 모델 접근 권한이 없어 새 HEAD의 브랜치 갱신이나 리뷰를 대신하지 않는다.

`AI development cleanup`은 `dev`에서 완료된 `AI development`의 중단 상태를 정리한다. 성공·스킵한 실행에는
정리 러너를 할당하지 않는다. 일반 PR과 `dev`·`main` push CI는 AI CI 후속 워크플로를 시작하지 않는다.
`workflow_run`은 트리거에서 결론을 거를 수 없으므로 관련 AI 실행에 스킵 기록은 남을 수 있다.

#### 모델과 자격 증명

**Settings → Environments → ai-development → Deployment branches and tags**에서 `ai-development` Environment를
설정하고 선택된 브랜치에 `dev` **브랜치**만 추가한다. 태그나 와일드카드는 허용하지 않는다. 개발 작업과 CI 머지
후속 작업은 이 Environment를 사용한다. 다음 세 Secret은 여기에 두고 Repository Secrets 사본을 삭제한다.

- `OPENAI_API_KEY`: [OpenAI API 키](https://platform.openai.com/api-keys)로 설정한다. Codex는 Responses API와
  기본 모델 `gpt-6.2-sol`을 사용한다. 모델 ID는 [공식 Codex 카탈로그](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json)에서 확인한다.
- `ANTHROPIC_API_KEY`: [Claude Console](https://console.anthropic.com/settings/keys)의 키로 설정한다. Claude는
  Messages API와 기본 모델 `claude-sonnet-5-5`를 사용한다. 모델 ID는 [공식 Anthropic SDK](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/model.py)에서 확인한다.
- `AI_AUTOMATION_TOKEN`: `han41858/commit-trail`로 범위를 제한한 fine-grained PAT를 사용한다. **Contents**,
  **Pull requests**, **Workflows**는 읽기/쓰기, **Actions**, **Secrets**, **Environments**는 읽기 권한을 준다.
  Workflows 쓰기는 `.github/workflows/` 커밋에 필요하고 읽기 권한은 Secret 값이 아닌 격리 메타데이터를 검사한다.
  classic PAT를 사용한다면 `workflow` 스코프도 필요하다. 짧은 만료 기간과 저장소 범위 제한을 권장한다.
  [GitHub PAT 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)를 참조한다.

**Settings → Secrets and variables → Actions → Variables**의 저장소 Actions 변수 `AI_CODEX_MODEL`과
`AI_CLAUDE_MODEL`은 기본 모델보다 우선한다. 예를 들어 Claude에 Opus를 사용하려면 `AI_CLAUDE_MODEL`을
`claude-opus-5-5`로 설정한다. 개발·리뷰 역할은 그대로이고 해당 공급자 모델만 바뀐다. 이전 ID를 지정한 변수가
있으면 갱신하거나 삭제한다. 선택한 모델은 구조화 출력과 도구 호출을 지원해야 하며 API 계정의 접근 권한도
필요하다. 사용할 수 없는 모델이면 공급자 오류를 기록하고 중단하며 다른 모델로 자동 전환하지 않는다.

기본 `GITHUB_TOKEN`은 상태·리뷰 댓글·Draft 해제에 사용한다. 브랜치·커밋·PR 게시와 스쿼시 머지에는
`AI_AUTOMATION_TOKEN`을 사용해 일반 PR 및 머지 후 CI가 시작될 수 있도록 한다. 컨트롤러는 모델 실행과 게시
변경 전에 Repository Secrets가 비어 있는지, 세 자격 증명이 `dev` 전용 Environment에 있는지, Secret을 담은
다른 Environment가 명시적인 `dev` 또는 `main` 브랜치로만 제한되는지 확인한다. 비어 있는 Preview·Production
Environment에는 브랜치 제한이 필요하지 않다. 검사는 개인 소유 저장소만 지원하며 조직 Secret 상속은 별도 검토가
필요하다. 권한 부족·안전하지 않은 정책·불완전한 메타데이터는 게시 전에 `needs_human`으로 처리한다. 워크플로
커밋 권한 오류는 필요한 Workflows 권한을 안내한다.

#### 실행 격리와 게시 전 검증

모델에는 Issue, 신뢰된 `AGENTS.md`, 제한된 Git 텍스트 스냅샷을 제공하며 도구에 셸·GitHub·공급자 자격 증명을
노출하지 않는다. 워크플로·자동화·의존성 설정·`AGENTS.md`를 포함한 일반 텍스트를 Issue 범위 안에서 편집할 수
있고 별도의 디렉터리 허용 목록은 없다. Git 내부 파일·`node_modules`·저장소 밖 경로·`.env` 비밀 파일·심볼릭
링크·비텍스트·크기 초과 파일은 제외하며 `.env.example`은 허용한다. 잠금 파일을 포함해 UTF-8 파일당 읽기·편집
한도는 1 MiB다.

공급자 응답은 SSE로 받아 하나의 결과로 조합한다. `.github/scripts/ai-development/config.mjs`의 `limits`는
요청당 도구 턴 30회, 출력 32,000토큰, 편집 80개, 수신 유휴 5분과 전체 30분을 제한한다. Codex의 추론 설정은
`medium`이다. 오류·조기 종료·무응답으로 결과를 알 수 없는 스트림은 자동으로 다시 요청하지 않는다. 공급자가
토큰 사용량을 반환하면 Actions 로그에 기록한다.

컨트롤러는 수정된 `package.json`과 `package-lock.json`에서 Docker로 `npm ci --ignore-scripts --no-audit --no-fund`를
실행해 의존성을 설치하고, 두 파일의 내용으로 이미지를 캐시한다. 잠금 파일 불일치나 설치 실패는 수정 시도에
검증 결과로 돌려준다. 그다음 자격 증명과 네트워크가 없는 별도 컨테이너에서 아래의 `config.checks`를 적용한다.
문서 전용 PR CI의 생략 규칙은 이 게시 전 검증에 적용하지 않는다.

```sh
npm run format:check
npm test
node --test --test-isolation=none .github/scripts/*.test.mjs
npm run build
```

#### 중단과 수동 재개

Issue에 `ai:stop`을 붙이면 컨트롤러가 다음 상태 점검에서 멈춘다. 즉시 실행을 끊어야 하면 Actions 실행을
취소한다. 정리 워크플로는 활성 상태가 남은 중단 실행을 정리한다. 상태 댓글에는 마지막 기록 커밋·PR·Actions
실행을 남긴다. 상태 댓글의 편집은 알림을 보내지 않으므로 `needs_human`이나 `failed`로 멈출 때 별도 중단
댓글도 남긴다.

1. 중단 댓글, 상태 댓글의 상세 사유, 필요한 경우 PR 지적 사항과 Actions 로그를 확인한다. 권한·격리 설정·CI 승인
   등 보고된 원인을 먼저 해결한다. 컨트롤러 수정이 필요하면 그 변경을 먼저 `dev`에 반영한다.
2. Issue가 닫혔다면 다시 열고 `ai:stop`을 제거한다. **Actions → AI development → Run workflow**에서 **dev**를
   선택하고 기존 Issue 번호를 입력한다. 실행 라벨을 다시 붙이는 것만으로는 재개하지 않는다.
3. 자동화는 원래 역할과 작업 브랜치·PR을 재사용하며 Issue 제목·본문 및 PR·HEAD의 동시 변경이나 닫힌 PR을
   확인한다. 요청 자체를 바꾸려면 새 Issue를 사용한다. 기존 PR에 새 `dev`가 필요하면 GitHub의 update-branch
   API로 반영하고 새 HEAD의 리뷰와 CI를 다시 거친다. 새 리뷰도 총 3회 한도에 포함하며 충돌은 사람이 확인한다.

직전 리뷰의 결과가 기록되지 않아 직접 PR 검토를 요청하는 안내가 나오면 해당 PR을 사람이 검토한다. 같은
커밋의 결과 불명 리뷰를 자동으로 다시 요청하지 않는다.

### 문서 전용 변경 판정

`.github/scripts/change-impact.mjs`는 CI와 Vercel이 함께 사용한다. `docs/` 아래의 일반 파일과 루트의
`README.md`, `AGENTS.md`, `LICENSE.md`만 빌드에 사용하지 않는 문서 경로로 판정한다. `docs/`에는 새 가이드·
예제·이미지도 둘 수 있지만 확장자만으로 판정하지 않으며 `docs-build/` 같은 다른 디렉터리는 포함하지 않는다.
패키지·잠금 파일, TypeScript·Vite·Vercel 설정, 워크플로·Ruleset·자동화 등 다른 경로가 함께 바뀌면 전체 검사와
빌드를 유지한다.

빌드의 진입점은 `index.html`과 `src/main.tsx`이며 TypeScript는 `src`를 검사하고 Vite는 `public`을 복사한다.
`vite.config.ts`는 PWA 매니페스트와 Service Worker를 생성한다. 앱이나 빌드가 읽는 문서·템플릿은
`src/`, `public/`, `templates/` 등 위 문서 전용 경로 밖에 둔다.

CI는 전체 이력을 가져오고 PR의 기준 SHA에서 체크아웃된 병합 결과까지, 또는 push의 `before`에서 `after`까지
비교한다. 이름 변경은 이전 경로와 새 경로를 모두 검사한다. 새 브랜치·강제 push 등으로 비교가 확실하지 않거나,
이력 누락·잘못된 이벤트·빈 비교·일반 파일이 아닌 문서·판정 오류가 있으면 전체 검증으로 처리한다. 문서 전용이어도
승격 검사와 **Test and build** 결과를 유지해야 하므로 워크플로 수준의 `paths-ignore`를 사용하지 않는다.

Vercel은 `ignoreCommand`에서 같은 스크립트를 `--vercel`로 실행한다.
[Ignored Build Step](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand)에 따라 종료 코드
0은 설치·빌드·배포 전에 취소하고, 1은 정상 진행한다. `HEAD^`가 아닌 `VERCEL_GIT_PREVIOUS_SHA`부터 비교해
마지막 문서 커밋이 앞선 앱 변경을 가리지 않도록 한다. 최초 배포·이력 부족·조상 관계 불일치·같은 SHA 재배포는
정상 빌드한다. 취소 시 현재 제공 중인 배포를 교체하거나 새 Production 릴리즈를 만들지 않는다. 실제 연동 동작은
Vercel 대시보드와 Git 배포에서 검증하며, 이 규칙은 CLI 배포 경로를 추가하지 않는다.

### 브랜치 승격

1. `dev`의 최종 개발 머지를 마친 뒤 **같은 저장소의 `dev` 자체**를 head로 하는 `main` 대상 PR을 연다. 포크의
   `dev`나 기능·복구·릴리즈 브랜치는 허용하지 않는다. `.github/scripts/check-promotion.mjs`는 의존성 설치 전에
   PR의 대상·소스 브랜치·소스 저장소를 검증한다. 이 규칙의 회귀 테스트는 자동화 테스트와 함께 실행한다.
2. 필수 CI를 통과한 PR은 **merge commit**으로 머지한다. 승격에는 squash나 rebase를 사용하지 않는다. 해당
   최종 `dev` SHA가 `main`의 조상인지 확인한다.
3. `main`에만 있는 `.github/workflows/production-release.yml`을 유지한다. `main` 전체나 `main` 기반 작업
   브랜치를 `dev`로 합치지 않고 별도 릴리즈 브랜치로 우회하지 않는다. [AGENTS.md](../AGENTS.md)의 프로젝트
   전용 브랜치 규칙을 따른다.

일반 배포 경로는 Git 연동이다. 수동 CLI 배포는 명시적인 예외이며 같은 SHA로 중복 배포하거나 커밋하지 않은
파일이 포함될 수 있다. CI에는 Vercel CLI 배포 단계나 Vercel 자격 증명을 추가하지 않는다.

### Production 릴리즈 발행과 정리

`main`에만 있는 `.github/workflows/production-release.yml`의 **Production release**가 `deployment_status`를
받아 같은 커밋의 `.github/workflows/release.yml`을 호출한다. 공유 워크플로는 수동 **Production release recovery**도
제공한다. `dev`와 그 작업 브랜치의 `release.yml`에는 배포 상태 트리거가 없으므로 Preview 이벤트로 새 스킵 실행을
만들지 않는다. 과거 실행 기록은 유지한다. 공유 워크플로와 릴리즈 로직의 변경도 `dev`를 거쳐 승격하며, CI 자동화
테스트는 진입점이 `dev`에 없고 `main`에 있어야 한다는 규칙을 검사한다.

Vercel에서 GitHub 배포 기록을 켠다(`gitProviderOptions.createDeployments: enabled`). GitHub는 배포 상태 이벤트를
받고 빌드는 여전히 Vercel Git Integration이 수행한다. Repository dispatch는 끈 상태로 둘 수 있다. 추가 Secret이나
CLI는 필요하지 않으며 게시 작업만 `contents: write`를 받는다.

워크플로는 GitHub에 저장된 Vercel 봇의 배포와 성공 상태, 팀·프로젝트 대시보드 URL, 배포 SHA가 `main`에
속하는지 검증한다. 대시보드 경로와 생성된 배포 호스트는 `TEAM` 값 `han41858` 및 정확한 프로젝트 이름
`commit-trail`과 일치해야 한다. 공개 Production 도메인도 배포 URL로 허용한다. 팀 URL을 바꿀 때는 공유 `TEAM`
설정을 갱신한다. 배포된 커밋이 아니라 보호된 기본 브랜치 `dev`에서 자동화 코드를 읽고 검증 작업이 확인한 정확한
자동화 커밋으로 게시한다.

성공한 Production의 **실제 배포 커밋**에 `rel-YYYYMMDDHHmmss` 태그와 GitHub Release를 만든다. 태그에는 확인한
배포 성공 시각을 **Asia/Seoul**로 적용하고 릴리즈 노트에는 변경 내역·커밋·Production URL·배포 링크를 포함한다.
Preview나 실패한 배포는 발행하지 않는다. 같은 커밋의 반복 이벤트·재배포는 남아 있는 릴리즈를 재사용하고, 발행 실패
후 재시도는 기존 태그를 재사용한다. 기존 태그는 옮기지 않으며 다른 커밋과 시간이 충돌하면 비어 있는 다음 초를
찾는다.

게시와 정리는 저장소 단위 `queue: max`(대기 최대 100개), `cancel-in-progress: false`로 직렬화한다. 지연 이벤트와
수동 dry run이 대기 중인 게시를 대체하지 않는다. 순서는 작업이 대기하기 시작한 시점 기준이므로 태그 시각도 비교해,
이전 배포 이벤트가 새 릴리즈를 대체하거나 이미 정리된 릴리즈를 다시 만들지 않도록 한다.

자동 발행한 Production 릴리즈 중 최신 하나만 보존한다. `rel-` 타임스탬프 태그와 본문 자동화 표시를 함께 확인하며,
이전 Git Stream 이름으로 자동 발행된 릴리즈도 관리 대상으로 본다. 오래된 게시 릴리즈만 삭제하고 수동 릴리즈·초안·
프리릴리즈와 Git 태그·커밋·배포 기록은 삭제하지 않는다.

- 게시 또는 재사용에 성공하면 이전 목록·이번 실행이 반환받은 릴리즈·다시 조회한 목록을 합친다. 같은 릴리즈 ID는
  새 목록이 우선하므로 초안·프리릴리즈·수동 릴리즈로 바뀐 항목을 보호한다. 새 목록이 비어 있거나 늦게 갱신돼도 이번
  실행에서 받은 릴리즈는 즉시 개별 재조회하지 않고 보존 후보에 남긴다.
- 이전 목록에만 있던 나머지 관리 대상은 삭제 전에 ID로 다시 조회한다. `404` 또는 수동·초안·프리릴리즈로의 변경은
  후보에서 제외하고, 다른 조회 오류나 ID·태그 불일치는 삭제 전에 정리를 중단한다. 이미 사라진 최신 릴리즈 때문에
  마지막으로 남은 실제 릴리즈를 삭제하지 않도록 한다.
- 새 릴리즈 발행에 실패하면 기존 릴리즈를 건드리지 않는다. 정리 실패는 오류로 보고하고, 같은 배포를 재시도하면
  새 태그나 릴리즈를 더 만들지 않고 정리를 이어간다. 수동 dry run에서는 삭제하지 않는다.

이벤트 누락을 확인하거나 재처리하려면 기본 브랜치 `dev`에서 **Production release recovery**의 **Run workflow**를
열고 GitHub deployment ID를 `deployment_id`에 입력한다. `dry_run` 기본값은 `true`이며 태그나 릴리즈를 변경하지
않는다. 검증을 마친 성공 Production 배포를 실제 발행할 때만 이를 끈다. Preview ID는 검증 단계에서 건너뛰며 과거
배포를 자동으로 소급 발행하지 않는다.

### 배포 검증과 보안 헤더

로컬에서는 개발 절의 테스트·빌드·`npm run preview -- --port 4173`으로 산출물을 확인한다. 실제 Production은
프로젝트의 공개 도메인을 익명 브라우저 세션이나 Vercel 인증 없는 HTTP 요청으로 열어 HTTP 200 응답과 로그인
리디렉션이 없음을 확인한다. JS·CSS와 공개 저장소 그래프가 동작하는지도 확인한다. 보호된 개별 배포 URL이나
인증한 요청의 성공만으로 공개 접근을 확인할 수는 없다.

`han41858/commit-trail`, `angular/angular` 같은 공개 저장소에서 실제 커밋, 브랜치 선택, 오래된 이력 로딩, 방향
전환, 커밋 링크와 `?repo=owner%2Frepo`의 새로고침을 확인한다. 좁은 화면에서는 탭과 고정 폭 세로 스크롤을,
넓은 화면에서는 콘텐츠에 맞추되 최대 50%인 그래프 열과 최대 50%인 메시지 표시를 확인한다. 비공개 저장소는 앱에
조회용 fine-grained PAT를 적용해 확인한 뒤 토큰을 제거하고 이력이 지워지는지 확인한다. 잘못된 저장소와 API
한도 메시지도 점검한다.

API 요청은 방문자 브라우저에서 나가므로 검증 환경의 `api.github.com` 외부 접속 정책은 Vercel 배포와 별개다.
단위 테스트와 모의 브라우저 검증은 실제 GitHub API나 비공개 저장소 접근을 확인한 것이 아니다. 실제 접근, 공개
도메인과 대시보드 설정, 분석 수집과 외부 미리보기는 배포 환경에서 확인한다.

해시가 있는 Vite 자산은 불변 캐시를 사용하고 HTML은 Vercel 기본 캐시 정책을 유지한다. 보안 헤더는 프레임 삽입과
민감한 기기 권한을 차단하고 MIME 스니핑과 리퍼러 전송을 막는다. CSP는 스크립트와 PWA 셸을 같은 출처로 제한하고
네트워크 연결은 같은 출처와 GitHub API `api.github.com`에만 허용해 토큰을 임의 외부 출처로 전송하는 경로를
제한한다. 쿼리 내비게이션에 catch-all rewrite는 필요하지 않다. Vercel 프로젝트의 커밋·PR 댓글 설정과
`vercel.json`의 `github.silent`로 Vercel GitHub 봇 댓글을 끈다.

## Automatic updates and metadata

Split view starts with `RefreshLoop.waitingForInitialLoad`: no automatic timeout or visible sweep is armed until every initial history and metadata operation has settled. The refresh control is disabled during that phase. Success and failure both finish initial loading; the first deadline is a full interval after settlement. Entering Split view with an already loaded primary still waits for any new columns. Later dispatch deadlines, independent repository responses and completion timestamps retain their existing policies.

`MonitorSession.settled` publishes readiness changes from every repository, including final pending-source cleanup and metadata jobs that finish after the initial open task. A failed request still settles: error information remains visible while the shared countdown and manual refresh become usable again. When the primary history has an error, common refresh uses its existing retry path just like secondary histories, retrying the failed source without a browser reload. No polling timer or healthy-cycle API request is added.

Both refresh-button pies and the collapsed bookmark fill use the theme’s blue accent at 40% opacity to distinguish filled and empty areas. Icons keep the normal foreground color, including on hover, so they remain legible over the fill; hover borders and focus outlines keep the existing accent.

The visible fill is aligned after DOM commit by anchoring its CSS animation start time to the same `nextAt` deadline, using the document's monotonic animation clock. Visibility and online events realign it without polling or API calls. Unrelated renders do not restart the animation; the hidden single-view sweep is inactive during Split view. Automatic callbacks also recheck initialization, enabled state and the latest deadline before dispatching.

The graph shows at most one version icon per commit: 🚀 when any release exists, otherwise 🏷️ when any tag exists, and no icon when neither exists. Releases take priority even if additional tags are attached. This rule uses the same rendering, hit-testing and tooltip path in single and Split view at every screen width, including after metadata refreshes. The retained icon keeps its size and position with no empty slot for a hidden tag. Clicking or tapping it opens the existing commit details with every tag name/link, release name/link and associated tag intact. `CommitInfo`, API requests, caching and refresh scheduling are unchanged.

In newest-first mode, a reader at the latest edge follows newer commits arriving from independent branch discovery as well as refreshes. A short eased scroll reveals new commits, continues across overlapping branch responses, stops on direct scroll input, and respects reduced motion. Reading older history keeps the current commit anchored; older pagination and unchanged metadata do not snap the viewport. The refresh button updates the current repository. Options provides a single automatic refresh switch and interval (authenticated: 30 seconds, 1 minute or 5 minutes; anonymous: 1 or 5 minutes). Defaults are 1 minute with an applied token and 5 minutes without. Hidden/offline tabs pause; overdue updates resume on return. `RefreshLoop.lastCompletedAt` records the end of an attempted refresh regardless of success; errors and retry deadlines are separate. Single-view history and metadata must both settle, including when one fails. Split view records the last completion among only the repository jobs newly started in that dispatch; jobs already busy from an earlier cycle are excluded, and a dispatch starting no jobs records no completion. Each repository still renders independently. Deferred completion tracking does not hold the shared timer: single-view deadlines still follow work completion, while split deadlines still follow dispatch, so faster repositories can refresh on subsequent ticks. Initial timestamps wait for initial work to settle, and discarded sessions, scope changes and stopped loops ignore late completions. No additional timers, API requests or cache changes are introduced. The footer keeps the existing completion-time or error/backoff display.

Tags (🏷️), GitHub Releases (🚀) and Actions rings augment commits without changing their coordinates. Commit-level Actions rings use green when every workflow is completed, at least one result is success, and every result is success or skipped; a success mixed with skipped workflows is therefore green. All-skipped runs and success mixed with neutral, cancelled, action_required, stale or unknown results remain gray. Running job progress is yellow, failure/timeout/startup failure is red, and waiting or all-cancelled results keep their existing gray states. This aggregate-only policy applies to every workflow name and to both single and Split view; original conclusions, individual detail icons, job counts/progress, API requests and caching are unchanged. There is no purple other-result category. Active runs retain priority; after they finish, any known failure remains red even alongside unknown results. Individual workflow icons and API result names remain available in the detail panel. Select a commit for version links, consistent 16px outline SVG workflow status icons before their names (green check, yellow spinner, gray waiting clock, red failure/timeout, and distinct cancel/skip/warning/unknown shapes), elapsed duration, attempts and known job counts. Active durations update locally; completed durations freeze at the final API status update without additional requests. Each workflow uses one row: status icon, linked name, optional job count, then elapsed time and Attempt. Elapsed time and Attempt use smaller muted text aligned to the right without wrapping; the Elapsed label remains in their tooltip. Long names use an ellipsis within the available width and retain a full-name tooltip and the original link. This layout is shared by single and Split view. Active workflow rows show completed/total job counts after the name; unconfirmed counts show ?/?, and completed workflows omit the count. The Actions heading shows a compact yellow completed/total summary such as 48/51 jobs (94%), without a separate status line or progress bar, alongside total elapsed time from the earliest workflow start to now or the final run status update when all runs finish. Overlapping workflows share elapsed wall time. Percentages count completed jobs, not elapsed time; incomplete or unconfirmed totals use a rotating graph donut without a percentage. Rotation is limited to visible running commits, pauses in hidden tabs, respects reduced motion and adds no API calls or canvas redraw loop. A Release icon does not mean a deployment completed. Actions access optionally needs **Actions: Read-only**. Missing metadata permissions do not clear the graph.

The Token popup lists Permission, Used for and Check in that order, sorted alphabetically by permission (Actions, Contents, Pull requests). Permission names are emphasized with Read-only underneath; each use is explained once without a separate feature title. It checks the applied token against the selected repository. It validates token identity, then probes Contents, Pull requests and Actions separately; Recheck repeats the checks. Edited tokens are checked after Apply, and results are not persisted. ✅ marks available access, 🚫 marks blocked access or an invalid token, and unverified/rate-limited states remain distinct. The popup omits login IDs and repeated repository labels. Checks report repository feature access rather than the complete token grant list. Create token is a prominent button and closes the token popup when opening GitHub. Opening the token popup dismisses prior API-limit guidance without clearing the retry deadline. Token, Options, branch and commit-detail popups close on outside presses or Escape; interaction inside a popup keeps it open. In Split view, Escape first cancels an active drag, dismisses a branch tooltip, clears a focused graph’s retained path highlight, or closes an open popup as applicable. It returns to single view only when the key is not consumed by those interactions; see the [shared input lifecycle](dag-hover-highlight.md#입력과-수명). Closing commit details also clears the selection and restores the node and Actions ring to their usual sizes, while keeping fetched metadata cached.

Conditional ETag reads reuse unchanged data. GitHub counts unauthenticated 304 responses against the hourly limit, so an automatic refresh without a token reads only the repository record and continues to branches, tags, releases and Actions when `pushed_at` changes; the first refresh after loading and one more after each push stay complete, unfinished workflow runs keep Actions polling, and manual or authenticated refreshes always read everything. Single and split views share this rule, and a rate-limited session without a token shows `Rate limit · token needed`. GitHub removes a merged branch 1-4 seconds after the merge, so a refresh in which a known branch head moved is followed 7 seconds later by one branch-only recheck of that repository (`RefreshLoop.recheckSoon`, `MonitorSession.recheck`). It covers squash, rebase and merge commits alike and never chains. Each repository waits from the moment its own change was seen, and the recheck does not wait for slower metadata of the same refresh. It leaves the progress indicator, completion time and next deadline unchanged. A regular refresh that starts reading the repository again replaces its recheck; a scope change or pending rate limit discards the targets, and a hidden page runs them when it becomes visible. Known commits are reused. For a commit with active workflows, missing completed-job snapshots are filled once so aggregate progress has every denominator; complete final snapshots are cached. Finished commits stop job reads, while recent workflow runs can reactivate tracking on a new attempt. Reference deletion requires a complete branch catalog. Unreachable commits are removed only when ancestry can be established; partial history is retained without a separate footer notice. Tag and release names share rows with their icons, and matching release names/versions are shown once. Version/run history is loaded in bounded pages: scrolling the commit panel continues version catalogs, the selected SHA’s runs and unfinished job pages. A short panel loads one initial continuation; further pages follow wheel, touch or keyboard scrolling without a button or repeated completed-page requests. See [the extension specification](auto-refresh-and-metadata.md).

The initial empty screen reserves the tagline, description and demo-button space during loading, so the logo stays in place even when the headline wraps. Only `Loading...` is shown in the title slot while loading; the description and demo button are hidden from view and assistive technology, and the button is disabled. The heading announces loading through a polite live region.

## 개발자 진단

개발 서버에서는 **Ctrl + Shift + D**로 진단 패널을 연다. 배포 빌드를 포함해
`/?repo=owner%2Frepository&debug=1`로 진입 버튼을 활성화할 수 있다. 웹과 설치형 PWA 모두 저장소 입력창에
`:debug`를 입력하고 Enter 또는 **Explore**를 누르면 URL·저장소·API 요청을 바꾸지 않고 패널을 연다. 패널을
닫아도 측정은 계속하며 **Disable debug**로 중지하고 기록을 지운다.

HTTP·캐시·한도, 초기/수동/자동 갱신, DAG 배치와 Canvas 그리기를 구분해 종류별 최근 20개 표본을 메모리에
유지한다. **Copy diagnostics**는 민감 정보를 제외한 JSON을 만든다. DevTools Console에서도 집계와 갱신 요약을
확인할 수 있으며 새 API 요청·외부 전송·영속 저장은 하지 않는다. 재실행 시 활성화 조건·측정 구간·Split view의
집계 범위와 해석 한계는 [개발자 디버그 모드 명세](developer-debug-mode.md)를 확인한다.

## Installable web app (PWA)

Commit Trail can be installed from a supported browser or added to the iOS home screen. It opens in standalone mode with the existing graph and controls. No install banner is shown. The app identity and launcher start at `/`; repository links still use `?repo=`.

The app uses dark/light SVG logos according to its resolved theme. The large empty-screen logo animates unless reduced motion is requested; it loops while the empty screen is displayed, with no time limit or app-imposed stop on tab return. Background playback scheduling follows browser policy. Header logos stay static. The PWA precaches all four SVG variants for offline use. Home-screen and social images are rendered on the brand background from a dedicated app-icon source (`assets/app-icon.svg`, with `assets/app-icon-maskable.svg` fitted to the maskable safe circle): it shares the logos' design — three planets (blue, violet, coral) with thick, gently curved trails and no blur, chosen for legibility at launcher sizes; the favicon is a simplified mark for 16–32px tabs: the same motif (sun, planet trails wrapping the travel axis, tail) reduced to two planets with thick strokes, no blur or mask, on a rounded dark brand background. Its 32px PNG fallback is rendered from the same favicon. Launcher and Apple icon URLs change with the full-logo exports while the manifest app ID stays `/`. Installed icon updates follow browser/OS schedules, independently of the app-shell update; existing iOS home-screen icons may require re-adding.

Production builds use `vite-plugin-pwa` to cache the static app shell, including lazy UI assets. **GitHub API responses, private history and PATs are never stored in Service Worker Cache Storage.** GitHub still needs a network connection. The existing browser localStorage token policy is unchanged. Service Workers require HTTPS (localhost works for development verification); Vite's dev server does not register the production worker.

A ready app version shows **Update app** and **Later** at the bottom right, with 12px edge spacing or the larger safe-area inset. When present, the debug entry or load-error notice stacks 8px above it without raising the update prompt; the debug position without an update stays unchanged. Applying reloads the consenting window after the new worker activates, preserving its URL. Another tab's approval does not force the current tab to reload. Failed downloads leave the installed shell available. Static cache cleanup happens on activation. Preview and Production have separate origins, workers, caches and installations; use the stable Production domain for normal installation.

Before changing **Update app** to **Updating…**, the click handler captures the button's rendered width and height and keeps those dimensions while activation is pending. Each retry measures again; outside activation the button uses its natural size. The button cannot shrink in its flex row, and update controls use explicit CSS appearance. This avoids relying on overlapping hidden labels or a native button's Grid sizing. Only the current label is rendered, so its accessible name follows the visible text. Error messages still use the existing wrapping behavior.

The update notice uses an elevated slate surface in dark mode and a white surface in light mode, with stronger borders and shadows to separate it from the graph. Its `--notice-surface`, `--notice-border` and `--notice-shadow` values are defined alongside the existing theme tokens. Border contrast is checked against both the notice surface and the graph background. **Update app** reuses the app's yellow primary-button palette; **Later** is a muted outline button. These styles are scoped to the update notice.

See [the PWA specification and verification checklist](pwa.md) for cache boundaries, update behavior, CSP changes and physical-device checks that still need a release environment.
