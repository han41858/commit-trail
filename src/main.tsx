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
import { AppNotices } from './AppNotices';
import { registerPwa } from './pwa';
import { useMeasuredOpen } from './measuredOperations';
import { Graph } from './Graph';
import { CommitDetails } from './CommitDetails';
import { BranchPicker } from './BranchPicker';
import { useRetryCountdown, retryLabel } from './useRetryCountdown';
import { History } from './history';
import { CommitInfoStore } from './CommitInfoStore';
import { RefreshLoop } from './RefreshLoop';
import { RefreshButton } from './RefreshButton';
import { MonitorSession } from './MonitorSession';
import {
  MonitorRepositories,
  MONITOR_REPOSITORIES_KEY,
  MONITOR_PUBLIC_REPOSITORIES_KEY,
  moveMonitorRepository,
} from './MonitorRepositories';
import { MonitorSetup } from './MonitorSetup';
import { MonitorControls } from './MonitorControls';
import { MonitorPane, MonitorStatus } from './MonitorPane';
import { useMonitorDetailsPosition } from './useMonitorDetailsPosition';
import { useRepositoryLocation } from './useRepositoryLocation';
import { repositoryLocationKey } from './repositoryLocation';
import { lowercaseRepoInput, parseRepo, type Commit } from './model';
import { RepositoryInput } from './RepositoryInput';
import {
  RecentRepositories,
  RECENT_REPOSITORIES_KEY,
} from './RecentRepositories';
import { BranchSelections, BRANCH_SELECTIONS_KEY } from './BranchSelections';
import type { RepositoryLocation } from './repositoryLocation';
import darkLogo from '../assets/logo.svg';
import lightLogo from '../assets/logo-light.svg';
import darkAnimatedLogo from '../assets/logo-animated.svg';
import lightAnimatedLogo from '../assets/logo-light-animated.svg';
import {
  readStoredToken,
  saveStoredToken,
  TOKEN_STORAGE_KEY,
} from './tokenStorage';
import { AccessTokenPanel } from './AccessTokenPanel';
import { ViewOptions } from './ViewOptions';
import { readViewOptions, saveViewOptions } from './viewOptions';
import { AppStatus } from './AppStatus';
import { OwnerRepositories } from './OwnerRepositories';
import { Analytics } from '@vercel/analytics/react';
import { analyticsBeforeSend } from './analytics';
import './style.css';
import './monitor.css';

const DEMO_REPO = 'han41858/commit-trail';

function App() {
  const { configuration, navigate } = useRepositoryLocation();
  const configurationKey = repositoryLocationKey(configuration);
  const lastMonitorSelection = useRef<readonly string[] | undefined>(undefined);
  const lastMonitorBranches = useRef(new Map<string, string>());
  const appliedLocation = useRef<RepositoryLocation | null>(null);
  const pickedLocation = useRef<string | null>(null);
  const [savedToken] = useState(readStoredToken);
  const [ownerRepositories] = useState(() => {
    const owners = new OwnerRepositories();
    owners.setToken(savedToken.token);
    return owners;
  });
  const authToken = useRef(savedToken.token);
  const [recent] = useState(
    () =>
      new RecentRepositories({
        allowPrivate: () => {
          const saved = readStoredToken();
          return (
            !!authToken.current &&
            !saved.error &&
            authToken.current === saved.token
          );
        },
      }),
  );
  const [branchSelections] = useState(
    () =>
      new BranchSelections({
        allowPrivate: () => {
          const saved = readStoredToken();
          return (
            !!authToken.current &&
            !saved.error &&
            authToken.current === saved.token
          );
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
          return (
            !!authToken.current &&
            !saved.error &&
            authToken.current === saved.token
          );
        },
        canWrite: () => {
          const saved = readStoredToken();
          return !saved.error && authToken.current === saved.token;
        },
      }),
  );
  const repositoryMetadata = (
    repository: string,
    isPrivate: boolean,
    visit: boolean,
  ) => {
    recent.repositoryMetadata(repository, isPrivate, visit);
    branchSelections.repositoryMetadata(repository, isPrivate);
    monitorRepositories.repositoryMetadata(repository, isPrivate);
  };
  const [history] = useState(
    () => new History(repositoryMetadata, branchSelections),
  );
  const [info] = useState(() => new CommitInfoStore());
  const extras = useSyncExternalStore(info.subscribe, info.getSnapshot);
  const [monitor] = useState(
    () =>
      new MonitorSession(history, info, repositoryMetadata, branchSelections),
  );
  const monitorState = useSyncExternalStore(
    monitor.subscribe,
    monitor.getSnapshot,
  );
  const reorderMonitor = useCallback(
    (repository: string, to: number) => {
      const current = monitor.getSnapshot();
      if (!current.active) return;
      const names = current.entries.map((entry) => entry.repository);
      const reordered = moveMonitorRepository(names, repository, to);
      if (reordered === names || !monitor.reorder(reordered)) return;
      const entries = new Map(
        current.entries.map((entry) => [entry.repository, entry]),
      );
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
      navigate(
        { mode: 'monitor', repositories: reordered, branches },
        { replace: true },
      );
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
          monitor.getSnapshot().active
            ? monitor.refreshAll(kind)
            : monitor.refreshPrimary(kind),
        () => !document.hidden && navigator.onLine,
      ),
  );
  const measured = useMeasuredOpen(history, info);
  const refreshState = useSyncExternalStore(loop.subscribe, loop.getSnapshot);
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot);
  const retrySeconds = useRetryCountdown(state.retryAt);
  const discoverySeconds = useRetryCountdown(state.discoveryRetryAt);
  const [input, setInput] = useState(configuration.repositories[0] || '');
  const [appliedToken, setAppliedToken] = useState(savedToken.token),
    [authRevision, setAuthRevision] = useState(0),
    [savedOptions] = useState(readViewOptions),
    [autoRefresh, setAutoRefresh] = useState(savedOptions.autoRefresh),
    [intervalChoice, setIntervalChoice] = useState<number | null>(
      savedOptions.interval,
    );
  const seconds =
    intervalChoice === 30 && !appliedToken
      ? 300
      : (intervalChoice ?? (appliedToken ? 60 : 300));
  const refreshRetrySeconds = useRetryCountdown(refreshState.retryAt || null);
  const [token, setToken] = useState(savedToken.token),
    [tokenStorageError, setTokenStorageError] = useState(savedToken.error),
    [tokenApplied, setTokenApplied] = useState(savedToken.token !== ''),
    [auth, setAuth] = useState(false),
    [theme, setTheme] = useState(savedOptions.theme),
    [options, setOptions] = useState(false);
  useEffect(() => {
    saveViewOptions({ theme, autoRefresh, interval: intervalChoice });
  }, [theme, autoRefresh, intervalChoice]);
  const [monitorSetup, setMonitorSetup] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  useEffect(() => {
    setErrorDismissed(false);
  }, [state.repo, state.error, state.retryAt]);
  const [systemTheme, setSystemTheme] = useState(() =>
    window.matchMedia('(prefers-color-scheme:light)').matches
      ? 'light'
      : 'dark',
  );
  const resolvedTheme = theme === 'system' ? systemTheme : theme;
  const logo = resolvedTheme === 'light' ? lightLogo : darkLogo;
  const animatedLogo =
    resolvedTheme === 'light' ? lightAnimatedLogo : darkAnimatedLogo;
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme:light)');
    const update = () => setSystemTheme(media.matches ? 'light' : 'dark');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        resolvedTheme === 'light' ? '#f2f6fc' : '#070a11',
      );
  }, [resolvedTheme]);
  const appRef = useRef<HTMLDivElement>(null);
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
      // A popup that this Escape just closed has already claimed the key.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        leaveMonitor();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [leaveMonitor, monitorState.active]);
  const wasMonitoring = useRef(false);
  useEffect(() => {
    if (wasMonitoring.current && !monitorState.active)
      monitorButtonRef.current?.focus();
    wasMonitoring.current = monitorState.active;
  }, [monitorState.active]);
  const primaryEntry = monitorState.entries.find((entry) => entry.primary);
  const primaryOrder = primaryEntry
    ? monitorState.entries.indexOf(primaryEntry)
    : 0;
  const primaryActive = !monitorState.active || !!primaryEntry;
  const monitorScope = monitorState.entries
    .map((entry) => entry.repository)
    .sort()
    .join('|');
  const monitorLimited = monitorState.retryAt > Date.now();
  const [topInset, setTopInset] = useState(
    window.innerWidth <= 800 ? 136 : 108,
  );
  useLayoutEffect(() => {
    const el = toolbarRef.current!;
    const update = () => {
      if (el.offsetHeight)
        setTopInset(Math.ceil(el.getBoundingClientRect().bottom) + 20);
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
  const [selection, setSelection] = useState<{
    repository: string;
    commit: Commit;
  } | null>(null);
  const selected =
    selection?.repository === state.repo ? selection.commit : null;
  const selectCommit = useCallback(
    (repository: string, commit: Commit) =>
      setSelection({ repository, commit }),
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
      !state.busy &&
      (!state.meta || (extras.repo === state.repo && !extras.busy));
    // Child layout effects can accept more visible history before this effect runs.
    const monitorSettled = monitor.getSnapshot().settled;
    if (monitorState.active ? monitorSettled : state.meta && primarySettled)
      loop.loaded();
  }, [
    loop,
    monitor,
    state.meta,
    state.busy,
    extras,
    monitorState.active,
    monitorState.settled,
  ]);
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
        // A token changed in another tab. Never restore that tab's private list
        // with this tab's previously applied credential; require an explicit apply.
        ownerRepositories.close();
        ownerRepositories.setToken('');
        lastMonitorSelection.current = undefined;
        leaveMonitor();
        lastMonitorBranches.current.clear();
        setMonitorSetup(false);
      }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [
    recent,
    branchSelections,
    monitorRepositories,
    leaveMonitor,
    ownerRepositories,
  ]);
  useEffect(
    () => () => {
      measured.cancel();
      ownerRepositories.close();
      monitor.stop();
      history.clear();
      info.cancel();
    },
    [history, info, monitor, ownerRepositories],
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
      !!previous &&
      previous.branches?.[previousIndex] !==
        configuration.branches?.[currentIndex];
    if (configuration.mode === 'monitor' && repository) {
      setSelection((chosen) =>
        chosen && configuration.repositories.includes(chosen.repository)
          ? chosen
          : null,
      );
      lastMonitorSelection.current = [...configuration.repositories];
      const session = monitor.getSnapshot();
      const sameBranches = configuration.repositories.every((name, index) => {
        const entry = session.entries.find(
          (entry) => entry.repository === name,
        );
        if (!entry) return false;
        const requested = configuration.branches?.[index];
        const priorIndex = previous?.repositories.indexOf(name) ?? -1;
        if (requested === previous?.branches?.[priorIndex]) return true;
        const state = entry.history.getSnapshot();
        return !!state.meta && !!state.baseHead && requested === state.base;
      });
      if (
        session.active &&
        sameBranches &&
        monitor.reorder(configuration.repositories)
      )
        return;
      if (!current.repo) {
        setInput(repository);
        setSelection(null);
        void measured.open(
          repository,
          authToken.current,
          configuration.branches?.[0],
        );
      }
      if (changedBranch) setSelection(null);
      monitor.start(
        configuration.repositories,
        authToken.current,
        configuration.branches,
        changedBranch,
      );
    } else {
      setSelection((chosen) =>
        chosen?.repository === repository ? chosen : null,
      );
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
        void measured.open(
          repository,
          authToken.current,
          configuration.branches?.[0],
        );
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
      if (
        target instanceof Element &&
        target.closest('[data-debug-ui],[data-pwa-ui]')
      )
        return;
      if (options && !optionsRef.current?.contains(target)) setOptions(false);
      if (
        auth &&
        !authRef.current?.contains(target) &&
        !tokenButtonRef.current?.contains(target)
      )
        setAuth(false);
      if (
        selection &&
        !(
          target instanceof Element &&
          target.closest(
            '.details,.graph-scroll,.monitor-exit,.monitor-reorder-handle',
          )
        )
      )
        setSelection(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Close the open popup first; Split view handles the next Escape.
        event.preventDefault();
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
    ownerRepositories.setToken(value);
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
        configuration.branches?.[
          configuration.repositories.indexOf(state.repo)
        ],
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
    ownerRepositories.setToken('');
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
    const target = {
      mode: 'single' as const,
      repositories: [state.repo],
      branches: [name],
    };
    pickedLocation.current = repositoryLocationKey(target);
    navigate(target);
  }
  const shareBranches = new Map(lastMonitorBranches.current);
  for (const entry of monitorState.entries) {
    const value = entry.history.getSnapshot();
    if (value.meta && value.baseHead)
      shareBranches.set(entry.repository, value.base);
    else shareBranches.delete(entry.repository);
  }
  if (state.meta && state.baseHead) shareBranches.set(state.repo, state.base);
  else shareBranches.delete(state.repo);
  return (
    <div
      ref={appRef}
      className={`app${monitorState.active ? ' app-monitor' : ''}`}
      data-theme={resolvedTheme}
      style={
        { '--toolbar-bottom': `${topInset - 20}px` } as React.CSSProperties
      }
    >
      {monitorState.active && (
        <MonitorControls
          monitorState={monitorState}
          refreshState={refreshState}
          seconds={seconds}
          autoRefresh={autoRefresh}
          limited={monitorLimited}
          onRefresh={() => void loop.refresh()}
          onReorder={reorderMonitor}
          onExit={leaveMonitor}
        />
      )}
      <main
        className={`graph-stage${monitorState.active ? ' monitor-stage' : ''}`}
        aria-label={monitorState.active ? 'Repository monitor' : undefined}
      >
        <section
          className={
            monitorState.active ? 'monitor-column' : 'single-repository'
          }
          ref={primaryPaneRef}
          hidden={!primaryActive}
          style={{ order: primaryOrder }}
          aria-label={
            monitorState.active ? `Repository ${state.repo}` : undefined
          }
        >
          {state.commits.length > 0 ? (
            <Graph
              active={primaryActive}
              containerResponsive={monitorState.active}
              columnOrder={primaryOrder}
              label={
                monitorState.active
                  ? `Commit graph for ${state.repo}`
                  : undefined
              }
              key={`${state.repo}:${state.base}:${reverse}`}
              theme={resolvedTheme}
              commits={state.commits}
              branches={state.branches}
              branch={state.base}
              reverse={reverse}
              selected={selected?.sha || ''}
              onSelect={select}
              onClearSelection={clearSelection}
              hasMore={state.more && !state.error && !monitorLimited}
              onLoadMore={(sources) => {
                if (monitor.canRequest()) void history.loadMore(sources);
              }}
              frontiers={state.frontiers}
              pendingSources={state.pendingSources}
              topInset={monitorState.active ? 34 : topInset}
              refreshVersion={state.refreshVersion}
              baseHead={state.baseHead}
              defaultBranch={state.meta?.default_branch}
              info={extras.bySha}
              onVisible={(shas) => {
                if (primaryActive && monitor.canRequest()) info.watch(shas);
              }}
            />
          ) : monitorState.active ? (
            <div className="monitor-empty" role="status">
              {state.busy
                ? 'Loading…'
                : state.error
                  ? 'Repository unavailable'
                  : 'No commits'}
            </div>
          ) : (
            <div className="empty">
              <picture>
                <source
                  media="(prefers-reduced-motion: reduce)"
                  srcSet={logo}
                />
                <img
                  className="empty-mark"
                  src={animatedLogo}
                  alt=""
                  width="160"
                  height="160"
                />
              </picture>
              <h1>
                {state.busy ? 'Loading...' : 'Watch your Git history unfold.'}
              </h1>
              {!state.busy && (
                <p>Choose a repository. Explore its branches as they evolve.</p>
              )}
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
              refreshing={
                !!primaryEntry && monitorState.running.has(primaryEntry)
              }
              limited={monitorLimited}
              anonymous={!appliedToken}
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
                anonymous={!appliedToken}
                selected={
                  selection?.repository === entry.repository
                    ? selection.commit
                    : null
                }
                onSelect={selectCommit}
                onClose={clearSelection}
              />
            ),
          )}
      </main>
      <header className="topbar" ref={toolbarRef}>
        <a className="brand" href="./" aria-label="Commit Trail home">
          <img src={logo} alt="" width="36" height="36" /> Commit Trail
        </a>
        <RepositoryInput
          value={input}
          current={state.meta ? state.repo : ''}
          onChange={setInput}
          onOpen={open}
          onRecent={openRecent}
          recent={recent}
          owners={ownerRepositories}
          popupOpen={auth || options || details || monitorSetup}
        />
        <div className="view-controls">
          <div className="base-control">
            <BranchPicker
              history={history}
              state={state}
              onPicked={pickedBranch}
            />
          </div>
          <button
            className="direction-toggle"
            aria-label={
              reverse
                ? 'Oldest first; newer commits below'
                : 'Newest first; older commits below'
            }
            title={
              reverse
                ? 'Oldest first; newer commits below'
                : 'Newest first; older commits below'
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
            aria-label={
              tokenApplied ? 'Access token (applied)' : 'Access token'
            }
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
          <ViewOptions
            panelRef={optionsRef}
            open={options}
            theme={theme}
            autoRefresh={autoRefresh}
            seconds={seconds}
            hasToken={!!appliedToken}
            onOpenChange={setOptions}
            onThemeChange={setTheme}
            onAutoRefreshChange={setAutoRefresh}
            onIntervalChange={setIntervalChoice}
          />
        </div>
      </header>
      {auth && (
        <AccessTokenPanel
          panelRef={authRef}
          repository={state.repo}
          appliedToken={appliedToken}
          token={token}
          revision={authRevision}
          storageError={tokenStorageError}
          onTokenChange={setToken}
          onApply={applyToken}
          onRemove={removeToken}
          onClose={() => setAuth(false)}
          onCreate={() => {
            setErrorDismissed(true);
            setAuth(false);
          }}
        />
      )}
      {state.error && !errorDismissed && !auth && !monitorState.active && (
        <div className="error floating-panel" role="alert">
          <span className="error-message">{state.error}</span>
          <div className="error-actions">
            <button
              disabled={state.busy || retrySeconds > 0}
              onClick={() => void history.retry()}
            >
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
          owners={ownerRepositories}
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
              branches: repositories.map((repository) =>
                shareBranches.get(repository),
              ),
            });
          }}
        />
      )}
      <AppNotices>
        <DebugRoot developer={import.meta.env.DEV} panelHost={appRef} />
        <PwaUpdatePrompt />
      </AppNotices>
      <AppStatus
        state={state}
        extras={extras}
        refreshState={refreshState}
        discoverySeconds={discoverySeconds}
        refreshRetrySeconds={refreshRetrySeconds}
        anonymous={!appliedToken}
        onRetryDiscovery={() => void history.retryDiscovery()}
      />
      <Analytics beforeSend={analyticsBeforeSend} />
    </div>
  );
}
debug.setMode(
  new URLSearchParams(location.search).get('debug') === '1' ? 'button' : 'off',
);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerPwa();
