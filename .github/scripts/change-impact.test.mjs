import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeImpact, ciComparison } from './change-impact.mjs';

const script = fileURLToPath(new URL('./change-impact.mjs', import.meta.url));
function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'commit-trail-impact-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '--initial-branch=fixture');
  git('config', 'user.name', 'Impact test');
  git('config', 'user.email', 'test@example.invalid');
  const write = (path, text = 'documentation\n') => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  write('README.md', 'initial\n');
  const base = commit();
  return { cwd, git, write, commit, base };
}

test('root prose and new documentation assets can skip validation', (t) => {
  const repo = repository(t);
  for (const path of [
    'README.md',
    'AGENTS.md',
    'LICENSE.md',
    'docs/specification.md',
    'docs/images/desktop.png',
    'docs/new-guide.md',
    'docs/nested/reference.json',
    'docs/images/new.png',
    'docs/examples/code.js',
  ]) {
    repo.write(path);
  }
  assert.equal(changeImpact({ ...repo, head: repo.commit() }).docsOnly, true);
});

test('source, public documents, templates, settings and unknown paths run all checks', (t) => {
  const repo = repository(t);
  for (const path of [
    'src/help.md',
    'public/help.md',
    'public/robots.txt',
    'index.html',
    'package-lock.json',
    'vite.config.ts',
    'tsconfig.json',
    'vercel.json',
    '.nvmrc',
    '.github/workflows/ci.yml',
    '.github/rulesets/dev.json',
    '.github/scripts/release.mjs',
    'templates/build-template.md',
    'docs-config.json',
    'docs-build/template.md',
    'NEW.md',
  ]) {
    repo.git('reset', '--hard', repo.base);
    repo.write(path);
    assert.equal(changeImpact({ ...repo, head: repo.commit() }).docsOnly, false, path);
  }
});

test('documentation mixed with build inputs still runs all checks', (t) => {
  const repo = repository(t);
  repo.write('docs/new-guide.md');
  repo.write('templates/page.md');
  assert.equal(changeImpact({ ...repo, head: repo.commit() }).docsOnly, false);
});

test('the complete push range retains a source change before the final docs commit', (t) => {
  const repo = repository(t);
  repo.write('src/main.tsx', 'export {};');
  repo.commit();
  repo.write('README.md', 'later docs');
  assert.equal(changeImpact({ ...repo, head: repo.commit() }).docsOnly, false);
});

test('multiple docs commits and deleted documentation remain docs-only', (t) => {
  const repo = repository(t);
  repo.write('docs/specification.md');
  repo.commit();
  repo.git('rm', 'README.md');
  assert.equal(changeImpact({ ...repo, head: repo.commit() }).docsOnly, true);
});

test('a PR compares its complete tested merge against the current base', (t) => {
  const repo = repository(t);
  repo.git('checkout', '-b', 'feature');
  repo.write('README.md', 'PR docs');
  repo.commit();
  repo.git('checkout', 'fixture');
  repo.write('src/main.tsx', 'base branch update');
  const currentBase = repo.commit();
  repo.git('checkout', 'feature');
  repo.git('merge', '--no-edit', 'fixture');
  const head = repo.git('rev-parse', 'HEAD');
  const comparison = ciComparison(
    'pull_request',
    {
      pull_request: { base: { sha: currentBase } },
    },
    head,
  );
  assert.equal(changeImpact({ cwd: repo.cwd, ...comparison }).docsOnly, true);
  repo.write('src/main.tsx', 'PR code update');
  repo.commit();
  repo.write('README.md', 'final PR docs');
  assert.equal(
    changeImpact({ cwd: repo.cwd, base: currentBase, head: repo.commit() }).docsOnly,
    false,
  );
});

test('renames consider both original and destination paths', (t) => {
  const repo = repository(t);
  repo.write('src/template.md');
  const base = repo.commit();
  mkdirSync(join(repo.cwd, 'docs'));
  repo.git('mv', 'src/template.md', 'docs/specification.md');
  const moved = repo.commit();
  assert.equal(changeImpact({ ...repo, base, head: moved }).docsOnly, false);
  repo.git('mv', 'docs/specification.md', 'src/template.md');
  assert.equal(changeImpact({ ...repo, base: moved, head: repo.commit() }).docsOnly, false);
});

test('symlinks under an audited documentation name cannot skip checks', (t) => {
  const repo = repository(t);
  repo.git('rm', 'README.md');
  symlinkSync('src/main.tsx', join(repo.cwd, 'README.md'));
  assert.equal(changeImpact({ ...repo, head: repo.commit() }).docsOnly, false);
});

test('missing history, zero SHA, empty range and invalid metadata run all checks', (t) => {
  const repo = repository(t);
  for (const base of [undefined, '', '0'.repeat(40), 'f'.repeat(40), 'HEAD^', repo.base]) {
    assert.equal(changeImpact({ ...repo, base, head: repo.base }).docsOnly, false);
  }
});

test('unrelated histories cannot be treated as a docs-only range', (t) => {
  const repo = repository(t);
  repo.git('checkout', '--orphan', 'other');
  repo.write('README.md', 'unrelated docs');
  assert.equal(changeImpact({ ...repo, head: repo.commit() }).docsOnly, false);
});

test('PRs compare the base with the tested merge tree and pushes compare before/after', () => {
  assert.deepEqual(
    ciComparison('pull_request', { pull_request: { base: { sha: 'base' } } }, 'merge'),
    {
      base: 'base',
      head: 'merge',
    },
  );
  assert.deepEqual(ciComparison('push', { before: 'before', after: 'head' }, 'head'), {
    base: 'before',
    head: 'head',
  });
  assert.deepEqual(ciComparison('push', { before: 'before', after: 'different' }, 'head'), {});
  assert.deepEqual(ciComparison('workflow_dispatch', {}, 'head'), {});
});

test('Vercel exits 0 only for verified documentation; first/repeated/missing deployments build', (t) => {
  const repo = repository(t);
  repo.write('README.md', 'docs update');
  const head = repo.commit();
  const run = (base) =>
    spawnSync(process.execPath, [script, '--vercel'], {
      cwd: repo.cwd,
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base },
      encoding: 'utf8',
    });
  assert.equal(run(repo.base).status, 0);
  for (const base of ['', head, 'f'.repeat(40)]) assert.equal(run(base).status, 1);
  repo.write('src/main.tsx');
  repo.commit();
  assert.equal(run(repo.base).status, 1);
});

test('CI always emits a result and fails open to full validation on metadata errors', (t) => {
  const repo = repository(t);
  repo.write('README.md', 'docs update');
  const after = repo.commit();
  const eventPath = join(repo.cwd, 'event.json');
  const output = join(repo.cwd, 'output');
  writeFileSync(eventPath, JSON.stringify({ before: repo.base, after }));
  const run = () =>
    spawnSync(process.execPath, [script, '--ci'], {
      cwd: repo.cwd,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: output,
      },
    });
  assert.equal(run().status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'docs_only=true\n');
  writeFileSync(eventPath, 'invalid JSON');
  assert.equal(run().status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'docs_only=true\ndocs_only=false\n');
});
