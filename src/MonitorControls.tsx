import type { MonitorSession } from './MonitorSession';
import type { RefreshState } from './RefreshLoop';
import { RefreshTimer } from './RefreshButton';
import { MonitorReorder } from './MonitorReorder';

export function MonitorControls({
  monitorState,
  refreshState,
  seconds,
  autoRefresh,
  limited,
  onRefresh,
  onReorder,
  onExit,
}: {
  monitorState: ReturnType<MonitorSession['getSnapshot']>;
  refreshState: RefreshState;
  seconds: number;
  autoRefresh: boolean;
  limited: boolean;
  onRefresh: () => void;
  onReorder: (repository: string, to: number) => void;
  onExit: () => void;
}) {
  return (
    <header
      className="monitor-controls"
      aria-label="Repository monitor controls"
    >
      <RefreshTimer
        nextAt={Math.max(refreshState.nextAt, monitorState.retryAt)}
        interval={seconds * 1000}
        sweeping={
          autoRefresh && !refreshState.waitingForInitialLoad && !limited
        }
        running={monitorState.running.size > 0}
        paused={!autoRefresh || limited}
        disabled={
          refreshState.waitingForInitialLoad || limited || refreshState.running
        }
        onRefresh={onRefresh}
      />
      <MonitorReorder entries={monitorState.entries} onReorder={onReorder} />
      <button
        type="button"
        className="monitor-exit"
        aria-label="Return to single view"
        title="Return to single view"
        onClick={onExit}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m12 5-7 7 7 7M5 12h14" />
        </svg>
      </button>
    </header>
  );
}
