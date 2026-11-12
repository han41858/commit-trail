import { ROW } from './model';
export function scrollPosition(
  before: readonly string[],
  after: readonly string[],
  top: number,
  height: number,
  padding: number,
  reverse: boolean,
  refresh: boolean,
) {
  if (!before.length) return top;
  const oldHeight = Math.max(height, before.length * ROW + padding + 80);
  const atLatest = reverse
    ? oldHeight - top - height <= ROW * 2
    : top <= ROW * 2;
  const latestChanged = reverse
    ? before.at(-1) !== after.at(-1)
    : before[0] !== after[0];
  // Independent branch responses can prepend newer commits outside a refresh.
  if (atLatest && latestChanged && (refresh || !reverse))
    return reverse
      ? Math.max(0, after.length * ROW + padding + 80 - height)
      : 0;
  return scrollAnchor(before, after, top, height, padding);
}
export function scrollAnchor(
  before: readonly string[],
  after: readonly string[],
  top: number,
  height: number,
  padding: number,
) {
  if (!before.length) return top;
  const row = Math.max(
      0,
      Math.min(before.length - 1, Math.floor((top - padding) / ROW)),
    ),
    indices = new Map(after.map((sha, index) => [sha, index]));
  for (let distance = 0; distance < before.length; distance++)
    for (const index of distance ? [row - distance, row + distance] : [row]) {
      if (index < 0 || index >= before.length) continue;
      const next = indices.get(before[index]);
      if (next !== undefined) return Math.max(0, top + (next - index) * ROW);
    }
  return Math.min(top, Math.max(0, after.length * ROW + padding + 80 - height));
}
