import type { Commit } from './model';
import type { BranchTrack } from './branchLabels';

export type GraphHoverTarget = { kind: 'branch' | 'commit' | 'edge'; id: string };
export type GraphHoverFocus = {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  branches: ReadonlySet<string>;
};
type HoverIndex = {
  commits: ReadonlyMap<string, Commit>;
  order: ReadonlyMap<string, number>;
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
  const order = new Map(ordered.map((commit, index) => [commit.sha, index]));
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
  const reference = baseHead ? owners.get(baseHead) : undefined;
  const ends = new Map<string, string[]>();
  for (const commit of ordered) {
    // First parents continue the destination; other parents bring work into it.
    for (const parent of commit.parents.slice(1)) {
      // A merge of an older work commit does not end a flow that has continued.
      // Importing the reference into work also does not end the reference flow.
      if (
        parent.sha === reference ||
        owners.get(parent.sha) !== parent.sha ||
        owners.get(commit.sha) === parent.sha
      )
        continue;
      const merges = ends.get(parent.sha) || [];
      merges.push(commit.sha);
      ends.set(parent.sha, merges);
    }
  }
  return { commits, order, heads, owners, ends, flows: new Map() };
}

function rememberFocus(key: string, focus: GraphHoverFocus, index: HoverIndex) {
  if (index.flows.size === 2) index.flows.delete(index.flows.keys().next().value!);
  index.flows.set(key, focus);
  return focus;
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
  return rememberFocus(head, focus, index);
}

function mergeFocus(child: string, parent: string, index: HoverIndex): GraphHoverFocus {
  const key = `edge:${child}:${parent}`;
  const cached = index.flows.get(key);
  if (cached) return cached;
  const path = [parent];
  const offsets = new Map([[parent, 0]]);
  const destination = index.commits.get(child)?.parents[0]?.sha;
  const pending = destination ? [destination] : [];
  const visited = new Set<string>();
  let boundary: number | undefined;

  // Compare first-parent trunks to find the branch's original fork. Earlier
  // promotions are secondary parents and must not shorten the incoming history.
  // Topological order lets us extend the incoming first-parent path lazily and
  // prune history older than the nearest common boundary found so far.
  while (pending.length) {
    const sha = pending.pop()!;
    const rank = index.order.get(sha);
    if (rank === undefined || visited.has(sha)) continue;
    if (boundary !== undefined && rank >= index.order.get(path[boundary])!) continue;
    visited.add(sha);
    while (index.order.get(path.at(-1)!)! < rank) {
      const last = path.at(-1)!;
      // Present-day refs may split this path, but cannot shorten a past merge.
      const next = index.commits.get(last)?.parents[0]?.sha;
      if (!next || !index.commits.has(next) || offsets.has(next)) break;
      offsets.set(next, path.length);
      path.push(next);
    }
    const common = offsets.get(sha);
    if (common !== undefined) {
      boundary = common;
      continue;
    }
    if (rank > index.order.get(path.at(-1)!)!) continue;
    const ancestor = index.commits.get(sha)!.parents[0];
    if (ancestor) pending.push(ancestor.sha);
  }
  if (boundary !== undefined) path.length = boundary + 1;
  else {
    while (true) {
      const next = index.commits.get(path.at(-1)!)?.parents[0]?.sha;
      if (!next || !index.commits.has(next) || offsets.has(next)) break;
      offsets.set(next, path.length);
      path.push(next);
    }
  }
  const nodes = new Set([child, ...path]);
  const edges = new Set([`${child}:${parent}`]);
  for (let i = 0; i < path.length - 1; i++) edges.add(`${path[i]}:${path[i + 1]}`);
  const last = path.at(-1)!;
  const missing = index.commits.get(last)?.parents[0]?.sha;
  if (boundary === undefined && missing && !index.commits.has(missing))
    edges.add(`${last}:${missing}`);
  const branches = new Set(
    [...index.heads].filter(([, sha]) => sha === parent).map(([name]) => name),
  );
  return rememberFocus(key, { nodes, edges, branches }, index);
}

export function graphHoverOwner(target: GraphHoverTarget | null, index: HoverIndex) {
  if (!target) return;
  let sha = target.kind === 'branch' ? index.heads.get(target.id) : target.id;
  if (target.kind === 'edge') {
    const [child, parent, extra] = target.id.split(':');
    if (!child || !parent || extra !== undefined) return;
    const commit = index.commits.get(child);
    const position = commit?.parents.findIndex((value) => value.sha === parent) ?? -1;
    if (position < 0) return;
    // Merge connectors describe that merge interval, not today's parent HEAD.
    if (position > 0) return index.owners.has(parent) ? `edge:${target.id}` : undefined;
    sha = child;
  }
  return sha ? index.owners.get(sha) : undefined;
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
  if (target?.kind === 'branch' && focus.branches.size > 1)
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
