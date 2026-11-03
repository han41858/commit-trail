// The renderer places nodes on fixed columns. Retain the vertical intervals
// actually traversed in each column, including skipped frames during a fling.
export type GraphViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
  inset: number;
};
type Interval = { top: number; bottom: number };
export class FrontierViewport {
  private previous: GraphViewport | undefined;
  private columns = new Map<number, Interval[]>();
  private rows: readonly string[] = [];
  private inset = 0;
  private rowHeight = 1;
  constructor(
    private readonly origin = 48,
    private readonly spacing = 34,
  ) {}
  // Keep traversed history tied to commits when parallel pages insert/reorder rows.
  // Pixel ranges alone can otherwise leave a new main boundary behind the range.
  rebase(rows: readonly string[], inset: number, rowHeight: number) {
    if (
      inset === this.inset &&
      rowHeight === this.rowHeight &&
      rows.length === this.rows.length &&
      rows.every((sha, index) => sha === this.rows[index])
    )
      return;
    const next = new Map(rows.map((sha, index) => [sha, inset + index * rowHeight]));
    const anchors = this.rows.flatMap((sha, index) => {
      const y = next.get(sha);
      return y === undefined ? [] : [{ before: this.inset + index * this.rowHeight, after: y }];
    });
    if (anchors.length) {
      const scale = rowHeight / this.rowHeight;
      const translate = (y: number) => {
        let low = 0,
          high = anchors.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (anchors[middle].before <= y) low = middle + 1;
          else high = middle;
        }
        const anchor = anchors[Math.max(0, low - 1)];
        return anchor.after + (y - anchor.before) * scale;
      };
      const monotonic = anchors.every(
        (anchor, index) => index === 0 || anchor.after > anchors[index - 1].after,
      );
      const columns = this.columns;
      this.columns = new Map();
      for (const [column, intervals] of columns)
        for (const interval of intervals) {
          const first = translate(interval.top),
            last = translate(interval.bottom);
          let top = Math.min(first, last),
            bottom = Math.max(first, last);
          // Topological ordering can also move an existing row outside its old neighbors.
          if (!monotonic)
            for (const anchor of anchors)
              if (anchor.before >= interval.top && anchor.before <= interval.bottom) {
                top = Math.min(top, anchor.after);
                bottom = Math.max(bottom, anchor.after);
              }
          this.remember(column, top, bottom);
        }
      if (this.previous)
        this.previous = {
          ...this.previous,
          top: this.previous.top > 0 ? Math.max(0, translate(this.previous.top)) : 0,
          inset,
        };
    } else if (this.rows.length) {
      this.columns.clear();
      this.previous = undefined;
    }
    this.rows = rows;
    this.inset = inset;
    this.rowHeight = rowHeight;
  }
  visit(current: GraphViewport) {
    if (current.width <= 0 || current.height <= 0) return;
    const before = this.previous ?? current;
    this.previous = current;
    const first = Math.max(
      0,
      Math.ceil((Math.min(before.left, current.left) - 22 - this.origin) / this.spacing),
    );
    const last = Math.floor(
      (Math.max(before.left + before.width, current.left + current.width) + 22 - this.origin) /
        this.spacing,
    );
    for (let column = first; column <= last; column++) {
      const x = this.origin + column * this.spacing;
      let from = 0,
        to = 1;
      const atMost = (start: number, end: number, value: number) => {
        const delta = end - start;
        if (delta === 0) return start <= value;
        const t = (value - start) / delta;
        if (delta > 0) to = Math.min(to, t);
        else from = Math.max(from, t);
        return from <= to;
      };
      // Clip the movement to the time when this column was horizontally visible.
      if (
        !atMost(before.left - 22, current.left - 22, x) ||
        !atMost(-before.left - before.width - 22, -current.left - current.width - 22, -x)
      )
        continue;
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const topBefore = before.top + before.inset - 60,
        topAfter = current.top + current.inset - 60;
      const bottomBefore = before.top + before.height + 300,
        bottomAfter = current.top + current.height + 300;
      const top = Math.min(lerp(topBefore, topAfter, from), lerp(topBefore, topAfter, to));
      const bottom = Math.max(
        lerp(bottomBefore, bottomAfter, from),
        lerp(bottomBefore, bottomAfter, to),
      );
      this.remember(column, top, bottom);
    }
  }
  private remember(column: number, top: number, bottom: number) {
    if (top > bottom) return;
    const intervals = this.columns.get(column) ?? [];
    let start = 0,
      end = 0;
    while (start < intervals.length && intervals[start].bottom < top) start++;
    end = start;
    while (end < intervals.length && intervals[end].top <= bottom) {
      top = Math.min(top, intervals[end].top);
      bottom = Math.max(bottom, intervals[end].bottom);
      end++;
    }
    intervals.splice(start, end - start, { top, bottom });
    this.columns.set(column, intervals);
  }
  contains(point: { x: number; y: number }) {
    const column = Math.round((point.x - this.origin) / this.spacing),
      intervals = this.columns.get(column);
    if (!intervals) return false;
    let low = 0,
      high = intervals.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (intervals[middle].bottom < point.y) low = middle + 1;
      else high = middle;
    }
    return low < intervals.length && intervals[low].top <= point.y;
  }
}
