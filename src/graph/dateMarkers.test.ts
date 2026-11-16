import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dateMarkers } from './dateMarkers';
import { monthMarkers } from './monthMarkers';
import { layout, type Commit } from '../shared/model';

const localTime = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
const c = (
  sha: string,
  date?: string,
  parent?: string,
  author?: string,
): Commit => ({
  sha,
  parents: parent ? [{ sha: parent }] : [],
  commit: {
    message: sha,
    committer: date ? { date: localTime(date) } : null,
    author: author ? { name: 'Test', date: localTime(author) } : null,
  },
  html_url: '',
});
const spine = (commits: Commit[]) =>
  new Set(commits.map((commit) => commit.sha));
const identity = (markers: ReturnType<typeof dateMarkers>) =>
  markers.map(({ sha, kind }) => ({ sha, kind }));
const simple = [
  c('fifth', '2026-11-05', 'fourth'),
  c('fourth', '2026-11-04', 'root'),
  c('root', '2026-11-03'),
];

for (const locale of ['ko-KR', 'en-US', 'en-GB', 'ja-JP', 'de-DE'])
  test(`${locale} uses the actual short month-anchor date and numeric days`, () => {
    const markers = dateMarkers(simple, spine(simple), locale);
    const full = new Intl.DateTimeFormat(locale, { dateStyle: 'short' });
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric' });
    assert.deepEqual(markers, [
      {
        sha: 'fifth',
        kind: 'day',
        label: day.format(new Date(localTime('2026-11-05'))),
      },
      {
        sha: 'fourth',
        kind: 'day',
        label: day.format(new Date(localTime('2026-11-04'))),
      },
      {
        sha: 'root',
        kind: 'month',
        label: full.format(new Date(localTime('2026-11-03'))),
      },
    ]);
    assert.deepEqual(
      identity(markers),
      identity(dateMarkers(simple, spine(simple), 'en-US')),
    );
  });

test('one anchor represents each loaded date without inventing empty days', () => {
  const commits = [
    c('seventh', '2026-11-07', 'late'),
    c('late', '2026-11-05T18:00:00', 'early'),
    c('early', '2026-11-05T08:00:00', 'root'),
    c('root', '2026-11-03'),
  ];
  assert.deepEqual(identity(dateMarkers(commits, spine(commits))), [
    { sha: 'seventh', kind: 'day' },
    { sha: 'early', kind: 'day' },
    { sha: 'root', kind: 'month' },
  ]);
});

test('month anchors suppress only a day marker at the same SHA, even after a year change', () => {
  const commits = [
    c('jan2', '2027-01-02', 'jan1'),
    c('jan1', '2027-01-01', 'dec31'),
    c('dec31', '2026-12-31', 'root'),
    c('root', '2026-12-03'),
  ];
  const markers = dateMarkers(commits, spine(commits));
  assert.deepEqual(identity(markers), [
    { sha: 'jan2', kind: 'day' },
    { sha: 'jan1', kind: 'month' },
    { sha: 'dec31', kind: 'day' },
    { sha: 'root', kind: 'month' },
  ]);
  assert.deepEqual(
    markers
      .filter((marker) => marker.kind === 'month')
      .map((marker) => marker.sha),
    monthMarkers(commits, spine(commits)).map((marker) => marker.sha),
  );
});

test('merged lanes can own both monthly and daily anchors in either direction', () => {
  const head = c('head', '2026-11-06T18:00:00', 'merge');
  head.parents.push({ sha: 'side-sixth' });
  const merge = c('merge', '2026-11-05T18:00:00', 'previous');
  merge.parents.push({ sha: 'side-fifth' });
  const commits = [
    head,
    c('side-sixth', '2026-11-06T06:00:00', 'side-fifth'),
    merge,
    c('side-fifth', '2026-11-05T06:00:00', 'previous'),
    c('previous', '2026-10-31'),
  ];
  const before = JSON.stringify(commits);
  const graph = layout(commits, new Map(), 'head');
  const markers = dateMarkers(graph.ordered, graph.spine);
  assert.equal(graph.spine.has('side-sixth'), false);
  assert.deepEqual(identity(markers), [
    { sha: 'side-sixth', kind: 'day' },
    { sha: 'side-fifth', kind: 'month' },
    { sha: 'previous', kind: 'month' },
  ]);
  assert.deepEqual(
    dateMarkers([...graph.ordered].reverse(), graph.spine),
    [...markers].reverse(),
  );
  assert.equal(JSON.stringify(commits), before);
});

test('oldest partial days and months wait for older base context independently', () => {
  const first = [
    c('fifth', '2026-11-05', 'fourth'),
    c('fourth', '2026-11-04', 'root'),
  ];
  const all = [...first, c('root', '2026-11-03')];
  assert.deepEqual(identity(dateMarkers(first, spine(all))), [
    { sha: 'fifth', kind: 'day' },
  ]);
  assert.deepEqual(monthMarkers(first, spine(all)), []);
  assert.deepEqual(identity(dateMarkers(all, spine(all))), [
    { sha: 'fifth', kind: 'day' },
    { sha: 'fourth', kind: 'day' },
    { sha: 'root', kind: 'month' },
  ]);
  assert.deepEqual(dateMarkers(first.slice(1), spine(all)), []);
});

test('unrelated old lanes cannot confirm a partial base day or month', () => {
  const commits = [
    c('base', '2026-11-05', 'missing'),
    c('unrelated', '2016-01-01'),
  ];
  for (const ordered of [commits, [...commits].reverse()])
    assert.deepEqual(dateMarkers(ordered, new Set(['base'])), []);
});

test('pagination moves a daily side anchor without moving an already confirmed month', () => {
  const first = [
    c('head', '2026-11-06', 'base'),
    c('base', '2026-11-05T18:00:00', 'root'),
    c('side-later', '2026-11-05T10:00:00', 'side-first'),
    c('root', '2026-11-04'),
  ];
  const all = [...first, c('side-first', '2026-11-05T03:00:00', 'root')];
  const base = new Set(['head', 'base', 'root']);
  for (const reverse of [false, true]) {
    const order = (list: Commit[]) => (reverse ? [...list].reverse() : list);
    const before = dateMarkers(order(first), base);
    const after = dateMarkers(order(all), base);
    assert(
      before.some(
        (marker) => marker.sha === 'side-later' && marker.kind === 'day',
      ),
    );
    assert(
      after.some(
        (marker) => marker.sha === 'side-first' && marker.kind === 'day',
      ),
    );
    assert.equal(before.find((marker) => marker.kind === 'month')?.sha, 'root');
    assert.equal(after.find((marker) => marker.kind === 'month')?.sha, 'root');
  }
});

test('equal timestamps use stable SHA anchors and a known root confirms tied context', () => {
  const commits = [
    c('head', '2026-11-06', 'base'),
    c('base', '2026-11-05T18:00:00', 'root'),
    c('side-z', '2026-11-05T06:00:00', 'root'),
    c('side-a', '2026-11-05T06:00:00', 'root'),
    c('root', '2026-11-04'),
  ];
  for (const ordered of [commits, [...commits].reverse()])
    assert(
      dateMarkers(ordered, new Set(['head', 'base', 'root'])).some(
        (marker) => marker.sha === 'side-a' && marker.kind === 'day',
      ),
    );
  const tied = [
    c('a-child', '2026-11-03', 'z-root'),
    c('z-root', '2026-11-03'),
  ];
  for (const ordered of [tied, [...tied].reverse()])
    assert.deepEqual(identity(dateMarkers(ordered, spine(tied))), [
      { sha: 'a-child', kind: 'month' },
    ]);
});

test('date reversals do not split one day into multiple markers or reorder the DAG', () => {
  const commits = [
    c('head', '2026-11-04T06:00:00', 'parent'),
    c('parent', '2026-11-05T08:00:00', 'repeat'),
    c('repeat', '2026-11-04T18:00:00', 'root'),
    c('root', '2026-11-03'),
  ];
  const graph = layout(commits, new Map(), 'head');
  const before = JSON.stringify(graph.ordered);
  const markers = dateMarkers(graph.ordered, graph.spine);
  assert.deepEqual(identity(markers), [
    { sha: 'head', kind: 'day' },
    { sha: 'parent', kind: 'day' },
    { sha: 'root', kind: 'month' },
  ]);
  assert.deepEqual(
    dateMarkers([...graph.ordered].reverse(), graph.spine),
    [...markers].reverse(),
  );
  assert.equal(JSON.stringify(graph.ordered), before);
});

test('committer dates take priority, author dates are the fallback, and invalid dates are ignored', () => {
  const commits = [
    c('committer', '2026-11-06', undefined, '2020-01-01'),
    c('fallback', 'invalid', undefined, '2026-11-04'),
    c('author', undefined, undefined, '2026-11-05'),
    c('root', '2026-11-03'),
    c('missing'),
    c('invalid', 'invalid', undefined, 'invalid'),
  ];
  assert.deepEqual(identity(dateMarkers(commits, spine(commits))), [
    { sha: 'committer', kind: 'day' },
    { sha: 'fallback', kind: 'day' },
    { sha: 'author', kind: 'day' },
    { sha: 'root', kind: 'month' },
  ]);
  assert.deepEqual(dateMarkers([], new Set()), []);
});

test('unloaded base tips fall back to the loaded timeline, including a known repository root', () => {
  const commits = [c('root', '2014-09-18'), c('next', '2014-10-02', 'root')];
  assert.deepEqual(identity(dateMarkers(commits, new Set(['unloaded']))), [
    { sha: 'root', kind: 'month' },
    { sha: 'next', kind: 'month' },
  ]);
});

test('date formatters are reused across marker recomputations', (t) => {
  const Original = Intl.DateTimeFormat;
  let created = 0;
  t.mock.method(
    Intl,
    'DateTimeFormat',
    new Proxy(Original, {
      construct(target, args) {
        created++;
        return Reflect.construct(target, args);
      },
    }),
  );
  const locale = 'en-US-u-nu-arab';
  const first = dateMarkers(simple, spine(simple), locale);
  for (let n = 0; n < 5; n++)
    assert.deepEqual(dateMarkers(simple, spine(simple), locale), first);
  assert.equal(created, 2);
});

for (const zone of [
  'Asia/Seoul',
  'UTC',
  'America/Los_Angeles',
  'Europe/Berlin',
  'Pacific/Auckland',
])
  test(`daily and monthly anchors use local calendar dates in ${zone}`, () => {
    const times = [
      '2026-11-02T12:00:00Z',
      '2026-11-02T08:00:00Z',
      '2026-11-02T00:00:00Z',
      '2026-11-01T23:00:00Z',
      '2026-11-01T15:00:00Z',
      '2026-11-01T11:00:00Z',
      '2026-11-01T10:59:59Z',
      '2026-11-01T08:00:00Z',
      '2026-11-01T07:00:00Z',
      '2026-11-01T00:00:00Z',
      '2026-10-31T23:00:00Z',
      '2026-10-31T15:00:00Z',
      '2026-10-31T11:00:00Z',
      '2026-10-31T10:59:59Z',
      '2026-10-30T00:00:00Z',
    ];
    const commits = times.map((time, index) =>
      c(
        `c${index}`,
        time,
        index === times.length - 1 ? undefined : `c${index + 1}`,
      ),
    );
    const script = `
      import { dateMarkers } from ${JSON.stringify(new URL('./dateMarkers.ts', import.meta.url).href)};
      const commits = ${JSON.stringify(commits)};
      const base = new Set(commits.map(c => c.sha));
      console.log(JSON.stringify({ normal: dateMarkers(commits, base, 'en-GB'), reverse: dateMarkers([...commits].reverse(), base, 'en-GB') }));
    `;
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          '--input-type=module',
          '--eval',
          script,
        ],
        { encoding: 'utf8', env: { ...process.env, TZ: zone } },
      ),
    );
    const full = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'short',
      timeZone: zone,
    });
    const day = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      timeZone: zone,
    });
    const calendar = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone: zone,
    });
    const days = new Map<string, Commit>(),
      months = new Map<string, Commit>();
    for (const commit of commits) {
      const parts = calendar.formatToParts(
        new Date(commit.commit.committer!.date),
      );
      const part = (type: string) =>
        parts.find((value) => value.type === type)!.value;
      const monthKey = `${part('year')}/${part('month')}`;
      // Descending timestamps replace each key with its earliest loaded commit.
      days.set(`${monthKey}/${part('day')}`, commit);
      months.set(monthKey, commit);
    }
    const monthShas = new Set([...months.values()].map((commit) => commit.sha));
    const dayShas = new Set([...days.values()].map((commit) => commit.sha));
    const expected = commits.flatMap((commit) => {
      const kind = monthShas.has(commit.sha) ? 'month' : 'day';
      return monthShas.has(commit.sha) || dayShas.has(commit.sha)
        ? [
            {
              sha: commit.sha,
              kind,
              label: (kind === 'month' ? full : day).format(
                new Date(commit.commit.committer!.date),
              ),
            },
          ]
        : [];
    });
    assert.deepEqual(result.normal, expected);
    assert.deepEqual(result.reverse, [...expected].reverse());
  });
