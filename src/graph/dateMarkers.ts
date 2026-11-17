import { commitTime, type Commit } from '../shared/model';

export type DateMarker = {
  sha: string;
  kind: 'month' | 'day';
  label: string;
};
type CalendarCommit = { commit: Commit; time: number; date: Date };
type Period = {
  calendar: Map<number, CalendarCommit>;
  context: Map<number, CalendarCommit>;
  earliest: number;
};
const period = (): Period => ({
  calendar: new Map(),
  context: new Map(),
  earliest: Infinity,
});
const earlier = (entry: CalendarCommit, previous: CalendarCommit) =>
  entry.time < previous.time ||
  (entry.time === previous.time && entry.commit.sha < previous.commit.sha);
function earlierContext(entry: CalendarCommit, previous: CalendarCommit) {
  if (entry.time !== previous.time) return entry.time < previous.time;
  const root = entry.commit.parents.length === 0,
    previousRoot = previous.commit.parents.length === 0;
  return root !== previousRoot ? root : entry.commit.sha < previous.commit.sha;
}

// The base path bounds partial periods; all loaded lanes supply month/day
// candidates and anchors, including branches ahead of the selected base tip.
// Keep this policy shared with the monthMarkers API.
export function calendarAnchors(ordered: Commit[], spine: Set<string>) {
  const hasSpine = ordered.some((commit) => spine.has(commit.sha));
  const periods = { month: period(), day: period() };
  for (const commit of ordered) {
    const time = commitTime(commit);
    if (!Number.isFinite(time)) continue;
    const date = new Date(time),
      month = date.getFullYear() * 12 + date.getMonth(),
      entry = { commit, time, date };
    for (const [group, key] of [
      [periods.month, month],
      [periods.day, month * 31 + date.getDate() - 1],
    ] as const) {
      const first = group.calendar.get(key);
      if (!first || earlier(entry, first)) group.calendar.set(key, entry);
      if (hasSpine && !spine.has(commit.sha)) continue;
      group.earliest = Math.min(group.earliest, key);
      const base = group.context.get(key);
      // A known root at the same earliest instant confirms the beginning in
      // either display direction. Otherwise break context ties by SHA as well.
      if (!base || earlierContext(entry, base)) group.context.set(key, entry);
    }
  }
  const confirmed = (group: Period) => {
    const anchors = new Map<string, CalendarCommit>();
    for (const key of group.calendar.keys()) {
      if (key < group.earliest) continue;
      // An oldest partial period needs older context, unless its root is known.
      if (
        key === group.earliest &&
        group.context.get(key)!.commit.parents.length > 0
      )
        continue;
      const entry = group.calendar.get(key)!;
      anchors.set(entry.commit.sha, entry);
    }
    return anchors;
  };
  return {
    month: confirmed(periods.month),
    day: confirmed(periods.day),
  };
}

const formatters = new Map<
  string,
  { month: Intl.DateTimeFormat; day: Intl.DateTimeFormat }
>();
function dateFormatters(locale?: string) {
  const key = locale ?? '';
  let cached = formatters.get(key);
  if (!cached) {
    cached = {
      month: new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      day: new Intl.DateTimeFormat(locale, { day: 'numeric' }),
    };
    formatters.set(key, cached);
  }
  return cached;
}

export function dateMarkers(
  ordered: Commit[],
  spine: Set<string>,
  locale?: string,
): DateMarker[] {
  const anchors = calendarAnchors(ordered, spine);
  const formats = dateFormatters(locale),
    seen = new Set<string>();
  return ordered.flatMap((commit): DateMarker[] => {
    if (seen.has(commit.sha)) return [];
    seen.add(commit.sha);
    const kind = anchors.month.has(commit.sha) ? 'month' : 'day',
      entry = anchors[kind].get(commit.sha);
    return entry
      ? [{ sha: commit.sha, kind, label: formats[kind].format(entry.date) }]
      : [];
  });
}
