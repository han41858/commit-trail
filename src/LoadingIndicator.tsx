import { useCallback, useSyncExternalStore } from 'react';
import { requestActivity } from './requestActivity';

export function LoadingIndicator({
  busy,
  repository,
  label = 'Loading history',
}: {
  busy: boolean;
  repository?: string;
  label?: string;
}) {
  const snapshot = useCallback(() => requestActivity.getSnapshot(repository), [repository]);
  const active = useSyncExternalStore(requestActivity.subscribe, snapshot);
  if (!busy && !active) return null;
  const speed = active > 8 ? 'fast' : active > 4 ? 'medium' : 'slow';
  return (
    <span
      className="history-loading"
      role="status"
      aria-label={active ? `${label}, ${active} active requests` : label}
      aria-live="off"
    >
      <span className="loading-spinner" data-speed={speed} aria-hidden="true" />
      {active > 0 && (
        <span className="request-count" aria-hidden="true">
          x{active}
        </span>
      )}
    </span>
  );
}
