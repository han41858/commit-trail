import type { Branch } from './model';

export const RECOMMENDATION_LIMIT = 30;
export const mergedCount = (counts: Record<string, number>, name: string) =>
  Object.hasOwn(counts, name) ? counts[name] : 0;
export function priorityBranchNames(branches: Branch[], defaultBranch: string) {
  const existing = new Set(branches.map((b) => b.name));
  return [...new Set(['main', 'master', defaultBranch])].filter((name) =>
    existing.has(name),
  );
}
export function preferredBranch(branches: Branch[], defaultBranch: string) {
  return priorityBranchNames(branches, defaultBranch)[0] || defaultBranch;
}
export function recommendBranches(
  branches: Branch[],
  counts: Record<string, number>,
  defaultBranch: string,
) {
  const priorities = priorityBranchNames(branches, defaultBranch);
  const order = (name: string) => {
    const index = priorities.indexOf(name);
    return index < 0 ? priorities.length : index;
  };
  return [...branches]
    .sort(
      (a, b) =>
        order(a.name) - order(b.name) ||
        mergedCount(counts, b.name) - mergedCount(counts, a.name) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, RECOMMENDATION_LIMIT);
}
export type ClosedPull = {
  id: number;
  merged_at: string | null;
  updated_at: string;
  base: { ref: string };
};
export class PullCounts {
  readonly since: string;
  readonly counts: Record<string, number> = Object.create(null);
  private seen = new Set<number>();
  scanned = 0;
  constructor(now = new Date()) {
    this.since = new Date(now.getTime() - 90 * 86400000).toISOString();
  }
  add(pulls: ClosedPull[]) {
    let reachedCutoff = false;
    for (const pr of pulls) {
      if (Date.parse(pr.updated_at) < Date.parse(this.since)) {
        reachedCutoff = true;
        continue;
      }
      if (this.seen.has(pr.id)) continue;
      this.seen.add(pr.id);
      this.scanned++;
      if (pr.merged_at && Date.parse(pr.merged_at) >= Date.parse(this.since))
        this.counts[pr.base.ref] = (this.counts[pr.base.ref] || 0) + 1;
    }
    return reachedCutoff;
  }
}
