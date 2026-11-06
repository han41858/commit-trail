import { ROW, type Commit } from './model';
import type { CommitInfo } from './CommitInfo';
import type { GraphColors } from './graphColors';
import type { GraphHoverFocus } from './graphHover';
import { GRAPH_COLOR_COUNT } from './graphPalette';
import { emojify } from './emoji';
import {
  visibleBranchLabels,
  type BranchLabelObstacle,
  type BranchTrack,
  type Point,
} from './branchLabels';
import { branchLabelText, commitVersionIcons, type visibleGraphEdges } from './graphView';
import type { MonthMarker } from './monthMarkers';

export type BranchBadge = Point & {
  width: number;
  height: number;
  text: string;
  name: string;
};

type GraphCanvasEdge = ReturnType<typeof visibleGraphEdges>[number] & {
  path: Path2D;
};

type GraphCanvasFrame = {
  dpr: number;
  width: number;
  view: { top: number; width: number; height: number };
  padding: number;
  ordered: readonly Commit[];
  positions: ReadonlyMap<string, Point>;
  months: readonly MonthMarker[];
  edges: readonly GraphCanvasEdge[];
  tones: GraphColors;
  tracks: BranchTrack[];
  selected: string;
  info?: ReadonlyMap<string, CommitInfo>;
  theme: string;
  narrow: boolean;
  showMessages: boolean;
  messageX: number;
  messageWidth: number;
  branchWidth: number;
  badgeHeight: number;
  badgeGap: number;
  displayNames: ReadonlyMap<string, string>;
};

// Draw one frame and return the exact painted bounds used by pointer hit testing.
// React keeps selection, animation scheduling and request lifetimes in Graph.
export function drawGraphCanvas(
  ctx: CanvasRenderingContext2D,
  container: HTMLElement,
  frame: GraphCanvasFrame,
  alpha: (kind: keyof GraphHoverFocus, id: string) => number,
  measure: boolean,
) {
  const {
    dpr,
    width,
    view,
    padding,
    ordered,
    positions,
    months,
    edges,
    tones,
    tracks,
    selected,
    info,
    theme,
    narrow,
    showMessages,
    messageX,
    messageWidth,
    branchWidth,
    badgeHeight,
    badgeGap,
    displayNames,
  } = frame;
  let drawn = 0,
    visible = 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, view.height);
  ctx.translate(0, -view.top);
  const style = getComputedStyle(container);
  const text = style.getPropertyValue('--text'),
    surface = style.getPropertyValue('--surface');
  const colors = Array.from({ length: GRAPH_COLOR_COUNT }, (_, i) =>
    style.getPropertyValue(`--graph-${i}`).trim(),
  );
  const left = container.scrollLeft,
    right = left + view.width - 16;
  const fitMessage = (value: string) => {
    if (ctx.measureText(value).width <= messageWidth) return value;
    const letters = Array.from(value);
    let low = 0,
      high = letters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (ctx.measureText(letters.slice(0, middle).join('') + '…').width <= messageWidth)
        low = middle;
      else high = middle - 1;
    }
    return letters.slice(0, low).join('') + '…';
  };
  ctx.save();
  ctx.font = '11px system-ui';
  ctx.textBaseline = 'bottom';
  for (const marker of months) {
    const p = positions.get(marker.sha);
    if (!p) continue;
    const y = p.y;
    if (y < view.top || y > view.top + view.height) continue;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = style.getPropertyValue('--month-line');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y + 0.5);
    ctx.lineTo(left + view.width, y + 0.5);
    ctx.stroke();
    const labelWidth = ctx.measureText(marker.label).width;
    ctx.globalAlpha = 1;
    ctx.fillStyle = style.getPropertyValue('--bg');
    ctx.fillRect(right - labelWidth - 5, y - 18, labelWidth + 10, 15);
    ctx.fillStyle = style.getPropertyValue('--muted');
    ctx.fillText(marker.label, right - labelWidth, y - 4);
  }
  ctx.restore();
  for (const edge of edges) {
    ctx.globalAlpha = (edge.primary ? 0.95 : 0.65) * alpha('edges', edge.id);
    ctx.strokeStyle = colors[(tones.edges.get(edge.id) || 0) % colors.length];
    ctx.lineWidth = edge.primary ? 2.5 : 1.6;
    ctx.setLineDash(edge.dashed ? [4, 4] : []);
    ctx.stroke(edge.path);
  }
  ctx.setLineDash([]);
  const labelObstacles: BranchLabelObstacle[] = [],
    messageWidths = new Map<string, number>();
  for (const c of ordered) {
    const p = positions.get(c.sha)!;
    if (p.y < view.top - ROW || p.y > view.top + view.height + ROW) continue;
    // Reserve the largest selected Actions ring, including its stroke, in advance.
    labelObstacles.push({ ...p, radius: 12 });
    if (measure) {
      drawn++;
      if (
        p.x >= left &&
        p.x <= left + view.width &&
        p.y >= view.top + Math.max(0, padding - 20) &&
        p.y <= view.top + view.height - 48
      )
        visible++;
    }
    const opacity = alpha('nodes', c.sha);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = colors[(tones.nodes.get(c.sha) || 0) % colors.length];
    ctx.beginPath();
    ctx.arc(p.x, p.y, c.sha === selected ? 7 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    if (c.parents.length > 1) {
      ctx.strokeStyle = text;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const extra = info?.get(c.sha);
    if (extra?.actions) {
      const summary = extra.actions,
        radius = c.sha === selected ? 10.5 : 7.5;
      ctx.strokeStyle = style.getPropertyValue(`--action-${summary.state}`).trim();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.globalAlpha =
        opacity *
        (summary.state === 'running'
          ? 0.25
          : summary.state === 'queued' ||
              summary.state === 'cancelled' ||
              summary.state === 'skipped'
            ? 0.4
            : 1);
      ctx.stroke();
      ctx.globalAlpha = opacity;
      if (summary.state === 'running' && summary.ratio !== null) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * summary.ratio);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = opacity;
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    for (const icon of commitVersionIcons(info?.get(c.sha), p.x)) ctx.fillText(icon.text, icon.x, p.y + 4);
    ctx.textAlign = 'left';
    ctx.fillStyle = text;
    ctx.globalAlpha = alpha('nodes', c.sha);
    if (showMessages) {
      ctx.font = `${narrow ? 12 : 13}px system-ui`;
      const message = fitMessage(emojify(c.commit.message.split('\n')[0]));
      ctx.fillText(message, messageX, p.y + (narrow ? 4 : -3));
      messageWidths.set(c.sha, ctx.measureText(message).width);
    }
    if (!narrow) {
      ctx.globalAlpha = 0.5 * alpha('nodes', c.sha);
      ctx.font = '11px monospace';
      const meta = fitMessage(
        `${c.sha.slice(0, 7)}  ${c.commit.author?.name || 'Unknown author'}`,
      );
      ctx.fillText(meta, messageX, p.y + 9);
      messageWidths.set(
        c.sha,
        Math.max(messageWidths.get(c.sha) || 0, ctx.measureText(meta).width),
      );
    }
  }
  ctx.globalAlpha = 1;
  ctx.font = `${narrow ? 10 : 11}px system-ui`;
  const labelRight = left + (showMessages ? messageX : branchWidth),
    nodeClearance = 15,
    maxTextWidth =
      Math.min(narrow ? Math.min(116, view.width * 0.36) : 190, branchWidth - 16) - 12,
    cache = new Map<string, { text: string; width: number }>();
  const badge = (name: string, x: number) => {
    // Match the 12px selected-ring obstacle plus its 3px gap and 8px left inset.
    const available =
        Math.max(x - left - 8 - nodeClearance, labelRight - x - nodeClearance) - 12,
      limitWidth = Math.min(maxTextWidth, available),
      key = `${name}\0${limitWidth}`,
      old = cache.get(key);
    if (old) return old;
    let text = '…';
    for (let limit = narrow ? 18 : 28; limit >= 1; limit--) {
      text = branchLabelText(name, displayNames, limit);
      if (ctx.measureText(text).width <= limitWidth) break;
    }
    const value = { text, width: ctx.measureText(text).width + 12 };
    cache.set(key, value);
    return value;
  };
  const hits: BranchBadge[] = [];
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, view.top + padding - 20, view.width, Math.max(0, view.height - padding - 28));
  ctx.clip();
  for (const label of visibleBranchLabels(
    tracks,
    view.top + padding - 20,
    view.top + view.height - 48,
    left,
    labelRight + 8,
    (names, point) => Math.max(...names.map((name) => badge(name, point.x).width)),
    badgeHeight,
    badgeGap,
    labelObstacles,
  )) {
    const x = label.boxX!,
      y = label.boxY!;
    const color = colors[(label.color ?? label.lane) % colors.length];
    if (label.names.length > 1) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4 * Math.max(...label.names.map((name) => alpha('branches', name)));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 3, y + badgeHeight / 2);
      ctx.lineTo(x - 3, y + label.boxHeight! - badgeHeight / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    label.names.forEach((ref, index) => {
      const { text: name, width: boxWidth } = badge(ref, label.x),
        rowY = y + index * (badgeHeight + badgeGap),
        opacity = alpha('branches', ref);
      ctx.globalAlpha = 0.35 * opacity;
      ctx.fillStyle = surface;
      ctx.beginPath();
      ctx.roundRect(x, rowY, boxWidth, badgeHeight, 4);
      ctx.fill();
      ctx.globalAlpha = (theme === 'light' ? 0.06 : 0.08) * opacity;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.fillText(name, x + 6, rowY + (narrow ? 12 : 14));
      const hitTop = Math.max(rowY, view.top + padding - 20),
        hitBottom = Math.min(rowY + badgeHeight, view.top + view.height - 48);
      if (hitBottom > hitTop)
        hits.push({
          x,
          y: hitTop,
          width: boxWidth,
          height: hitBottom - hitTop,
          text: name,
          name: ref,
        });
    });
  }
  ctx.restore();
  return { badges: hits, messages: messageWidths, drawn, visible };
}
