import type { HistorySnapshot } from './history';
import type { InfoSnapshot } from './CommitInfoStore';
import { noChanges, type Changes } from './debug';

type Signature = Map<string, number>;
export type ChangeSnapshot = {
  commits: Signature;
  branches: Signature;
  tags: Signature;
  releases: Signature;
  actions: Signature;
};
const signature = (value: unknown) => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
};
export function captureChanges(
  history: HistorySnapshot,
  info: InfoSnapshot,
): ChangeSnapshot {
  const snapshot: ChangeSnapshot = {
    commits: new Map(),
    branches: new Map(),
    tags: new Map(),
    releases: new Map(),
    actions: new Map(),
  };
  for (const commit of history.commits)
    snapshot.commits.set(
      commit.sha,
      signature([commit.parents, commit.commit]),
    );
  for (const branch of history.branches)
    snapshot.branches.set(branch.name, signature(branch.commit.sha));
  for (const [sha, value] of info.bySha) {
    for (const tag of value.tags)
      snapshot.tags.set(tag.name, signature(tag.sha));
    for (const release of value.releases)
      snapshot.releases.set(String(release.id), signature([sha, release]));
    for (const run of value.runs)
      snapshot.actions.set(
        String(run.id),
        signature([
          run.status,
          run.conclusion,
          run.run_attempt,
          run.updated_at,
          info.jobs.get(run.id),
        ]),
      );
  }
  return snapshot;
}
export function changeCounts(
  before: ChangeSnapshot,
  after: ChangeSnapshot,
): Changes {
  const result = noChanges();
  const compare = (a: Signature, b: Signature) => ({
    added: [...b.keys()].filter((key) => !a.has(key)).length,
    removed: [...a.keys()].filter((key) => !b.has(key)).length,
    changed: [...b].filter(([key, value]) => a.has(key) && a.get(key) !== value)
      .length,
  });
  const commits = compare(before.commits, after.commits),
    branches = compare(before.branches, after.branches);
  Object.assign(result, {
    commitsAdded: commits.added,
    commitsChanged: commits.changed,
    commitsRemoved: commits.removed,
    branchesAdded: branches.added,
    branchesRemoved: branches.removed,
    branchesChanged: branches.changed,
  });
  for (const [field, name] of [
    ['tags', 'tagsChanged'],
    ['releases', 'releasesChanged'],
    ['actions', 'actionsChanged'],
  ] as const) {
    const value = compare(before[field], after[field]);
    result[name] = value.added + value.removed + value.changed;
  }
  return result;
}
