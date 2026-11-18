import type { MonitorSession } from './MonitorSession';
import type { RefreshState } from '../shared/refresh/RefreshLoop';
import { RefreshFill, RefreshTimer } from '../shared/refresh/RefreshButton';
import { MonitorReorder } from './MonitorReorder';
import { useId, useRef, useState, type RefObject } from 'react';

export function MonitorControls({
  monitorState,
  refreshState,
  seconds,
  autoRefresh,
  limited,
  onRefresh,
  onReorder,
  onManage,
  manageRef,
  onExit,
}: {
  monitorState: ReturnType<MonitorSession['getSnapshot']>;
  refreshState: RefreshState;
  seconds: number;
  autoRefresh: boolean;
  limited: boolean;
  onRefresh: () => void;
  onReorder: (repository: string, to: number) => void;
  onManage: () => void;
  manageRef: RefObject<HTMLButtonElement | null>;
  onExit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  const nextAt = Math.max(refreshState.nextAt, monitorState.retryAt),
    sweeping = autoRefresh && !refreshState.waitingForInitialLoad && !limited;
  return (
    <header
      className="monitor-controls"
      aria-label="Repository monitor controls"
    >
      <div
        className="monitor-actions"
        data-expanded={expanded}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            event.stopPropagation();
            setExpanded(false);
            toggle.current?.focus();
          }
        }}
      >
        <div
          className="monitor-drawer"
          id={drawerId}
          inert={!expanded}
          aria-hidden={!expanded}
        >
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
          <RefreshTimer
            nextAt={nextAt}
            interval={seconds * 1000}
            sweeping={sweeping}
            running={monitorState.running.size > 0}
            paused={!autoRefresh || limited}
            disabled={
              refreshState.waitingForInitialLoad ||
              limited ||
              refreshState.running
            }
            onRefresh={onRefresh}
          />
          <button
            type="button"
            className="monitor-manage"
            ref={manageRef}
            aria-label="Manage repositories"
            title="Manage repositories"
            onClick={onManage}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 12H3M16 6H3M16 18H3M18 9v6M21 12h-6" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="monitor-toggle"
          ref={toggle}
          aria-label={
            expanded ? 'Hide monitor controls' : 'Show monitor controls'
          }
          title={expanded ? 'Hide monitor controls' : 'Show monitor controls'}
          aria-expanded={expanded}
          aria-controls={drawerId}
          onClick={() => setExpanded((value) => !value)}
        >
          <RefreshFill
            nextAt={nextAt}
            interval={seconds * 1000}
            sweeping={!expanded && sweeping}
            variant="rise"
          />
          <svg
            className="refresh-symbol"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d={expanded ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
          </svg>
        </button>
      </div>
      <MonitorReorder entries={monitorState.entries} onReorder={onReorder} />
    </header>
  );
}
