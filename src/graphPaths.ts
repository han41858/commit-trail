import type { Branch, Commit } from './model';

export type GraphPaths = {
  nodes: Map<string, string>;
  edges: Map<string, string>;
  branches: Map<string, string>;
  heads: Map<string, string>;
  reference?: string;
};

// `ordered` is a canonical, child-before-parent ordering, independent of render lanes.
// A path owns its first-parent continuation up to the first already claimed join.
export function graphPaths(ordered: Commit[], branches: Branch[], baseHead?: string): GraphPaths {
  const commits = new Map(ordered.map((commit) => [commit.sha, commit]));
  const ranks = new Map(ordered.map((commit, rank) => [commit.sha, rank]));
  const nodes = new Map<string, string>();
  const heads = new Map<string, string>();
  const claim = (head: string) => {
    let sha: string | undefined = head;
    while (sha && !nodes.has(sha)) {
      nodes.set(sha, head);
      heads.set(head, head);
      sha = commits.get(sha)?.parents[0]?.sha;
    }
  };
  if (baseHead && commits.has(baseHead)) claim(baseHead);
  const refs = [...branches].sort(
    (a, b) =>
      (ranks.get(a.commit.sha) ?? Infinity) - (ranks.get(b.commit.sha) ?? Infinity) ||
      compare(a.commit.sha, b.commit.sha) ||
      compare(a.name, b.name),
  );
  // Claim heads in topology order, including unnamed incoming paths, before
  // looking up refs. An interior ref must not split a deleted branch either.
  for (const commit of ordered) claim(commit.sha);
  const edges = new Map<string, string>();
  for (const commit of ordered)
    for (const [position, parent] of commit.parents.entries()) {
      if (!nodes.has(parent.sha)) claim(parent.sha);
      edges.set(
        `${commit.sha}:${parent.sha}`,
        nodes.get(position === 0 ? commit.sha : parent.sha)!,
      );
    }
  return {
    nodes,
    edges,
    branches: new Map(
      refs
        .filter((ref) => commits.has(ref.commit.sha))
        .map((ref) => [ref.name, nodes.get(ref.commit.sha)!]),
    ),
    heads,
    reference: baseHead ? nodes.get(baseHead) : undefined,
  };
}

export function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
