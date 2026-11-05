import { graphHoverAlpha, type GraphHoverFocus } from './graphHover';

type Kind = keyof GraphHoverFocus;
type Fade = { from: number; to: number };
export const GRAPH_OPACITY_DURATION = 140;
const kinds: Kind[] = ['nodes', 'edges', 'branches'];
const key = (kind: Kind, id: string) => `${kind}\0${id}`;
const progress = (elapsed: number) => {
  const value = Math.max(0, Math.min(1, elapsed / GRAPH_OPACITY_DURATION));
  return value * value * (3 - 2 * value);
};

// Only opacity changes live here. Layout, hit testing and data requests remain
// independent of animation frames, and removed graph elements are discarded.
export class GraphOpacity {
  private focus: GraphHoverFocus | null = null;
  private elements: GraphHoverFocus | null = null;
  private fades = new Map<string, Fade>();
  private started = 0;

  setTarget(focus: GraphHoverFocus | null, elements: GraphHoverFocus, now: number) {
    if (focus === this.focus && elements === this.elements) return;
    const next = new Map<string, Fade>();
    const retained = new Map<string, Fade>();
    let changed = false;
    for (const kind of kinds) {
      for (const id of elements[kind]) {
        const entryKey = key(kind, id);
        const to = graphHoverAlpha(focus, kind, id);
        const known = this.elements?.[kind].has(id);
        const from = known ? this.value(kind, id, now) : to;
        if (known && graphHoverAlpha(this.focus, kind, id) !== to) changed = true;
        if (from !== to) next.set(entryKey, { from, to });
        const old = this.fades.get(entryKey);
        if (known && old?.to === to) retained.set(entryKey, old);
      }
    }
    this.focus = focus;
    this.elements = elements;
    if (changed) {
      this.fades = next;
      this.started = now;
    } else {
      // Equivalent focus/data updates must not restart an in-flight fade.
      this.fades = retained;
    }
  }

  value(kind: Kind, id: string, now: number) {
    const fade = this.fades.get(key(kind, id));
    if (!fade) return graphHoverAlpha(this.focus, kind, id);
    return fade.from + (fade.to - fade.from) * progress(now - this.started);
  }

  active(now: number) {
    if (now - this.started >= GRAPH_OPACITY_DURATION) this.fades.clear();
    return this.fades.size > 0;
  }
}
