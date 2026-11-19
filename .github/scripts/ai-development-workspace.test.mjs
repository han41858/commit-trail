import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { develop } from './ai-development/run.mjs';
import { createWorkspace, resolveEdits } from './ai-development/workspace.mjs';

function fixture(spawn, lock = '{"lockfileVersion":3,"packages":{}}') {
  const cwd = mkdtempSync(join(tmpdir(), 'ai-workspace-test-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  writeFileSync(join(cwd, 'AGENTS.md'), 'Fixture instructions.');
  writeFileSync(join(cwd, 'package.json'), '{"name":"fixture"}');
  writeFileSync(join(cwd, 'package-lock.json'), lock);
  git('init', '--quiet');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'Fixture',
  );
  const head = git('rev-parse', 'HEAD');
  const state = { base: head, head };
  const workspace = createWorkspace({
    cwd,
    config: {
      instructions: 'AGENTS.md',
      base: 'dev',
      checks: ['node --version'],
    },
    repository: 'owner/repo',
    token: 'unused',
    spawn,
  });
  return {
    workspace,
    state,
    close() {
      workspace.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

test('the real package-lock can be read, paged and edited above the former 128 KiB limit', () => {
  const lock = readFileSync(
    new URL('../../package-lock.json', import.meta.url),
    'utf8',
  );
  assert(Buffer.byteLength(lock) > 128 * 1024);
  const context = fixture(() => ({ status: 0 }), lock);
  try {
    const snapshot = context.workspace.snapshot(context.state);
    assert.equal(snapshot.read('package-lock.json'), lock);
    assert.match(
      snapshot.inspect('read_file', { path: 'package-lock.json', line: 1 }),
      /lockfileVersion/,
    );
    const result = resolveEdits(
      [
        {
          path: 'package-lock.json',
          before: '"lockfileVersion": 3,',
          after: '"lockfileVersion": 3, "fixture": true,',
        },
      ],
      snapshot,
    );
    assert.equal(JSON.parse(result[0].text).fixture, true);
    assert.throws(
      () =>
        resolveEdits(
          [
            {
              path: 'large.txt',
              before: null,
              after: 'x'.repeat(1024 * 1024 + 1),
            },
          ],
          snapshot,
        ),
      /크기 제한/,
    );
  } finally {
    context.close();
  }
});

test('isolated validation reports the last started check separately from its output', () => {
  const context = fixture((_command, args) => {
    if (args[0] !== 'run') return { status: 0 };
    const name = args[args.indexOf('--name') + 1];
    assert.match(args.at(-1), new RegExp(`${name}:check:0`));
    return {
      status: 1,
      stdout: `${name}:check:0\nprivate candidate output\n`,
      stderr: '',
    };
  });
  try {
    const validation = context.workspace.runChecks(context.state, []);
    assert.equal(validation.ok, false);
    assert.equal(validation.step, 'node --version');
    assert.match(validation.log, /private candidate output/);
  } finally {
    context.close();
  }
});

test('development retries a missing or ambiguous edit against the original snapshot', async () => {
  for (const before of ['not present', 'repeat']) {
    const text = 'repeat left\nrepeat right\n';
    const path = 'example.md';
    const calls = [];
    let validations = 0;
    const models = {
      async run({ context }) {
        calls.push(JSON.parse(context).previousFailure);
        return {
          status: 'completed',
          edits: [
            { path, before: 'left', after: 'updated left' },
            {
              path,
              before: calls.length === 1 ? before : 'repeat right',
              after: 'updated right',
            },
          ],
        };
      },
    };
    const result = await develop(
      models,
      {
        snapshot: () => ({
          files: new Map([[path, '100644']]),
          read: () => text,
        }),
        runChecks(_state, changes) {
          validations++;
          assert.deepEqual(changes, [
            { path, text: 'repeat updated left\nupdated right\n' },
          ]);
          return {
            ok: true,
            changes: [{ path, text: 'validated output\n' }],
          };
        },
      },
      { issue: { number: 233 }, state: {}, guard: async () => {} },
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[1].path, path);
    assert.equal(calls[1].editNumber, 2);
    assert.match(
      calls[1].reason,
      before === 'repeat' ? /여러 곳/ : /찾을 수 없/,
    );
    assert.equal(validations, 1);
    assert.deepEqual(result.changes, [{ path, text: 'validated output\n' }]);
  }
});

test('dependencies use the edited manifests and invalidate the cache when either changes', () => {
  const builds = [];
  let runs = 0;
  const context = fixture((_command, args) => {
    if (args[0] === 'build') {
      const directory = args.at(-1);
      builds.push({
        manifest: JSON.parse(
          readFileSync(join(directory, 'package.json'), 'utf8'),
        ),
        lock: JSON.parse(
          readFileSync(join(directory, 'package-lock.json'), 'utf8'),
        ),
      });
      assert.match(
        readFileSync(join(directory, 'Dockerfile'), 'utf8'),
        /npm ci --ignore-scripts/,
      );
    }
    if (args[0] === 'run') {
      runs++;
      assert.equal(args[args.indexOf('--network') + 1], 'none');
      const name = args[args.indexOf('--name') + 1];
      return { status: 0, stdout: `${name}:formatted:[]\n`, stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  const changes = (version, revision = 1) => [
    {
      path: 'package.json',
      text: JSON.stringify({ dependencies: { example: version } }),
    },
    {
      path: 'package-lock.json',
      text: JSON.stringify({ revision, packages: { example: version } }),
    },
  ];
  try {
    assert.equal(
      context.workspace.runChecks(context.state, changes('1.0.0')).ok,
      true,
    );
    assert.equal(
      context.workspace.runChecks(context.state, changes('1.0.0')).ok,
      true,
    );
    assert.equal(builds.length, 1);
    assert.equal(
      context.workspace.runChecks(context.state, changes('2.0.0')).ok,
      true,
    );
    assert.equal(
      context.workspace.runChecks(context.state, changes('2.0.0', 2)).ok,
      true,
    );
    assert.deepEqual(
      builds.map(({ manifest }) => manifest.dependencies.example),
      ['1.0.0', '2.0.0', '2.0.0'],
    );
    assert.deepEqual(
      builds.map(({ lock }) => lock.revision),
      [1, 1, 2],
    );
    assert.equal(runs, 4);
  } finally {
    context.close();
  }
});

test('validation returns formatted bytes only for existing candidate paths', () => {
  let formatted = [{ path: 'example.js', text: 'const x = 1;\n' }];
  const context = fixture((_command, args) => {
    if (args[0] !== 'run') return { status: 0 };
    const name = args[args.indexOf('--name') + 1];
    const script = args.at(-1);
    assert.match(script, /const paths = \["example\.js"\]/);
    assert(script.indexOf("'--write'") < script.lastIndexOf('node --version'));
    return {
      status: 0,
      stdout: `${name}:formatted:${JSON.stringify(formatted)}\n`,
    };
  });
  try {
    const changes = [
      { path: 'example.js', text: 'const x=1;' },
      { path: 'AGENTS.md', text: null },
    ];
    assert.deepEqual(context.workspace.runChecks(context.state, changes), {
      ok: true,
      changes: [{ path: 'example.js', text: 'const x = 1;\n' }, changes[1]],
    });
    formatted = [{ path: 'AGENTS.md', text: 'unexpected' }];
    assert.equal(context.workspace.runChecks(context.state, changes).ok, false);
  } finally {
    context.close();
  }
});

test('dependency installation errors return validation feedback and never run stale dependencies', () => {
  let runs = 0;
  const context = fixture((_command, args) => {
    if (args[0] === 'run') runs++;
    return args[0] === 'build'
      ? { status: 1, stdout: '', stderr: 'npm ci: lock out of sync' }
      : { status: 0 };
  });
  try {
    const result = context.workspace.runChecks(context.state, []);
    assert.equal(result.ok, false);
    assert.match(result.log, /lock out of sync/);
    assert.equal(runs, 0);
    const missing = context.workspace.runChecks(context.state, [
      { path: 'package-lock.json', text: null },
    ]);
    assert.equal(missing.ok, false);
    assert.match(missing.log, /일반 파일/);
  } finally {
    context.close();
  }
});
