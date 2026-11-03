import type { ReactNode } from 'react';
import type { RunStatus } from './CommitInfo';

const cross = <path d="m3.5 3.5 9 9m0-9-9 9" />;
const clock = (
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </>
);
const shapes: Record<RunStatus['icon'], ReactNode> = {
  success: <path d="m3 8 3 3 7-7" />,
  failure: cross,
  startup_failure: cross,
  timed_out: clock,
  queued: clock,
  running: <path d="M8 2a6 6 0 1 1-6 6" />,
  cancelled: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m4 12 8-8" />
    </>
  ),
  skipped: <path d="m3 3 7 5-7 5V3m10 0v10" />,
  neutral: <path d="M3 8h10" />,
  action_required: (
    <>
      <path d="m8 1.5 6.5 12h-13Z" />
      <path d="M8 5v3.5m0 2.5h.01" />
    </>
  ),
  stale: (
    <>
      <circle cx="6.5" cy="8" r="5.5" />
      <path d="M6.5 5v3l2 1M14.5 4v4m0 3h.01" />
    </>
  ),
  unknown: <path d="M5.5 5a2.5 2.5 0 1 1 4.2 1.8C8.5 7.5 8 8 8 9.5M8 12.5h.01" />,
};
export function ActionStatusIcon({ status }: { status: RunStatus }) {
  return (
    <span
      className={`run-status run-status-${status.icon}`}
      role="img"
      aria-label={status.label}
      title={status.label}
    >
      <svg className="run-status-icon" viewBox="0 0 16 16" aria-hidden="true">
        {shapes[status.icon]}
      </svg>
    </span>
  );
}
