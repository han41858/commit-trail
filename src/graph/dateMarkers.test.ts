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
  test(`${locale} uses the actual localized month-anchor date and numeric days`, () => {
    const markers = dateMarkers(simple, spine(simple), locale);
    const full = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
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

test('days between release merges include dates with only side-branch commits', () => {
  const head = c('release-16', '2026-11-16', 'release-13');
  head.parents.push({ sha: 'work-15' });
  const commits = [
    head,
    c('work-15', '2026-11-15', 'work-14'),
    c('work-14', '2026-11-14', 'work-11'),
    c('release-13', '2026-11-13', 'root-9'),
    c('work-11', '2026-11-11', 'work-10'),
    c('work-10', '2026-11-10', 'root-9'),
    c('root-9', '2026-11-09'),
  ];
  const graph = layout(commits, new Map(), head.sha);
  const expected = graph.ordered.map((commit) => ({
    sha: commit.sha,
    kind: commit.sha === 'root-9' ? 'month' : 'day',
  }));
  for (const reverse of [false, true]) {
    const ordered = reverse ? [...graph.ordered].reverse() : graph.ordered;
    assert.deepEqual(
      identity(dateMarkers(ordered, graph.spine)),
      reverse ? [...expected].reverse() : expected,
    );
    assert.deepEqual(monthMarkers(ordered, graph.spine), [
      { sha: 'root-9', label: '2026.11' },
    ]);
  }
});

test('a branch ahead of the selected base gets a day marker at its earliest daily commit', () => {
  const commits = [
    c('dev-17-late', '2026-11-17T18:00:00', 'dev-17-early'),
    c('dev-17-early', '2026-11-17T06:00:00', 'main-16'),
    c('main-16', '2026-11-16', 'main-13'),
    c('main-13', '2026-11-13', 'missing'),
  ];
  const graph = layout(commits, new Map(), 'main-16');
  assert.equal(graph.spine.has('dev-17-early'), false);
  const expected = [
    { sha: 'dev-17-early', kind: 'day' },
    { sha: 'main-16', kind: 'day' },
  ];
  for (const reverse of [false, true]) {
    const ordered = reverse ? [...graph.ordered].reverse() : graph.ordered;
    assert.deepEqual(
      identity(dateMarkers(ordered, graph.spine)),
      reverse ? [...expected].reverse() : expected,
    );
  }
});

test('older base context reveals side-only dates without letting unrelated history confirm partial periods', () => {
  const head = c('head-16', '2026-11-16', 'base-13');
  head.parents.push({ sha: 'side-15' });
  const first = [
    head,
    c('side-15', '2026-11-15', 'side-12'),
    c('base-13', '2026-11-13', 'base-9'),
    c('side-12', '2026-11-12', 'base-9'),
    c('unrelated-1', '2026-11-01'),
  ];
  const all = [...first, c('base-9', '2026-11-09', 'missing')];
  const base = new Set(['head-16', 'base-13', 'base-9']);
  for (const reverse of [false, true]) {
    const order = (commits: Commit[]) =>
      reverse ? [...commits].reverse() : commits;
    const before = [
      { sha: 'head-16', kind: 'day' },
      { sha: 'side-15', kind: 'day' },
    ];
    const after = [
      ...before,
      { sha: 'base-13', kind: 'day' },
      { sha: 'side-12', kind: 'day' },
    ];
    assert.deepEqual(
      identity(dateMarkers(order(first), base)),
      reverse ? [...before].reverse() : before,
    );
    assert.deepEqual(
      identity(dateMarkers(order(all), base)),
      reverse ? [...after].reverse() : after,
    );
    assert.deepEqual(monthMarkers(order(all), base), []);
  }
});

test('side-only dates in a newer month do not change the existing monthly confirmation policy', () => {
  const commits = [
    c('dev-nov-2', '2026-11-02', 'dev-nov-1'),
    c('dev-nov-1', '2026-11-01', 'main-oct-31'),
    c('main-oct-31', '2026-10-31', 'missing'),
  ];
  const base = new Set(['main-oct-31']);
  const expected = [
    { sha: 'dev-nov-2', kind: 'day' },
    { sha: 'dev-nov-1', kind: 'day' },
  ];
  for (const reverse of [false, true]) {
    const ordered = reverse ? [...commits].reverse() : commits;
    assert.deepEqual(
      identity(dateMarkers(ordered, base)),
      reverse ? [...expected].reverse() : expected,
    );
    assert.deepEqual(monthMarkers(ordered, base), []);
  }
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
      year: 'numeric',
      month: 'long',
      day: 'numeric',
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
