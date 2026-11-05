import { debug } from './debug';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  graphHoverIndex,
  graphHoverOwner,
  resolveGraphHover,
  type GraphHoverFocus,
  type GraphHoverTarget,
} from './graphHover';
import { GraphOpacity } from './graphOpacity';
import { ROW, type Commit, type Branch, type HistoryFrontier } from './model';
import { measuredLayout } from './measuredLayout';
import {
  branchTracks,
  branchLabelContentBottom,
  visibleBranchLabels,
  type BranchLabelObstacle,
} from './branchLabels';
import { graphColors } from './graphColors';
import { GRAPH_COLOR_COUNT } from './graphPalette';
import { monthMarkers } from './monthMarkers';
import { emojify } from './emoji';
import { scrollPosition, scrollAnchor } from './scrollPosition';
import { actionText, attempt, runStatus, runElapsed, type CommitInfo } from './CommitInfo';
import {
  graphFrame,
  branchDisplayNames,
  branchLabelText,
  commitVersionIcons,
  visibleHistorySources,
  visibleGraphEdges,
  GRAPH_ORIGIN,
} from './graphView';
type BranchBadge = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  name: string;
};
type Props = {
  active?: boolean;
  containerResponsive?: boolean;
  columnOrder?: number;
  label?: string;
  theme: string;
  commits: Commit[];
  branches: Branch[];
  branch: string;
  reverse: boolean;
  onSelect: (c: Commit) => void;
  selected: string;
  hasMore: boolean;
  onLoadMore: (sources?: string[]) => void;
  frontiers: HistoryFrontier[];
  pendingSources: string[];
  topInset: number;
  baseHead?: string;
  defaultBranch?: string;
  refreshVersion?: number;
  info?: ReadonlyMap<string, CommitInfo>;
  onVisible?: (shas: string[]) => void;
};
export function Graph({
  active = true,
  containerResponsive = false,
  columnOrder = 0,
  label,
  theme,
  commits,
  branches,
  branch,
  reverse,
  onSelect,
  selected,
  hasMore,
  onLoadMore,
  frontiers,
  pendingSources,
  topInset,
  baseHead,
  defaultBranch,
  refreshVersion = 0,
  info,
  onVisible,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    branchTooltip = useRef<HTMLDivElement>(null),
    prior = useRef(new Map<string, number>());
  const captureFrontiers = useRef<() => void>(() => {});
  const badgeHits = useRef<BranchBadge[]>([]);
  const [hoveredBadge, setHoveredBadge] = useState<BranchBadge | null>(null);
  const hoverRef = useRef<GraphHoverTarget | null>(null);
  const hoverExit = useRef<number | undefined>(undefined);
  const [hoverTarget, setHoverTarget] = useState<GraphHoverTarget | null>(null);
  const [canHover, setCanHover] = useState(() => window.matchMedia('(any-hover: hover)').matches);
  const [opacity] = useState(() => new GraphOpacity());
  const cancelHoverExit = useCallback(() => {
    window.clearTimeout(hoverExit.current);
    hoverExit.current = undefined;
  }, []);
  const updateHover = useCallback(
    (target: GraphHoverTarget | null) => {
      cancelHoverExit();
      const previous = hoverRef.current;
      if (previous?.kind === target?.kind && previous?.id === target?.id) return;
      hoverRef.current = target;
      setHoverTarget(target);
    },
    [cancelHoverExit],
  );
  const deferHoverExit = useCallback(() => {
    if (!hoverRef.current || hoverExit.current !== undefined) return;
    // Bridge the small gaps between targets without flashing the default graph.
    hoverExit.current = window.setTimeout(() => updateHover(null), 100);
  }, [updateHover]);
  useEffect(() => cancelHoverExit, [cancelHoverExit]);
  const branchTooltipId = useId();
  const messageHits = useRef(new Map<string, number>());
  const [view, setView] = useState({
    top: 0,
    width: containerResponsive ? 0 : window.innerWidth,
    height: window.innerHeight,
  });
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden);
  const pageVisible = active && documentVisible;
  useEffect(() => {
    const update = () => setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const [screenMobile, setScreenMobile] = useState(
    () => window.matchMedia('(max-width:800px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width:800px)');
    const update = () => setScreenMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  // Split columns use their measured width with the existing responsive rules.
  const mobile = containerResponsive ? view.width <= 800 : screenMobile;
  const head = baseHead || branches.find((b) => b.name === branch)?.commit.sha;
  const data = useMemo(() => measuredLayout(commits, prior.current, head), [commits, head]);
  useEffect(() => {
    prior.current = data.lanes;
  }, [data]);
  const tones = useMemo(
    () => graphColors(commits, branches, branch, head, defaultBranch),
    [commits, branches, branch, head, defaultBranch],
  );
  const ordered = useMemo(
    () => (reverse ? [...data.ordered].reverse() : data.ordered),
    [data, reverse],
  );
  const months = useMemo(() => monthMarkers(ordered, data.spine), [ordered, data, reverse]);
  const padding = topInset;
  const maxLane = Array.from(data.lanes.values()).reduce((a, b) => Math.max(a, b), 0);
  const { spacing, width, branchWidth, showMessages, messageX, messageWidth } = graphFrame(
    view.width,
    maxLane,
    mobile,
  );
  // clientWidth rounds fractional columns; an origin on the edge can hit the next column.
  const origin = containerResponsive && view.width <= GRAPH_ORIGIN ? view.width / 2 : GRAPH_ORIGIN;
  const positions = useMemo(
    () =>
      new Map(
        ordered.map((c, i) => [
          c.sha,
          {
            x: origin + (data.lanes.get(c.sha) || 0) * spacing,
            y: i * ROW + padding,
          },
        ]),
      ),
    [ordered, data, padding, spacing, origin],
  );
  const pendingActions = useMemo(() => {
    if (!pageVisible || !info) return [];
    const first = Math.max(0, Math.ceil((view.top - 20) / ROW)),
      last = Math.min(
        ordered.length,
        Math.floor((view.top + view.height - 48 - padding) / ROW) + 1,
      ),
      left = container.current?.scrollLeft || 0;
    return ordered.slice(first, last).filter((commit) => {
      const summary = info.get(commit.sha)?.actions,
        point = positions.get(commit.sha)!;
      return (
        summary?.state === 'running' &&
        summary.ratio === null &&
        point.x >= left - 12 &&
        point.x <= left + view.width + 12
      );
    });
  }, [ordered, positions, padding, view, info, pageVisible]);
  const tracks = useMemo(
    () =>
      branchTracks(commits, branches, branch, data.spine, positions, reverse, tones, data.lanes),
    [commits, branches, branch, data, positions, reverse, tones],
  );
  const hoverIndex = useMemo(
    () => graphHoverIndex(data.ordered, tracks, tones.paths),
    [data.ordered, tracks, tones.paths],
  );
  const edges = useMemo(
    () =>
      visibleGraphEdges(
        ordered,
        positions,
        data.spine,
        origin,
        reverse,
        view.top,
        view.top + view.height,
      ).map((edge) => {
        const path = new Path2D();
        const middle = (edge.from.y + edge.to.y) / 2;
        path.moveTo(edge.from.x, edge.from.y);
        path.bezierCurveTo(edge.from.x, middle, edge.to.x, middle, edge.to.x, edge.to.y);
        return { ...edge, path, owner: graphHoverOwner({ kind: 'edge', id: edge.id }, hoverIndex) };
      }),
    [ordered, positions, data.spine, origin, reverse, view.top, view.height, hoverIndex],
  );
  const selectionFocus = useMemo(
    () =>
      pageVisible && selected
        ? resolveGraphHover({ kind: 'commit', id: selected }, hoverIndex)
        : null,
    [pageVisible, selected, hoverIndex],
  );
  const hoverFocus = useMemo(() => {
    if (!canHover || !pageVisible) return null;
    if (
      selectionFocus &&
      hoverTarget &&
      hoverTarget.kind !== 'branch' &&
      graphHoverOwner(hoverTarget, hoverIndex) === hoverIndex.owners.get(selected)
    )
      return selectionFocus;
    return resolveGraphHover(hoverTarget, hoverIndex);
  }, [canHover, pageVisible, hoverTarget, hoverIndex, selected, selectionFocus]);
  const focus = hoverFocus || selectionFocus;
  const opacityIndex = useMemo(
    () => ({
      nodes: hoverIndex.commits,
      edges: tones.edges,
      branches: hoverIndex.heads,
    }),
    [hoverIndex, tones.edges],
  );
  useEffect(() => {
    const media = window.matchMedia('(any-hover: hover)');
    const update = () => setCanHover(media.matches);
    const clear = () => {
      updateHover(null);
      setHoveredBadge(null);
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('blur', clear);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('blur', clear);
    };
  }, [updateHover]);
  useLayoutEffect(() => {
    if (!canHover || !pageVisible || (hoverTarget && !hoverFocus)) updateHover(null);
    if (!canHover || !pageVisible) setHoveredBadge(null);
  }, [canHover, pageVisible, hoverTarget, hoverFocus, updateHover]);
  useLayoutEffect(() => {
    updateHover(null);
  }, [columnOrder, view.width, view.height, reverse, branch, theme, updateHover]);
  useLayoutEffect(() => {
    setHoveredBadge(null);
    if (canvas.current) canvas.current.title = '';
  }, [tracks, view, pageVisible, theme, columnOrder]);
  useLayoutEffect(() => {
    const tooltip = branchTooltip.current,
      graph = container.current;
    if (!hoveredBadge || !tooltip || !graph) return;
    const viewport = window.visualViewport,
      left = viewport?.offsetLeft || 0,
      top = viewport?.offsetTop || 0,
      width = viewport?.width || window.innerWidth,
      height = viewport?.height || window.innerHeight;
    tooltip.style.maxWidth = `${Math.max(0, Math.min(360, width - 16))}px`;
    const size = tooltip.getBoundingClientRect(),
      bounds = graph.getBoundingClientRect(),
      badgeX = bounds.left + hoveredBadge.x - graph.scrollLeft,
      badgeY = bounds.top + hoveredBadge.y - graph.scrollTop,
      below = badgeY + hoveredBadge.height + 6,
      y = below + size.height <= top + height - 8 ? below : badgeY - size.height - 6;
    tooltip.style.left = `${Math.max(left + 8, Math.min(badgeX, left + width - size.width - 8))}px`;
    tooltip.style.top = `${Math.max(top + 8, Math.min(y, top + height - size.height - 8))}px`;
  }, [hoveredBadge]);
  const showingBranchTooltip = hoveredBadge !== null;
  useEffect(() => {
    if (!showingBranchTooltip) return;
    const hide = () => setHoveredBadge(null);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    };
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('blur', hide);
    window.visualViewport?.addEventListener('resize', hide);
    window.visualViewport?.addEventListener('scroll', hide);
    return () => {
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('blur', hide);
      window.visualViewport?.removeEventListener('resize', hide);
      window.visualViewport?.removeEventListener('scroll', hide);
    };
  }, [showingBranchTooltip]);
  const badgeHeight = mobile ? 18 : 20,
    badgeGap = 2;
  const height = Math.max(
    view.height,
    ordered.length * ROW + padding + 80,
    branchLabelContentBottom(tracks, badgeHeight, badgeGap) + 80,
  );
  const displayNames = useMemo(
    () => branchDisplayNames(branches.map((ref) => ref.name)),
    [branches],
  );
  const lastOrder = useRef<string[]>([]),
    scrollTop = useRef(0),
    lastRefresh = useRef(refreshVersion),
    followingLatest = useRef<number | null>(null),
    followingFrame = useRef<number | null>(null);
  const cancelFollowFrame = () => {
    if (followingFrame.current !== null) {
      cancelAnimationFrame(followingFrame.current);
      followingFrame.current = null;
    }
  };
  const stopFollowing = () => {
    const el = container.current;
    cancelFollowFrame();
    if (followingLatest.current !== null && el) {
      followingLatest.current = null;
      el.scrollTo({ top: el.scrollTop, behavior: 'auto' });
      scrollTop.current = el.scrollTop;
      captureFrontiers.current();
    }
  };
  useLayoutEffect(() => {
    cancelFollowFrame();
    if (!pageVisible) return;
    const el = container.current!,
      after = ordered.map((c) => c.sha);
    const top = followingLatest.current !== null ? el.scrollTop : scrollTop.current;
    const next =
      followingLatest.current !== null
        ? reverse
          ? Math.max(0, after.length * ROW + padding + 80 - el.clientHeight)
          : 0
        : scrollPosition(
            lastOrder.current,
            after,
            top,
            el.clientHeight,
            padding,
            reverse,
            lastRefresh.current !== refreshVersion,
          );
    const anchor = scrollAnchor(lastOrder.current, after, top, el.clientHeight, padding);
    if (
      lastOrder.current.length &&
      next !== anchor &&
      pageVisible &&
      !window.matchMedia('(prefers-reduced-motion:reduce)').matches
    ) {
      if (anchor !== el.scrollTop) el.scrollTop = anchor;
      const from = el.scrollTop;
      followingLatest.current = from === next ? null : next;
      setView((v) => (v.top === from ? v : { ...v, top: from }));
      if (followingLatest.current !== null) {
        const started = performance.now();
        const move = (now: number) => {
          followingFrame.current = null;
          const target = followingLatest.current;
          if (target === null) return;
          const progress = Math.min(1, (now - started) / 240);
          el.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3);
          const top = el.scrollTop;
          scrollTop.current = top;
          setView((v) => (v.top === top ? v : { ...v, top }));
          if (progress < 1 && top !== target) followingFrame.current = requestAnimationFrame(move);
          else followingLatest.current = null;
        };
        followingFrame.current = requestAnimationFrame(move);
      } else el.scrollTo({ top: next, behavior: 'auto' });
    } else {
      followingLatest.current = null;
      el.scrollTo({ top: next, behavior: 'auto' });
      setView((v) => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop }));
    }
    scrollTop.current = el.scrollTop;
    lastOrder.current = after;
    lastRefresh.current = refreshVersion;
    return cancelFollowFrame;
  }, [ordered, padding, reverse, refreshVersion, pageVisible]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion:reduce)');
    const update = () => {
      const el = container.current;
      if (media.matches && followingLatest.current !== null && el) {
        cancelFollowFrame();
        const top = followingLatest.current;
        followingLatest.current = null;
        el.scrollTo({ top, behavior: 'auto' });
        scrollTop.current = el.scrollTop;
        setView((v) => ({ ...v, top: el.scrollTop }));
      }
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    const el = container.current!;
    const update = () => {
      const { clientWidth: width, clientHeight: height } = el;
      setView((v) => (v.width === width && v.height === height ? v : { ...v, width, height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerResponsive]);
  useLayoutEffect(() => {
    container.current!.scrollLeft = 0;
  }, [width, mobile]);
  useEffect(() => {
    if (!onVisible || !pageVisible) return;
    const first = Math.max(0, Math.ceil((view.top - 20) / ROW)),
      last = Math.min(
        ordered.length,
        Math.floor((view.top + view.height - 48 - padding) / ROW) + 1,
      );
    const el = container.current!;
    onVisible(
      ordered
        .slice(first, last)
        .filter((c) => {
          const x = positions.get(c.sha)!.x;
          return x >= el.scrollLeft - 20 && x <= el.scrollLeft + view.width + 20;
        })
        .map((c) => c.sha),
    );
  }, [ordered, positions, padding, view, onVisible, pageVisible]);
  const icons = (sha: string, x: number) => commitVersionIcons(info?.get(sha), x);
  useLayoutEffect(() => {
    captureFrontiers.current = () => {
      if (!hasMore || !pageVisible || followingLatest.current !== null) return;
      const el = container.current!;
      const ready = visibleHistorySources(
        frontiers,
        positions,
        {
          left: el.scrollLeft,
          top: el.scrollTop,
          width: el.clientWidth,
          height: el.clientHeight - 48,
          inset: Math.max(0, padding - 20),
        },
        pendingSources,
      );
      if (ready.length) onLoadMore(ready);
    };
    // A predecessor page can leave another gap above this viewport. Re-evaluate
    // after layout and queue cleanup so that path continues without another scroll.
    captureFrontiers.current();
  }, [
    positions,
    frontiers,
    pendingSources,
    padding,
    hasMore,
    onLoadMore,
    view.width,
    view.height,
    pageVisible,
  ]);
  useEffect(() => {
    if (!pageVisible || view.width <= 0 || view.height <= 0) return;
    const ctx = canvas.current!.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.floor(width * dpr),
      pixelHeight = Math.floor(view.height * dpr);
    if (canvas.current!.width !== pixelWidth) canvas.current!.width = pixelWidth;
    if (canvas.current!.height !== pixelHeight) canvas.current!.height = pixelHeight;
    opacity.setTarget(focus, opacityIndex, performance.now());
    const rings = container.current!.querySelectorAll<HTMLElement>('.actions-pending-ring');
    let frame: number | undefined;
    const draw = (now: number) => {
      const started = debug.startTime();
      let drawn = 0,
        visible = 0;
      const alpha = (kind: keyof GraphHoverFocus, id: string) => opacity.value(kind, id, now);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, view.height);
      ctx.translate(0, -view.top);
      const style = getComputedStyle(container.current!);
      const text = style.getPropertyValue('--text'),
        surface = style.getPropertyValue('--surface');
      const colors = Array.from({ length: GRAPH_COLOR_COUNT }, (_, i) =>
        style.getPropertyValue(`--graph-${i}`).trim(),
      );
      const left = container.current!.scrollLeft,
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
        if (started !== undefined) {
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
        for (const icon of icons(c.sha, p.x)) ctx.fillText(icon.text, icon.x, p.y + 4);
        ctx.textAlign = 'left';
        ctx.fillStyle = text;
        ctx.globalAlpha = alpha('nodes', c.sha);
        if (showMessages) {
          ctx.font = `${mobile ? 12 : 13}px system-ui`;
          const message = fitMessage(emojify(c.commit.message.split('\n')[0]));
          ctx.fillText(message, messageX, p.y + (mobile ? 4 : -3));
          messageWidths.set(c.sha, ctx.measureText(message).width);
        }
        if (!mobile) {
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
      ctx.font = `${mobile ? 10 : 11}px system-ui`;
      const labelRight = left + (showMessages ? messageX : branchWidth),
        nodeClearance = 15,
        maxTextWidth =
          Math.min(mobile ? Math.min(116, view.width * 0.36) : 190, branchWidth - 16) - 12,
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
        for (let limit = mobile ? 18 : 28; limit >= 1; limit--) {
          text = branchLabelText(name, displayNames, limit);
          if (ctx.measureText(text).width <= limitWidth) break;
        }
        const value = { text, width: ctx.measureText(text).width + 12 };
        cache.set(key, value);
        return value;
      };
      const hits: typeof badgeHits.current = [];
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
          ctx.fillText(name, x + 6, rowY + (mobile ? 12 : 14));
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
      badgeHits.current = hits;
      messageHits.current = messageWidths;
      if (started !== undefined)
        debug.render(started, commits, {
          loaded: commits.length,
          visible,
          drawn,
          branches: branches.length,
          lanes: maxLane + 1,
        });
      for (const ring of rings) {
        ring.style.opacity = String(alpha('nodes', ring.dataset.commit!));
      }
      if (opacity.active(now)) frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [
    theme,
    months,
    tones,
    tracks,
    padding,
    data,
    ordered,
    positions,
    branches,
    origin,
    width,
    view,
    selected,
    mobile,
    badgeHeight,
    branchWidth,
    showMessages,
    messageX,
    messageWidth,
    reverse,
    info,
    displayNames,
    pageVisible,
    focus,
    opacity,
    opacityIndex,
    edges,
  ]);
  function edgeAt(clientX: number, clientY: number) {
    const el = container.current!,
      rect = el.getBoundingClientRect(),
      x = clientX - rect.left + el.scrollLeft,
      y = clientY - rect.top + el.scrollTop;
    const ctx = canvas.current!.getContext('2d')!;
    const hits: { edge: (typeof edges)[number]; distance: number }[] = [];
    ctx.save();
    // Paths and pointer coordinates are in graph CSS pixels, independent of DPR.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    for (const edge of edges) {
      if (
        !edge.owner ||
        x < Math.min(edge.from.x, edge.to.x) - 5 ||
        x > Math.max(edge.from.x, edge.to.x) + 5 ||
        y < Math.min(edge.from.y, edge.to.y) - 5 ||
        y > Math.max(edge.from.y, edge.to.y) + 5
      )
        continue;
      ctx.lineWidth = 10;
      if (!ctx.isPointInStroke(edge.path, x, y)) continue;
      let low = 0,
        high = 10;
      for (let i = 0; i < 5; i++) {
        ctx.lineWidth = (low + high) / 2;
        if (ctx.isPointInStroke(edge.path, x, y)) high = ctx.lineWidth;
        else low = ctx.lineWidth;
      }
      hits.push({ edge, distance: high / 2 });
    }
    ctx.restore();
    if (!hits.length) return;
    const distance = Math.min(...hits.map((hit) => hit.distance));
    const nearest = hits.filter((hit) => hit.distance <= distance + 0.5);
    const current =
      graphHoverOwner(hoverRef.current, hoverIndex) || hoverIndex.owners.get(selected);
    const inMerge = current?.startsWith('edge:');
    const retainedFocus = hoverRef.current
      ? resolveGraphHover(hoverRef.current, hoverIndex)
      : selectionFocus;
    const identity = (hit: (typeof hits)[number]) =>
      retainedFocus?.edges.has(hit.edge.id) ? current : hit.edge.owner;
    const preferred = nearest.filter((hit) => identity(hit) === current);
    const candidates = preferred.length ? preferred : nearest;
    // At an indistinguishable crossing, keep an existing flow or wait for clarity.
    if (new Set(candidates.map(identity)).size !== 1) return;
    if (inMerge && identity(candidates[0]) === current) return hoverRef.current!;
    return { kind: 'edge', id: candidates[0].edge.id } as const;
  }
  function badgeAt(clientX: number, clientY: number) {
    const el = container.current!,
      rect = el.getBoundingClientRect(),
      x = clientX - rect.left + el.scrollLeft,
      y = clientY - rect.top + el.scrollTop;
    const commit = ordered[Math.round((y - padding) / ROW)],
      point = commit && positions.get(commit.sha);
    if (point && Math.hypot(x - point.x, y - point.y) <= 12) return;
    return badgeHits.current.find(
      (label) =>
        x >= label.x && x <= label.x + label.width && y >= label.y && y <= label.y + label.height,
    );
  }
  function pick(clientX: number, clientY: number, forHover = false) {
    const el = container.current!,
      rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft,
      y = clientY - rect.top + el.scrollTop;
    const c = ordered[Math.round((y - padding) / ROW)];
    if (!c) return;
    const p = positions.get(c.sha)!;
    return Math.abs(y - p.y) <= 22 &&
      ((forHover ? Math.hypot(x - p.x, y - p.y) <= 12 : Math.abs(x - p.x) <= 22) ||
        (!forHover && icons(c.sha, p.x).some((icon) => Math.abs(x - icon.x) <= 9)) ||
        (showMessages && x >= messageX && x <= messageX + (messageHits.current.get(c.sha) || 0)))
      ? c
      : undefined;
  }
  return (
    <div
      className="graph-scroll fit-width"
      ref={container}
      tabIndex={0}
      aria-label={label || 'Commit graph. Scroll to load more history.'}
      onWheelCapture={stopFollowing}
      onTouchStartCapture={stopFollowing}
      onPointerDownCapture={(event) => {
        cancelHoverExit();
        setHoveredBadge(null);
        if (event.pointerType === 'touch') updateHover(null);
        stopFollowing();
      }}
      onKeyDownCapture={(event) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
          stopFollowing();
      }}
      onScroll={(e) => {
        setHoveredBadge(null);
        updateHover(null);
        if (canvas.current) canvas.current.title = '';
        const top = e.currentTarget.scrollTop;
        scrollTop.current = top;
        if (followingLatest.current !== null && top === followingLatest.current)
          followingLatest.current = null;
        captureFrontiers.current();
        setView((v) => (v.top === top ? v : { ...v, top }));
      }}
    >
      <div style={{ height, width: '100%', position: 'relative' }}>
        <canvas
          aria-label={`Commit history graph. Tap a node${showMessages ? ' or message' : ''} to inspect it.`}
          aria-describedby={hoveredBadge ? branchTooltipId : undefined}
          ref={canvas}
          style={{
            position: 'sticky',
            top: 0,
            width: '100%',
            height: view.height,
            display: 'block',
          }}
          onClick={(e) => {
            if (badgeAt(e.clientX, e.clientY)) return;
            const c = pick(e.clientX, e.clientY);
            updateHover(null);
            if (c) onSelect(c);
          }}
          onPointerLeave={(e) => {
            setHoveredBadge(null);
            updateHover(null);
            e.currentTarget.title = '';
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'touch' || e.buttons) {
              updateHover(null);
              setHoveredBadge(null);
              e.currentTarget.title = '';
              return;
            }
            const badge = badgeAt(e.clientX, e.clientY);
            if (badge) {
              updateHover(canHover ? { kind: 'branch', id: badge.name } : null);
              e.currentTarget.title = '';
              if (badge.text === badge.name) setHoveredBadge(null);
              else
                setHoveredBadge((previous) =>
                  previous?.name === badge.name &&
                  previous.x === badge.x &&
                  previous.y === badge.y &&
                  previous.width === badge.width &&
                  previous.height === badge.height &&
                  previous.text === badge.text
                    ? previous
                    : badge,
                );
              return;
            }
            setHoveredBadge(null);
            const hoverCommit = canHover && pick(e.clientX, e.clientY, true);
            if (hoverCommit) updateHover({ kind: 'commit', id: hoverCommit.sha });
            else {
              const edge = canHover && edgeAt(e.clientX, e.clientY);
              if (edge) {
                updateHover(edge);
                e.currentTarget.title = '';
                return;
              }
              deferHoverExit();
            }
            const c = pick(e.clientX, e.clientY);
            if (!c) {
              e.currentTarget.title = '';
              return;
            }
            const extra = info?.get(c.sha),
              p = positions.get(c.sha)!,
              el = container.current!,
              x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
            const icon = icons(c.sha, p.x).find((icon) => Math.abs(x - icon.x) <= 9);
            e.currentTarget.title = [
              `${c.sha.slice(0, 7)} · ${emojify(c.commit.message.split('\n')[0])}`,
              icon?.title,
              extra?.actions && ['running', 'queued'].includes(extra.actions.state)
                ? `${actionText(extra.actions.state)}${extra.actions.ratio !== null ? ` · ${extra.actions.done}/${extra.actions.total} jobs` : ''}`
                : '',
              ...(extra?.runs || []).map(
                (run) =>
                  `${run.name || 'Workflow'} · ${runStatus(run).label} · Elapsed ${runElapsed(run) || '—'} · Attempt ${attempt(run)}`,
              ),
            ]
              .filter(Boolean)
              .join('\n');
          }}
        />
        {pendingActions.map((commit) => {
          const point = positions.get(commit.sha)!,
            radius = commit.sha === selected ? 10.5 : 7.5;
          return (
            <span
              key={commit.sha}
              className="actions-pending-ring"
              data-commit={commit.sha}
              role="img"
              aria-label="GitHub Actions in progress; job counts not confirmed"
              style={{
                opacity: opacity.value('nodes', commit.sha, performance.now()),
                left: point.x - radius - 1,
                top: point.y - radius - 1,
                width: radius * 2 + 2,
                height: radius * 2 + 2,
              }}
            />
          );
        })}
      </div>
      {hoveredBadge && (
        <div id={branchTooltipId} ref={branchTooltip} className="branch-tooltip" role="tooltip">
          {hoveredBadge.name}
        </div>
      )}
    </div>
  );
}
