import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { lowercaseField } from './repoInput';
import { lowercaseRepoInput } from './model';
import {
  matchingRecentRepositories,
  type RecentRepositories,
} from './RecentRepositories';
import type { OwnerRepositories } from './OwnerRepositories';
import { OwnerRepositoryPicker } from './OwnerRepositoryPicker';
import { useOwnerRepositoryPicker } from './useOwnerRepositoryPicker';
import './recentRepositories.css';

type Props = {
  value: string;
  current: string;
  onChange: (value: string) => void;
  onOpen: (value: string) => void;
  onRecent: (repository: string) => void;
  recent: RecentRepositories;
  owners: OwnerRepositories;
  popupOpen: boolean;
};

export function RepositoryInput({
  value,
  current,
  onChange,
  onOpen,
  onRecent,
  recent,
  owners,
  popupOpen,
}: Props) {
  const input = useRef<HTMLInputElement>(null),
    form = useRef<HTMLFormElement>(null),
    listId = useId();
  const snapshot = useSyncExternalStore(recent.subscribe, recent.getSnapshot);
  const ownerPicker = useOwnerRepositoryPicker(owners, value, form, input);
  const [open, setOpen] = useState(false),
    [edited, setEdited] = useState(false),
    [active, setActive] = useState<string | null>(null),
    [menuHeight, setMenuHeight] = useState<number | null>(null);
  const matches = matchingRecentRepositories(
      snapshot.entries,
      value,
      edited ? undefined : current,
    ),
    activeIndex = matches.findIndex((entry) => entry.repository === active);
  const showing =
      open &&
      !popupOpen &&
      !ownerPicker.showing &&
      snapshot.available &&
      matches.length > 0,
    expanded = showing && menuHeight !== 0;
  const activeId =
    expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;
  function close() {
    setOpen(false);
    setActive(null);
  }
  function choose(repository: string) {
    ownerPicker.close();
    close();
    onChange(repository);
    input.current?.blur();
    onRecent(repository);
  }
  useEffect(() => {
    if (popupOpen) {
      close();
      ownerPicker.close();
    }
  }, [popupOpen, ownerPicker.close]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !form.current?.contains(event.target))
        close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!showing) return;
    const viewport = window.visualViewport;
    const update = () => {
      const bottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight;
      setMenuHeight(
        Math.max(
          0,
          Math.min(
            360,
            bottom - (input.current?.getBoundingClientRect().bottom || 0) - 16,
          ),
        ),
      );
    };
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [showing]);
  useEffect(() => {
    if (activeId)
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);
  return (
    <form
      className="repo-form recent-form"
      ref={form}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        close();
        if (ownerPicker.submit(value)) return;
        ownerPicker.close();
        input.current?.blur();
        onOpen(value);
      }}
    >
      <div className="repo-input">
        <input
          ref={input}
          aria-label="GitHub repository"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup={ownerPicker.showing ? 'dialog' : 'grid'}
          aria-expanded={ownerPicker.showing || expanded}
          aria-controls={
            ownerPicker.showing
              ? `${listId}-owner`
              : expanded
                ? listId
                : undefined
          }
          aria-activedescendant={activeId}
          autoComplete="off"
          enterKeyHint="go"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder="owner or owner/repository"
          onFocus={() => {
            setOpen(true);
            setActive(null);
            setEdited(false);
          }}
          onChange={(event) => {
            setEdited(true);
            onChange(lowercaseField(event.currentTarget));
            setOpen(true);
            setActive(null);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (ownerPicker.keyDown(event)) return;
            if (
              (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
              !popupOpen &&
              !ownerPicker.showing &&
              snapshot.available &&
              matches.length
            ) {
              event.preventDefault();
              setOpen(true);
              const index =
                activeIndex < 0
                  ? event.key === 'ArrowDown'
                    ? 0
                    : matches.length - 1
                  : (activeIndex +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      matches.length) %
                    matches.length;
              setActive(matches[index].repository);
            } else if (event.key === 'Enter' && expanded && activeIndex >= 0) {
              event.preventDefault();
              choose(matches[activeIndex].repository);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (
              event.ctrlKey &&
              event.shiftKey &&
              event.key.toLowerCase() === 'd'
            )
              close();
          }}
        />
        {value && (
          <button
            type="button"
            className="clear-repo"
            aria-label="Clear repository"
            title="Clear repository"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              setActive(null);
              setOpen(true);
              input.current?.focus();
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        )}
        {ownerPicker.showing && (
          <OwnerRepositoryPicker
            id={`${listId}-owner`}
            model={owners}
            onClose={() => {
              ownerPicker.close(true);
              close();
            }}
            onSelect={(repository) => {
              const normalized = lowercaseRepoInput(repository);
              ownerPicker.close();
              close();
              onChange(normalized);
              input.current?.blur();
              onOpen(normalized);
            }}
          />
        )}
        {expanded && (
          <div
            className="recent-menu"
            style={
              menuHeight === null
                ? undefined
                : {
                    maxHeight: `max(0px, calc(${menuHeight}px - var(--safe-bottom)))`,
                  }
            }
          >
            {/* A grid popup permits separate, keyboard-accessible delete controls inside each row. */}
            <div
              id={listId}
              role="grid"
              aria-label="Recent repositories"
              className="recent-grid"
            >
              {matches.map((entry, index) => (
                <div
                  key={entry.repository}
                  role="row"
                  aria-selected={active === entry.repository}
                  className="recent-row"
                >
                  <div role="gridcell" id={`${listId}-${index}`}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="recent-open"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => choose(entry.repository)}
                      title={entry.repository}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        aria-hidden="true"
                      >
                        <path d="M3 11a9 9 0 1 1 2.6 7.4M3 5v6h6M12 7v5l3 2" />
                      </svg>
                      <span>{entry.repository}</span>
                    </button>
                  </div>
                  <div role="gridcell">
                    <button
                      type="button"
                      className="recent-remove"
                      aria-label={`Remove ${entry.repository} from history`}
                      title={`Remove ${entry.repository} from history`}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        recent.remove(entry.repository);
                        setActive(null);
                        input.current?.focus({ preventScroll: true });
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="recent-clear"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                recent.clear();
                setActive(null);
                input.current?.focus({ preventScroll: true });
              }}
            >
              Clear history
            </button>
          </div>
        )}
      </div>
      <button
        type="submit"
        className="primary explore-button"
        aria-label="Explore repository"
        title="Explore repository"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      </button>
    </form>
  );
}
