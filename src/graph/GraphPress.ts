// Only a stationary, short touch can pin a graph path. Mouse clicks retain
// their native click semantics; neither input prevents browser scrolling.
export class GraphPress {
  private cancelled = false;
  readonly radius: number;
  constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly started: number,
    private readonly touch: boolean,
  ) {
    this.radius = touch ? 12 : 5;
  }
  move(x: number, y: number) {
    if (Math.hypot(x - this.x, y - this.y) > 8) this.cancel();
  }
  cancel() {
    this.cancelled = true;
  }
  acceptsClick(now: number) {
    return !this.cancelled && (!this.touch || now - this.started <= 500);
  }
}
