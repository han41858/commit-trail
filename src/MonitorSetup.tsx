import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import {
  MONITOR_LIMIT,
  monitorRepository,
  normalizeMonitorRepositories,
  moveMonitorRepository,
  type MonitorRepositories,
} from './MonitorRepositories';
import type { RecentRepositories } from './RecentRepositories';
import { lowercaseField } from './repoInput';
import { monitorShareURL } from './repositoryLocation';

export function MonitorSetup({
  current,
  recent,
  saved,
  initial,
  branches,
  onStart,
  onClose,
}: {
  current: string;
  recent: RecentRepositories;
  saved: MonitorRepositories;
  initial?: readonly string[];
  branches?: ReadonlyMap<string, string>;
  onStart: (repositories: string[]) => void;
  onClose: () => void;
}) {
  const visits = useSyncExternalStore(recent.subscribe, recent.getSnapshot);
  const [selected, setSelected] = useState(() => {
    const names = initial ?? saved.getSnapshot();
    // An existing selection can deliberately exclude the single-view repository.
    return normalizeMonitorRepositories(
      initial !== undefined || names.length > 0 ? names : [current],
    );
  });
  const [input, setInput] = useState(''),
    [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copySequence = useRef(0);
  const [dragging, setDragging] = useState(''),
    [orderStatus, setOrderStatus] = useState('');
  const dialog = useRef<HTMLElement>(null),
    field = useRef<HTMLInputElement>(null),
    list = useRef<HTMLOListElement>(null);
  const drag = useRef<{ repository: string; pointerId: number; index: number } | null>(null);
  const available =
    selected.length < MONITOR_LIMIT
      ? visits.entries.filter((entry) => !selected.includes(entry.repository))
      : [];
  useEffect(() => {
    dialog.current?.focus();
  }, []);
  useEffect(
    () => () => {
      copySequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (copyStatus !== 'copied' && copyStatus !== 'failed') return;
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  function resetCopy() {
    copySequence.current++;
    setCopyStatus('idle');
  }
  function add(value: string) {
    let repository: string;
    try {
      repository = monitorRepository(value);
    } catch {
      setError('Enter a GitHub URL or owner/repository.');
      return;
    }
    if (selected.includes(repository)) {
      setError('Repository already selected.');
      return;
    }
    if (selected.length >= MONITOR_LIMIT) {
      setError(`Select up to ${MONITOR_LIMIT} repositories.`);
      return;
    }
    setSelected((names) => [...names, repository]);
    setInput('');
    setError('');
    resetCopy();
    setOrderStatus('');
  }
  async function copyLink() {
    const sequence = ++copySequence.current;
    setCopyStatus('copying');
    try {
      await navigator.clipboard.writeText(
        monitorShareURL(
          location.href,
          selected,
          selected.map((repository) => branches?.get(repository)),
        ),
      );
      if (sequence === copySequence.current) setCopyStatus('copied');
    } catch {
      if (sequence === copySequence.current) setCopyStatus('failed');
    }
  }
  function move(repository: string, index: number) {
    setSelected((names) => moveMonitorRepository(names, repository, index));
    resetCopy();
  }
  function finishDrag(event: PointerEvent<HTMLOListElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging('');
    if (list.current?.hasPointerCapture(current.pointerId))
      list.current.releasePointerCapture(current.pointerId);
    setOrderStatus(
      `${current.repository} moved to position ${current.index + 1} of ${selected.length}.`,
    );
  }
  return (
    <div
      className="monitor-setup-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="monitor-setup floating-panel"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="monitor-setup-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const controls = dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled)',
            );
            if (!controls?.length) return;
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button className="close" aria-label="Close monitor setup" onClick={onClose}>
          ×
        </button>
        <h2 id="monitor-setup-title">Split view</h2>
        <p>Watch up to {MONITOR_LIMIT} repositories side by side. Landscape works best.</p>
        <ol
          className="monitor-selected"
          ref={list}
          aria-label="Selected repositories"
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId || !list.current) return;
            const rows = [...list.current.children];
            let target = 0,
              distance = Infinity;
            rows.forEach((row, index) => {
              const rect = row.getBoundingClientRect(),
                next = Math.abs(event.clientY - (rect.top + rect.height / 2));
              if (next < distance) {
                target = index;
                distance = next;
              }
            });
            current.index = target;
            move(current.repository, target);
            const panel = dialog.current;
            if (panel) {
              const rect = panel.getBoundingClientRect();
              if (event.clientY > rect.bottom - 28) panel.scrollTop += 12;
              else if (event.clientY < rect.top + 28) panel.scrollTop -= 12;
            }
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
        >
          {selected.map((repository, index) => (
            <li key={repository} data-dragging={dragging === repository}>
              <button
                type="button"
                className="monitor-drag"
                aria-label={`Reorder ${repository}`}
                aria-description="Drag or use Up/Down to reorder"
                aria-pressed={dragging === repository}
                disabled={selected.length < 2}
                title="Drag or use Up/Down to reorder"
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0 || drag.current || selected.length < 2)
                    return;
                  event.preventDefault();
                  event.currentTarget.focus({ preventScroll: true });
                  drag.current = { repository, pointerId: event.pointerId, index };
                  setDragging(repository);
                  setOrderStatus('');
                  list.current?.setPointerCapture(event.pointerId);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault();
                  const target = Math.max(
                    0,
                    Math.min(selected.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                  );
                  move(repository, target);
                  setOrderStatus(
                    `${repository} moved to position ${target + 1} of ${selected.length}.`,
                  );
                }}
              >
                <svg
                  width="16"
                  height="18"
                  viewBox="0 0 16 18"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  {[4, 9, 14].flatMap((y) =>
                    [5, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />),
                  )}
                </svg>
              </button>
              <span title={repository}>{repository}</span>
              <button
                type="button"
                aria-label={`Remove ${repository} from monitor`}
                onClick={() => {
                  setSelected((names) => names.filter((name) => name !== repository));
                  setError('');
                  resetCopy();
                  setOrderStatus('');
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
        <div className="monitor-order-status" role="status" aria-live="polite">
          {orderStatus}
        </div>
        <form
          className="monitor-add"
          onSubmit={(event) => {
            event.preventDefault();
            add(input);
            field.current?.focus();
          }}
        >
          <input
            ref={field}
            aria-label="Repository to monitor"
            placeholder="owner/repository"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={input}
            onChange={(event) => {
              setInput(lowercaseField(event.currentTarget));
              setError('');
            }}
          />
          <button type="submit" disabled={selected.length >= MONITOR_LIMIT}>
            Add
          </button>
        </form>
        {error && (
          <p className="monitor-setup-error" role="alert">
            {error}
          </p>
        )}
        {available.length > 0 && (
          <>
            <h3>Recent repositories</h3>
            <div className="monitor-recent">
              {available.map((entry) => (
                <button
                  type="button"
                  key={entry.repository}
                  title={entry.repository}
                  aria-label={`Add ${entry.repository} to monitor`}
                  onClick={() => add(entry.repository)}
                >
                  <span>{entry.repository}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <p className="monitor-share-note">
          Shared links include repository and branch names, including private ones. Share with care.
        </p>
        <div className="monitor-copy-status" role="status" aria-live="polite">
          {
            { idle: '', copying: '', copied: 'Link copied.', failed: 'Could not copy link.' }[
              copyStatus
            ]
          }
        </div>
        <div className="monitor-setup-actions">
          <small>
            {selected.length} / {MONITOR_LIMIT}
          </small>
          <button
            type="button"
            className="monitor-copy"
            data-state={copyStatus}
            aria-label="Copy link"
            aria-busy={copyStatus === 'copying'}
            disabled={!selected.length || copyStatus === 'copying'}
            onClick={() => void copyLink()}
          >
            {
              { idle: 'Copy link', copying: 'Copy link', copied: 'Copied!', failed: 'Copy failed' }[
                copyStatus
              ]
            }
          </button>
          <button
            type="button"
            className="primary"
            disabled={!selected.length}
            onClick={() => onStart(selected)}
          >
            Start split view
          </button>
        </div>
      </section>
    </div>
  );
}
