type UpdateState = { visible: boolean; applying: boolean; error: string };
const initial = (): UpdateState => ({
  visible: false,
  applying: false,
  error: '',
});

// App-version updates are independent of GitHub refreshes and never receive app data or tokens.
export class PwaUpdates {
  private state = initial();
  private listeners = new Set<() => void>();
  private worker: object | undefined;
  private dismissed = new WeakSet<object>();
  private approved = false;
  private reloading = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly activate: () => Promise<void>,
    private readonly reload: () => void,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  ready = (worker: object) => {
    const changed = this.worker !== worker;
    this.worker = worker;
    if (this.dismissed.has(worker) || this.state.applying) return;
    if (changed || !this.state.visible)
      this.publish({ visible: true, error: '' });
  };
  dismiss = () => {
    if (this.state.applying) return;
    if (this.worker) this.dismissed.add(this.worker);
    this.publish({ visible: false, error: '' });
  };
  controlled = (worker: object) => {
    if (!this.approved) {
      this.ready(worker);
      return;
    }
    if (this.reloading) return;
    this.reloading = true;
    clearTimeout(this.timer);
    this.reload();
  };
  apply = async () => {
    if (!this.state.visible || this.state.applying) return;
    this.approved = true;
    this.publish({ applying: true, error: '' });
    const failed = () => {
      this.approved = false;
      clearTimeout(this.timer);
      this.publish({
        applying: false,
        error: 'Could not apply the update. Please try again.',
      });
    };
    this.timer = setTimeout(failed, 15000);
    try {
      await this.activate();
    } catch {
      failed();
    }
  };
}
