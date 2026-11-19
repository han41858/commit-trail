# Commit Trail technical guide

Detailed usage, architecture, API behavior, development and deployment notes. See the [README](../README.md) for a product overview and screenshots.

Explore the flow of Git history. A responsive, read-only GitHub commit DAG viewer, built with React, TypeScript, Vite and Canvas 2D. No backend or database.

## Development

Use Node.js **24.x** and npm, matching [`.nvmrc`](../.nvmrc) and the package engine requirement.

```sh
npm ci
npm run dev
npm test
npm run build
npm run format:check
```

Formatting uses an exactly pinned Prettier version and the shared `han41858/ai-native` configuration in `prettier.config.mjs`. Run `npm run format` to format supported files across the repository, or `npm run format:check` to check them without writing. Generated outputs, local caches and the npm-managed `package-lock.json` are excluded. No formatting plugins or Git hooks are required. CI checks formatting even for documentation-only changes.

Deploy `dist/` to any static host. Repository selection uses `?repo=owner%2Frepo` and survives refresh without server rewrites.

The bottom of Options shows the running app's build time right-aligned with a `Built at` prefix, using the browser's local date format and time zone with a consistent 24-hour `HH:mm` time. Vite embeds one UTC timestamp at build time; every device displays that same instant with its local date and zero-padded 24-hour time, without AM/PM, seconds or a time zone label. It stays fixed offline or across reloads of the same build, and the menu expands within the available viewport to keep it on one line. Unusually long values use an ellipsis, with the full localized timestamp available in the time element’s tooltip. A cached PWA keeps its previous build time until an app update is applied. Rebuilding the same commit changes the timestamp and bundle hash, so it can trigger a PWA update. The development server shows `Development`.

## Product rename and saved browser data

The product name is **Commit Trail**, the GitHub repository is `han41858/commit-trail`, and the Production domain is `https://commit-trail-view.vercel.app/`. The Vercel project name is `commit-trail`. GitHub repository names and Vercel project/domain settings are managed in their dashboards; changing source-code names alone does not rename those external resources. Verify that the renamed Vercel project is connected to the renamed GitHub repository, keeps `main` as its Production Branch, and serves the new public domain. Existing project IDs, team ownership and Git deployment settings should be retained.

Commit Trail starts fresh with `commit-trail.*` localStorage keys for the token, recent repositories, branch choices, Split view selection and view options (`commit-trail.view-options`: theme, auto refresh and interval). Previous product keys are neither read nor migrated. Users enter their token and configure their repositories again. A new Vercel domain also has separate localStorage, Service Workers and PWA installations; no token or setting is transferred through links, redirects or analytics. The PWA manifest's `id`, `start_url` and `scope` remain `/`; its visible names change to Commit Trail.

## Anonymous web analytics

Commit Trail uses Vercel Web Analytics via the official `@vercel/analytics/react` component in Production. It collects page views only; the app does not emit custom interaction events or integrate Google Analytics. Analytics is best-effort and must not block GitHub history.

The SDK's `beforeSend` filter removes URL search parameters, fragments and URL credentials from events. This includes repository and branch names in `repo` / `branch` parameters, which can be sensitive for private repositories. Only the initial page view per document is retained. Client-side changes to repository, branch, Split view order, or browser history do not create additional counted page views. No PAT, GitHub API response, commit details or selected repository names are explicitly sent as custom events.

The existing `Referrer-Policy: no-referrer` and restrictive CSP are kept; the Vercel deployment must serve the analytics script and collection route from the same origin. The app does not add cookies or user identifiers. This instrumentation is not an assertion that Vercel receives no request-level metadata; review Vercel's own documentation and applicable privacy requirements before rollout.

**Enable separately:** Open the Vercel project **commit-trail → Analytics → Enable**, then deploy to Production. Confirm that the browser Network panel shows the Vercel Analytics script and page-view request, and that no `repo` or `branch` query values are sent. Compare counts when switching repositories and changing Split view order within the same document. Browser extensions and network filters may block analytics. Do not enable new custom events without a separate privacy review.

## Link previews and search metadata

`index.html` includes the product title, description, canonical URL, Open Graph metadata and an X summary card in the initial HTML. Link-preview crawlers do not need to run JavaScript or call GitHub. Both cards reuse the existing public 512×512 PNG logo at `https://commit-trail-view.vercel.app/icons/app-logo-512.png`; the square image matches the summary-card format.

Single-repository and Split view links keep their query configuration for the app, while previews always describe Commit Trail. Canonical and Open Graph URLs point to the public Production root. Repository names, PATs and other query values are not inserted into metadata. `public/robots.txt` permits crawling and points to `public/sitemap.xml`, which lists only the product root.

After deployment, inspect the raw HTML at `/`, `/?repo=owner/repo` and a repeated-`repo` Split view URL without running JavaScript. Check the image URL, `/robots.txt` and `/sitemap.xml` for successful public responses and the expected content types. Vercel Preview protection and automatic noindex behavior are unchanged; use the public Production URL when validating a chat preview. Existing pasted links may retain a service's cached card until that service fetches the URL again. These metadata changes provide the card data; individual services still decide whether and how to display it.

## 사용 방법

1. `owner/repo` 또는 `https://github.com/owner/repo`를 입력하고 제출해 저장소를 연다. Owner 이름만 제출하면 [저장소 목록](#owner-저장소-선택)을 연다. 입력을 지워도 현재 그래프는 유지한다.
2. **Branch**에서 기준 브랜치를 선택한다. **↓ Older** 또는 **↓ Newer**로 아래쪽에 이어질 이력 방향을 바꾸고, 커밋을 선택해 상세를 확인한다.
3. 비공개 저장소는 **Token**에서 해당 저장소에 한정한 fine-grained PAT를 적용한다. 권한 확인, API 한도, 저장·삭제 정책은 [제품 명세의 공개·비공개 저장소](specification.md#22-공개비공개-저장소)를 따른다. 공유 URL에 PAT는 포함하지 않지만 비공개 저장소와 브랜치 이름은 노출한다.

브랜치 선택과 점진적 로딩은 [제품 명세](specification.md)에서 설명한다. 기능별 세부 규칙은 [Split view](monitor-mode.md), [최근 저장소](recent-repositories.md), [날짜 구분선](date-separators.md), [개발자 진단](developer-debug-mode.md) 명세를 따른다.

## Owner 저장소 선택

GitHub 사용자나 조직 이름을 제출하면 공개 목록과 적용한 PAT로 조회할 수 있는 목록을 합쳐 이름순으로 표시한다. 일반 화면에서는 한 항목을 바로 열고, Split view에서는 체크한 항목을 **Add N repositories**로 일괄 추가한다.

명시적 조회, **Load more**, 소스별 오류와 재시도, 취소 및 메모리 캐시의 수명은 [Owner 저장소 선택 명세](owner-repositories.md)를 따른다.

## DAG 경로 강조와 선택

배지·커밋·연결선에 포인터를 올리면 현재 조회한 경로와 경계를 임시로 강조한다. 배지나 선을 클릭·탭하면 경로만 고정하고, 커밋 노드·메시지·버전 아이콘을 선택하면 상세도 연다.

경로 소유권, 색상 배정, 강조 범위와 입력 수명은 [DAG 경로 명세](dag-hover-highlight.md)를 따른다. 그래프 배치와 브랜치 선택은 [제품 명세](specification.md)를 따른다.

## Architecture and limits

`src/main.tsx` is the application entry and composes the feature modules. Source files, their styles and their `*.test.ts` files are grouped by responsibility:

| Directory         | Responsibility                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`        | App notices, status, view settings, analytics and global styles; `pwa/` owns app updates                                            |
| `src/graph/`      | Graph rendering, layout presentation, path highlighting, input and commit details                                                   |
| `src/repository/` | Repository/branch selection, owner lookup, navigation, history loading and metadata stores                                          |
| `src/monitor/`    | Split view selection, ordering, sessions, panes and detail positioning                                                              |
| `src/token/`      | Token storage, permission checks and token controls                                                                                 |
| `src/shared/`     | Common Git data/model operations and emoji conversion; `github/`, `refresh/`, `debug/` and `ui/` group shared services and controls |

Keep tests beside the implementation they exercise. `npm test` discovers `src/**/*.test.ts` recursively, including nested shared modules. Modules use explicit relative imports, and the existing feature/session lifetimes are preserved across single and Split view.

`main.tsx` owns app state, authentication, navigation and refresh lifetimes. `ViewOptions.tsx`, `AccessTokenPanel.tsx`, `AppStatus.tsx` and `MonitorControls.tsx` render their controls from explicit props. `PopupBackdrop.tsx` shares the background and pointer-gesture handling for token, settings and Split view popups. The settings button stays in the header while its panel renders beside the header so the backdrop covers the whole app. These controls do not create separate sessions or subscriptions.

`model.ts` owns data and topological lane layout; `api.ts` owns paginated REST requests. `history.ts` coordinates cancellation, encountered-parent traversal, directional pagination and bounded loading batches. `HistoryCommitPages.ts` owns that traversal’s request pool, in-flight deduplication, immutable page cache and head validation; History still supplies the cancellation signals and resets the reader at the same traversal boundaries. `historyTraversal.ts` contains pure frontier, loaded-history range and ancestry calculations.

`Graph.tsx` owns layout, input, scrolling and animation scheduling. `graphCanvas.ts` draws each DPR-aware frame and returns the painted badge and message bounds used for hit testing; it does not own selection or request lifetimes. Branch refs and lanes are separate. Commit identity is deduplicated by SHA. Parent relationships, rather than dates, determine order. Parent lanes are reused where possible, with earlier assignments preferred as pages arrive. `graphColors.ts` computes deterministic path colors separately from rendered lane placement, and its shared path IDs also bound highlighting and badge tracks. Pagination can change a path boundary or collision neighborhood; the same final snapshot and selected base/HEAD SHA still produce identical assignments in a fresh browser. `branchLabels.ts` anchors labels to visible curve segments rather than only branch heads.

The canvas bounds its drawing to the viewport, but layout and edge traversal still process loaded history. No claim of unlimited history: 10,000 synthetic commits are covered by automated tests; live large-repository and 100,000-commit performance still need measurement. New history pages are requested from unresolved boundaries at or before the current viewport bottom, within horizontally visible lanes. This includes boundaries above the viewport: after a large jump, one page may still leave a path disconnected from the visible history. Layout and queue-cleanup scans keep following successor pages until the boundary moves below the viewport, reaches a root or rejoins loaded ancestry. Both display directions use the same rule without tracking prior scroll positions. This intentionally replaces the earlier rule that excluded newly inserted offscreen rows: new boundaries above the viewport are eligible, while boundaries below it remain deferred. Previously visited ranges are not accumulated. Required paths are not truncated by an arbitrary batch budget; existing concurrency, deduplication, cancellation, error and rate-limit handling still apply. Latest-follow animations do not fetch from transient viewport positions. Each History instance limits its commit request pool to sixteen concurrent HTTP requests across parent paths and activity-discovered branches. Monitor repositories use independent pools, and metadata requests use their own readers; sixteen is not an application-wide HTTP concurrency cap. A slow branch never blocks another available slot; loading continues to accept new visible boundaries, and queued work survives scrolling out of view. Identical in-flight commit queries share one request. Accepted boundary work is registered before subscribers run, and cleanup publishes the remaining queue so unresolved cursors are reconsidered without another scroll event. Empty or mismatched boundary responses keep the gap unresolved and expose Retry rather than falsely marking the path complete. Repository, direction, or token changes cancel queued and in-flight work. Fully loaded shared ancestry is not fetched again just because an API source still has additional pages. Branch-name discovery never starts commit requests. Activity discovery scans at most one metadata page and three independent histories per batch, skips already loaded heads, and pauses with a Retry branches control if it fails. Oldest-first uses API pagination metadata to avoid downloading the complete history before rendering; if last-page metadata is unavailable, it reports an error instead of scanning every page. Errors pause new automatic loading while already accepted independent requests can finish; Retry repeats failed sources without refetching successful paths. Infinite scroll is incremental loading, not an unlimited memory or performance guarantee. No offline Git history cache; private history remains visible in memory until cleared or refreshed. GitHub access depends on the browser network policy and API quota.

Missing-parent boundaries depend on commits currently loaded, not on whether their SHA was fetched earlier. If branch deletion prunes an ancestor and a later merge needs it again, traversal restores it from a valid immutable page in memory when available, without another HTTP request. An unfiltered first page pinned to a 40-character SHA must contain that commit before it enters the page cache. Empty or mismatched responses are not cached, so Retry can recover. If this validation fails for a refreshed HEAD, the previous graph, refs and HEAD remain in place for the next refresh to retry. Since-filtered activity discovery and later pages in oldest-first traversal may legitimately omit the pinned HEAD and are exempt from that check.

After a complete branch refresh, loaded paths belonging only to deleted refs are retired even if an unrelated catalog head or parent is still unknown. Current reachable ancestry and prior heads of surviving refs protect shared commits and history behind unresolved gaps; actual merge parents remain connected, while obsolete squash-merged branch paths disappear. Immutable page caches remain available if later traversal needs a retired parent. A deleted selected base still keeps its cached history and existing notice.

Activity discovery, recommendation and exact-name lookups compare late ref responses with the completed refresh version. Older results cannot restore removed names or changed heads. A complete catalog also ends old picker pagination. Parent responses whose boundary has disappeared are not integrated again; errors specific to that obsolete request are ignored, while authentication and rate-limit failures still surface. In-flight HTTP work may finish, but it cannot recreate the retired graph path.

## Deploy to Vercel

The repository includes `vercel.json`. Use Node.js **24.x**, framework **Vite**, install command `npm ci --no-audit --no-fund`, build command `npm run build`, and output directory `dist`. No backend, functions, environment variables, or build-time GitHub token are required. Never add a PAT as a `VITE_*` variable: those values would be public in the browser bundle.

### Git integration

The existing Vercel project `commit-trail` is linked to `han41858/commit-trail`. Keep the repository root as Root Directory, the Framework Preset as **Vite**, automatic Git deployments enabled, and the Production Branch as **main**. The GitHub default branch remains **dev**.

`vercel.json` explicitly enables Git deployments with `git.deploymentEnabled: true`. Keep Vercel's Preview Deployments enabled (`previewDeploymentsDisabled: false`). The separate `gitProviderOptions.createDeployments` option controls GitHub deployment records and is not the Vercel build switch.

- Feature branches (`feature/*` and existing `feat/*`) and `dev` receive Preview deployments through Vercel Git Integration, unless the documentation-only rule below cancels the build.
- Merging a PR into `main` starts the Production build and deployment unless only audited non-build documentation changed. Every feature, fix, documentation and configuration change first reaches `dev` through a PR. Only a PR from this repository's `dev` branch may target `main`; the required CI job rejects other source branches and forks. Feature, recovery and release branches must not promote directly to `main`.
- `.github/workflows/ci.yml` starts **Test and build** when PRs targeting `dev` or `main` open, reopen, receive commits or are edited, and on pushes to those branches. Each validation runs the promotion guard. For code, build inputs, automation or uncertain changes it retains `npm ci`, all application and automation tests, and `npm run build`, using `.nvmrc` and the npm download cache. Every validation sets up Node, installs dependencies and runs `npm run format:check`. For verified documentation-only changes it skips application and automation tests and the build. No new Secrets are needed.
- The required GitHub Actions check is **Test and build**. The Ruleset definitions in `.github/rulesets/` retain the existing protections and add this check. `dev` also requires PR branches to be up to date, so concurrent feature PRs are tested against the latest `dev`. `main` does not require an up-to-date head, but every main-targeted PR still validates its proposed merge. Its intentional file difference from `dev` is `.github/workflows/production-release.yml`. Ordinary `dev` → `main` merge commits preserve this main-only addition; do not copy it back into `dev` or merge a main-based feature branch into dev. These JSON files are definitions; changing them in Git does not update GitHub's active Rulesets automatically.
- GitHub Actions performs validation; Vercel Git Integration performs deployment. Preview builds can run alongside CI. Main's PR checks gate merging; gating production-domain assignment on post-merge checks would require separate Vercel Deployment Checks.

### CI event handling

Pull-request `edited` events remain enabled to validate target-branch changes. Retargeting must rerun the dev-to-main promotion guard and the target branch's release-entrypoint checks. Title/body edits also run validation. Every run uses the literal job name **Test and build**, allocates a runner and executes the promotion guard. Required-check names must not be conditional, and the required job itself must not be skipped. Verified documentation-only changes skip heavy steps inside that job.

Do not assume a newer metadata-only skipped run preserves the required-check association of an older successful run. GitHub can record a skipped job's dynamic name as unevaluated expression text, leaving **Test and build** expected and blocking merge even after an older validation is rerun. The workflow uses one concurrency group per PR or branch; a newer run replaces superseded validation with a new complete check. The existing Ruleset remains unchanged.

PR and post-merge push validation both remain enabled. `dev` protection does not require a PR, and `main` allows a PR whose head is not up to date with its base. A PR's tested merge therefore does not automatically prove that a later push has the same tree. Automation checks also depend on the destination branch. Reusing results would require verified equivalent inputs and a successful validation for the same branch context. This workflow retains full validation for those events.

### AI development and cross-review

`AI development` runs on GitHub-hosted Ubuntu runners after a repository user with write access adds one of the following labels to an open Issue. Create the labels in the repository before first use.

| Label               | Developer        | Reviewer         |
| ------------------- | ---------------- | ---------------- |
| `ai:develop`        | OpenAI Codex     | Anthropic Claude |
| `ai:develop:codex`  | OpenAI Codex     | Anthropic Claude |
| `ai:develop:claude` | Anthropic Claude | OpenAI Codex     |

Create an Issue with a focused change and explicit acceptance criteria, then apply one label. A collision blocks startup. The first run records the role and a snapshot of the Issue and current `dev`. The developer proposes edits and the workflow validates them before publishing a commit to `ai/issue-<number>-<developer>` and opening one Draft PR against `dev`. The reviewer can read Git snapshots and the diff. The workflow publishes structured findings as PR comments. It sends requested changes back to the original developer and stops after three reviews, a repeated defect, or a request for human judgment.

`AI development cleanup` listens only for completed `AI development` runs on `dev` and reconciles interrupted attempts; successful or skipped runs do not allocate a cleanup runner. `AI development CI follow-up` listens only for completed `CI` runs whose head branch matches `ai/issue-*`. It then requires a successful pull-request run from the same repository and an exact `ai/issue-<number>-(codex|claude)` branch before continuing the recorded review and merge. Ordinary PR branches and `dev`/`main` push CI therefore create no AI follow-up workflow run. Related AI runs can still leave skipped records because `workflow_run` cannot filter by conclusion at the trigger level.

All AI development jobs, including the separate cleanup and CI follow-up jobs, share one concurrency queue, so Issues are processed one at a time in the order their runs were queued. A later Issue starts from the `dev` that already contains the earlier merge. An Issue that left the queue to wait for CI, or a run interrupted by a manual merge, can still find `dev` changed; it stops with `needs_human`. Running `AI development` again with that Issue number merges the latest `dev` into the working branch with GitHub's update-branch API, then reviews the new HEAD and waits for its CI before merging. The refresh counts toward the three-review limit, and a merge conflict is left for human follow-up. The CI follow-up job never refreshes by itself because it has no model access to review the new HEAD.

Provider responses are streamed over server-sent events and reassembled into the same object a non-streaming call returns, so long outputs are not bound by one fixed response timeout. Each request can make up to 30 tool turns, return up to 32,000 output tokens and propose up to 80 edits; it ends when no bytes arrive for five minutes or after 30 minutes in total. Codex uses medium reasoning effort. A stream that reports an error, ends early or goes silent has an unknown outcome and is not retried automatically. Adjust `limits` in `.github/scripts/ai-development/config.mjs` to change this budget. Keep Issues small enough for one focused PR.

For a first run, name a small code or documentation change and say how to verify it. A request for role-by-role comments alone gives the reviewer no Draft PR to inspect. If the developer asks for human judgment, the Issue state includes the reason supplied by the developer. Start a new Issue with a concrete edit if the original Issue only requested comments.

#### Credentials and required CI

Create an Actions Environment named `ai-development` before using the updated automation. Under **Settings → Environments → ai-development → Deployment branches and tags**, choose selected branches and allow only the `dev` **branch**, without tags or wildcards. The development job and CI merge follow-up bind this Environment. Put these Secrets in that Environment and delete their Repository Secrets copies:

- `OPENAI_API_KEY` from the [OpenAI API keys page](https://platform.openai.com/api-keys). The default model is `gpt-6.2-sol` through the Responses API, matching the everyday coding model in the [official Codex model catalog](https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json). Override it with the Actions variable `AI_CODEX_MODEL` if needed. Use a model with structured output and function-tool support.
- `ANTHROPIC_API_KEY` from the [Claude Console](https://console.anthropic.com/settings/keys). The default model is `claude-sonnet-5-5` through the Messages API, using the current Sonnet generation listed in the [official Anthropic SDK](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/model.py). Override it with `AI_CLAUDE_MODEL` if needed. Use a Claude model with structured output and tool support.

The Actions variables take precedence over these defaults. If a variable still names an older model, update or remove that variable to use the new default. SDK and catalog entries identify model IDs; the repository's API account must also have access to the selected model. An inaccessible model stops the Issue with the reported provider error rather than silently falling back.

To use Opus for the Claude role, set the repository Actions variable `AI_CLAUDE_MODEL` to `claude-opus-5-5`. Create it under **Settings → Secrets and variables → Actions → Variables**. The same variable selects Claude for development or cross-review according to the Issue label; it does not change the role assignment.

The built-in `GITHUB_TOKEN` records state, review comments and PR readiness. Publishing uses `AI_AUTOMATION_TOKEN` from the protected Environment, so regular PR and post-merge CI can start. Repository policy can still require **Approve workflows to run**; a reviewed HEAD continues after its required CI succeeds.

Configure `AI_AUTOMATION_TOKEN` as a repository-scoped fine-grained personal access token for `han41858/commit-trail` with **Contents**, **Pull requests** and **Workflows** read/write, plus **Actions**, **Secrets** and **Environments** read. Workflows write permits commits under `.github/workflows/`; the read permissions inspect isolation metadata, not Secret values. A classic PAT also needs `workflow` scope. Prefer a short expiration and repository-scoped access. [Personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

Before model execution and every publishing mutation, the controller verifies that Repository Secrets are empty, all three credentials exist in the dev-only Environment, and any other Environment containing Secrets is restricted to explicit `dev`/`main` branches. Empty Preview/Production Environments can remain unrestricted. This check targets the current personal repository; inherited organization Secrets require separate review. Missing permissions, unsafe rules or incomplete metadata stop the Issue as `needs_human` before publication. Workflow commit permission errors explicitly name the required Workflows permission. These checks preserve editing and automatic merging of workflow files while keeping unreviewed branches from using stored Secrets.

The pipeline checks the existing **Test and build** job on the current PR head. A missing run, approval wait or failed check keeps the Issue in `needs_human` until CI succeeds for the reviewed SHA. Once both checks succeed, the workflow marks the PR ready for review and requests a squash merge into `dev` with the reviewed SHA. GitHub enforces the existing branch rules. The Issue records `merged` and the merge commit, and GitHub closes the linked Issue. Conflicts, a changed PR or HEAD, or a rejected merge are reported for human follow-up. `dev` → `main` promotion remains a manual merge-commit PR.

#### Isolation and recovery

Provider calls receive the Issue, trusted `AGENTS.md` instructions, and bounded access to Git text snapshots. Models have no shell, GitHub credentials, or provider credentials in their tool context. Development may edit regular text files throughout the repository, including workflows, automation scripts, dependency configuration and `AGENTS.md`, within the Issue's scope. There is no directory allowlist. Git internals, `node_modules`, path traversal and `.env` secret files remain blocked; `.env.example` may be edited. Symlinks and non-text or oversized files remain excluded. The per-file UTF-8 read/edit limit is 1 MiB, including the paged package lock. A Docker build installs the edited tree's `package.json` and `package-lock.json` with `npm ci --ignore-scripts`, without application credentials. The dependency image cache is keyed by both files' contents. Manifest/lock mismatches and installation failures return validation feedback for the next correction attempt. The edited tree runs the usual format, tests and build in a separate offline container with no credentials. Actions logs report provider token data when available.

The Issue has a state comment with the last recorded commit, PR and Actions run. Editing that comment sends no notification, so whenever a run stops as `needs_human` or `failed` the workflow also posts a separate comment with the reason. Add an `ai:stop` label or cancel the Actions run to stop work. A follow-up workflow records an interrupted run if it left an active state. To resume, reopen the Issue and remove `ai:stop` if applicable, then explicitly run `AI development` on `dev` with that Issue number. Recovery preserves the original role and reuses the existing branch and PR. It checks for concurrent edits and closed PRs before proceeding, and brings a changed `dev` into the branch as described above. A review with an unknown outcome is escalated rather than silently repeated. Refer to the state comment and PR findings for the required next action.

For `needs_human`, read both the stop notice and the state comment's detailed reason. Fix the reported condition, then choose **Actions → AI development → Run workflow**, select **dev**, and enter the existing Issue number. Reapplying an execution label does not resume a recorded run. A controller change must reach `dev` before resuming an Issue blocked by the previous implementation. If the notice calls for direct PR review because a model review's outcome is unknown, follow that instruction rather than requesting the same review again.

### Documentation-only change detection

`.github/scripts/change-impact.mjs` is the shared policy for CI and Vercel. `docs/` is reserved for non-build documentation and its assets; any regular file under that exact directory, including new guides, examples and images, is eligible for skipping. Only the root documents `README.md`, `AGENTS.md` and `LICENSE.md` are listed separately. Extensions do not determine build impact, and similarly named directories such as `docs-build/` are not included.

The build starts at `index.html` and `src/main.tsx`; TypeScript includes `src`, Vite copies `public`, and `vite.config.ts` generates the PWA manifest/service worker. Neither `docs/` nor the three root documents are build inputs. Build-consumed documents and templates must live outside `docs/`, for example in `src/`, `public/` or `templates/`. Do not import or read documentation-only paths from application/build code. Other paths, including packages/lockfiles, TypeScript/Vite/Vercel settings, workflows, rulesets and automation scripts, keep full validation. A change mixing documentation and any such path also runs all checks.

CI fetches history and compares the PR base SHA to the checked-out merge result, or the full push `before`/`after` range. Rename sources and destinations are both considered. Missing history, new/force-pushed branches, invalid event data, empty comparisons, non-regular documentation files and detector errors fall back to full validation. Do not add workflow-level `paths-ignore` or skip the required job: its **Test and build** name must keep reporting a result for the existing dev/main Rulesets. The branch-promotion guard remains mandatory even for documentation.

`vercel.json` sets `ignoreCommand` to the same script with `--vercel`. Per Vercel's [Ignored Build Step contract](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand), exit 0 cancels before dependency installation/build/deployment, while exit 1 continues normally. The comparison starts at `VERCEL_GIT_PREVIOUS_SHA`, not `HEAD^`, so earlier application changes in a multi-commit range cannot be hidden by a final documentation commit. First deployments, missing/shallow history, unrelated ancestry and same-SHA redeployments build normally. Skipping does not replace the currently served deployment or publish a new production release. Actual Git Integration behavior is verified after this configuration is merged; this does not add a CLI deployment path.

### Branch promotion

Create the promotion PR only after the final development merge, using `dev` itself as its head. Merge with a merge commit, then verify that the final dev SHA is an ancestor of main. Do not squash or rebase a promotion. `.github/scripts/check-promotion.mjs` checks the PR event's base, head branch and head repository before dependencies are installed; its regression tests run with the existing release-automation tests. See the project-specific rules in [AGENTS.md](../AGENTS.md).

The shared-ancestor repair in #103/#104 is historical context. Its separate release-branch promotion path must not be reused; the corrected history now preserves the existing main-only entrypoint through normal dev → main promotions.

Use the Git deployment as the normal release path. A manual CLI deployment is an explicit exception: it can create another deployment for the same SHA, and uncommitted files can differ from that SHA. Do not add a Vercel CLI deployment step or Vercel credentials to the CI workflow.

Verify public Production access at the project's assigned production domain using an anonymous browser session or an HTTP request without Vercel authentication. Check for HTTP 200, no login redirect, working JS/CSS, and a public repository graph. A protected generated deployment URL or an authenticated fetch does not establish anonymous access.

### Production releases

Only `main` contains `.github/workflows/production-release.yml`, the **Production release** entrypoint for `deployment_status`. It calls the same-commit `.github/workflows/release.yml`, which is reusable and also exposes **Production release recovery** for manual execution. On `dev` and feature branches based on it, `release.yml` has no deployment-status trigger, so new Preview deployment events do not create skipped Production release runs. Existing run history is retained.

After a successful Vercel Production deployment, the shared workflow creates a `rel-YYYYMMDDHHmmss` tag and GitHub Release on the **deployed commit**. The timestamp uses the verified success time in **Asia/Seoul**. Release notes contain the changes, commit, production URL, and deployment links. Preview and failed deployments do not publish releases.

Only the newest automated Production release is retained. After successful publication or reuse, the workflow re-lists releases and combines that response with the earlier catalog and the release returned by publication or reuse. This keeps the newly published release eligible for retention even when GitHub temporarily returns an older or empty list. When the same release ID appears in both snapshots, the later response takes precedence so edits to a manual release, draft or prerelease remain protected. Managed releases found only in the earlier catalog are checked by release ID before any deletion: a 404 or a change to manual/draft/prerelease removes them from retention and deletion candidates, while other lookup errors or identity changes stop cleanup without deleting releases. This prevents a concurrently deleted newest release from causing the last real release to be deleted. The release returned by this run’s publication or reuse remains trusted when absent from the list, since an immediate individual lookup can lag behind a successful write too. It deletes older published Production releases, including releases from the former Git Stream name. It identifies them by their `rel-` timestamp tags and automation marker in the body. Git tags, commits and deployment records remain intact; drafts, prereleases and manual releases are excluded. New-publication failures leave existing releases untouched. Cleanup failures surface as errors, and retrying the same deployment resumes cleanup without creating another tag or release. Delayed events for older deployments do not recreate pruned releases. Manual dry runs never delete releases.

Vercel's GitHub deployment records must be enabled (`gitProviderOptions.createDeployments: enabled`) so GitHub receives `deployment_status` events. This records deployments; Vercel Git Integration still performs the builds. Repository-dispatch events can stay disabled. No additional Secrets or deployment CLI are needed; only the publishing job receives `contents: write`.

The workflow verifies the persisted GitHub deployment and status from the Vercel bot, the team/project dashboard URL, and that the deployed SHA belongs to `main`.

Dashboard paths and generated deployment hosts share the `TEAM` setting, currently `han41858`, and require the exact `commit-trail` project. Only the current team URL is accepted; the public Production domain is also accepted. A team URL rename must update this shared setting.

Automation code is checked out from the protected default branch, not from the event's deployed commit. Publication and cleanup runs are serialized across the repository with `queue: max` (up to 100 pending jobs) and `cancel-in-progress: false`, so delayed events and manual dry runs do not replace an already waiting publication. Queue order follows when jobs start waiting, so the tag-time guard still prevents older deployments from replacing the newer release. Repeated events and redeployments reuse the retained commit's release; failed publication reuses its tag on retry. Existing tags are never moved. A timestamp collision with another commit uses the next free second, and older deployment events keep their Git tags without recreating pruned releases or replacing the newer release.

To verify or recover a missed event, run **Production release recovery** from the default branch (`dev`) with its **GitHub deployment ID**. Keeping the manual workflow on the default branch preserves GitHub's Run workflow button. Dry run is enabled by default and writes no tag or release; disable it only to publish the verified successful Production deployment. Preview IDs are safe to test and are skipped. Existing historical deployments are not backfilled automatically.

The main-only entrypoint is already installed and remains on main. Changes to the shared `release.yml` and release logic first merge into dev and then promote from dev to main; do not create a separate direct-to-main configuration PR. The protected default branch (`dev`) supplies the trusted automation code, and publication uses the exact automation commit verified by the inspection job. The CI job also runs `node --test --test-isolation=none .github/scripts/*.test.mjs`; a branch-placement regression check rejects the automatic entrypoint on dev and requires it on main.

### Before publishing

```sh
npm ci --no-audit --no-fund
npm test
npm run build
npm run preview -- --port 4173
```

On the deployment, open a public repository such as `han41858/commit-trail` and `angular/angular`; verify real commit data, branch selection, loading older history, direction reversal, commit links, and refreshing a `?repo=owner%2Frepo` URL. Test tapping and fixed-width vertical scrolling in narrow layouts, and wide-layout content-sized graph columns capped at 50% and messages capped at 50%. A fine-grained PAT can be entered in the app for a private-repository check; remove it afterwards and confirm the history clears. Check invalid repository and API-limit messages.

The current cloud environment's `api.github.com` egress policy is separate from Vercel. API requests originate in the visitor's browser. Unit tests and mocked browser checks do not establish that live GitHub access works; live API and private-repository validation remain release checks.

Hashed Vite assets use immutable caching; the HTML keeps Vercel's default caching. Security headers disable framing and sensitive device permissions, prevent MIME sniffing, and omit the referrer. A Content Security Policy allows scripts and PWA shell requests from this site and GitHub API requests to `api.github.com`, so a stored token cannot be sent elsewhere by injected code. Query-based navigation does not require a catch-all rewrite.

Vercel GitHub bot comments are disabled through the project’s commit/PR comment settings and `github.silent` in `vercel.json`.

Month and day separators span the graph's visible width with left-aligned labels above the lines. Valid committer timestamps take priority over valid author timestamps, and calendar groups use the browser's local time zone independently of Locale. Month labels use `Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' })` for the anchor's actual full date, following local conventions such as `2026년 11월 3일`; day labels use `{ day: 'numeric' }`. The selected branch's loaded first-parent history supplies the oldest base month and date as independent lower bounds for monthly and daily markers. Every loaded month or date newer than its bound gets a marker even if it occurs only on a side branch or ahead of the selected base tip. For example, December work on dev gets a full December label before main advances beyond November. When the base path is not loaded, the available timeline supplies that context. Partial oldest months and days independently wait for older context unless a known root confirms their beginning. An unrelated old branch cannot confirm a partial base period.

Each confirmed month and day attaches to the earliest timestamp among **all loaded commits**, including merged side branches; timestamp ties use SHA. Loading an earlier candidate moves its anchor. A month marker suppresses only a day marker at the same SHA. Date reversals never create multiple markers for one calendar date or reorder the DAG. Month lines/text retain stronger emphasis, while day labels use a smaller font and lower opacity. Labels sit 4px inside the visible left edge with 3px background padding, both reduced in very narrow columns. Their Canvas bottom reference is 1px below the separator row so the visible glyphs sit close to the line; the 15px background ends 2px below that row. Text and backgrounds stay before the commit message column when messages are visible, or use the full visible width when messages are hidden. Text is measured, and narrow areas fit the complete Locale label using Canvas `maxWidth`. If horizontal scrolling leaves no space before messages, the label is omitted while its line remains. Labels retain the existing background and fit on adjacent 31px rows. `dateMarkers.ts` computes both periods with shared logic, `Graph.tsx` memoizes the result, and formatters are reused outside animation frames. The existing monthly API and regression tests remain available. Single/Split view and both directions share the policy without new settings, dependencies or API requests; commit geometry, pagination and scroll behavior are unchanged. See [date separators](date-separators.md).

## 자동 갱신과 메타데이터

**Options**에서 자동 갱신을 켜거나 끄고 주기를 선택한다. 커밋 상세에서 태그·GitHub Release·Actions를 확인한다. 그래프의 🚀는 연결된 Release가 있다는 뜻이며 최신 버전이나 배포 성공을 뜻하지 않는다. Release가 없고 태그가 있으면 🏷️를 표시한다.

초기 로딩과 완료 시각, 비인증 갱신 예외, 기존 브랜치 HEAD 이동 뒤 7초 재확인, 메타데이터 조회와 캐시는 [자동 갱신 및 메타데이터 명세](auto-refresh-and-metadata.md)를 따른다.

## Developer diagnostics

In development, press **Ctrl + Shift + D** to open the debug panel. On any build, use `/?repo=owner%2Frepository&debug=1` to enable the small debug entry button. Closing the panel keeps measurements running; **Disable debug** stops and clears them.

In the installed PWA, enter `:debug` in the existing repository field and press Enter or Explore. This also works on the web. It opens diagnostics and restores the current repository field without reloading the page, changing the URL, or issuing API requests. It keeps existing measurements if already enabled; otherwise it starts a new in-memory debug session. No debug button is shown by default, and the command needs to be entered again after a fresh launch or reload unless `?debug=1` is present.

The panel separates HTTP/cache/quota observations, initial/manual/automatic refreshes, DAG layout and Canvas drawing. Each category retains its latest 20 samples in memory. **Copy diagnostics** exports numeric, sanitized JSON; details and refresh summaries also appear in DevTools Console. No extra API calls, external telemetry or persisted diagnostics are added. See [the developer debug specification](developer-debug-mode.md) for measurement boundaries and limitations.

## 설치형 웹 앱(PWA)

지원 브라우저의 설치 메뉴나 iOS 홈 화면 추가로 설치한다. 앱은 `standalone`으로 실행하며 설치 배너를 표시하지 않는다. 오프라인에는 정적 앱 셸만 제공하며, GitHub API 응답·비공개 이력·PAT는 Service Worker Cache Storage에 저장하지 않는다.

**Update app**을 누르면 동의한 창만 현재 URL에서 다시 연다. 설치 조건, 캐시·보안 경계, 업데이트 복구와 미확인 실기기 항목은 [PWA 명세](pwa.md)를 따른다.
