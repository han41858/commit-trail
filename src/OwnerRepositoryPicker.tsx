import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OwnerRepositories } from './OwnerRepositories';
import { LoadingIndicator } from './LoadingIndicator';
import { MONITOR_LIMIT } from './MonitorRepositories';
import { retryLabel, useRetryCountdown } from './useRetryCountdown';
import './ownerRepositories.css';

type Props = {
  id?: string;
  model: OwnerRepositories;
  onSelect: (repository: string) => void;
  onSelectMany?: (repositories: string[]) => void;
  selectionLimit?: number;
  onClose: () => void;
  inline?: boolean;
  excluded?: readonly string[];
  disabled?: boolean;
};

export function OwnerRepositoryPicker({
  id,
  model,
  onSelect,
  onSelectMany,
  selectionLimit = MONITOR_LIMIT,
  onClose,
  inline = false,
  excluded = [],
  disabled = false,
}: Props) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const panel = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const headingId = useId();
  const hintId = useId();
  const publicWait = useRetryCountdown(snapshot.public.retryAt);
  const authenticatedWait = useRetryCountdown(snapshot.authenticated.retryAt);
  const sources = [
    { ...snapshot.public, wait: publicWait },
    { ...snapshot.authenticated, wait: authenticatedWait },
  ];
  const more = sources.some((source) => source.more);
  const failed = sources.filter((source) => source.error);
  const canRetry = !snapshot.busy && failed.some((source) => !source.busy && source.wait === 0);
  const retryWait = failed.length ? Math.min(...failed.map((source) => source.wait)) : 0;
  const canLoadMore =
    !snapshot.busy &&
    sources.some((source) => source.more && !source.error && !source.busy && source.wait === 0);
  const search = query.trim().toLowerCase();
  const shown = snapshot.repositories.filter((repository) =>
    repository.name.toLowerCase().includes(search),
  );
  const isExcluded = (repository: string) =>
    excluded.some((name) => name.toLowerCase() === repository.toLowerCase());
  const multiple = onSelectMany !== undefined;
  const limit = Math.max(0, selectionLimit);
  const choices = pending.filter((repository) => !isExcluded(repository));
  const isPending = (repository: string) =>
    choices.some((name) => name.toLowerCase() === repository.toLowerCase());
  const isBlocked = (repository: string) =>
    isExcluded(repository) ||
    (multiple
      ? !isPending(repository) && (disabled || choices.length >= limit)
      : disabled);
  const selectable = shown.filter((repository) => !isBlocked(repository.full_name));
  const selected = selectable.find((repository) => repository.id === active) ?? selectable[0];
  const activeId = selected ? `${listId}-${selected.id}` : undefined;

  function toggle(repository: string) {
    if (isExcluded(repository)) return;
    setPending((names) => {
      const next = names.filter((name) => !isExcluded(name));
      if (next.some((name) => name.toLowerCase() === repository.toLowerCase()))
        return next.filter((name) => name.toLowerCase() !== repository.toLowerCase());
      if (disabled || next.length >= limit) return next;
      return [...next, repository];
    });
  }

  function focusChoice(index: number) {
    const repository = selectable[index];
    if (!repository) return;
    setActive(repository.id);
    document.getElementById(`${listId}-${repository.id}`)?.focus({ preventScroll: true });
  }

  useEffect(() => {
    setQuery('');
    setActive(null);
    setPending([]);
    field.current?.focus({ preventScroll: true });
  }, [snapshot.owner, multiple]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const anchor = element.parentElement;
    let scrollArea = inline ? anchor : null;
    while (scrollArea && !/(auto|scroll)/.test(getComputedStyle(scrollArea).overflowY))
      scrollArea = scrollArea.parentElement;
    const visibleBounds = () => {
      const viewportTop = viewport?.offsetTop || 0;
      const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
      if (!scrollArea) return { top: viewportTop, bottom: viewportBottom };
      const innerTop = scrollArea.getBoundingClientRect().top + scrollArea.clientTop;
      return {
        top: Math.max(viewportTop, innerTop),
        bottom: Math.min(viewportBottom, innerTop + scrollArea.clientHeight),
      };
    };
    const update = () => {
      const left = viewport?.offsetLeft || 0;
      const width = viewport?.width || window.innerWidth;
      if (!inline && anchor) {
        const rect = anchor.getBoundingClientRect();
        const availableWidth = Math.max(0, width - 16);
        const panelWidth = Math.min(rect.width, availableWidth);
        const x = Math.max(left + 8, Math.min(rect.left, left + width - panelWidth - 8));
        element.style.maxWidth = `${availableWidth}px`;
        element.style.left = `${x - rect.left}px`;
      }
      const bounds = visibleBounds();
      const available =
        bounds.bottom - Math.max(bounds.top, element.getBoundingClientRect().top) - 8;
      element.style.maxHeight = `${Math.max(0, Math.min(380, available))}px`;
    };
    const fit = () => {
      if (inline) {
        const bounds = visibleBounds();
        element.style.maxHeight = `${Math.max(0, Math.min(380, bounds.bottom - bounds.top - 8))}px`;
        element.scrollIntoView({ block: 'nearest' });
      }
      update();
    };
    fit();
    const observer = !inline && anchor ? new ResizeObserver(update) : null;
    if (anchor) observer?.observe(anchor);
    window.addEventListener('resize', fit);
    document.addEventListener('scroll', update, true);
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
      document.removeEventListener('scroll', update, true);
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', update);
    };
  }, [inline, snapshot.owner]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  useEffect(() => {
    const target = sentinel.current;
    const root = inline ? content.current : list.current;
    if (!target || !root || !canLoadMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void model.loadMore();
      },
      { root, rootMargin: '0px 0px 120px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [model, inline, canLoadMore, snapshot.owner, snapshot.repositories, search]);

  if (!snapshot.owner) return null;

  let empty = snapshot.authenticated.enabled
    ? 'No accessible repositories found for this owner.'
    : 'No public repositories found for this owner.';
  if (search) empty = 'No matching repositories in the loaded pages.';
  else if (snapshot.busy) empty = 'Loading repositories…';
  else if (failed.length) empty = 'No repositories loaded.';
  else if (more) empty = 'No repositories for this owner in the loaded pages. Scroll to continue.';

  return (
    <section
      id={id}
      ref={panel}
      className={`owner-picker${inline ? ' owner-picker-inline' : ''}`}
      role={inline ? 'region' : 'dialog'}
      aria-label={inline ? `Repositories for ${snapshot.owner}` : undefined}
      aria-labelledby={inline ? undefined : headingId}
      aria-busy={snapshot.busy}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {!inline && (
        <div className="owner-picker-heading">
          <strong id={headingId}>Repositories for {snapshot.owner}</strong>
          {snapshot.busy && <LoadingIndicator busy label="Loading repositories" />}
          <button
            type="button"
            className="owner-picker-close"
            aria-label="Close repositories"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      )}
      <input
        ref={field}
        data-owner-filter=""
        className="owner-repository-filter"
        aria-label="Filter repositories"
        role={multiple ? undefined : 'combobox'}
        aria-autocomplete={multiple ? undefined : 'list'}
        aria-haspopup={multiple ? undefined : 'listbox'}
        aria-expanded={multiple ? undefined : true}
        aria-controls={listId}
        aria-activedescendant={multiple ? undefined : activeId}
        aria-describedby={hintId}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Filter loaded repositories"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(null);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            if (!selectable.length) return;
            if (multiple) {
              focusChoice(event.key === 'ArrowDown' ? 0 : selectable.length - 1);
              return;
            }
            const current = selectable.findIndex((repository) => repository.id === selected?.id);
            const next =
              (current + (event.key === 'ArrowDown' ? 1 : -1) + selectable.length) %
              selectable.length;
            setActive(selectable[next].id);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (selected) {
              if (multiple) toggle(selected.full_name);
              else onSelect(selected.full_name);
            }
          }
        }}
      />
      <div ref={content} className="owner-picker-content">
        <small id={hintId} className="owner-picker-hint">
          {snapshot.repositories.length.toLocaleString()} loaded · Name A–Z
          {more ? ' · More pages available' : ''}
          {inline && snapshot.busy && <LoadingIndicator busy label="Loading repositories" />}
        </small>
        <div
          ref={list}
          className="owner-repository-list"
          id={listId}
          role={multiple ? 'group' : 'listbox'}
          aria-label="Owner repositories"
          onKeyDown={(event) => {
            if (!multiple || event.nativeEvent.isComposing) return;
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
            const current = selectable.findIndex(
              (repository) => `${listId}-${repository.id}` === target.id,
            );
            if (current < 0) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              focusChoice(
                (current + (event.key === 'ArrowDown' ? 1 : -1) + selectable.length) %
                  selectable.length,
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              event.stopPropagation();
              toggle(selectable[current].full_name);
            }
          }}
        >
          {shown.map((repository) => {
            const added = isExcluded(repository.full_name);
            const label = `${repository.name}, ${repository.private ? 'Private' : 'Public'}${added ? ', already added' : ''}`;
            const content = (
              <>
                <span className="owner-repository-title">
                  <strong>{repository.name}</strong>
                  <small>{repository.private ? 'Private' : 'Public'}</small>
                </span>
                {repository.description && (
                  <span className="owner-repository-description">{repository.description}</span>
                )}
                {added && <small>Already added</small>}
              </>
            );
            if (multiple) {
              const blocked = isBlocked(repository.full_name);
              return (
                <label
                  key={repository.id}
                  className="owner-repository-option owner-repository-choice"
                  data-active={active === repository.id}
                  data-disabled={blocked}
                  title={repository.full_name}
                >
                  <input
                    id={`${listId}-${repository.id}`}
                    type="checkbox"
                    aria-label={label}
                    checked={added || isPending(repository.full_name)}
                    disabled={blocked}
                    onFocus={() => setActive(repository.id)}
                    onChange={() => toggle(repository.full_name)}
                  />
                  <span className="owner-repository-content">{content}</span>
                </label>
              );
            }
            return (
              <button
                key={repository.id}
                id={`${listId}-${repository.id}`}
                type="button"
                role="option"
                aria-selected={selected?.id === repository.id}
                aria-label={label}
                disabled={disabled || added}
                tabIndex={-1}
                className="owner-repository-option"
                title={repository.full_name}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onSelect(repository.full_name)}
              >
                {content}
              </button>
            );
          })}
          {more && <div ref={sentinel} className="owner-picker-sentinel" aria-hidden="true" />}
        </div>
        {!shown.length && (
          <p className="owner-picker-empty" role="status">
            {empty}
          </p>
        )}
        {failed.length > 0 && (
          <div className="owner-picker-actions">
            {snapshot.public.error && (
              <p role="alert">Public repositories: {snapshot.public.error}</p>
            )}
            {snapshot.authenticated.error && (
              <p role="alert">Token access: {snapshot.authenticated.error}</p>
            )}
            <div>
              {failed.length > 0 && (
                <button type="button" disabled={!canRetry} onClick={() => void model.retry()}>
                  {canRetry ? 'Retry' : retryLabel(retryWait)}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {multiple && (
        <div className="owner-picker-selection">
          <small role="status" aria-live="polite">
            {choices.length} / {limit} selected
          </small>
          <button
            type="button"
            className="primary"
            disabled={disabled || choices.length === 0 || choices.length > limit}
            onClick={() => onSelectMany(choices)}
          >
            Add {choices.length} {choices.length === 1 ? 'repository' : 'repositories'}
          </button>
        </div>
      )}
    </section>
  );
}
