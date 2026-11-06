import type { HistorySnapshot } from './history';
import type { InfoSnapshot } from './CommitInfoStore';
import type { RefreshState } from './RefreshLoop';
import { LoadingIndicator } from './LoadingIndicator';
import { retryLabel } from './useRetryCountdown';

export function AppStatus({
  state,
  extras,
  refreshState,
  discoverySeconds,
  refreshRetrySeconds,
  onRetryDiscovery,
}: {
  state: HistorySnapshot;
  extras: InfoSnapshot;
  refreshState: RefreshState;
  discoverySeconds: number;
  refreshRetrySeconds: number;
  onRetryDiscovery: () => void;
}) {
  return (
    <footer className="graph-status" aria-live="polite">
      <span>{state.commits.length.toLocaleString()} commits</span>
      <LoadingIndicator busy={state.busy || extras.busy || refreshState.running} />
      {state.discoveryError && (
        <button
          className="discovery-retry"
          title={state.discoveryError}
          aria-label="Retry recent branch discovery"
          disabled={state.busy || !!state.error || discoverySeconds > 0}
          onClick={onRetryDiscovery}
        >
          {discoverySeconds ? retryLabel(discoverySeconds) : 'Retry branches'}
        </button>
      )}
      {state.meta &&
        !refreshState.running &&
        (refreshRetrySeconds > 0 ||
          !!refreshState.error ||
          refreshState.lastCompletedAt !== null) && (
          <span className="refresh-status" role="status" title={refreshState.error || undefined}>
            {refreshRetrySeconds
              ? `Retry in ${refreshRetrySeconds}s`
              : refreshState.error
                ? 'Refresh failed'
                : refreshState.lastCompletedAt !== null
                  ? `Updated ${new Date(refreshState.lastCompletedAt).toLocaleTimeString()}`
                  : ''}
          </span>
        )}
      {Object.keys(extras.errors).length > 0 && (
        <span className="metadata-error" title={Object.values(extras.errors).join(' · ')}>
          Metadata unavailable
        </span>
      )}
    </footer>
  );
}
