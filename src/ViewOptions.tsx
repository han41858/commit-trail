import type { RefObject } from 'react';

const BUILD_DATE = import.meta.env.DEV
  ? ''
  : (() => {
      const builtAt = new Date(__BUILD_TIME__);
      const date = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(builtAt);
      const time = `${String(builtAt.getHours()).padStart(2, '0')}:${String(builtAt.getMinutes()).padStart(2, '0')}`;
      return `${date} ${time}`;
    })();

export function ViewOptions({
  panelRef,
  open,
  theme,
  autoRefresh,
  seconds,
  hasToken,
  onOpenChange,
  onThemeChange,
  onAutoRefreshChange,
  onIntervalChange,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  theme: string;
  autoRefresh: boolean;
  seconds: number;
  hasToken: boolean;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (theme: string) => void;
  onAutoRefreshChange: (enabled: boolean) => void;
  onIntervalChange: (seconds: number) => void;
}) {
  return (
    <div className="options" ref={panelRef}>
      <button
        className="options-trigger"
        aria-label="Options"
        aria-expanded={open}
        aria-controls="options-menu"
        onClick={() => onOpenChange(!open)}
      >
        •••
      </button>
      {open && (
        <section
          className="options-menu floating-panel"
          id="options-menu"
          aria-label="View options"
        >
          <label>
            Theme
            <select
              aria-label="Color theme"
              value={theme}
              onChange={(e) => onThemeChange(e.target.value)}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label>
            Auto refresh
            <input
              type="checkbox"
              aria-label="Auto refresh"
              checked={autoRefresh}
              onChange={(e) => onAutoRefreshChange(e.target.checked)}
            />
          </label>
          <label>
            Interval
            <select
              aria-label="Refresh interval"
              value={seconds}
              onChange={(e) => onIntervalChange(Number(e.target.value))}
            >
              {hasToken && <option value={30}>30 seconds</option>}
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
            </select>
          </label>
          <small className="build-info">
            {import.meta.env.DEV ? (
              'Development'
            ) : (
              <>
                {'Built at '}
                <time dateTime={__BUILD_TIME__} dir="auto" title={BUILD_DATE}>
                  {BUILD_DATE}
                </time>
              </>
            )}
          </small>
        </section>
      )}
    </div>
  );
}
