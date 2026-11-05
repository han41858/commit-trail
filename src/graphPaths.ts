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
export function graphPaths(
  ordered: Commit[],
  branches: Branch[],
  baseHead?: string,
  defaultBranch?: string,
): GraphPaths {
  const commits = new Map(ordered.map((commit) => [commit.sha, commit]));
  const firstParentChildren = new Map<string, number>();
  for (const commit of ordered) {
    const parent = commit.parents[0]?.sha;
    if (parent) firstParentChildren.set(parent, (firstParentChildren.get(parent) ?? 0) + 1);
  }
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
  const refs = [...branches].sort((a, b) => compare(a.name, b.name));
  const defaultHead = refs.find((ref) => ref.name === defaultBranch)?.commit.sha;
  if (defaultHead && commits.has(defaultHead) && !firstParentChildren.has(defaultHead))
    claim(defaultHead);
  const protectedHistory = new Set(nodes.keys());
  let protectedHead = defaultHead;
  while (protectedHead && commits.has(protectedHead) && !protectedHistory.has(protectedHead)) {
    protectedHistory.add(protectedHead);
    protectedHead = commits.get(protectedHead)?.parents[0]?.sha;
  }
  const firstParentAncestor = firstParentAncestry(ordered, commits);
  const tips = new Map<string, boolean>();
  for (const ref of refs) {
    const head = ref.commit.sha;
    if (!commits.has(head) || firstParentChildren.has(head) || nodes.has(head) || tips.has(head))
      continue;
    let integration = false;
    let sha = head;
    while (true) {
      const commit = commits.get(sha)!;
      if (
        commit.parents
          .slice(1)
          .some(
            (parent) =>
              commits.has(parent.sha) &&
              !protectedHistory.has(parent.sha) &&
              !firstParentAncestor(parent.sha, sha),
          )
      )
        integration = true;
      const parent = commit.parents[0]?.sha;
      // Shared inherited merges cannot prove which outgoing branch integrates
      // work. Use only this tip's exclusive stem, not history before its fork.
      if (
        !parent ||
        !commits.has(parent) ||
        nodes.has(parent) ||
        firstParentChildren.get(parent) !== 1
      )
        break;
      sha = parent;
    }
    tips.set(head, integration);
  }
  for (const [head] of [...tips].sort(([a, x], [b, y]) => Number(y) - Number(x) || compare(a, b)))
    claim(head);
  // Only actual first-parent tips may claim before unnamed history. Interior
  // refs, including refs inside deleted paths, remain aliases of their owner.
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

// DFS intervals answer first-parent ancestry in O(1), without repeatedly
// walking the shared history for each candidate merge or terminal reference.
function firstParentAncestry(ordered: Commit[], commits: ReadonlyMap<string, Commit>) {
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const commit of ordered) {
    const parent = commit.parents[0]?.sha;
    if (!parent || !commits.has(parent)) roots.push(commit.sha);
    else {
      const list = children.get(parent) ?? [];
      list.push(commit.sha);
      children.set(parent, list);
    }
  }
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  let clock = 0;
  for (const root of roots) {
    const pending: { sha: string; exit: boolean }[] = [{ sha: root, exit: false }];
    while (pending.length) {
      const { sha, exit } = pending.pop()!;
      if (exit) {
        ends.set(sha, clock);
        continue;
      }
      starts.set(sha, clock++);
      pending.push({ sha, exit: true });
      for (const child of children.get(sha) ?? []) pending.push({ sha: child, exit: false });
    }
  }
  return (ancestor: string, descendant: string) =>
    starts.get(ancestor)! <= starts.get(descendant)! &&
    starts.get(descendant)! < ends.get(ancestor)!;
}
