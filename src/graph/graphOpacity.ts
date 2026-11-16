import { graphHoverAlpha, type GraphHoverFocus } from './graphHover';

type Kind = keyof GraphHoverFocus;
type Fade = { from: number; to: number };
type Fades = Record<Kind, Map<string, Fade>>;
type Elements = Record<Kind, Pick<ReadonlySet<string>, 'has' | 'size'>>;
const GRAPH_OPACITY_DURATION = 140;
const kinds: Kind[] = ['nodes', 'edges', 'branches'];
const emptyFades = (): Fades => ({
  nodes: new Map(),
  edges: new Map(),
  branches: new Map(),
});
const progress = (elapsed: number) => {
  const value = Math.max(0, Math.min(1, elapsed / GRAPH_OPACITY_DURATION));
  return value * value * (3 - 2 * value);
};

// Unfocused elements share one fade. Only focused elements and unfinished
// exceptions need individual values; data indexes are queried, never traversed.
export class GraphOpacity {
  private focus: GraphHoverFocus | null = null;
  private elements: Elements | null = null;
  private background: Fade = { from: 1, to: 1 };
  private backgroundVisible = false;
  private fades = emptyFades();
  private moving = false;
  private started = 0;

  setTarget(focus: GraphHoverFocus | null, elements: Elements, now: number) {
    if (focus === this.focus && elements === this.elements) return;
    const initial = this.elements === null;
    const commonTo = focus ? 0.25 : 1;
    const commonFrom = initial
      ? commonTo
      : this.interpolate(this.background, now);
    const next = emptyFades();
    const retained = emptyFades();
    let changed = this.background.to !== commonTo;
    let nextBackgroundVisible = false;
    let retainedBackgroundVisible = false;
    let nextMoving = false;
    let retainedMoving = false;
    for (const kind of kinds) {
      // Older exceptions matter for A -> B -> C before A has finished fading.
      const candidates = new Set([
        ...(this.focus?.[kind] || []),
        ...(focus?.[kind] || []),
        ...this.fades[kind].keys(),
      ]);
      let focused = 0;
      let nextUnfocused = 0;
      let retainedUnfocused = 0;
      for (const id of candidates) {
        if (!elements[kind].has(id)) continue;
        const highlighted = focus?.[kind].has(id);
        if (highlighted) focused++;
        const to = graphHoverAlpha(focus, kind, id);
        const from = initial ? to : this.value(kind, id, now);
        if (graphHoverAlpha(this.focus, kind, id) !== to) changed = true;
        const fallback = highlighted ? 1 : commonFrom;
        if (from !== fallback) {
          next[kind].set(id, { from, to });
          nextMoving ||= from !== to;
          if (!highlighted) nextUnfocused++;
        }
        const old = this.fades[kind].get(id);
        if (old?.to === to) {
          retained[kind].set(id, old);
          retainedMoving ||= old.from !== old.to;
          if (!highlighted) retainedUnfocused++;
        }
      }
      if (elements[kind].size > focused + nextUnfocused)
        nextBackgroundVisible = true;
      if (elements[kind].size > focused + retainedUnfocused)
        retainedBackgroundVisible = true;
    }
    this.focus = focus;
    this.elements = elements;
    this.backgroundVisible = changed
      ? nextBackgroundVisible
      : retainedBackgroundVisible;
    if (changed) {
      this.background = { from: commonFrom, to: commonTo };
      this.fades = next;
      this.moving = nextMoving;
      this.started = now;
    } else {
      // Equivalent focus/data updates must not restart an in-flight fade.
      this.fades = retained;
      this.moving = retainedMoving;
    }
  }

  private interpolate(fade: Fade, now: number) {
    return fade.from + (fade.to - fade.from) * progress(now - this.started);
  }

  value(kind: Kind, id: string, now: number) {
    const fade = this.fades[kind].get(id);
    if (fade) return this.interpolate(fade, now);
    return this.focus?.[kind].has(id)
      ? 1
      : this.interpolate(this.background, now);
  }

  active(now: number) {
    const backgroundMoving =
      this.backgroundVisible && this.background.from !== this.background.to;
    if (
      now - this.started >= GRAPH_OPACITY_DURATION ||
      (!backgroundMoving && !this.moving)
    ) {
      for (const kind of kinds) this.fades[kind].clear();
      this.background = { from: this.background.to, to: this.background.to };
      this.moving = false;
      return false;
    }
    return true;
  }
}
