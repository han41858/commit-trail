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
  paths: ReadonlyMap<string, GraphHoverFocus>;
  history: Commit[];
  tracks: readonly BranchTrack[];
  commitFocus: Map<string, GraphHoverFocus>;
};

// Membership comes from the existing visual traversal's real SHA edges, never
// from a lane number, a coordinate or a palette color shared by unrelated paths.
export function graphHoverIndex(commits: Commit[], tracks: readonly BranchTrack[]): HoverIndex {
  const loaded = new Set(commits.map((commit) => commit.sha));
  const realEdges = new Set(
    commits.flatMap((commit) => commit.parents.map((parent) => `${commit.sha}:${parent.sha}`)),
  );
  const paths = new Map<string, GraphHoverFocus>();
  for (const track of tracks) {
    const nodes = new Set((track.commitShas || []).filter((sha) => loaded.has(sha)));
    if (!nodes.size) continue;
    paths.set(track.name, {
      nodes,
      edges: new Set((track.edgeKeys || []).filter((key) => realEdges.has(key))),
      branches: new Set([track.name]),
    });
  }
  return { commits: loaded, paths, history: commits, tracks, commitFocus: new Map() };
}

export function resolveGraphHover(
  target: GraphHoverTarget | null,
  index: HoverIndex,
): GraphHoverFocus | null {
  if (!target) return null;
  if (target.kind === 'branch') return index.paths.get(target.id) || null;
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
  return !focus || focus[kind].has(id) ? 1 : 0.5;
}
