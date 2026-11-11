import type { Commit } from './model';
import { emojify } from './emoji';
import { CommitExtras } from './CommitExtras';
import type { InfoSnapshot } from './CommitInfoStore';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';

export function CommitDetails({
  commit,
  onClose,
  info,
  onMore,
  panelRef,
  style,
  repository,
}: {
  commit: Commit | null;
  onClose: () => void;
  info?: InfoSnapshot;
  onMore?: (sha: string) => Promise<unknown>;
  panelRef?: RefObject<HTMLElement | null>;
  style?: CSSProperties;
  repository?: string;
}) {
  const ownRef = useRef<HTMLElement>(null),
    container = panelRef || ownRef,
    content = useRef<HTMLDivElement>(null),
    pending = useRef(false),
    autoLoaded = useRef(''),
    touchY = useRef<number | null>(null);
  const repositoryId = useId();
  const sha = commit?.sha || '';
  const loadMore = useCallback(() => {
    const el = content.current;
    if (
      !sha ||
      !info?.more ||
      info.busy ||
      info.retryAt > Date.now() ||
      !onMore ||
      !el ||
      pending.current ||
      el.scrollHeight - el.scrollTop - el.clientHeight > 64
    )
      return;
    pending.current = true;
    void onMore(sha).finally(() => {
      pending.current = false;
    });
  }, [sha, info, onMore]);
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = 0;
    autoLoaded.current = '';
  }, [sha, info?.repo]);
  useEffect(() => {
    if (!sha || !info || info.selected !== sha || info.busy) return;
    const key = `${info.repo}:${sha}`;
    if (autoLoaded.current === key) return;
    autoLoaded.current = key;
    // Fill a short initial panel once; further pages require downward scrolling.
    if (!Object.keys(info.errors).length) loadMore();
  }, [sha, info, loadMore]);
  const authored = commit?.commit.author?.date;
  const date =
    authored && Number.isFinite(Date.parse(authored))
      ? new Date(authored)
      : null;
  const body = (
    commit?.commit.message.split('\n').slice(1).join('\n') || ''
  ).replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, '');
  return (
    <aside
      className="details floating-panel"
      ref={container}
      style={style}
      tabIndex={-1}
      aria-label="Commit details"
      aria-describedby={repository ? repositoryId : undefined}
      onFocus={(event) => {
        if (event.target === event.currentTarget)
          content.current?.focus({ preventScroll: true });
      }}
    >
      {repository && (
        <p className="commit-repository" id={repositoryId} title={repository}>
          {repository}
        </p>
      )}
      <div className="detail-actions">
        {commit?.html_url.startsWith('https://github.com/') && (
          <a
            className="github-button"
            href={commit.html_url}
            target="_blank"
            rel="noreferrer"
            aria-label="View commit on GitHub"
            title="View on GitHub"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
            </svg>
          </a>
        )}
        <button
          className="close"
          aria-label="Close commit details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div
        className="detail-content"
        ref={content}
        tabIndex={0}
        role="region"
        aria-label="Commit details content"
        onScroll={loadMore}
        onWheel={(event) => {
          if (event.deltaY > 0) loadMore();
        }}
        onTouchStart={(event) => {
          touchY.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(event) => {
          const y = event.touches[0]?.clientY;
          if (y !== undefined) {
            if (touchY.current !== null && y < touchY.current) loadMore();
            touchY.current = y;
          }
        }}
        onKeyDown={(event) => {
          if (
            event.target === content.current &&
            ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)
          )
            loadMore();
        }}
      >
        {commit ? (
          <>
            <div className="commit-meta">
              <code className="commit-sha">{commit.sha.slice(0, 7)}</code>
              {date && (
                <time
                  className="commit-authored"
                  dateTime={authored!}
                  title={date.toLocaleString()}
                >
                  {date.toLocaleString(undefined, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              )}
            </div>
            <h2>
              {emojify(commit.commit.message.split('\n')[0])}
              {commit.commit.author?.name && (
                <>
                  {' '}
                  <span className="commit-author">
                    by {commit.commit.author.name}
                  </span>
                </>
              )}
            </h2>
            {body.trim() && <pre>{emojify(body)}</pre>}
            {info && <CommitExtras sha={commit.sha} info={info} />}
          </>
        ) : (
          <p>Tap a node to inspect a commit.</p>
        )}
      </div>
    </aside>
  );
}
