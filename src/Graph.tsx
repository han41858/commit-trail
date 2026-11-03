import { debug } from './debug';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ROW, type Commit, type Branch, type HistoryFrontier } from './model';
import { measuredLayout } from './measuredLayout';
import {
  branchTracks,
  branchLabelContentBottom,
  visibleBranchLabels,
  type BranchLabelObstacle,
} from './branchLabels';
import { emptyGraphColors, graphColors } from './graphColors';
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
  GRAPH_ORIGIN,
} from './graphView';
type BranchBadge = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  names: string[];
};
type Props = {
  active?: boolean;
  containerResponsive?: boolean;
  label?: string;
  theme: string;
  commits: Commit[];
  branches: Branch[];
  branch: string;
  reverse: boolean;
  onSelect: (c: Commit) => void;
  selected: string;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: (sources?: string[]) => void;
  frontiers: HistoryFrontier[];
  pendingSources: string[];
  topInset: number;
  baseHead?: string;
  refreshVersion?: number;
  info?: ReadonlyMap<string, CommitInfo>;
  onVisible?: (shas: string[]) => void;
};
export function Graph({
  active = true,
  containerResponsive = false,
  label,
  theme,
  commits,
  branches,
  branch,
  reverse,
  onSelect,
  selected,
  hasMore,
  loading,
  onLoadMore,
  frontiers,
  pendingSources,
  topInset,
  baseHead,
  refreshVersion = 0,
  info,
  onVisible,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    branchTooltip = useRef<HTMLDivElement>(null),
    prior = useRef(new Map<string, number>());
  const priorColors = useRef(emptyGraphColors());
  const captureFrontiers = useRef<() => void>(() => {});
  const badgeHits = useRef<BranchBadge[]>([]);
  const [hoveredBadge, setHoveredBadge] = useState<BranchBadge | null>(null);
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
    () => graphColors(commits, data.ordered, branches, branch, data.spine, priorColors.current),
    [commits, data, branches, branch],
  );
  useLayoutEffect(() => {
    priorColors.current = tones;
  }, [tones]);
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
  // Keep the existing origin unless a split column is narrower than that margin.
  const origin = containerResponsive && view.width < GRAPH_ORIGIN ? view.width / 2 : GRAPH_ORIGIN;
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
  useLayoutEffect(() => {
    setHoveredBadge(null);
    if (canvas.current) canvas.current.title = '';
  }, [tracks, view, pageVisible, theme]);
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
    const started = debug.startTime();
    let drawn = 0,
      visible = 0;
    const ctx = canvas.current!.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.current!.width = width * dpr;
    canvas.current!.height = view.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, view.height);
    ctx.translate(0, -view.top);
    const style = getComputedStyle(container.current!);
    const text = style.getPropertyValue('--text'),
      surface = style.getPropertyValue('--surface');
    const colors = Array.from({ length: 6 }, (_, i) =>
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
    for (const c of ordered) {
      const p = positions.get(c.sha)!;
      for (const parent of c.parents) {
        const end = positions.get(parent.sha);
        const spineEdge = data.spine.has(c.sha) && c.parents[0]?.sha === parent.sha;
        const ex = end?.x ?? (spineEdge ? origin : p.x);
        const ey = end?.y ?? p.y + (reverse ? -ROW / 2 : ROW / 2);
        if (Math.max(p.y, ey) < view.top - ROW || Math.min(p.y, ey) > view.top + view.height + ROW)
          continue;
        ctx.globalAlpha = spineEdge ? 0.95 : 0.65;
        ctx.strokeStyle = colors[(tones.edges.get(`${c.sha}:${parent.sha}`) || 0) % colors.length];
        ctx.lineWidth = spineEdge ? 2.5 : 1.6;
        ctx.setLineDash(end ? [] : [4, 4]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.bezierCurveTo(p.x, (p.y + ey) / 2, ex, (p.y + ey) / 2, ex, ey);
        ctx.stroke();
      }
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
      ctx.globalAlpha = 1;
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
          summary.state === 'running'
            ? 0.25
            : summary.state === 'queued' ||
                summary.state === 'cancelled' ||
                summary.state === 'skipped'
              ? 0.4
              : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (summary.state === 'running' && summary.ratio !== null) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * summary.ratio);
          ctx.stroke();
        }
      }
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      for (const icon of icons(c.sha, p.x)) ctx.fillText(icon.text, icon.x, p.y + 4);
      ctx.textAlign = 'left';
      ctx.fillStyle = text;
      if (showMessages) {
        ctx.font = `${mobile ? 12 : 13}px system-ui`;
        const message = fitMessage(emojify(c.commit.message.split('\n')[0]));
        ctx.fillText(message, messageX, p.y + (mobile ? 4 : -3));
        messageWidths.set(c.sha, ctx.measureText(message).width);
      }
      if (!mobile) {
        ctx.globalAlpha = 0.5;
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
      const available = Math.max(x - left - 8 - nodeClearance, labelRight - x - nodeClearance) - 12,
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
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 3, y + badgeHeight / 2);
        ctx.lineTo(x - 3, y + label.boxHeight! - badgeHeight / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      label.names.forEach((ref, index) => {
        const { text: name, width: boxWidth } = badge(ref, label.x),
          rowY = y + index * (badgeHeight + badgeGap);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = surface;
        ctx.beginPath();
        ctx.roundRect(x, rowY, boxWidth, badgeHeight, 4);
        ctx.fill();
        ctx.globalAlpha = theme === 'light' ? 0.06 : 0.08;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
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
            names: [ref],
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
  ]);
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
  function pick(clientX: number, clientY: number) {
    const el = container.current!,
      rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft,
      y = clientY - rect.top + el.scrollTop;
    const c = ordered[Math.round((y - padding) / ROW)];
    if (!c) return;
    const p = positions.get(c.sha)!;
    return Math.abs(y - p.y) <= 22 &&
      (Math.abs(x - p.x) <= 22 ||
        icons(c.sha, p.x).some((icon) => Math.abs(x - icon.x) <= 9) ||
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
      onPointerDownCapture={() => {
        setHoveredBadge(null);
        stopFollowing();
      }}
      onKeyDownCapture={(event) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
          stopFollowing();
      }}
      onScroll={(e) => {
        setHoveredBadge(null);
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
            if (c) onSelect(c);
          }}
          onPointerLeave={(e) => {
            setHoveredBadge(null);
            e.currentTarget.title = '';
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'touch') return;
            const badge = badgeAt(e.clientX, e.clientY);
            if (badge) {
              e.currentTarget.title = '';
              if (badge.text === badge.names.join(' · ')) setHoveredBadge(null);
              else setHoveredBadge((previous) => (previous === badge ? previous : badge));
              return;
            }
            setHoveredBadge(null);
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
              role="img"
              aria-label="GitHub Actions in progress; job counts not confirmed"
              style={{
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
          {hoveredBadge.names.join(' · ')}
        </div>
      )}
    </div>
  );
}
