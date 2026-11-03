import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { monitorDropTarget } from './monitorReorder';

type Entry = { repository: string };
type Drag = {
  repository: string;
  entries: readonly Entry[];
  element: HTMLButtonElement;
  pointerId: number;
  from: number;
  to: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
};
type Visual = { repository: string; x: number; y: number; line: number };

export const MonitorReorder = memo(function MonitorReorder({
  entries,
  onReorder,
}: {
  entries: readonly Entry[];
  onReorder: (repository: string, to: number) => void;
}) {
  const grid = useRef<HTMLDivElement>(null),
    preview = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    longPress = useRef<number | null>(null);
  const [visual, setVisual] = useState<Visual | null>(null),
    [announcement, setAnnouncement] = useState('');
  const reset = useCallback((message = '', update = true) => {
    if (longPress.current !== null) window.clearTimeout(longPress.current);
    longPress.current = null;
    const current = drag.current;
    drag.current = null;
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    if (update) {
      setVisual(null);
      if (message) setAnnouncement(message);
    }
  }, []);
  useEffect(() => {
    reset();
    return () => reset('', false);
  }, [entries, reset]);
  useEffect(() => {
    const cancel = () => {
      if (drag.current) reset(`Reordering ${drag.current.repository} cancelled.`);
    };
    const escape = (event: KeyboardEvent) => {
      if (!drag.current || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, [reset]);
  useLayoutEffect(() => {
    if (!visual || !preview.current) return;
    const viewport = window.visualViewport,
      left = viewport?.offsetLeft || 0,
      top = viewport?.offsetTop || 0,
      width = viewport?.width || window.innerWidth,
      height = viewport?.height || window.innerHeight,
      element = preview.current;
    element.style.maxWidth = `${Math.max(0, Math.min(280, width - 16))}px`;
    const size = element.getBoundingClientRect();
    element.style.left = `${Math.max(left + 8, Math.min(visual.x + 12, left + width - size.width - 8))}px`;
    element.style.top = `${Math.max(top + 8, Math.min(visual.y + 10, top + height - size.height - 8))}px`;
  }, [visual]);
  function move(current: Drag) {
    const bounds = [...(grid.current?.children || [])].map((element) =>
      element.getBoundingClientRect(),
    );
    const target = monitorDropTarget(bounds, current.x, current.from);
    if (!target) return;
    if (current.to !== target.to)
      setAnnouncement(
        `Moving ${current.repository}. Position ${target.to + 1} of ${entries.length}.`,
      );
    current.to = target.to;
    setVisual({ repository: current.repository, x: current.x, y: current.y, line: target.left });
  }
  function activate(current: Drag) {
    if (drag.current !== current || !current.element.isConnected) return;
    current.active = true;
    current.element.setPointerCapture(current.pointerId);
    setAnnouncement(
      `Moving ${current.repository}. Position ${current.from + 1} of ${entries.length}.`,
    );
    move(current);
  }
  function finish(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const valid = current.active && current.entries === entries;
    reset();
    if (commit && valid && current.from !== current.to) {
      onReorder(current.repository, current.to);
      setAnnouncement(
        `${current.repository} moved to position ${current.to + 1} of ${entries.length}.`,
      );
    } else if (current.active)
      setAnnouncement(
        commit && valid
          ? `${current.repository} kept position ${current.from + 1} of ${entries.length}.`
          : `Reordering ${current.repository} cancelled.`,
      );
  }
  return (
    <>
      <div className="monitor-repositories" ref={grid}>
        {entries.map((entry, index) => (
          <h2
            className="monitor-repository"
            key={entry.repository}
            data-dragging={visual?.repository === entry.repository}
          >
            <button
              type="button"
              className="monitor-reorder-handle"
              title="Drag to reorder"
              aria-label={`Reorder ${entry.repository}`}
              aria-description="Drag to reorder. Keyboard ordering is available in Split view setup."
              aria-pressed={visual?.repository === entry.repository}
              disabled={entries.length < 2}
              onContextMenu={(event) => event.preventDefault()}
              onDragStart={(event) => event.preventDefault()}
              onClick={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0 || drag.current) return;
                const current: Drag = {
                  repository: entry.repository,
                  entries,
                  element: event.currentTarget,
                  pointerId: event.pointerId,
                  from: index,
                  to: index,
                  startX: event.clientX,
                  startY: event.clientY,
                  x: event.clientX,
                  y: event.clientY,
                  active: false,
                };
                drag.current = current;
                if (event.pointerType === 'touch') {
                  longPress.current = window.setTimeout(() => {
                    longPress.current = null;
                    activate(current);
                  }, 400);
                } else {
                  event.preventDefault();
                  activate(current);
                }
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (!current || current.pointerId !== event.pointerId) return;
                current.x = event.clientX;
                current.y = event.clientY;
                if (!current.active) {
                  if (Math.hypot(current.x - current.startX, current.y - current.startY) > 6)
                    reset(`Reordering ${current.repository} cancelled.`);
                  return;
                }
                event.preventDefault();
                move(current);
              }}
              onPointerUp={(event) => finish(event, true)}
              onPointerCancel={(event) => finish(event, false)}
              onLostPointerCapture={(event) => finish(event, false)}
            >
              <svg
                width="12"
                height="16"
                viewBox="0 0 16 18"
                fill="currentColor"
                aria-hidden="true"
              >
                {[4, 9, 14].flatMap((y) =>
                  [5, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />),
                )}
              </svg>
            </button>
            <a
              href={`https://github.com/${entry.repository}`}
              target="_blank"
              rel="noopener noreferrer"
              title={entry.repository}
            >
              {entry.repository}
            </a>
          </h2>
        ))}
      </div>
      {visual && (
        <>
          <div className="monitor-drag-preview" ref={preview} aria-hidden="true">
            {visual.repository}
          </div>
          <div
            className="monitor-insertion"
            style={{ left: Math.max(1, Math.min(visual.line, window.innerWidth - 1)) }}
            aria-hidden="true"
          />
        </>
      )}
      <div className="monitor-order-status" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );
});
