export type Commit = {
  sha: string;
  parents: { sha: string }[];
  commit: {
    message: string;
    author: { name: string; date: string } | null;
    committer: { date: string } | null;
  };
  html_url: string;
};
export type Branch = { name: string; commit: { sha: string } };
export type HistoryFrontier = { sha: string; sources: string[] };
export const ROW = 31;
export function commitTime(commit: Commit) {
  for (const value of [commit.commit.committer?.date, commit.commit.author?.date]) {
    const time = value ? Date.parse(value) : NaN;
    if (Number.isFinite(time)) return time;
  }
  return NaN;
}
export function layout(commits: Commit[], previous = new Map<string, number>(), baseHead?: string) {
  const map = new Map(commits.map((c) => [c.sha, c]));
  const children = new Map<string, number>();
  for (const c of map.values())
    for (const p of c.parents)
      if (map.has(p.sha)) children.set(p.sha, (children.get(p.sha) || 0) + 1);
  // Choose the newest eligible commit, while keeping every child above its parents.
  // A FIFO queue interleaves old branch tips with recent base-branch history.
  const priority = new Map(
    [...map.values()].map((commit, index) => {
      const time = commitTime(commit);
      return [commit.sha, { time: Number.isFinite(time) ? time : -Infinity, index }];
    }),
  );
  const newer = (a: Commit, b: Commit) => {
    const x = priority.get(a.sha)!,
      y = priority.get(b.sha)!;
    return x.time > y.time || (x.time === y.time && x.index < y.index);
  };
  const ready: Commit[] = [];
  const push = (commit: Commit) => {
    ready.push(commit);
    let index = ready.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!newer(ready[index], ready[parent])) break;
      [ready[index], ready[parent]] = [ready[parent], ready[index]];
      index = parent;
    }
  };
  const pop = () => {
    const commit = ready[0],
      last = ready.pop()!;
    if (ready.length) {
      ready[0] = last;
      let index = 0;
      while (index * 2 + 1 < ready.length) {
        let child = index * 2 + 1;
        if (child + 1 < ready.length && newer(ready[child + 1], ready[child])) child++;
        if (!newer(ready[child], ready[index])) break;
        [ready[index], ready[child]] = [ready[child], ready[index]];
        index = child;
      }
    }
    return commit;
  };
  for (const commit of map.values()) if (!children.get(commit.sha)) push(commit);
  const ordered: Commit[] = [];
  while (ready.length) {
    const c = pop();
    ordered.push(c);
    for (const p of c.parents)
      if (map.has(p.sha)) {
        const n = children.get(p.sha)! - 1;
        children.set(p.sha, n);
        if (!n) push(map.get(p.sha)!);
      }
  }
  // The base branch follows first parents only: merged ancestry must keep its own lane.
  const spine = new Set<string>();
  let sha = baseHead;
  while (sha && !spine.has(sha)) {
    spine.add(sha);
    sha = map.get(sha)?.parents[0]?.sha;
  }
  const minimum = baseHead ? 1 : 0;
  const lanes = new Map<string, number>();
  const active: (string | null)[] = Array(minimum).fill(null);
  const free = () => {
    const slot = active.findIndex((value, index) => index >= minimum && value === null);
    return slot < 0 ? active.length : slot;
  };
  for (const c of ordered) {
    let lane = spine.has(c.sha) ? 0 : active.indexOf(c.sha);
    if (lane < minimum && !spine.has(c.sha)) {
      const preferred = previous.get(c.sha);
      lane =
        preferred !== undefined && preferred >= minimum && !active[preferred] ? preferred : free();
    }
    lanes.set(c.sha, lane);
    active[lane] = null;
    c.parents.forEach((p, i) => {
      if (spine.has(p.sha) || active.includes(p.sha)) return;
      const slot = i === 0 && !spine.has(c.sha) ? lane : free();
      active[slot] = p.sha;
    });
  }
  return { ordered, lanes, spine };
}
export function ancestors(sha: string, commits: Commit[]) {
  const map = new Map(commits.map((c) => [c.sha, c]));
  const found = new Set<string>();
  const todo = [sha];
  while (todo.length) {
    const s = todo.pop()!;
    if (found.has(s)) continue;
    found.add(s);
    for (const p of map.get(s)?.parents || []) todo.push(p.sha);
  }
  return found;
}
// GitHub resolves owner/repository paths case-insensitively, so the field accepts lowercase only.
export const lowercaseRepoInput = (value: string) => value.toLowerCase();
export function parseRepo(input: string) {
  const clean = input
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean) || clean.split('/').some((s) => s === '.' || s === '..'))
    throw new Error('Enter a GitHub URL or owner/repository.');
  return clean;
}
