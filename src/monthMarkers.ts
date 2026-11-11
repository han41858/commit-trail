import { commitTime, type Commit } from './model';

export type MonthMarker = { sha: string; label: string };
type MonthCommit = { commit: Commit; time: number; date: Date };
export function monthMarkers(
  ordered: Commit[],
  spine: Set<string>,
): MonthMarker[] {
  const hasSpine = ordered.some((commit) => spine.has(commit.sha));
  const calendar = new Map<number, MonthCommit>(),
    context = new Map<number, MonthCommit>();
  // The base path confirms month boundaries; every loaded lane can own a marker.
  for (const commit of ordered) {
    const time = commitTime(commit);
    if (!Number.isFinite(time)) continue;
    const date = new Date(time),
      key = date.getFullYear() * 12 + date.getMonth(),
      entry = { commit, time, date },
      first = calendar.get(key),
      base = context.get(key);
    // A SHA tie-break keeps the anchor stable when equal timestamps are reversed.
    if (
      !first ||
      time < first.time ||
      (time === first.time && commit.sha < first.commit.sha)
    )
      calendar.set(key, entry);
    if ((!hasSpine || spine.has(commit.sha)) && (!base || time < base.time))
      context.set(key, entry);
  }
  const earliest = Math.min(...context.keys());
  const markers = new Map<string, string>();
  for (const [key, base] of context) {
    // A partial oldest month is not its true beginning. Wait for older context;
    // a known root is the first available commit even if the repo began midmonth.
    if (key === earliest && base.commit.parents.length > 0) continue;
    const { commit, date } = calendar.get(key)!;
    markers.set(
      commit.sha,
      `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`,
    );
  }
  return ordered.flatMap((commit) =>
    markers.has(commit.sha)
      ? [{ sha: commit.sha, label: markers.get(commit.sha)! }]
      : [],
  );
}
