import { layout, type Branch, type Commit } from './model';
import { compare, graphPaths, type GraphPaths } from './graphPaths';
import { GRAPH_COLOR_COUNT } from './graphPalette';

export type GraphColors = {
  nodes: Map<string, number>;
  branches: Map<string, number>;
  edges: Map<string, number>;
  paths: GraphPaths;
  assignments: Map<string, number>;
};

function preferredColor(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++)
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return 1 + ((hash >>> 0) % (GRAPH_COLOR_COUNT - 1));
}

// Use a fresh canonical layout for adjacency, never the renderer's retained lanes.
// The same snapshot therefore gives the same allocation in an older tab and a new browser.
export function graphColors(
  commits: Commit[],
  branches: Branch[],
  base: string,
  baseHead = branches.find((ref) => ref.name === base)?.commit.sha,
  defaultBranch?: string,
): GraphColors {
  const canonical = layout(
    [...commits].sort((a, b) => compare(a.sha, b.sha)),
    new Map(),
    baseHead,
  );
  const paths = graphPaths(canonical.ordered, branches, baseHead, defaultBranch);
  const neighbors = pathNeighbors(canonical.ordered, canonical.lanes, paths);
  const names = new Map<string, string>();
  for (const ref of [...branches].sort((a, b) => compare(a.name, b.name))) {
    const owner = paths.branches.get(ref.name);
    // A ref in the middle of a path is an alias, not a new path or color seed.
    if (owner === ref.commit.sha && !names.has(owner)) names.set(owner, ref.name);
  }
  const assignments = new Map<string, number>();
  const starts = new Map<string, string>();
  for (const commit of canonical.ordered) starts.set(paths.nodes.get(commit.sha)!, commit.sha);
  const priority = [...paths.heads.keys()].sort(
    (a, b) =>
      Number(b === paths.reference) - Number(a === paths.reference) ||
      compare(starts.get(a) ?? a, starts.get(b) ?? b) ||
      compare(a, b),
  );
  for (const owner of priority) {
    const preferred = owner === paths.reference ? 0 : preferredColor(names.get(owner) ?? owner);
    const candidates =
      preferred === 0
        ? [0]
        : [
            ...Array.from(
              { length: GRAPH_COLOR_COUNT - 1 },
              (_, offset) => 1 + ((preferred - 1 + offset) % (GRAPH_COLOR_COUNT - 1)),
            ),
            0,
          ];
    const conflicts = new Map<number, number>();
    for (const neighbor of neighbors.get(owner) ?? []) {
      const color = assignments.get(neighbor);
      if (color !== undefined) conflicts.set(color, (conflicts.get(color) ?? 0) + 1);
    }
    // Never recolor an earlier path. With more than eight neighbors, reuse the
    // least-conflicting candidate; a finite palette cannot guarantee uniqueness.
    let color = candidates[0];
    for (const candidate of candidates)
      if ((conflicts.get(candidate) ?? 0) < (conflicts.get(color) ?? 0)) color = candidate;
    assignments.set(owner, color);
  }
  const colors = (owners: ReadonlyMap<string, string>) =>
    new Map([...owners].map(([key, owner]) => [key, assignments.get(owner)!]));
  return {
    nodes: colors(paths.nodes),
    branches: colors(paths.branches),
    edges: colors(paths.edges),
    paths,
    assignments,
  };
}

// Include joins and neighboring concurrently occupied canonical lanes. Each
// edge reserves its owning lane; real fork/merge endpoints connect both paths.
function pathNeighbors(ordered: Commit[], lanes: ReadonlyMap<string, number>, paths: GraphPaths) {
  const neighbors = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    if (a === b) return;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const list = neighbors.get(from) ?? new Set<string>();
      list.add(to);
      neighbors.set(from, list);
    }
  };
  const ranks = new Map(ordered.map((commit, rank) => [commit.sha, rank]));
  type Event = { lane: number; owner: string; delta: number };
  const events = new Map<number, Event[]>();
  const event = (rank: number, lane: number, owner: string, delta: number) => {
    const list = events.get(rank) ?? [];
    list.push({ lane, owner, delta });
    events.set(rank, list);
  };
  const span = (first: number, last: number, lane: number, owner: string) => {
    event(first, lane, owner, 1);
    event(last + 1, lane, owner, -1);
  };
  for (const [rank, commit] of ordered.entries()) {
    const owner = paths.nodes.get(commit.sha)!;
    const lane = lanes.get(commit.sha)!;
    span(rank, rank, lane, owner);
    for (const parent of commit.parents) {
      const parentOwner = paths.nodes.get(parent.sha)!;
      const edgeOwner = paths.edges.get(`${commit.sha}:${parent.sha}`)!;
      connect(owner, parentOwner);
      const end = ranks.get(parent.sha) ?? rank;
      const parentLane = lanes.get(parent.sha);
      const edgeLane = edgeOwner === owner ? lane : (parentLane ?? lane);
      span(rank, end, edgeLane, edgeOwner);
    }
  }
  const active = new Map<number, Map<string, number>>();
  const occupied: number[] = [];
  const occupants = new Map<number, string[]>();
  const position = (lane: number) => {
    let low = 0;
    let high = occupied.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (occupied[middle] < lane) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  for (const rank of [...events.keys()].sort((a, b) => a - b)) {
    const changed = new Map<number, Set<string>>();
    for (const { lane, owner, delta } of events.get(rank)!) {
      const counts = active.get(lane) ?? new Map<string, number>();
      const count = (counts.get(owner) ?? 0) + delta;
      if (count) counts.set(owner, count);
      else counts.delete(owner);
      active.set(lane, counts);
      const owners = changed.get(lane) ?? new Set<string>();
      owners.add(owner);
      changed.set(lane, owners);
    }
    for (const [lane, changedOwners] of changed) {
      const owners = occupants.get(lane) ?? [];
      const counts = active.get(lane)!;
      for (const owner of changedOwners) {
        let low = 0;
        let high = owners.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (compare(owners[middle], owner) < 0) low = middle + 1;
          else high = middle;
        }
        if (counts.has(owner) && owners[low] !== owner) owners.splice(low, 0, owner);
        else if (!counts.has(owner) && owners[low] === owner) owners.splice(low, 1);
        if (low > 0 && low < owners.length) connect(owners[low - 1], owners[low]);
        if (low + 1 < owners.length) connect(owners[low], owners[low + 1]);
      }
      occupants.set(lane, owners);
      const index = position(lane);
      if (owners.length && occupied[index] !== lane) occupied.splice(index, 0, lane);
      else if (!owners.length && occupied[index] === lane) occupied.splice(index, 1);
    }
    const pairs = new Set<number>();
    for (const lane of changed.keys()) {
      const index = position(lane);
      if (index > 0 && index < occupied.length) pairs.add(index - 1);
      if (index < occupied.length - 1) pairs.add(index);
    }
    for (const index of pairs) {
      const left = occupants.get(occupied[index])!;
      const right = occupants.get(occupied[index + 1])!;
      // Usually each lane has one owner; coincident endpoints use stable local
      // neighbors rather than demanding infinitely many distinct colors.
      connect(left[0], right[0]);
      connect(left.at(-1)!, right.at(-1)!);
    }
  }
  return neighbors;
}
