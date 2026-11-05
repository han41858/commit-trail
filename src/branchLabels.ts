import { ROW, type Branch, type Commit } from './model';
import type { GraphColors } from './graphColors';
export type Point = { x: number; y: number };
export type BranchTrack = {
  name: string;
  lane: number;
  color?: number;
  points: Point[];
  connections?: Point[][];
  commitShas?: string[];
};
export type BranchLabel = Point & {
  names: string[];
  lane: number;
  color?: number;
  boxX?: number;
  boxY?: number;
  boxHeight?: number;
};
export type BranchLabelObstacle = Point & { radius: number };

export function branchTracks(
  commits: Commit[],
  branches: Branch[],
  base: string,
  spine: Set<string>,
  positions: Map<string, Point>,
  reverse: boolean,
  colors?: GraphColors,
  lanes?: ReadonlyMap<string, number>,
): BranchTrack[] {
  const map = new Map(commits.map((c) => [c.sha, c]));
  const tracks: BranchTrack[] = [];
  const incoming = new Map<string, Commit[]>();
  for (const c of commits)
    for (const parent of c.parents.slice(1)) {
      const list = incoming.get(parent.sha) || [];
      list.push(c);
      incoming.set(parent.sha, list);
    }
  for (const ref of [...branches].sort(
    (a, b) => Number(b.name === base) - Number(a.name === base) || a.name.localeCompare(b.name),
  )) {
    const head = positions.get(ref.commit.sha);
    if (!head) continue;
    const color = colors?.branches.get(ref.name) ?? colors?.nodes.get(ref.commit.sha);
    const owner = colors?.paths.branches.get(ref.name);
    const sharesBase = spine.has(ref.commit.sha);
    const points: Point[] = [],
      connections: Point[][] = [],
      commitShas: string[] = [];
    const seen = new Set<string>();
    let sha: string | undefined = ref.commit.sha;
    while (sha && !seen.has(sha)) {
      seen.add(sha);
      const point = positions.get(sha);
      if (!point) break;
      points.push(point);
      commitShas.push(sha);
      const joined =
        owner !== undefined
          ? colors!.paths.nodes.get(sha) !== owner
          : ref.name !== base && !sharesBase && spine.has(sha);
      if (joined) break;
      for (const child of incoming.get(sha) || []) {
        const from = positions.get(child.sha);
        if (from) {
          connections.push([from, point]);
          commitShas.push(child.sha);
        }
      }
      const parent: string | undefined = map.get(sha)?.parents[0]?.sha;
      if (parent && !positions.has(parent)) {
        points.push({ x: point.x, y: point.y + (reverse ? -ROW / 2 : ROW / 2) });
        break;
      }
      sha = parent;
    }
    tracks.push({
      name: ref.name,
      lane: lanes?.get(ref.commit.sha) ?? Math.max(0, Math.round((head.x - 48) / 34)),
      color,
      points,
      connections,
      commitShas,
    });
  }
  return tracks;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const horizontal = (t: number) => 3 * t * t - 2 * t * t * t;
const vertical = (t: number) => 1.5 * t - 1.5 * t * t + t * t * t;
function inverse(value: number, curve: (t: number) => number) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  let low = 0,
    high = 1;
  for (let i = 0; i < 22; i++) {
    const t = (low + high) / 2;
    if (curve(t) < value) low = t;
    else high = t;
  }
  return (low + high) / 2;
}
function anchor(
  points: Point[],
  target: number,
  top: number,
  bottom: number,
  left: number,
  right: number,
): Point | undefined {
  if (points.length === 1) {
    const p = points[0];
    return p.x >= left && p.x <= right && p.y >= top && p.y <= bottom ? p : undefined;
  }
  if (points.length < 2) return;
  const direction = points.at(-1)!.y >= points[0].y ? 1 : -1;
  const lower = direction > 0 ? top : -bottom,
    upper = direction > 0 ? bottom : -top;
  // Skip segments above the viewport, even for very long branch histories.
  let low = 0,
    high = points.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (points[mid].y * direction < lower) low = mid + 1;
    else high = mid;
  }
  let best: Point | undefined,
    distance = Infinity;
  for (let i = Math.max(0, low - 1); i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    if (a.y * direction > upper) break;
    let start = 0,
      end = 1,
      visible = true;
    for (const [from, to, min, max, curve] of [
      [a.x, b.x, left, right, horizontal],
      [a.y, b.y, top, bottom, vertical],
    ] as const) {
      if (from === to) {
        if (from < min || from > max) visible = false;
        continue;
      }
      const first = (min - from) / (to - from),
        last = (max - from) / (to - from);
      const lo = Math.min(first, last),
        hi = Math.max(first, last);
      if (hi < 0 || lo > 1) {
        visible = false;
        break;
      }
      start = Math.max(start, inverse(clamp(lo), curve));
      end = Math.min(end, inverse(clamp(hi), curve));
    }
    if (!visible || start > end) continue;
    const fraction = clamp((target - a.y) / (b.y - a.y)),
      requested = inverse(fraction, vertical);
    const t = Math.max(start, Math.min(end, requested));
    const actualY =
      t === requested && fraction > 0 && fraction < 1 ? target : a.y + (b.y - a.y) * vertical(t);
    const p = {
      x: Math.max(left, Math.min(right, a.x + (b.x - a.x) * horizontal(t))),
      y: Math.max(top, Math.min(bottom, actualY)),
    };
    const delta = Math.abs(p.y - target);
    if (delta < distance) {
      best = p;
      distance = delta;
    }
    if (delta < 0.001) break;
  }
  return best;
}
function sharedHeadTracks(tracks: BranchTrack[]) {
  const groups = new Map<string, { track: BranchTrack; names: string[] }>();
  for (const track of tracks) {
    const head = track.points[0];
    if (!head) continue;
    const key = `${head.x}:${head.y}`,
      group = groups.get(key);
    if (group) {
      if (!group.names.includes(track.name)) group.names.push(track.name);
    } else groups.set(key, { track, names: [track.name] });
  }
  return [...groups.values()];
}
export function branchLabelContentBottom(tracks: BranchTrack[], height: number, gap = 2) {
  return sharedHeadTracks(tracks).reduce(
    (bottom, { track, names }) =>
      Math.max(bottom, track.points[0].y - height / 2 + names.length * (height + gap) - gap),
    0,
  );
}
export function visibleBranchLabels(
  tracks: BranchTrack[],
  top: number,
  bottom: number,
  left = -Infinity,
  right = Infinity,
  measure = (names: string[], _point: Point) =>
    Math.min(34, Math.max(...names.map((name) => name.length))) * 6.5 + 16,
  height = 22,
  gap = 2,
  obstacles: readonly BranchLabelObstacle[] = [],
): BranchLabel[] {
  if (top > bottom || left > right) return [];
  const labels: BranchLabel[] = [],
    rects: { x: number; y: number; width: number; height: number }[] = [];
  const nodes = obstacles.map((point) => ({
    x: point.x - point.radius - 3,
    y: point.y - point.radius - 3,
    width: (point.radius + 3) * 2,
    height: (point.radius + 3) * 2,
  }));
  const labelBarriers = () =>
    rects.map((rect) => ({
      x: rect.x - 4,
      y: rect.y - gap,
      width: rect.width + 8,
      height: rect.height + gap * 2,
    }));
  const barriers = () => [...nodes, ...labelBarriers()];
  const intersects = (a: (typeof rects)[number], b: (typeof rects)[number]) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  // Prefer clear space farther right before the left side or another path anchor.
  const beside = (rect: (typeof rects)[number], candidates = nodes, blockers = barriers()) => {
    const nearby = blockers.filter(
      (other) => rect.y < other.y + other.height && rect.y + rect.height > other.y,
    );
    const xs = [
      rect.x,
      ...candidates
        .filter((other) => rect.y < other.y + other.height && rect.y + rect.height > other.y)
        .flatMap((other) => [other.x + other.width, other.x - rect.width]),
    ].sort(
      (a, b) =>
        Number(a < rect.x) - Number(b < rect.x) ||
        Math.abs(a - rect.x) - Math.abs(b - rect.x) ||
        b - a,
    );
    const x = xs.find(
      (x) =>
        x >= left + 8 &&
        x + rect.width <= right - 8 &&
        !nearby.some((other) => intersects({ ...rect, x }, other)),
    );
    return x === undefined ? undefined : { ...rect, x };
  };
  // Keep the caller's leading/base group first, then reserve scarce space for
  // wider side badges before short names that can still fit on either side.
  const groups = sharedHeadTracks(tracks),
    first = groups[0];
  groups.sort(
    (a, b) =>
      Number(b === first) - Number(a === first) ||
      measure(b.names, b.track.points[0]) - measure(a.names, a.track.points[0]) ||
      b.names.length - a.names.length,
  );
  for (const { track, names } of groups) {
    const stackHeight = names.length * (height + gap) - gap;
    const box = (point: Point) => {
      const width = measure(names, point),
        x =
          point.x + 12 + width <= right - 8
            ? point.x + 12
            : point.x - width - 12 >= left + 8
              ? point.x - width - 12
              : Math.max(left + 8, Math.min(point.x + 12, right - width - 8));
      return {
        x,
        y: Math.max(top + 6, Math.min(point.y - height / 2, bottom - stackHeight)),
        width,
        height: stackHeight,
      };
    };
    const place = (label: BranchLabel) => {
      labels.push(label);
      rects.push({
        x: label.boxX!,
        y: label.boxY!,
        width: measure(names, label),
        height: stackHeight,
      });
    };
    // Oversized stacks stay tied to their head so scrolling reveals every name.
    // Graph reserves their natural extent without moving any commit or lane.
    if (stackHeight > bottom - top - 6) {
      const head = track.points[0],
        y = head.y - height / 2;
      if (head.x < left || head.x > right || y > bottom || y + stackHeight < top) continue;
      const rect = box(head),
        position = beside({ ...rect, y }) || rect;
      place({
        ...head,
        names,
        lane: track.lane,
        color: track.color,
        boxX: position.x,
        boxY: y,
        boxHeight: stackHeight,
      });
      continue;
    }
    let fallback: BranchLabel | undefined,
      placed = false;
    for (let row = 0; row <= Math.ceil((bottom - top) / (height + gap + 2)); row++) {
      const target = top + (track.lane % 4) * (height + gap) + row * (height + gap + 2);
      let point: Point | undefined,
        distance = Infinity;
      for (const path of [track.points, ...(track.connections || [])]) {
        const candidate = anchor(path, target, top, bottom, left, right);
        if (!candidate) continue;
        const delta = Math.abs(candidate.y - target);
        if (delta < distance) {
          point = candidate;
          distance = delta;
        }
      }
      if (!point) break;
      const label: BranchLabel = {
          ...point,
          names,
          lane: track.lane,
          color: track.color,
          boxHeight: stackHeight,
        },
        rect = box(point),
        position = beside(rect);
      label.boxX = position?.x ?? rect.x;
      label.boxY = rect.y;
      fallback ??= label;
      if (!position) continue;
      place(label);
      placed = true;
      break;
    }
    // Keep short-path fallbacks nearby so a badge cannot name an unrelated older row.
    if (!placed && fallback) {
      const width = measure(names, fallback);
      const ys = [
        top + 6,
        ...barriers().flatMap((rect) => [rect.y + rect.height, rect.y - stackHeight]),
      ]
        .filter(
          (y) => y >= top + 6 && y + stackHeight <= bottom && Math.abs(y - fallback!.boxY!) <= ROW,
        )
        .sort((a, b) => Math.abs(a - fallback!.boxY!) - Math.abs(b - fallback!.boxY!));
      let position: (typeof rects)[number] | undefined;
      // Preserve existing node-clear placement first, then consider badge edges.
      // If no nearby position clears nodes, still keep branch names separate.
      for (const blockers of [undefined, barriers(), labelBarriers()]) {
        for (const y of ys) {
          const rect = { x: fallback.boxX!, y, width, height: stackHeight };
          position = blockers ? beside(rect, blockers, blockers) : beside(rect);
          if (position) break;
        }
        if (position) break;
      }
      if (position) {
        fallback.boxX = position.x;
        fallback.boxY = position.y;
      }
      place(fallback);
    }
  }
  return labels;
}
