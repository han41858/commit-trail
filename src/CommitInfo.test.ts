import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionSummary,
  runElapsed,
  actionsElapsed,
  runStatus,
  completedJobCount,
  type ActionRun,
  type ActionJob,
  type JobInfo,
} from './CommitInfo';
const run = (
  id: number,
  status = 'completed',
  conclusion: string | null = 'success',
  extra: Partial<ActionRun> = {},
): ActionRun => ({
  id,
  workflow_id: id,
  head_sha: 'sha',
  name: 'Build',
  status,
  conclusion,
  run_attempt: 1,
  updated_at: '2026-10-30T00:00:00Z',
  html_url: 'https://github.com/a/b/actions/runs/' + id,
  ...extra,
});
const detail = (
  id: number,
  statuses: string[],
  extra: Partial<JobInfo> = {},
): JobInfo => ({
  attempt: 1,
  jobs: statuses.map((status, index) => ({
    id: id * 100 + index,
    run_id: id,
    status,
    conclusion: status === 'completed' ? 'success' : null,
  })),
  total: statuses.length,
  complete: true,
  next: 0,
  ...extra,
});
for (const [conclusions, expected] of [
  [['success'], 'success'],
  [['success', 'success'], 'success'],
  [['success', 'skipped'], 'success'],
  [['success', 'skipped', 'skipped'], 'success'],
  [['success', 'success', 'skipped', 'skipped'], 'success'],
  [['failure'], 'failure'],
  [['timed_out'], 'failure'],
  [['startup_failure'], 'failure'],
  [['success', 'failure'], 'failure'],
  [['success', 'skipped', 'failure'], 'failure'],
  [['success', 'timed_out'], 'failure'],
  [['success', 'startup_failure'], 'failure'],
  [['cancelled'], 'cancelled'],
  [['cancelled', 'cancelled'], 'cancelled'],
  [['success', 'cancelled'], 'skipped'],
  [['skipped'], 'skipped'],
  [['skipped', 'skipped'], 'skipped'],
  [['neutral'], 'skipped'],
  [['action_required'], 'skipped'],
  [['stale'], 'skipped'],
  [['future_result'], 'skipped'],
  [['success', 'neutral'], 'skipped'],
  [['success', 'action_required'], 'skipped'],
  [['success', 'stale'], 'skipped'],
  [['success', 'future_result'], 'skipped'],
  [['success', null], 'skipped'],
] as const)
  test(`Actions final result ${conclusions.map((c) => c ?? 'missing').join('/')} is ${expected}`, () => {
    assert.equal(
      actionSummary(
        conclusions.map((c, i) => run(i, 'completed', c)),
        new Map(),
      )?.state,
      expected,
    );
  });
test('success with skipped workflows preserves individual results and completed job totals', () => {
  const runs = [run(1), run(2, 'completed', 'skipped')],
    before = JSON.stringify(runs);
  for (const statuses of [[], ['completed', 'completed']]) {
    const skipped = detail(2, statuses);
    skipped.jobs.forEach((job) => (job.conclusion = 'skipped'));
    const jobs = new Map([
        [1, detail(1, ['completed', 'completed', 'completed'])],
        [2, skipped],
      ]),
      snapshot = JSON.stringify([...jobs]);
    assert.deepEqual(actionSummary(runs, jobs), {
      state: 'success',
      done: 3 + statuses.length,
      total: 3 + statuses.length,
      ratio: 1,
    });
    assert.deepEqual(completedJobCount(runs[1], jobs), {
      completed: statuses.length,
      total: statuses.length,
    });
    assert.deepEqual(runStatus(runs[1]), { icon: 'skipped', label: 'Skipped' });
    assert.equal(JSON.stringify(runs), before);
    assert.equal(JSON.stringify([...jobs]), snapshot);
  }
  assert.deepEqual(actionSummary(runs, new Map()), {
    state: 'success',
    done: null,
    total: null,
    ratio: null,
  });
});
test('success and skipped never override unfinished workflows or the existing active-work priority', () => {
  const completed = [run(1), run(2, 'completed', 'skipped')];
  for (const status of [
    'in_progress',
    'queued',
    'waiting',
    'pending',
    'requested',
  ]) {
    const active = run(3, status, 'success'),
      state = status === 'in_progress' ? 'running' : 'queued';
    for (const extra of [[], [run(4, 'completed', 'failure')]])
      assert.equal(
        actionSummary([...completed, active, ...extra], new Map())?.state,
        state,
      );
  }
  for (const status of ['future_status', null])
    assert.equal(
      actionSummary(
        [...completed, run(3, 'completed', 'skipped', { status })],
        new Map(),
      )?.state,
      'skipped',
    );
  assert.equal(
    actionSummary(
      [...completed, run(3, 'queued', null), run(4, 'in_progress', null)],
      new Map(),
    )?.state,
    'running',
  );
});
test('success with skipped uses only the latest workflow attempt and keeps rerun progress unconfirmed', () => {
  const old = run(1, 'completed', 'failure'),
    latest = run(1, 'completed', 'success', { run_attempt: 2 }),
    skipped = run(2, 'completed', 'skipped');
  const jobs = new Map([
    [1, detail(1, ['completed', 'completed'], { attempt: 2 })],
    [2, detail(2, [])],
  ]);
  assert.deepEqual(actionSummary([old, latest, skipped], jobs), {
    state: 'success',
    done: 2,
    total: 2,
    ratio: 1,
  });
  assert.deepEqual(actionSummary([latest, skipped, old], jobs), {
    state: 'success',
    done: 2,
    total: 2,
    ratio: 1,
  });
  assert.deepEqual(
    actionSummary(
      [old, latest, skipped, run(1, 'in_progress', null, { run_attempt: 3 })],
      jobs,
    ),
    { state: 'running', done: null, total: null, ratio: null },
  );
});
test('known failures remain red beside skipped or unknown results while active work retains precedence', () => {
  for (const failure of ['failure', 'timed_out', 'startup_failure']) {
    for (const other of [
      run(2, 'completed', 'skipped'),
      run(2, 'completed', 'neutral'),
      run(2, 'future_status', null),
    ])
      assert.equal(
        actionSummary([run(1, 'completed', failure), other], new Map())?.state,
        'failure',
      );
    assert.equal(
      actionSummary(
        [run(1, 'completed', failure), run(2, 'in_progress', null)],
        new Map(),
      )?.state,
      'running',
    );
    assert.equal(
      actionSummary(
        [run(1, 'completed', failure), run(2, 'queued', null)],
        new Map(),
      )?.state,
      'queued',
    );
  }
});
test('multiple workflows aggregate actual completed jobs and deduplicate jobs and runs', () => {
  const runs = [
    run(1),
    run(2, 'in_progress', null),
    run(3, 'queued', null),
    run(2, 'in_progress', null),
  ];
  const jobs = new Map([
    [1, detail(1, ['completed', 'completed', 'completed'])],
    [2, detail(2, ['completed', 'completed', 'in_progress', 'queued'])],
    [3, detail(3, ['queued', 'queued', 'queued'])],
  ]);
  jobs.get(2)!.jobs.push(jobs.get(2)!.jobs[0]);
  assert.deepEqual(actionSummary(runs, jobs), {
    state: 'running',
    done: 5,
    total: 10,
    ratio: 0.5,
  });
});
test('100 percent completed jobs never implies success while GitHub still reports running', () => {
  const active = run(1, 'in_progress', null),
    jobs = new Map([[1, detail(1, Array(46).fill('completed'))]]);
  assert.deepEqual(actionSummary([active], jobs), {
    state: 'running',
    done: 46,
    total: 46,
    ratio: 1,
  });
  assert.deepEqual(completedJobCount(active, jobs), {
    completed: 46,
    total: 46,
  });
});
test('incomplete job pages and changed matrix totals suppress percentages', () => {
  const runs = [run(1, 'in_progress', null)];
  assert.equal(
    actionSummary(runs, new Map([[1, detail(1, ['completed'], { total: 2 })]]))
      ?.ratio,
    null,
  );
  assert.equal(
    actionSummary(
      runs,
      new Map([[1, detail(1, ['completed'], { complete: false })]]),
    )?.ratio,
    null,
  );
});
test('the latest attempt replaces old jobs and can lower progress', () => {
  const runs = [run(1), run(1, 'in_progress', null, { run_attempt: 2 })];
  assert.equal(
    actionSummary(runs, new Map([[1, detail(1, ['completed'])]]))?.ratio,
    null,
  );
  assert.deepEqual(
    actionSummary(
      runs,
      new Map([[1, detail(1, ['queued', 'completed'], { attempt: 2 })]]),
    ),
    { state: 'running', done: 1, total: 2, ratio: 0.5 },
  );
});
test('every completed job counts regardless of conclusion and unknown status uses the gray fallback', () => {
  const jobs = detail(1, ['completed', 'completed', 'completed', 'completed']);
  jobs.jobs.forEach(
    (job, i) =>
      (job.conclusion = ['failure', 'cancelled', 'skipped', 'success'][i]),
  );
  assert.equal(
    actionSummary([run(1, 'in_progress', null)], new Map([[1, jobs]]))?.ratio,
    1,
  );
  assert.equal(
    actionSummary([run(1, 'future_status', 'success')], new Map())?.state,
    'skipped',
  );
  assert.equal(actionSummary([], new Map()), null);
});
test('workflow badges keep final results distinct and never infer success before completion', () => {
  for (const conclusion of [
    'success',
    'failure',
    'timed_out',
    'cancelled',
    'skipped',
    'neutral',
    'action_required',
    'startup_failure',
    'stale',
  ])
    assert.equal(runStatus(run(1, 'completed', conclusion)).icon, conclusion);
  assert.deepEqual(runStatus(run(1, 'completed', 'future_result')), {
    icon: 'unknown',
    label: 'Unknown result',
  });
  assert.equal(runStatus(run(1, 'in_progress', 'success')).icon, 'running');
  assert.equal(runStatus(run(1, 'queued', null)).icon, 'queued');
  assert.deepEqual(runStatus(run(1, 'future_status', 'success')), {
    icon: 'unknown',
    label: 'Unknown state',
  });
});
test('completed elapsed duration freezes at the final API status update', () => {
  const completed = run(1, 'completed', 'success', {
    run_started_at: '2026-10-30T00:00:00Z',
    updated_at: '2026-10-30T00:02:05Z',
  });
  assert.equal(
    runElapsed(completed, Date.parse('2026-10-30T01:00:00Z')),
    '2m 5s',
  );
  assert.equal(
    runElapsed(completed, Date.parse('2026-11-01T00:00:00Z')),
    '2m 5s',
  );
});
test('active elapsed duration advances across seconds, minutes and hours using the current attempt start', () => {
  const active = run(1, 'in_progress', null, {
    run_started_at: '2026-10-30T00:00:00Z',
  });
  assert.equal(
    runElapsed(active, Date.parse('2026-10-30T00:00:59.999Z')),
    '59s',
  );
  assert.equal(runElapsed(active, Date.parse('2026-10-30T00:01:00Z')), '1m 0s');
  assert.equal(
    runElapsed(active, Date.parse('2026-10-30T01:02:03Z')),
    '1h 2m 3s',
  );
  assert.equal(
    runElapsed(
      { ...active, run_attempt: 2, run_started_at: '2026-10-30T01:00:00Z' },
      Date.parse('2026-10-30T01:02:03Z'),
    ),
    '2m 3s',
  );
});
test('missing, invalid and out-of-order timestamps remain unknown instead of showing a fabricated duration', () => {
  const completed = run(1);
  assert.equal(runElapsed(completed), null);
  assert.equal(runElapsed({ ...completed, run_started_at: 'invalid' }), null);
  assert.equal(
    runElapsed({ ...completed, run_started_at: '2026-10-31T00:00:00Z' }),
    null,
  );
  assert.equal(
    runElapsed({
      ...completed,
      run_started_at: '2026-10-30T00:00:00Z',
      updated_at: 'invalid',
    }),
    null,
  );
  assert.equal(
    runElapsed({
      ...completed,
      status: 'future_status',
      run_started_at: '2026-10-30T00:00:00Z',
    }),
    null,
  );
});
test('workflow job counts use completed jobs consistently with the commit aggregate and deduplicate IDs', () => {
  const active = run(1, 'in_progress', null),
    info = detail(1, ['completed', 'completed', 'in_progress', 'queued']);
  info.jobs.push(
    info.jobs[2],
    { id: 999, run_id: 2, status: 'in_progress', conclusion: null },
    {
      id: 998,
      run_id: 1,
      run_attempt: 2,
      status: 'in_progress',
      conclusion: null,
    },
  );
  assert.deepEqual(completedJobCount(active, new Map([[1, info]])), {
    completed: 2,
    total: 4,
  });
  assert.deepEqual(
    completedJobCount(
      run(1, 'queued', null),
      new Map([[1, detail(1, ['queued', 'waiting'])]]),
    ),
    { completed: 0, total: 2 },
  );
});
test('partial job pages, unknown statuses and mismatching totals do not fabricate completed counts', () => {
  const active = run(1, 'in_progress', null);
  assert.equal(completedJobCount(active, new Map()), null);
  assert.equal(
    completedJobCount(
      active,
      new Map([[1, detail(1, ['in_progress'], { complete: false })]]),
    ),
    null,
  );
  assert.equal(
    completedJobCount(
      active,
      new Map([[1, detail(1, ['in_progress'], { total: 2 })]]),
    ),
    null,
  );
  assert.equal(
    completedJobCount(active, new Map([[1, detail(1, ['future_status'])]])),
    null,
  );
});
test('rerunning a workflow clears previous attempt job counts until its own jobs are known', () => {
  const active = run(1, 'in_progress', null, { run_attempt: 2 });
  assert.equal(
    completedJobCount(active, new Map([[1, detail(1, ['in_progress'])]])),
    null,
  );
  assert.deepEqual(
    completedJobCount(
      active,
      new Map([
        [1, detail(1, ['in_progress', 'queued', 'completed'], { attempt: 2 })],
      ]),
    ),
    { completed: 1, total: 3 },
  );
});
test('a completed workflow with zero jobs does not block known progress from another workflow', () => {
  assert.deepEqual(
    actionSummary(
      [run(1, 'completed', 'skipped'), run(2, 'in_progress', null)],
      new Map([
        [1, detail(1, [])],
        [2, detail(2, ['completed', 'in_progress'])],
      ]),
    ),
    { state: 'running', done: 1, total: 2, ratio: 0.5 },
  );
  assert.deepEqual(
    actionSummary([run(1, 'in_progress', null)], new Map([[1, detail(1, [])]])),
    {
      state: 'running',
      done: 0,
      total: 0,
      ratio: null,
    },
  );
});
test('total Actions elapsed time spans overlapping workflows and freezes at the last final status', () => {
  const runs = [
    run(1, 'completed', 'success', {
      run_started_at: '2026-10-30T00:00:00Z',
      updated_at: '2026-10-30T00:02:00Z',
    }),
    run(2, 'completed', 'failure', {
      run_started_at: '2026-10-30T00:01:00Z',
      updated_at: '2026-10-30T00:03:05Z',
    }),
  ];
  assert.equal(
    actionsElapsed(runs, Date.parse('2026-10-30T01:00:00Z')),
    '3m 5s',
  );
  assert.equal(
    actionsElapsed(runs, Date.parse('2026-10-31T00:00:00Z')),
    '3m 5s',
  );
  const active = [
    runs[0],
    { ...runs[1], status: 'in_progress', conclusion: null },
  ];
  assert.equal(
    actionsElapsed(active, Date.parse('2026-10-30T00:03:30Z')),
    '3m 30s',
  );
  assert.equal(
    actionsElapsed(active, Date.parse('2026-10-30T00:04:00Z')),
    '4m 0s',
  );
});
test('total Actions time uses latest attempts and never fabricates missing or invalid times', () => {
  const previous = run(1, 'completed', 'success', {
    run_started_at: '2026-10-30T00:00:00Z',
    updated_at: '2026-10-30T00:01:00Z',
  });
  const retry = run(1, 'in_progress', null, {
      run_attempt: 2,
      run_started_at: '2026-10-30T00:02:00Z',
      updated_at: '2026-10-30T00:02:00Z',
    }),
    now = Date.parse('2026-10-30T00:03:00Z');
  assert.equal(actionsElapsed([previous, retry], now), '1m 0s');
  assert.equal(actionsElapsed([], now), null);
  for (const invalid of [
    { ...retry, run_started_at: null },
    { ...previous, updated_at: 'invalid' },
    { ...retry, status: 'future_status' },
    { ...previous, updated_at: '2026-10-29T00:00:00Z' },
    { ...retry, run_started_at: '2026-10-31T00:00:00Z' },
  ])
    assert.equal(actionsElapsed([{ ...previous, id: 2 }, invalid], now), null);
});
