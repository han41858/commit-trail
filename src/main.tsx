import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import { debug } from './debug';
import { DebugRoot } from './DebugRoot';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';
import { registerPwa } from './pwa';
import { useMeasuredOpen } from './measuredOperations';
import { Graph } from './Graph';
import { CommitDetails } from './CommitDetails';
import { BranchPicker } from './BranchPicker';
import { useRetryCountdown, retryLabel } from './useRetryCountdown';
import { History } from './history';
import { CommitInfoStore } from './CommitInfoStore';
import { RefreshLoop } from './RefreshLoop';
import { RefreshButton, RefreshTimer } from './RefreshButton';
import { MonitorSession } from './MonitorSession';
import {
  MonitorRepositories,
  MONITOR_REPOSITORIES_KEY,
  MONITOR_PUBLIC_REPOSITORIES_KEY,
  moveMonitorRepository,
} from './MonitorRepositories';
import { MonitorSetup } from './MonitorSetup';
import { MonitorReorder } from './MonitorReorder';
import { MonitorPane, MonitorStatus } from './MonitorPane';
import { useMonitorDetailsPosition } from './useMonitorDetailsPosition';
import { useRepositoryLocation } from './useRepositoryLocation';
import { repositoryLocationKey } from './repositoryLocation';
import { lowercaseRepoInput, parseRepo, type Commit } from './model';
import { RepositoryInput } from './RepositoryInput';
import { RecentRepositories, RECENT_REPOSITORIES_KEY } from './RecentRepositories';
import { BranchSelections, BRANCH_SELECTIONS_KEY } from './BranchSelections';
import type { RepositoryLocation } from './repositoryLocation';
import logo from '../assets/logo-320.png';
import { emojify } from './emoji';
import { requestActivity } from './requestActivity';
import { readStoredToken, saveStoredToken, TOKEN_STORAGE_KEY } from './tokenStorage';
import { TokenPermissions } from './TokenPermissions';
import './style.css';
import './monitor.css';

const DEMO_REPO = 'han41858/git-stream';
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

function App() {
  const { configuration, navigate } = useRepositoryLocation();
  const configurationKey = repositoryLocationKey(configuration);
  const lastMonitorSelection = useRef<readonly string[] | undefined>(undefined);
  const lastMonitorBranches = useRef(new Map<string, string>());
  const appliedLocation = useRef<RepositoryLocation | null>(null);
  const pickedLocation = useRef<string | null>(null);
  const [savedToken] = useState(readStoredToken);
  const authToken = useRef(savedToken.token);
  const [recent] = useState(
    () =>
      new RecentRepositories({
        allowPrivate: () => {
          const saved = readStoredToken();
          return !!authToken.current && !saved.error && authToken.current === saved.token;
        },
      }),
  );
  const [branchSelections] = useState(
    () =>
      new BranchSelections({
        allowPrivate: () => {
          const saved = readStoredToken();
          return !!authToken.current && !saved.error && authToken.current === saved.token;
        },
        canWrite: () => {
          const saved = readStoredToken();
          return !saved.error && authToken.current === saved.token;
        },
      }),
  );
  const [monitorRepositories] = useState(
    () =>
      new MonitorRepositories({
        publicRepositories: () =>
          recent
            .getSnapshot()
            .entries.filter((entry) => entry.visibility === 'public')
            .map((entry) => entry.repository),
        allowPrivate: () => {
          const saved = readStoredToken();
          return !!authToken.current && !saved.error && authToken.current === saved.token;
        },
        canWrite: () => {
          const saved = readStoredToken();
          return !saved.error && authToken.current === saved.token;
        },
      }),
  );
  const repositoryMetadata = (repository: string, isPrivate: boolean, visit: boolean) => {
    recent.repositoryMetadata(repository, isPrivate, visit);
    branchSelections.repositoryMetadata(repository, isPrivate);
    monitorRepositories.repositoryMetadata(repository, isPrivate);
  };
  const [history] = useState(() => new History(repositoryMetadata, branchSelections));
  const [info] = useState(() => new CommitInfoStore());
  const extras = useSyncExternalStore(info.subscribe, info.getSnapshot);
  const [monitor] = useState(
    () => new MonitorSession(history, info, repositoryMetadata, branchSelections),
  );
  const monitorState = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  const reorderMonitor = useCallback(
    (repository: string, to: number) => {
      const current = monitor.getSnapshot();
      if (!current.active) return;
      const names = current.entries.map((entry) => entry.repository);
      const reordered = moveMonitorRepository(names, repository, to);
      if (reordered === names || !monitor.reorder(reordered)) return;
      const entries = new Map(current.entries.map((entry) => [entry.repository, entry]));
      const branches = reordered.map((name) => {
        const entry = entries.get(name)!,
          state = entry.history.getSnapshot();
        if (state.meta && state.baseHead && !state.busy) {
          lastMonitorBranches.current.set(name, state.base);
          return state.base;
        }
        return entry.branch;
      });
      lastMonitorSelection.current = reordered;
      monitorRepositories.set(reordered);
      navigate({ mode: 'monitor', repositories: reordered, branches }, { replace: true });
    },
    [monitor, monitorRepositories, navigate],
  );
  const leaveMonitor = useCallback(() => {
    for (const entry of monitor.getSnapshot().entries) {
      const value = entry.history.getSnapshot();
      if (value.meta && value.baseHead)
        lastMonitorBranches.current.set(entry.repository, value.base);
    }
    const current = history.getSnapshot(),
      repository = current.repo;
    navigate({
      mode: 'single',
      repositories: repository ? [repository] : [],
      ...(current.meta && current.baseHead ? { branches: [current.base] } : {}),
    });
    monitor.stop();
  }, [history, monitor, navigate]);
  const [loop] = useState(
    () =>
      new RefreshLoop(
        (kind) =>
          monitor.getSnapshot().active ? monitor.refreshAll(kind) : monitor.refreshPrimary(kind),
        () => !document.hidden && navigator.onLine,
      ),
  );
  const measured = useMeasuredOpen(history, info);
  const refreshState = useSyncExternalStore(loop.subscribe, loop.getSnapshot);
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot);
  const activeRequests = useSyncExternalStore(
    requestActivity.subscribe,
    requestActivity.getSnapshot,
  );
  const loadingSpeed = activeRequests > 8 ? 'fast' : activeRequests > 4 ? 'medium' : 'slow';
  const retrySeconds = useRetryCountdown(state.retryAt);
  const discoverySeconds = useRetryCountdown(state.discoveryRetryAt);
  const [input, setInput] = useState(configuration.repositories[0] || '');
  const [appliedToken, setAppliedToken] = useState(savedToken.token),
    [authRevision, setAuthRevision] = useState(0),
    [autoRefresh, setAutoRefresh] = useState(true),
    [intervalChoice, setIntervalChoice] = useState<number | null>(null);
  const seconds =
    intervalChoice === 30 && !appliedToken ? 300 : (intervalChoice ?? (appliedToken ? 60 : 300));
  const refreshRetrySeconds = useRetryCountdown(refreshState.retryAt || null);
  const [token, setToken] = useState(savedToken.token),
    [tokenStorageError, setTokenStorageError] = useState(savedToken.error),
    [tokenApplied, setTokenApplied] = useState(savedToken.token !== ''),
    [auth, setAuth] = useState(false),
    [theme, setTheme] = useState('system'),
    [options, setOptions] = useState(false);
  const [monitorSetup, setMonitorSetup] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  useEffect(() => {
    setErrorDismissed(false);
  }, [state.repo, state.error, state.retryAt]);
  const [systemTheme, setSystemTheme] = useState(() =>
    window.matchMedia('(prefers-color-scheme:light)').matches ? 'light' : 'dark',
  );
  const resolvedTheme = theme === 'system' ? systemTheme : theme;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme:light)');
    const update = () => setSystemTheme(media.matches ? 'light' : 'dark');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'light' ? '#f2f6fc' : '#070a11');
  }, [resolvedTheme]);
  const optionsRef = useRef<HTMLDivElement>(null),
    toolbarRef = useRef<HTMLElement>(null),
    authRef = useRef<HTMLElement>(null),
    tokenButtonRef = useRef<HTMLButtonElement>(null),
    detailsRef = useRef<HTMLElement>(null),
    primaryPaneRef = useRef<HTMLElement>(null),
    monitorButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!monitorState.active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        leaveMonitor();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [leaveMonitor, monitorState.active]);
  const wasMonitoring = useRef(false);
  useEffect(() => {
    if (wasMonitoring.current && !monitorState.active) monitorButtonRef.current?.focus();
    wasMonitoring.current = monitorState.active;
  }, [monitorState.active]);
  const primaryEntry = monitorState.entries.find((entry) => entry.primary);
  const primaryOrder = primaryEntry ? monitorState.entries.indexOf(primaryEntry) : 0;
  const primaryActive = !monitorState.active || !!primaryEntry;
  const monitorScope = monitorState.entries
    .map((entry) => entry.repository)
    .sort()
    .join('|');
  const monitorLimited = monitorState.retryAt > Date.now();
  const [topInset, setTopInset] = useState(window.innerWidth <= 800 ? 136 : 108);
  useLayoutEffect(() => {
    const el = toolbarRef.current!;
    const update = () => {
      if (el.offsetHeight) setTopInset(Math.ceil(el.getBoundingClientRect().bottom) + 20);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  const [selection, setSelection] = useState<{ repository: string; commit: Commit } | null>(null);
  const selected = selection?.repository === state.repo ? selection.commit : null;
  const selectCommit = useCallback(
    (repository: string, commit: Commit) => setSelection({ repository, commit }),
    [],
  );
  const clearSelection = useCallback(() => setSelection(null), []);
  const details = selected !== null;
  const detailsPosition = useMonitorDetailsPosition(
    primaryPaneRef,
    detailsRef,
    monitorState.active && primaryActive && details,
    selected?.sha || '',
    primaryOrder,
  );
  const reverse = state.reverse;
  useEffect(() => {
    void measured.openInfo(state.meta ? state.repo : '', appliedToken);
    return () => info.cancel();
  }, [info, state.repo, !!state.meta, appliedToken, authRevision]);
  useLayoutEffect(() => {
    loop.configure(
      monitorState.active
        ? `monitor:${monitorScope}:${authRevision}`
        : state.meta
          ? `${state.repo}:${authRevision}`
          : '',
      autoRefresh,
      seconds * 1000,
      monitorState.active,
    );
  }, [
    loop,
    state.repo,
    !!state.meta,
    authRevision,
    autoRefresh,
    seconds,
    monitorState.active,
    monitorScope,
  ]);
  useEffect(() => {
    const changed = () => loop.visibilityChanged();
    document.addEventListener('visibilitychange', changed);
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => {
      monitor.stop();
      loop.stop();
      document.removeEventListener('visibilitychange', changed);
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
    };
  }, [loop]);
  useEffect(() => {
    const primarySettled =
      !state.busy && (!state.meta || (extras.repo === state.repo && !extras.busy));
    // Child layout effects can accept more visible history before this effect runs.
    const monitorSettled = monitor.getSnapshot().settled;
    if (monitorState.active ? monitorSettled : state.meta && primarySettled) loop.loaded();
  }, [loop, monitor, state.meta, state.busy, extras, monitorState.active, monitorState.settled]);
  useEffect(() => {
    if (extras.repo === state.repo) {
      if (selected && monitor.canRequest()) void info.inspect(selected.sha);
      else if (!selected) info.clearSelection();
    }
  }, [info, selected?.sha, extras.repo, state.repo, monitorLimited]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === RECENT_REPOSITORIES_KEY ||
        event.key === TOKEN_STORAGE_KEY
      )
        recent.reload();
      if (
        event.key === null ||
        event.key === BRANCH_SELECTIONS_KEY ||
        event.key === TOKEN_STORAGE_KEY
      )
        branchSelections.reload();
      if (
        event.key === null ||
        event.key === MONITOR_REPOSITORIES_KEY ||
        event.key === MONITOR_PUBLIC_REPOSITORIES_KEY ||
        event.key === TOKEN_STORAGE_KEY
      )
        monitorRepositories.reload();
      if (event.key === null || event.key === TOKEN_STORAGE_KEY) {
        lastMonitorSelection.current = undefined;
        leaveMonitor();
        lastMonitorBranches.current.clear();
        setMonitorSetup(false);
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [recent, branchSelections, monitorRepositories, leaveMonitor]);
  useEffect(
    () => () => {
      measured.cancel();
      monitor.stop();
      history.clear();
      info.cancel();
    },
    [history, info, monitor],
  );
  useEffect(() => {
    setMonitorSetup(false);
    setOptions(false);
    setAuth(false);
    const current = history.getSnapshot(),
      repository = configuration.repositories[0] || '';
    const previous = appliedLocation.current;
    appliedLocation.current = configuration;
    const userPicked = pickedLocation.current === configurationKey;
    pickedLocation.current = null;
    const currentIndex = configuration.repositories.indexOf(current.repo),
      previousIndex = previous?.repositories.indexOf(current.repo) ?? -1;
    const changedBranch =
      !!previous && previous.branches?.[previousIndex] !== configuration.branches?.[currentIndex];
    if (configuration.mode === 'monitor' && repository) {
      setSelection((chosen) =>
        chosen && configuration.repositories.includes(chosen.repository) ? chosen : null,
      );
      lastMonitorSelection.current = [...configuration.repositories];
      const session = monitor.getSnapshot();
      const sameBranches = configuration.repositories.every((name, index) => {
        const entry = session.entries.find((entry) => entry.repository === name);
        if (!entry) return false;
        const requested = configuration.branches?.[index];
        const priorIndex = previous?.repositories.indexOf(name) ?? -1;
        if (requested === previous?.branches?.[priorIndex]) return true;
        const state = entry.history.getSnapshot();
        return !!state.meta && !!state.baseHead && requested === state.base;
      });
      if (session.active && sameBranches && monitor.reorder(configuration.repositories)) return;
      if (!current.repo) {
        setInput(repository);
        setSelection(null);
        void measured.open(repository, authToken.current, configuration.branches?.[0]);
      }
      if (changedBranch) setSelection(null);
      monitor.start(
        configuration.repositories,
        authToken.current,
        configuration.branches,
        changedBranch,
      );
    } else {
      setSelection((chosen) => (chosen?.repository === repository ? chosen : null));
      monitor.stop();
      setInput(repository);
      if (!repository) {
        measured.cancel();
        history.clear();
        void info.open('', '');
        setSelection(null);
      } else if (
        current.repo !== repository ||
        (!current.meta && !current.busy && !current.error)
      ) {
        setSelection(null);
        void measured.open(repository, authToken.current, configuration.branches?.[0]);
      } else if (changedBranch && !userPicked) {
        setSelection(null);
        void history.restoreBase(configuration.branches?.[0]);
      }
    }
  }, [configurationKey, history, monitor, monitorRepositories]);
  useEffect(() => {
    if (!options && !auth && !selection) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (target instanceof Element && target.closest('[data-debug-ui],[data-pwa-ui]')) return;
      if (options && !optionsRef.current?.contains(target)) setOptions(false);
      if (auth && !authRef.current?.contains(target) && !tokenButtonRef.current?.contains(target))
        setAuth(false);
      if (
        selection &&
        !(
          target instanceof Element &&
          target.closest('.details,.monitor-exit,.monitor-reorder-handle')
        )
      )
        setSelection(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOptions(false);
        setAuth(false);
        setSelection(null);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [options, auth, selection]);
  function applyToken() {
    const value = token.trim();
    if (value !== appliedToken) lastMonitorSelection.current = undefined;
    leaveMonitor();
    if (value !== appliedToken) lastMonitorBranches.current.clear();
    setMonitorSetup(false);
    monitor.authenticationChanged(appliedToken, value);
    branchSelections.authenticationChanged(appliedToken, value);
    monitorRepositories.authenticationChanged(appliedToken, value);
    recent.authenticationChanged(appliedToken, value);
    const error = saveStoredToken(value);
    authToken.current = value;
    recent.reload();
    monitorRepositories.reconcile();
    setToken(value);
    setAppliedToken(value);
    setAuthRevision((v) => v + 1);
    setTokenStorageError(error);
    history.setToken(value);
    setTokenApplied(value !== '');
    setAuth(true);
    if (state.repo) {
      setSelection(null);
      void measured.open(
        state.repo,
        value,
        configuration.branches?.[configuration.repositories.indexOf(state.repo)],
      );
    }
  }
  function removeToken() {
    lastMonitorSelection.current = undefined;
    leaveMonitor();
    lastMonitorBranches.current.clear();
    setMonitorSetup(false);
    monitor.authenticationChanged(appliedToken, '');
    branchSelections.authenticationChanged(appliedToken, '');
    monitorRepositories.authenticationChanged(appliedToken, '');
    recent.authenticationChanged(appliedToken, '');
    measured.cancel();
    const error = saveStoredToken('');
    authToken.current = '';
    recent.reload();
    monitorRepositories.reconcile();
    history.clear();
    void info.open('', '');
    setToken('');
    setAppliedToken('');
    setAuthRevision((v) => v + 1);
    setTokenApplied(false);
    setTokenStorageError(error);
    setSelection(null);
    setAuth(!!error);
  }
  function open(value: string) {
    // A standalone PWA has no address bar. Handle the explicit local command
    // before repository loading so it cannot clear history or send an API request.
    if (value.trim() === ':debug') {
      setInput(state.repo);
      debug.setMode('panel');
      return;
    }
    setSelection(null);
    let repository: string;
    try {
      repository = parseRepo(lowercaseRepoInput(value));
    } catch {
      void measured.open(value, appliedToken);
      return;
    }
    const target = { mode: 'single' as const, repositories: [repository] };
    if (repositoryLocationKey(target) === configurationKey)
      void measured.open(repository, appliedToken);
    else navigate(target);
  }
  function openRecent(repository: string) {
    setInput(repository);
    if (repository === state.repo && state.meta) {
      recent.touch(repository);
      return;
    }
    open(repository);
  }
  function openTokenPopup() {
    setErrorDismissed(true);
    setOptions(false);
    setSelection(null);
    setAuth(true);
  }
  function select(commit: Commit) {
    selectCommit(state.repo, commit);
    if (monitorState.active) detailsRef.current?.focus({ preventScroll: true });
  }
  function pickedBranch(name: string) {
    setSelection(null);
    if (typeof state.meta?.private === 'boolean')
      branchSelections.record(state.repo, name, state.meta.private);
    const target = { mode: 'single' as const, repositories: [state.repo], branches: [name] };
    pickedLocation.current = repositoryLocationKey(target);
    navigate(target);
  }
  const shareBranches = new Map(lastMonitorBranches.current);
  for (const entry of monitorState.entries) {
    const value = entry.history.getSnapshot();
    if (value.meta && value.baseHead) shareBranches.set(entry.repository, value.base);
    else shareBranches.delete(entry.repository);
  }
  if (state.meta && state.baseHead) shareBranches.set(state.repo, state.base);
  else shareBranches.delete(state.repo);
  return (
    <div
      className={`app${monitorState.active ? ' app-monitor' : ''}`}
      data-theme={resolvedTheme}
      style={{ '--toolbar-bottom': `${topInset - 20}px` } as React.CSSProperties}
    >
      {monitorState.active && (
        <header className="monitor-controls" aria-label="Repository monitor controls">
          <RefreshTimer
            nextAt={Math.max(refreshState.nextAt, monitorState.retryAt)}
            interval={seconds * 1000}
            sweeping={autoRefresh && !refreshState.waitingForInitialLoad && !monitorLimited}
            running={monitorState.running.size > 0}
            paused={!autoRefresh || monitorLimited}
            disabled={refreshState.waitingForInitialLoad || monitorLimited || refreshState.running}
            onRefresh={() => void loop.refresh()}
          />
          <MonitorReorder entries={monitorState.entries} onReorder={reorderMonitor} />
          <button
            type="button"
            className="monitor-exit"
            aria-label="Return to single view"
            title="Return to single view"
            onClick={leaveMonitor}
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
      )}
      <main
        className={`graph-stage${monitorState.active ? ' monitor-stage' : ''}`}
        aria-label={monitorState.active ? 'Repository monitor' : undefined}
      >
        <section
          className={monitorState.active ? 'monitor-column' : 'single-repository'}
          ref={primaryPaneRef}
          hidden={!primaryActive}
          style={{ order: primaryOrder }}
          aria-label={monitorState.active ? `Repository ${state.repo}` : undefined}
        >
          {state.commits.length > 0 ? (
            <Graph
              active={primaryActive}
              containerResponsive={monitorState.active}
              label={monitorState.active ? `Commit graph for ${state.repo}` : undefined}
              key={`${state.repo}:${state.base}:${reverse}`}
              theme={resolvedTheme}
              commits={state.commits}
              branches={state.branches}
              branch={state.base}
              reverse={reverse}
              selected={selected?.sha || ''}
              onSelect={select}
              hasMore={state.more && !state.error && !monitorLimited}
              loading={state.busy}
              onLoadMore={(sources) => {
                if (monitor.canRequest()) void history.loadMore(sources);
              }}
              frontiers={state.frontiers}
              pendingSources={state.pendingSources}
              topInset={monitorState.active ? 34 : topInset}
              refreshVersion={state.refreshVersion}
              baseHead={state.baseHead}
              info={extras.bySha}
              onVisible={(shas) => {
                if (primaryActive && monitor.canRequest()) info.watch(shas);
              }}
            />
          ) : monitorState.active ? (
            <div className="monitor-empty" role="status">
              {state.busy ? 'Loading…' : state.error ? 'Repository unavailable' : 'No commits'}
            </div>
          ) : (
            <div className="empty">
              <img className="empty-mark" src={logo} alt="" width="160" height="160" />
              <h1>{state.busy ? 'Loading...' : 'Watch your Git history unfold.'}</h1>
              {!state.busy && <p>Choose a repository. Explore its branches as they evolve.</p>}
              {!state.busy && (
                <button
                  type="button"
                  className="demo-button"
                  aria-label={`Explore ${DEMO_REPO}`}
                  onClick={() => {
                    setInput(DEMO_REPO);
                    open(DEMO_REPO);
                  }}
                >
                  <span>Explore</span>
                  <span className="demo-repository">{DEMO_REPO}</span>
                </button>
              )}
            </div>
          )}
          {details && primaryActive && (
            <CommitDetails
              panelRef={detailsRef}
              style={detailsPosition}
              repository={monitorState.active ? state.repo : undefined}
              commit={selected}
              onClose={clearSelection}
              info={extras}
              onMore={monitor.canRequest() ? info.loadMore : undefined}
            />
          )}
          {monitorState.active && primaryActive && (
            <MonitorStatus
              state={state}
              extras={extras}
              refreshing={!!primaryEntry && monitorState.running.has(primaryEntry)}
              limited={monitorLimited}
            />
          )}
        </section>
        {monitorState.active &&
          monitorState.entries.map((entry, index) =>
            entry.primary ? null : (
              <MonitorPane
                key={entry.repository}
                entry={entry}
                order={index}
                theme={resolvedTheme}
                session={monitor}
                refreshing={monitorState.running.has(entry)}
                limited={monitorLimited}
                selected={selection?.repository === entry.repository ? selection.commit : null}
                onSelect={selectCommit}
                onClose={clearSelection}
              />
            ),
          )}
      </main>
      <header className="topbar" ref={toolbarRef}>
        <a className="brand" href="./" aria-label="GitStream home">
          <img src={logo} alt="" width="36" height="36" /> GitStream
        </a>
        <RepositoryInput
          value={input}
          current={state.meta ? state.repo : ''}
          onChange={setInput}
          onOpen={open}
          onRecent={openRecent}
          recent={recent}
          popupOpen={auth || options || details || monitorSetup}
        />
        <div className="view-controls">
          <div className="base-control">
            <BranchPicker history={history} state={state} onPicked={pickedBranch} />
          </div>
          <button
            className="direction-toggle"
            aria-label={
              reverse ? 'Oldest first; newer commits below' : 'Newest first; older commits below'
            }
            title={
              reverse ? 'Oldest first; newer commits below' : 'Newest first; older commits below'
            }
            aria-pressed={reverse}
            onClick={() => {
              setSelection(null);
              void history.setDirection(!reverse);
            }}
          >
            {reverse ? '↓ Newer' : '↓ Older'}
          </button>
          <RefreshButton
            nextAt={refreshState.nextAt}
            interval={seconds * 1000}
            sweeping={
              !monitorState.active &&
              autoRefresh &&
              !!state.meta &&
              refreshState.lastCompletedAt !== null &&
              !refreshState.running &&
              refreshRetrySeconds === 0
            }
            disabled={
              !state.meta ||
              (!state.commits.length && state.busy) ||
              refreshState.running ||
              refreshRetrySeconds > 0
            }
            onRefresh={() => void loop.refresh()}
          />
          <button
            className="token-button"
            ref={tokenButtonRef}
            aria-label={tokenApplied ? 'Access token (applied)' : 'Access token'}
            title={tokenApplied ? 'Access token applied' : 'Access token'}
            aria-expanded={auth}
            onClick={() => {
              if (auth) setAuth(false);
              else openTokenPopup();
            }}
          >
            <svg
              className={`ticket-icon${tokenApplied ? ' applied' : ''}`}
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" />
              <path d="M15 5v2M15 11v2M15 17v2" />
            </svg>
            <span className="token-label">Token</span>
          </button>
          <button
            type="button"
            className="monitor-trigger"
            ref={monitorButtonRef}
            aria-label="Split view"
            title="Split view"
            onClick={() => {
              setOptions(false);
              setAuth(false);
              setMonitorSetup(true);
            }}
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
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M12 4v16" />
            </svg>
          </button>
          <div className="options" ref={optionsRef}>
            <button
              className="options-trigger"
              aria-label="Options"
              aria-expanded={options}
              aria-controls="options-menu"
              onClick={() => setOptions(!options)}
            >
              •••
            </button>
            {options && (
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
                    onChange={(e) => setTheme(e.target.value)}
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
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                  />
                </label>
                <label>
                  Interval
                  <select
                    aria-label="Refresh interval"
                    value={seconds}
                    onChange={(e) => setIntervalChoice(Number(e.target.value))}
                  >
                    {appliedToken && <option value={30}>30 seconds</option>}
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
        </div>
      </header>
      {auth && (
        <section className="auth floating-panel" ref={authRef} aria-label="GitHub access token">
          <button className="close" aria-label="Close access token" onClick={() => setAuth(false)}>
            ×
          </button>
          <h2>GitHub access token</h2>
          <p>60 requests/hour · 5,000 with a token</p>
          <TokenPermissions
            repo={state.repo}
            token={appliedToken}
            pending={token.trim() !== appliedToken}
            revision={authRevision}
          />
          <a
            className="create-token primary"
            aria-label="Create a fine-grained GitHub token"
            onClick={() => {
              setErrorDismissed(true);
              setAuth(false);
            }}
            href="https://github.com/settings/personal-access-tokens/new?name=GitStream&amp;contents=read&amp;pull_requests=read&amp;actions=read"
            target="_blank"
            rel="noreferrer"
          >
            Create token
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
            </svg>
          </a>
          <form
            className="token-form"
            onSubmit={(e) => {
              e.preventDefault();
              e.currentTarget.querySelector('input')?.blur();
              applyToken();
            }}
          >
            <input
              aria-label="Access token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your token"
            />
            <button className="primary" type="submit">
              Apply token
            </button>
          </form>
          <small>Saved in this browser until you remove it.</small>
          {tokenStorageError && <p role="alert">{tokenStorageError}</p>}
          <button className="remove-token" onClick={removeToken}>
            Remove token & clear history
          </button>
        </section>
      )}
      {state.error && !errorDismissed && !auth && !monitorState.active && (
        <div className="error floating-panel" role="alert">
          <span className="error-message">{state.error}</span>
          <div className="error-actions">
            <button disabled={state.busy || retrySeconds > 0} onClick={() => void history.retry()}>
              {retryLabel(retrySeconds)}
            </button>
            {state.error.includes('GitHub') && (
              <button onClick={openTokenPopup}>Access token</button>
            )}
          </div>
        </div>
      )}
      {monitorSetup && !monitorState.active && (
        <MonitorSetup
          current={state.meta ? state.repo : ''}
          recent={recent}
          saved={monitorRepositories}
          initial={lastMonitorSelection.current}
          branches={shareBranches}
          onClose={() => {
            setMonitorSetup(false);
            monitorButtonRef.current?.focus();
          }}
          onStart={(repositories) => {
            monitorRepositories.set(repositories);
            setMonitorSetup(false);
            navigate({
              mode: 'monitor',
              repositories,
              branches: repositories.map((repository) => shareBranches.get(repository)),
            });
          }}
        />
      )}
      <DebugRoot developer={import.meta.env.DEV} />
      <PwaUpdatePrompt />
      <footer className="graph-status" aria-live="polite">
        <span>{state.commits.length.toLocaleString()} commits</span>
        {state.busy || activeRequests > 0 || refreshState.running ? (
          <span
            className="history-loading"
            role="status"
            aria-label={
              activeRequests
                ? `Loading history, ${activeRequests} active requests`
                : 'Loading history'
            }
            aria-live="off"
          >
            <span className="loading-spinner" data-speed={loadingSpeed} aria-hidden="true" />
            {activeRequests > 0 && (
              <span className="request-count" aria-hidden="true">
                x{activeRequests}
              </span>
            )}
          </span>
        ) : null}
        {state.discoveryError && (
          <button
            className="discovery-retry"
            title={state.discoveryError}
            aria-label="Retry recent branch discovery"
            disabled={state.busy || !!state.error || discoverySeconds > 0}
            onClick={() => void history.retryDiscovery()}
          >
            {discoverySeconds ? retryLabel(discoverySeconds) : 'Retry branches'}
          </button>
        )}
        {state.meta &&
          !refreshState.running &&
          (refreshRetrySeconds > 0 ||
            !!refreshState.error ||
            refreshState.lastCompletedAt !== null) && (
            <span className="refresh-status" role="status" title={refreshState.error || undefined}>
              {refreshRetrySeconds
                ? `Retry in ${refreshRetrySeconds}s`
                : refreshState.error
                  ? 'Refresh failed'
                  : refreshState.lastCompletedAt !== null
                    ? `Updated ${new Date(refreshState.lastCompletedAt).toLocaleTimeString()}`
                    : ''}
            </span>
          )}
        {Object.keys(extras.errors).length > 0 && (
          <span className="metadata-error" title={Object.values(extras.errors).join(' · ')}>
            Metadata unavailable
          </span>
        )}
      </footer>
    </div>
  );
}
debug.setMode(new URLSearchParams(location.search).get('debug') === '1' ? 'button' : 'off');
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerPwa();
