import type { Commit } from './model';
import type { BranchTrack } from './branchLabels';
import type { GraphPaths } from './graphPaths';

export type GraphHoverTarget = {
  kind: 'branch' | 'commit' | 'edge';
  id: string;
};
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

// Rendering, badge placement and focus share path ownership, never palette values.
export function graphHoverIndex(
  ordered: Commit[],
  tracks: readonly BranchTrack[],
  paths: GraphPaths,
): HoverIndex {
  const commits = new Map(ordered.map((commit) => [commit.sha, commit]));
  const heads = new Map<string, string>();
  for (const track of tracks) {
    const head = track.headSha;
    if (head && commits.has(head)) heads.set(track.name, head);
  }
  const owners = paths.nodes;
  const ends = new Map<string, string[]>();
  for (const commit of ordered)
    for (const parent of commit.parents.slice(1)) {
      const owner = owners.get(parent.sha);
      if (
        !owner ||
        owner === paths.reference ||
        paths.heads.get(owner) !== parent.sha ||
        owners.get(commit.sha) === owner
      )
        continue;
      const merges = ends.get(owner) ?? [];
      merges.push(commit.sha);
      ends.set(owner, merges);
    }
  return { commits, heads, owners, ends, flows: new Map() };
}

function rememberFocus(key: string, focus: GraphHoverFocus, index: HoverIndex) {
  if (index.flows.size === 2)
    index.flows.delete(index.flows.keys().next().value!);
  index.flows.set(key, focus);
  return focus;
}

function focusedBranches(
  owner: string | undefined,
  nodes: ReadonlySet<string>,
  index: HoverIndex,
) {
  const boundaryOwners = new Set<string>();
  // Only the existing start/end nodes identify neighboring paths. Their labels
  // may be at newer HEADs, but none of their other nodes or edges become focused.
  for (const sha of nodes) {
    const boundaryOwner = index.owners.get(sha);
    if (boundaryOwner && boundaryOwner !== owner)
      boundaryOwners.add(boundaryOwner);
  }
  return new Set(
    [...index.heads]
      .filter(([, sha]) => {
        const branchOwner = index.owners.get(sha);
        return branchOwner === owner
          ? nodes.has(sha)
          : !!branchOwner && boundaryOwners.has(branchOwner);
      })
      .map(([name]) => name),
  );
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
  const branches = focusedBranches(head, nodes, index);
  const focus = { nodes, edges, branches };
  // Keep two recent flows; moving among commits in one flow reuses one result.
  return rememberFocus(head, focus, index);
}

function mergeFocus(
  child: string,
  parent: string,
  index: HoverIndex,
): GraphHoverFocus {
  const key = `edge:${child}:${parent}`;
  const cached = index.flows.get(key);
  if (cached) return cached;
  const owner = index.owners.get(parent);
  const nodes = new Set([child]);
  const edges = new Set([`${child}:${parent}`]);
  let sha: string | undefined = parent;
  while (sha && index.commits.has(sha) && !nodes.has(sha)) {
    nodes.add(sha);
    // Include one differently owned fork node, then stop. A merge cap excludes
    // later commits in this same path, without searching destination ancestry.
    if (index.owners.get(sha) !== owner) break;
    const next: string | undefined = index.commits.get(sha)?.parents[0]?.sha;
    if (next) edges.add(`${sha}:${next}`);
    sha = next;
  }
  const branches = focusedBranches(owner, nodes, index);
  return rememberFocus(key, { nodes, edges, branches }, index);
}

export function graphHoverOwner(
  target: GraphHoverTarget | null,
  index: HoverIndex,
) {
  if (!target) return;
  let sha = target.kind === 'branch' ? index.heads.get(target.id) : target.id;
  if (target.kind === 'edge') {
    const [child, parent, extra] = target.id.split(':');
    if (!child || !parent || extra !== undefined) return;
    const commit = index.commits.get(child);
    const position =
      commit?.parents.findIndex((value) => value.sha === parent) ?? -1;
    if (position < 0) return;
    // A merge connector caps the incoming colored path at this historical SHA.
    if (position > 0)
      return index.commits.has(parent) ? `edge:${target.id}` : undefined;
    sha = child;
  }
  return sha && index.commits.has(sha) ? index.owners.get(sha) : undefined;
}

export function resolveGraphHover(
  target: GraphHoverTarget | null,
  index: HoverIndex,
): GraphHoverFocus | null {
  const owner = graphHoverOwner(target, index);
  if (!owner) return null;
  if (target?.kind === 'edge' && owner.startsWith('edge:')) {
    const [child, parent] = target.id.split(':');
    return mergeFocus(child, parent, index);
  }
  const focus = flowFocus(owner, index);
  if (target?.kind === 'branch') {
    const branches = new Set(
      [...focus.branches].filter(
        (name) =>
          name === target.id ||
          index.owners.get(index.heads.get(name)!) !== owner,
      ),
    );
    // Keep the cached result when only boundary names accompany this badge.
    if (branches.size !== focus.branches.size) return { ...focus, branches };
  }
  return focus;
}

export function graphHoverAlpha(
  focus: GraphHoverFocus | null,
  kind: keyof GraphHoverFocus,
  id: string,
) {
  return !focus || focus[kind].has(id) ? 1 : 0.25;
}
