type Bounds = { left: number; right: number; top: number; bottom: number };
export function monitorDetailsFrame(
  anchor: { left: number; width: number },
  bounds: Bounds,
  noticeTop = bounds.bottom,
) {
  const availableWidth = Math.max(0, bounds.right - bounds.left),
    originalHeight = Math.max(0, bounds.bottom - bounds.top),
    bottom = Math.min(bounds.bottom, noticeTop),
    rise = Math.max(0, bounds.bottom - bottom),
    availableHeight = Math.max(0, bottom - bounds.top);
  const gapX = Math.min(8, availableWidth / 2),
    gapY = Math.min(8, availableHeight / 2),
    width = Math.min(480, availableWidth - gapX * 2);
  const left = Math.max(
    bounds.left + gapX,
    Math.min(
      anchor.left + anchor.width / 2 - width / 2,
      bounds.right - gapX - width,
    ),
  );
  return {
    left,
    width,
    bottom: bounds.top + availableHeight - gapY,
    maxHeight: Math.max(
      0,
      Math.min(originalHeight * 0.65 - rise, availableHeight - gapY * 2),
    ),
  };
}
