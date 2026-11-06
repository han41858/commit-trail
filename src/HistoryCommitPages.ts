import { commitsPage } from './api';
import { debug } from './debug';
import { RequestPool } from './RequestPool';

// One traversal owns its page cache and in-flight requests. History supplies the
// cancellation signals and resets the reader when the repository or traversal changes.
export class HistoryCommitPages {
  private pool = new RequestPool();
  private pages = new Map<string, Awaited<ReturnType<typeof commitsPage>>>();
  private requests = new Map<string, ReturnType<typeof commitsPage>>();

  reset() {
    this.pool = new RequestPool();
    this.pages.clear();
    this.requests.clear();
  }

  get(
    repo: string,
    ref: string,
    page: number,
    token: string,
    signal: AbortSignal,
    since?: number,
  ) {
    const key = `${ref}:${page}:${since ?? ''}`;
    const cached = this.pages.get(key);
    if (cached) {
      debug.cache('commits', debug.forSignal(signal));
      return Promise.resolve(cached);
    }
    const existing = this.requests.get(key);
    if (existing) {
      debug.cache('commits', debug.forSignal(signal), 'shared');
      return existing;
    }
    const request = this.pool
      .run(signal, () => commitsPage(repo, ref, page, token, signal, since))
      .then((result) => {
        signal.throwIfAborted();
        const immutable = /^[a-f0-9]{40}$/i.test(ref);
        // Validate an unfiltered head page before caching it or accepting new refs.
        // Later forward pages and since-filtered discovery may omit the head.
        if (
          immutable &&
          page === 1 &&
          since === undefined &&
          (!Array.isArray(result.data) || !result.data.some((commit) => commit.sha === ref))
        )
          throw new Error(
            'GitHub did not return the requested commit. Retry to continue this branch.',
          );
        if (immutable) this.pages.set(key, result);
        return result;
      })
      .finally(() => {
        if (this.requests.get(key) === request) this.requests.delete(key);
      });
    this.requests.set(key, request);
    return request;
  }
}
