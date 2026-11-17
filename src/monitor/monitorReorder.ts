export type HeaderBounds = { left: number; right: number };

export function monitorDropTarget(
  bounds: readonly HeaderBounds[],
  x: number,
  from: number,
) {
  if (
    !bounds.length ||
    !Number.isFinite(x) ||
    !Number.isInteger(from) ||
    from < 0 ||
    from >= bounds.length
  )
    return;
  const edges = [
    bounds[0].left,
    ...bounds
      .slice(1)
      .map((value, index) => (bounds[index].right + value.left) / 2),
    bounds.at(-1)!.right,
  ];
  let boundary = 0;
  for (let index = 1; index < edges.length; index++)
    if (Math.abs(edges[index] - x) < Math.abs(edges[boundary] - x))
      boundary = index;
  return {
    boundary,
    left: edges[boundary],
    to: boundary > from ? boundary - 1 : boundary,
  };
}
