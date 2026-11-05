import type { Commit } from './model';
import type { BranchTrack } from './branchLabels';

export type GraphHoverTarget = { kind: 'branch' | 'commit'; id: string };
export type GraphHoverFocus = {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  branches: ReadonlySet<string>;
};
type HoverIndex = {
  commits: ReadonlyMap<string, Commit>;
  heads: ReadonlyMap<string, string>;
  owners: ReadonlyMap<string, string>;
  ends: ReadonlyMap<string, readonly string[]>;
  flows: Map<string, GraphHoverFocus>;
};

// Claim first-parent paths in render order. SHA ownership distinguishes flows
// even when their coordinates or the finite palette happen to be identical.
export function graphHoverIndex(
  ordered: Commit[],
  tracks: readonly BranchTrack[],
  baseHead?: string,
): HoverIndex {
  const commits = new Map(ordered.map((commit) => [commit.sha, commit]));
  const heads = new Map<string, string>();
  for (const track of tracks) {
    const head = track.commitShas?.[0];
    if (head && commits.has(head)) heads.set(track.name, head);
  }
  const boundaries = new Set(heads.values());
  if (baseHead && commits.has(baseHead)) boundaries.add(baseHead);
  const owners = new Map<string, string>();
  const claim = (head: string) => {
    let sha: string | undefined = head;
    while (sha && commits.has(sha) && !owners.has(sha)) {
      if (sha !== head && boundaries.has(sha)) break;
      owners.set(sha, head);
      sha = commits.get(sha)?.parents[0]?.sha;
    }
  };
  if (baseHead) claim(baseHead);
  for (const head of heads.values()) claim(head);
  // Merged/deleted branches still have an observable first-parent flow.
  for (const commit of ordered) claim(commit.sha);
  const ends = new Map<string, string[]>();
  for (const commit of ordered) {
    if (commit.parents.length < 2) continue;
    for (const parent of commit.parents) {
      // A merge of an older work commit does not end a flow that has continued.
      if (owners.get(parent.sha) !== parent.sha || owners.get(commit.sha) === parent.sha) continue;
      const merges = ends.get(parent.sha) || [];
      merges.push(commit.sha);
      ends.set(parent.sha, merges);
    }
  }
  return { commits, heads, owners, ends, flows: new Map() };
}

function flowFocus(head: string, index: HoverIndex): GraphHoverFocus {
  const cached = index.flows.get(head);
  if (cached) return cached;
  const nodes = new Set<string>();
  const edges = new Set<string>();
  let sha: string | undefined = head;
  while (sha && index.commits.has(sha) && !nodes.has(sha)) {
    nodes.add(sha);
    // Include the fork/join node so the branch's start is visible, then stop.
    if (index.owners.get(sha) !== head) break;
    const parent: string | undefined = index.commits.get(sha)?.parents[0]?.sha;
    if (parent) edges.add(`${sha}:${parent}`);
    sha = parent;
  }
  // Show the terminal merge and its connector, without traversing that flow.
  for (const merge of index.ends.get(head) || []) {
    nodes.add(merge);
    edges.add(`${merge}:${head}`);
  }
  const branches = new Set(
    [...index.heads].filter(([, sha]) => sha === head).map(([name]) => name),
  );
  const focus = { nodes, edges, branches };
  // Keep two recent flows; moving among commits in one flow reuses one result.
  if (index.flows.size === 2) index.flows.delete(index.flows.keys().next().value!);
  index.flows.set(head, focus);
  return focus;
}

export function resolveGraphHover(
  target: GraphHoverTarget | null,
  index: HoverIndex,
): GraphHoverFocus | null {
  if (!target) return null;
  const sha = target.kind === 'branch' ? index.heads.get(target.id) : target.id;
  if (!sha) return null;
  const owner = index.owners.get(sha);
  if (!owner) return null;
  const focus = flowFocus(owner, index);
  if (target.kind === 'branch' && focus.branches.size > 1)
    return { ...focus, branches: new Set([target.id]) };
  return focus;
}

export function graphHoverAlpha(
  focus: GraphHoverFocus | null,
  kind: keyof GraphHoverFocus,
  id: string,
) {
  return !focus || focus[kind].has(id) ? 1 : 0.25;
}
