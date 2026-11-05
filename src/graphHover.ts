import { ancestors, type Commit } from './model';
import type { BranchTrack } from './branchLabels';

export type GraphHoverTarget = { kind: 'branch' | 'commit'; id: string };
export type GraphHoverFocus = {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  branches: ReadonlySet<string>;
};
type HoverIndex = {
  commits: ReadonlySet<string>;
  heads: ReadonlyMap<string, string>;
  history: Commit[];
  tracks: readonly BranchTrack[];
  commitFocus: Map<string, GraphHoverFocus>;
};

// Track metadata identifies branch HEADs; ancestry always comes from actual parents.
export function graphHoverIndex(commits: Commit[], tracks: readonly BranchTrack[]): HoverIndex {
  const loaded = new Set(commits.map((commit) => commit.sha));
  const heads = new Map<string, string>();
  for (const track of tracks) {
    const head = track.commitShas?.[0];
    if (head && loaded.has(head)) heads.set(track.name, head);
  }
  return { commits: loaded, heads, history: commits, tracks, commitFocus: new Map() };
}

export function resolveGraphHover(
  target: GraphHoverTarget | null,
  index: HoverIndex,
): GraphHoverFocus | null {
  if (!target) return null;
  if (target.kind === 'branch') {
    const head = index.heads.get(target.id);
    if (!head) return null;
    const focus = resolveGraphHover({ kind: 'commit', id: head }, index)!;
    const branches = new Set<string>();
    for (const [name, sha] of index.heads) {
      if (name === target.id || (sha !== head && focus.nodes.has(sha))) branches.add(name);
    }
    return { ...focus, branches };
  }
  if (!index.commits.has(target.id)) return null;
  const cached = index.commitFocus.get(target.id);
  if (cached) return cached;
  const focus = graphCommitFocus(target.id, index.history, index.tracks)!;
  // Keep only two recent results rather than accumulating every commit's ancestry.
  if (index.commitFocus.size === 2)
    index.commitFocus.delete(index.commitFocus.keys().next().value!);
  index.commitFocus.set(target.id, focus);
  return focus;
}

export function graphCommitFocus(
  sha: string,
  commits: Commit[],
  tracks: readonly BranchTrack[],
): GraphHoverFocus | null {
  if (!sha || !commits.some((commit) => commit.sha === sha)) return null;
  const history = ancestors(sha, commits);
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const commit of commits) {
    if (!history.has(commit.sha)) continue;
    nodes.add(commit.sha);
    for (const parent of commit.parents) edges.add(`${commit.sha}:${parent.sha}`);
  }
  const branches = new Set(
    tracks
      .filter((track) => {
        const path = track.commitShas;
        return path && (path.includes(sha) || history.has(path[0]));
      })
      .map((track) => track.name),
  );
  return { nodes, edges, branches };
}

export function graphHoverAlpha(
  focus: GraphHoverFocus | null,
  kind: keyof GraphHoverFocus,
  id: string,
) {
  return !focus || focus[kind].has(id) ? 1 : 0.25;
}
