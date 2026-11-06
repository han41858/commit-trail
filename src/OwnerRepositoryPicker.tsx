import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OwnerRepositories } from './OwnerRepositories';
import { LoadingIndicator } from './LoadingIndicator';
import { retryLabel, useRetryCountdown } from './useRetryCountdown';
import './ownerRepositories.css';

type Props = {
  id?: string;
  model: OwnerRepositories;
  onSelect: (repository: string) => void;
  onClose: () => void;
  inline?: boolean;
  excluded?: readonly string[];
  disabled?: boolean;
};

export function OwnerRepositoryPicker({
  id,
  model,
  onSelect,
  onClose,
  inline = false,
  excluded = [],
  disabled = false,
}: Props) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const panel = useRef<HTMLElement>(null);
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
  const canRetry = failed.some((source) => !source.busy && source.wait === 0);
  const retryWait = failed.length ? Math.min(...failed.map((source) => source.wait)) : 0;
  const canLoadMore = sources.some(
    (source) => source.more && !source.error && !source.busy && source.wait === 0,
  );
  const search = query.trim().toLowerCase();
  const shown = snapshot.repositories.filter((repository) =>
    repository.name.toLowerCase().includes(search),
  );
  const isExcluded = (repository: string) =>
    excluded.some((name) => name.toLowerCase() === repository.toLowerCase());
  const selectable = disabled
    ? []
    : shown.filter((repository) => !isExcluded(repository.full_name));
  const selected = selectable.find((repository) => repository.id === active) ?? selectable[0];
  const activeId = selected ? `${listId}-${selected.id}` : undefined;

  useEffect(() => {
    setQuery('');
    setActive(null);
    field.current?.focus({ preventScroll: true });
  }, [snapshot.owner]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (inline) element.scrollIntoView({ block: 'nearest' });
    const viewport = window.visualViewport;
    const update = () => {
      const top = viewport?.offsetTop || 0;
      const left = viewport?.offsetLeft || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      if (!inline) {
        const anchor = element.parentElement?.getBoundingClientRect();
        if (anchor) {
          const panelWidth = Math.min(440, Math.max(0, width - 16));
          const x = Math.max(left + 8, Math.min(anchor.left, left + width - panelWidth - 8));
          element.style.width = `${panelWidth}px`;
          element.style.left = `${x - anchor.left}px`;
        }
      }
      const available = top + height - element.getBoundingClientRect().top - 8;
      element.style.maxHeight = `${Math.max(0, Math.min(380, available))}px`;
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [inline, snapshot.owner]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  if (!snapshot.owner) return null;

  let empty = snapshot.authenticated.enabled
    ? 'No accessible repositories found for this owner.'
    : 'No public repositories found for this owner.';
  if (search) empty = 'No matching repositories in the loaded pages.';
  else if (snapshot.busy) empty = 'Loading repositories…';
  else if (failed.length) empty = 'No repositories loaded.';
  else if (more) empty = 'No repositories for this owner in the loaded pages. Load more to continue.';

  return (
    <section
      id={id}
      ref={panel}
      className={`owner-picker${inline ? ' owner-picker-inline' : ''}`}
      role="dialog"
      aria-labelledby={headingId}
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
      <input
        ref={field}
        data-owner-filter=""
        className="owner-repository-filter"
        aria-label="Filter repositories"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeId}
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
            const current = selectable.findIndex((repository) => repository.id === selected?.id);
            const next =
              (current + (event.key === 'ArrowDown' ? 1 : -1) + selectable.length) %
              selectable.length;
            setActive(selectable[next].id);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (selected) onSelect(selected.full_name);
          }
        }}
      />
      <small id={hintId} className="owner-picker-hint">
        {snapshot.repositories.length.toLocaleString()} loaded · Recent push first
        {more ? ' · More pages available' : ''}
      </small>
      <div
        className="owner-repository-list"
        id={listId}
        role="listbox"
        aria-label="Owner repositories"
      >
        {shown.map((repository) => {
          const added = isExcluded(repository.full_name);
          return (
            <button
              key={repository.id}
              id={`${listId}-${repository.id}`}
              type="button"
              role="option"
              aria-selected={selected?.id === repository.id}
              aria-label={`${repository.name}, ${repository.private ? 'Private' : 'Public'}${added ? ', already added' : ''}`}
              disabled={disabled || added}
              tabIndex={-1}
              className="owner-repository-option"
              title={repository.full_name}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onSelect(repository.full_name)}
            >
              <span className="owner-repository-title">
                <strong>{repository.name}</strong>
                <small>{repository.private ? 'Private' : 'Public'}</small>
              </span>
              {repository.description && (
                <span className="owner-repository-description">{repository.description}</span>
              )}
              {added && <small>Already added</small>}
            </button>
          );
        })}
      </div>
      {!shown.length && (
        <p className="owner-picker-empty" role="status">
          {empty}
        </p>
      )}
      {(failed.length > 0 || more) && (
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
            {more && (
              <button type="button" disabled={!canLoadMore} onClick={() => void model.loadMore()}>
                Load more
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
