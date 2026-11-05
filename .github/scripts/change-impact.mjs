import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Audited prose and documentation-only images, never Vite/TypeScript/public inputs.
// New files are intentionally not inferred from their directory or extension.
const documentation = new Set([
  'AGENTS.md',
  'README.md',
  'LICENSE.md',
  'docs/README.md',
  'docs/auto-refresh-and-metadata.md',
  'docs/dag-hover-highlight.md',
  'docs/developer-debug-mode.md',
  'docs/monitor-mode.md',
  'docs/pwa.md',
  'docs/recent-repositories.md',
  'docs/specification.md',
  'docs/technical-guide.md',
  'docs/images/README.md',
  'docs/images/auto-refresh.gif',
  'docs/images/desktop.png',
  'docs/images/mobile.png',
  'docs/images/split-desktop.png',
  'docs/images/split-mobile-landscape.png',
  'docs/images/split-mobile-portrait.png',
]);
const commitSHA = /^[0-9a-f]{40}$/i;

export function changeImpact({ base, head, cwd = process.cwd() }) {
  const full = (reason) => ({ docsOnly: false, reason });
  if (!commitSHA.test(base || '') || !commitSHA.test(head || '') || base === head) {
    return full('No distinct, verified comparison commits; run all checks.');
  }
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    for (const sha of [base, head]) git('cat-file', '-e', `${sha}^{commit}`);
    git('merge-base', '--is-ancestor', base, head);
    const paths = git('diff', '--name-only', '--no-renames', '-z', base, head, '--')
      .split('\0')
      .filter(Boolean);
    if (!paths.length) return full('No changed paths; preserve rebuild/revalidation behavior.');
    if (paths.some((path) => !documentation.has(path))) {
      return full('Source, build inputs, automation or unclassified files changed.');
    }
    // A document path becoming a symlink/submodule is not a prose-only change.
    for (const sha of [base, head]) {
      const entries = git('ls-tree', '-r', '-z', sha, '--', ...paths)
        .split('\0')
        .filter(Boolean);
      if (entries.some((entry) => !entry.startsWith('100644 ') && !entry.startsWith('100755 '))) {
        return full('A documentation path has a non-regular Git mode.');
      }
    }
    return { docsOnly: true, reason: 'Only audited, non-build documentation changed.' };
  } catch {
    return full('Comparison history is unavailable or uncertain; run all checks.');
  }
}

export function ciComparison(eventName, event, checkedHead) {
  if (eventName === 'pull_request' && event.pull_request) {
    // Compare the base against the checked-out merge result, not just the last commit.
    return { base: event.pull_request.base?.sha, head: checkedHead };
  }
  if (eventName === 'push' && event.after === checkedHead) {
    return { base: event.before, head: checkedHead };
  }
  return {};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const vercel = process.argv[2] === '--vercel';
  let result = { docsOnly: false, reason: 'Unknown invocation; run all checks.' };
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (vercel) {
      result = changeImpact({ base: process.env.VERCEL_GIT_PREVIOUS_SHA, head });
    } else if (process.argv[2] === '--ci') {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      result = changeImpact(ciComparison(process.env.GITHUB_EVENT_NAME, event, head));
    }
  } catch {
    result = { docsOnly: false, reason: 'Change detection failed; run all checks.' };
  }
  console.log(result.reason);
  if (vercel) {
    // Vercel Ignored Build Step: 0 cancels, 1 continues before install/build.
    process.exitCode = result.docsOnly ? 0 : 1;
  } else if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${result.docsOnly}\n`);
  }
}
