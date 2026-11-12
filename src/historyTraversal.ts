import { commitTime, type Commit, type HistoryFrontier } from './model';

export function historyFrontiers(
  commits: ReadonlyMap<string, Commit>,
  traversal: {
    reverse: boolean;
    nextPage: number;
    forwardWindow: readonly Commit[];
    sideCommits: ReadonlySet<string>;
  },
) {
  const { reverse, nextPage, forwardWindow, sideCommits } = traversal;
  const frontiers: HistoryFrontier[] = [];
  if (reverse) {
    if (nextPage > 0) {
      const parents = new Set(
        [...commits.values()].flatMap((commit) =>
          commit.parents.map((parent) => parent.sha),
        ),
      );
      const tips = forwardWindow.filter((commit) => !parents.has(commit.sha));
      for (const commit of tips.length ? tips : forwardWindow.slice(0, 1))
        frontiers.push({ sha: commit.sha, sources: [`page:${nextPage}`] });
    }
  }
  for (const commit of commits.values()) {
    if (reverse && !sideCommits.has(commit.sha)) continue;
    // A queried parent may have been pruned; only a loaded commit closes a gap.
    const sources = [
      ...new Set(commit.parents.map((parent) => parent.sha)),
    ].filter((sha) => !commits.has(sha));
    if (sources.length) frontiers.push({ sha: commit.sha, sources });
  }
  return frontiers;
}

export function historyRange(
  commits: ReadonlyMap<string, Commit>,
  head: string,
  forwardWindow: readonly Commit[],
) {
  const known: Commit[] = [];
  const seen = new Set<string>();
  let sha: string | undefined = head;
  while (sha && !seen.has(sha)) {
    seen.add(sha);
    const commit = commits.get(sha);
    if (!commit) break;
    known.push(commit);
    sha = commit.parents[0]?.sha;
  }
  let min = Infinity,
    max = -Infinity,
    anchor = '';
  for (const commit of known.length ? known : forwardWindow) {
    const time = commitTime(commit);
    if (!Number.isFinite(time)) continue;
    if (time < min) {
      min = time;
      anchor = commit.sha;
    }
    max = Math.max(max, time);
  }
  return anchor ? { min, max, anchor } : null;
}

export function commitAncestry(
  commits: ReadonlyMap<string, Commit>,
  heads: Iterable<string>,
  stopAt?: ReadonlySet<string>,
) {
  const reachable = new Set<string>(),
    todo = [...heads];
  let partial = false;
  while (todo.length) {
    const sha = todo.pop()!;
    if (reachable.has(sha) || stopAt?.has(sha)) continue;
    reachable.add(sha);
    const commit = commits.get(sha);
    if (!commit) {
      partial = true;
      continue;
    }
    for (const parent of commit.parents) todo.push(parent.sha);
  }
  return { reachable, partial };
}
