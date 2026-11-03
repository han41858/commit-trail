import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { monthMarkers } from './monthMarkers';
import { layout, type Commit } from './model';
const localDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`).toISOString() : value;
const c = (sha: string, date?: string, parent?: string, authorDate?: string): Commit => ({
  sha,
  parents: parent ? [{ sha: parent }] : [],
  commit: {
    message: sha,
    author: authorDate ? { name: 'Test', date: localDay(authorDate) } : null,
    committer: date ? { date: localDay(date) } : null,
  },
  html_url: '',
});

test('month and year markers use the same month-start commits in both directions', () => {
  const commits = [
    c('jan31', '2026-01-31', 'jan1'),
    c('jan1', '2026-01-01', 'dec31'),
    c('dec31', '2025-12-31', 'dec2'),
    c('dec2', '2025-12-02', 'nov30'),
    c('nov30', '2025-11-30'),
  ];
  const spine = new Set(commits.map((commit) => commit.sha));
  const newest = monthMarkers(commits, spine),
    oldest = monthMarkers([...commits].reverse(), spine);
  assert.deepEqual(newest, [
    { sha: 'jan1', label: '2026.01' },
    { sha: 'dec2', label: '2025.12' },
    { sha: 'nov30', label: '2025.11' },
  ]);
  assert.deepEqual(oldest, [...newest].reverse());
  assert.deepEqual(
    commits.map((commit) => commit.sha),
    ['jan31', 'jan1', 'dec31', 'dec2', 'nov30'],
  );
});

test('a partial month never labels its latest or partially loaded oldest commit as the month start', () => {
  const first = [c('late', '2026-10-31', 'middle'), c('middle', '2026-10-20', 'early')];
  const all = [
    ...first,
    c('early', '2026-10-01', 'september'),
    c('september', '2026-09-30', 'missing'),
  ];
  const spine = new Set(all.map((commit) => commit.sha));
  assert.deepEqual(monthMarkers(first, spine), []);
  assert.deepEqual(monthMarkers(all.slice(0, 3), spine), []);
  assert.deepEqual(monthMarkers(all, spine), [{ sha: 'early', label: '2026.10' }]);
});

test('the earliest available commit in the month is used when there was no commit on the first', () => {
  const commits = [
    c('end', '2026-03-31', 'start'),
    c('start', '2026-03-04', 'prev'),
    c('prev', '2026-02-28', 'missing'),
  ];
  assert.deepEqual(monthMarkers(commits, new Set(commits.map((commit) => commit.sha))), [
    { sha: 'start', label: '2026.03' },
  ]);
});

test('a merged side branch supplies the first commit of the month in both Older and Newer views', () => {
  const previous = c('previous', '2026-10-31T23:55:00'),
    first = c('side-first', '2026-11-01T00:13:57', 'previous'),
    later = c('side-later', '2026-11-01T01:30:00', 'side-first');
  const merge = c('merge', '2026-11-01T02:07:51', 'previous');
  merge.parents.push({ sha: 'side-later' });
  const commits = [c('head', '2026-11-01T09:00:00', 'merge'), merge, later, first, previous],
    before = JSON.stringify(commits),
    dag = layout(commits, new Map(), 'head');
  assert.equal(dag.spine.has(first.sha), false);
  const expected = [
    { sha: 'side-first', label: '2026.11' },
    { sha: 'previous', label: '2026.10' },
  ];
  assert.deepEqual(monthMarkers(dag.ordered, dag.spine), expected);
  assert.deepEqual(monthMarkers([...dag.ordered].reverse(), dag.spine), [...expected].reverse());
  assert.equal(JSON.stringify(commits), before);
});

test('loading an earlier side-branch commit moves a confirmed month boundary in both directions', () => {
  const first = [
      c('head', '2026-11-03', 'previous'),
      c('side-later', '2026-11-02', 'side-first'),
      c('previous', '2026-10-31'),
    ],
    spine = new Set(['head', 'previous']);
  const next = [...first.slice(0, 2), c('side-first', '2026-11-01', 'previous'), first[2]];
  for (const reverse of [false, true]) {
    const order = (commits: Commit[]) => (reverse ? [...commits].reverse() : commits);
    assert.equal(
      monthMarkers(order(first), spine).find((marker) => marker.label === '2026.11')?.sha,
      'side-later',
    );
    assert.equal(
      monthMarkers(order(next), spine).find((marker) => marker.label === '2026.11')?.sha,
      'side-first',
    );
  }
});

test('equal earliest timestamps select the same commit when the display direction reverses', () => {
  const commits = [
      c('head', '2026-11-02', 'previous'),
      c('side-z', '2026-11-01', 'previous'),
      c('side-a', '2026-11-01', 'previous'),
      c('previous', '2026-10-31'),
    ],
    spine = new Set(['head', 'previous']);
  for (const order of [commits, [...commits].reverse()])
    assert.equal(
      monthMarkers(order, spine).find((marker) => marker.label === '2026.11')?.sha,
      'side-a',
    );
});

test('markers prefer committer time, fall back to valid author time, and ignore missing dates', () => {
  const commits = [
    c('committer', '2026-02-15', undefined, '2020-01-01'),
    c('invalid', 'invalid', undefined, '2026-01-01'),
    c('missing'),
    c('bad', 'invalid', undefined, 'invalid'),
  ];
  assert.deepEqual(monthMarkers(commits, new Set(commits.map((commit) => commit.sha))), [
    { sha: 'committer', label: '2026.02' },
    { sha: 'invalid', label: '2026.01' },
  ]);
});

for (const [zone, monthStart, yearStart, offsetMonth] of [
  ['Asia/Seoul', 'korea', 'korea', '2026.03'],
  ['UTC', 'utc', 'utc', '2026.02'],
  ['America/Los_Angeles', 'los-angeles', 'los-angeles', '2026.02'],
  ['Europe/Berlin', 'berlin', 'berlin', '2026.02'],
])
  test(`local month and year boundaries follow ${zone} without changing traversal or pagination rules`, () => {
    const month = [
      c('latest', '2026-11-02T12:00:00Z', 'los-angeles'),
      c('los-angeles', '2026-11-01T07:00:00Z', 'before-la'),
      c('before-la', '2026-11-01T06:59:59Z', 'utc'),
      c('utc', '2026-11-01T00:00:00Z', 'berlin'),
      c('berlin', '2026-10-31T23:00:00Z', 'korea'),
      c('korea', '2026-10-31T15:00:00Z', 'before-korea'),
      c('before-korea', '2026-10-31T14:59:59Z', 'october'),
      c('october', '2026-10-02T12:00:00Z', 'root'),
      c('root', '2026-09-15T12:00:00Z'),
    ];
    const year = [
      c('latest', '2027-01-02T12:00:00Z', 'los-angeles'),
      c('los-angeles', '2027-01-01T08:00:00Z', 'utc'),
      c('utc', '2027-01-01T00:00:00Z', 'berlin'),
      c('berlin', '2026-12-31T23:00:00Z', 'korea'),
      c('korea', '2026-12-31T15:00:00Z', 'december'),
      c('december', '2026-12-02T12:00:00Z', 'root'),
      c('root', '2026-11-15T12:00:00Z'),
    ];
    const offset = [
      c('offset', '2026-03-01T00:30:00+02:00', undefined, '2020-01-01T12:00:00Z'),
      c('fallback', 'invalid', undefined, '2026-01-15T12:00:00Z'),
      c('missing'),
    ];
    const script = `import {monthMarkers} from ${JSON.stringify(new URL('./monthMarkers.ts', import.meta.url).href)};
 const [month,year,offset]=${JSON.stringify([month, year, offset])};
 const run=commits=>monthMarkers(commits,new Set(commits.map(c=>c.sha)));
 const before=JSON.stringify(month);
 console.log(JSON.stringify({month:run(month),reverse:run([...month].reverse()),year:run(year),offset:run(offset),partial:run(month.slice(0,2)),unchanged:JSON.stringify(month)===before}));`;
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', script],
        { encoding: 'utf8', env: { ...process.env, TZ: zone } },
      ),
    );
    const expected = [
      { sha: monthStart, label: '2026.11' },
      { sha: 'october', label: '2026.10' },
      { sha: 'root', label: '2026.09' },
    ];
    assert.deepEqual(result.month, expected);
    assert.deepEqual(result.reverse, [...expected].reverse());
    assert.deepEqual(result.year, [
      { sha: yearStart, label: '2027.01' },
      { sha: 'december', label: '2026.12' },
      { sha: 'root', label: '2026.11' },
    ]);
    assert.deepEqual(result.offset, [
      { sha: 'offset', label: offsetMonth },
      { sha: 'fallback', label: '2026.01' },
    ]);
    assert.deepEqual(result.partial, []);
    assert.equal(result.unchanged, true);
  });

test('out-of-order timestamps cannot create duplicate monthly labels', () => {
  const commits = [
    c('feb', '2026-02-28'),
    c('march', '2026-03-01'),
    c('jan31', '2026-01-31'),
    c('jan1', '2026-01-01'),
    c('dec', '2025-12-31'),
  ];
  const spine = new Set(commits.map((commit) => commit.sha));
  const actual = monthMarkers(commits, spine);
  assert.equal(actual.filter((marker) => marker.label === '2026.01').length, 1);
  assert.equal(actual.find((marker) => marker.label === '2026.01')?.sha, 'jan1');
  assert.deepEqual(monthMarkers([...commits].reverse(), spine), [...actual].reverse());
});

test('pagination preserves already confirmed month starts', () => {
  const first = [
    c('late', '2026-03-31', 'first'),
    c('first', '2026-03-01', 'prev'),
    c('prev', '2026-02-28', 'earlier'),
  ];
  const next = [...first, c('earlier', '2026-02-01', 'root'), c('root', '2026-01-31')];
  const spine = new Set(next.map((commit) => commit.sha));
  assert.deepEqual(monthMarkers(first, spine), [{ sha: 'first', label: '2026.03' }]);
  assert.deepEqual(monthMarkers(next, spine), [
    { sha: 'first', label: '2026.03' },
    { sha: 'earlier', label: '2026.02' },
    { sha: 'root', label: '2026.01' },
  ]);
});

test('an old unrelated branch cannot make a partial base month appear complete', () => {
  const commits = [c('base', '2026-10-29', 'missing'), c('side', '2016-01-01')];
  assert.deepEqual(monthMarkers(commits, new Set(['base'])), []);
  assert.deepEqual(monthMarkers([...commits].reverse(), new Set(['base'])), []);
});

test('oldest-first windows can mark repository creation before the tip is loaded', () => {
  const commits = [c('root', '2014-09-18'), c('next', '2014-10-02', 'root')];
  assert.deepEqual(monthMarkers(commits, new Set(['unloaded-tip'])), [
    { sha: 'root', label: '2014.09' },
    { sha: 'next', label: '2014.10' },
  ]);
  assert.deepEqual(monthMarkers([], new Set()), []);
});
