// Loading never schedules another page. Only new downward user movement can
// request a batch; the cooldown groups wheel/touch/scroll events from one gesture.
export class OwnerRepositoryScroll {
  private top = 0;
  private nextGestureAt = 0;

  reset() {
    this.top = 0;
    this.nextGestureAt = 0;
  }

  move(top: number) {
    const movement = top - this.top;
    this.top = top;
    return movement;
  }

  request(
    area: { scrollTop: number; clientHeight: number; scrollHeight: number },
    movement: number,
    ready: boolean,
    filtered: boolean,
    now = performance.now(),
  ) {
    if (movement <= 0) return false;
    const previous = this.nextGestureAt;
    this.nextGestureAt = now + 300;
    return (
      ready &&
      !filtered &&
      now >= previous &&
      area.scrollTop + area.clientHeight >= area.scrollHeight - 120
    );
  }
}
