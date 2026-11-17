import type { Commit } from '../shared/model';
import { calendarAnchors } from './dateMarkers';

export type MonthMarker = { sha: string; label: string };
export function monthMarkers(
  ordered: Commit[],
  spine: Set<string>,
): MonthMarker[] {
  const anchors = calendarAnchors(ordered, spine).month;
  // Preserve the existing monthly API; the graph uses dateMarkers for Locale
  // labels and daily separators, while both share boundary confirmation.
  const markers = new Map<string, string>();
  for (const { commit, date } of anchors.values()) {
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
