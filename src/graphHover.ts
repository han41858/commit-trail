import type { Commit } from './model';
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
  owners: ReadonlyMap<string, string | null>;
};

// Membership comes from the existing visual traversal's real SHA edges, never
// from a lane number, a coordinate or a palette color shared by unrelated paths.
export function graphHoverIndex(
  commits: readonly Commit[],
  tracks: readonly BranchTrack[],
): HoverIndex {
  const loaded = new Set(commits.map((commit) => commit.sha));
  const realEdges = new Set(
    commits.flatMap((commit) => commit.parents.map((parent) => `${commit.sha}:${parent.sha}`)),
  );
  const paths = new Map<string, GraphHoverFocus>();
  const owners = new Map<string, string | null>();
  for (const track of tracks) {
    const nodes = new Set((track.commitShas || []).filter((sha) => loaded.has(sha)));
    if (!nodes.size) continue;
    paths.set(track.name, {
      nodes,
      edges: new Set((track.edgeKeys || []).filter((key) => realEdges.has(key))),
      branches: new Set([track.name]),
    });
    for (const sha of nodes) {
      const owner = owners.get(sha);
      owners.set(sha, owner === undefined || owner === track.name ? track.name : null);
    }
  }
  return { commits: loaded, paths, owners };
}

export function resolveGraphHover(
  target: GraphHoverTarget | null,
  index: HoverIndex,
): GraphHoverFocus | null {
  if (!target) return null;
  if (target.kind === 'branch') return index.paths.get(target.id) || null;
  if (!index.commits.has(target.id)) return null;
  const owner = index.owners.get(target.id);
  if (owner) return index.paths.get(owner) || null;
  // A shared or unclassified commit is safe to emphasize on its own.
  return { nodes: new Set([target.id]), edges: new Set(), branches: new Set() };
}

export function graphHoverAlpha(
  focus: GraphHoverFocus | null,
  kind: keyof GraphHoverFocus,
  id: string,
) {
  return !focus || focus[kind].has(id) ? 1 : 0.5;
}
