import { GitHubError } from './api';
import { GitHubReader } from './GitHubReader';
import { parseRepo } from './model';

export type OwnerRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  pushed_at: string | null;
  owner: { login: string };
};
export type OwnerRepositorySource = {
  busy: boolean;
  error: string;
  retryAt: number | null;
  more: boolean;
};
export type OwnerRepositoriesSnapshot = {
  owner: string;
  repositories: readonly OwnerRepository[];
  busy: boolean;
  public: OwnerRepositorySource;
  authenticated: OwnerRepositorySource & { enabled: boolean };
};

type SourceName = 'public' | 'authenticated';
type CachedSource = {
  repositories: readonly OwnerRepository[];
  page: number;
  more: boolean;
  expiresAt: number;
};
type Source = CachedSource & OwnerRepositorySource & { reader: GitHubReader };
type Session = {
  owner: string;
  public: Source;
  authenticated: Source | null;
  repositories: readonly OwnerRepository[];
  loading: boolean;
};
type CachedOwner = Partial<Record<SourceName, CachedSource>>;
const CACHE_LIFETIME = 60_000;
const CACHE_LIMIT = 10;
const sourceState = (): OwnerRepositorySource => ({
  busy: false,
  error: '',
  retryAt: null,
  more: false,
});
const empty = (authenticated: boolean): OwnerRepositoriesSnapshot => ({
  owner: '',
  repositories: [],
  busy: false,
  public: sourceState(),
  authenticated: { ...sourceState(), enabled: authenticated },
});

// Only owner-matched records from the actual response can enter the list or cache.
function repositoriesForOwner(data: unknown, owner: string, publicOnly: boolean) {
  if (!Array.isArray(data)) throw new Error('Invalid repository list.');
  const repositories: OwnerRepository[] = [];
  for (const value of data) {
    if (
      !value ||
      !Number.isSafeInteger(value.id) ||
      value.id <= 0 ||
      typeof value.name !== 'string' ||
      typeof value.full_name !== 'string' ||
      typeof value.owner?.login !== 'string' ||
      value.owner.login.toLowerCase() !== owner ||
      typeof value.private !== 'boolean' ||
      (publicOnly && value.private)
    )
      continue;
    const fullName = `${value.owner.login}/${value.name}`;
    try {
      if (
        parseRepo(fullName) !== fullName ||
        value.full_name.toLowerCase() !== fullName.toLowerCase()
      )
        continue;
    } catch {
      continue;
    }
    repositories.push({
      id: value.id,
      name: value.name,
      full_name: value.full_name,
      private: value.private,
      description: typeof value.description === 'string' ? value.description : null,
      pushed_at: typeof value.pushed_at === 'string' ? value.pushed_at : null,
      owner: { login: value.owner.login },
    });
  }
  return repositories;
}

function mergedRepositories(session: Session) {
  const repositories = new Map<number, OwnerRepository>();
  for (const repository of [
    ...session.public.repositories,
    ...(session.authenticated?.repositories || []),
  ])
    repositories.set(repository.id, repository);
  return [...repositories.values()].sort((a, b) => {
    const aName = a.name.toLowerCase(),
      bName = b.name.toLowerCase();
    return (aName < bName ? -1 : aName > bName ? 1 : 0) || a.id - b.id;
  });
}

// App-lifetime memory only. A token change discards every authenticated result;
// closing cancels in-flight work without losing fresh completed source pages.
export class OwnerRepositories {
  private token = '';
  private session: Session | null = null;
  private snapshot = empty(false);
  private listeners = new Set<() => void>();
  private cache = new Map<string, CachedOwner>();
  private retryAt = { public: 0, authenticated: 0 };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;

  setToken(token: string) {
    if (token === this.token) return;
    this.token = token;
    this.cache.clear();
    this.retryAt.authenticated = 0;
    this.close();
  }

  close = () => {
    const session = this.session;
    this.session = null;
    session?.public.reader.cancel();
    session?.authenticated?.reader.cancel();
    this.snapshot = empty(!!this.token);
    this.notify();
  };

  async open(value: string) {
    const owner = value.trim().toLowerCase();
    if (owner === this.session?.owner && this.snapshot.busy) return;
    this.close();
    if (!owner) return;
    const cached = this.cache.get(owner);
    const source = (name: SourceName): Source => {
      const old = cached?.[name];
      const fresh = old && old.expiresAt > Date.now() ? old : undefined;
      const reader = new GitHubReader(name === 'public' ? '' : this.token);
      reader.retryAt = this.retryAt[name];
      return {
        repositories: [],
        page: 0,
        expiresAt: 0,
        ...sourceState(),
        ...fresh,
        reader,
      };
    };
    const session: Session = {
      owner,
      public: source('public'),
      authenticated: this.token ? source('authenticated') : null,
      repositories: [],
      loading: false,
    };
    this.session = session;
    if (cached) {
      this.cache.delete(owner);
      this.cache.set(owner, cached);
    }
    const missing = (['public', 'authenticated'] as const).filter(
      (name) => session[name]?.page === 0,
    );
    if (missing.length) await this.loadBatch(session, missing);
    else {
      session.repositories = mergedRepositories(session);
      this.publish(session);
    }
  }

  async loadMore() {
    const session = this.session;
    if (!session) return;
    await this.loadBatch(
      session,
      (['public', 'authenticated'] as const).filter((name) => {
        const source = session[name];
        return source && (source.more || !!source.error) &&
          (source.retryAt === null || source.retryAt <= Date.now());
      }),
    );
  }

  private async loadBatch(session: Session, names: readonly SourceName[]) {
    if (session !== this.session || session.loading || !names.length) return;
    session.loading = true;
    this.publish(session);
    try {
      await Promise.all(names.map((name) => this.load(session, name)));
    } finally {
      if (session === this.session) {
        // Keep the previous rows stable while public and authenticated pages load.
        // A completed action exposes their combined result in one list update.
        session.repositories = mergedRepositories(session);
        session.loading = false;
        this.publish(session);
      }
    }
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private publish(session: Session) {
    if (session !== this.session) return;
    const state = (source: Source | null) =>
      source
        ? {
            busy: source.busy,
            error: source.error,
            retryAt: source.retryAt,
            more: source.more,
          }
        : sourceState();
    this.snapshot = {
      owner: session.owner,
      repositories: session.repositories,
      busy: session.loading,
      public: state(session.public),
      authenticated: { ...state(session.authenticated), enabled: !!session.authenticated },
    };
    this.notify();
  }

  private async load(session: Session, name: SourceName) {
    const source = session[name];
    if (
      session !== this.session ||
      !source ||
      source.busy ||
      (source.retryAt !== null && source.retryAt > Date.now())
    )
      return;
    source.busy = true;
    source.error = '';
    source.retryAt = null;
    this.publish(session);
    const page = source.page + 1;
    const path =
      name === 'public'
        ? `/users/${encodeURIComponent(session.owner)}/repos?type=owner&sort=full_name&direction=asc&per_page=100&page=${page}`
        : `/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc&per_page=100&page=${page}`;
    try {
      const result = await source.reader.get<unknown>(path);
      if (session !== this.session) return;
      const repositories = repositoriesForOwner(result.data, session.owner, name === 'public');
      const merged = new Map(source.repositories.map((repository) => [repository.id, repository]));
      for (const repository of repositories) merged.set(repository.id, repository);
      source.repositories = [...merged.values()];
      source.page = page;
      source.more = Array.isArray(result.data) && result.data.length >= 100 && result.next;
      if (page === 1) source.expiresAt = Date.now() + CACHE_LIFETIME;
      const cached = this.cache.get(session.owner) || {};
      cached[name] = {
        repositories: source.repositories,
        page: source.page,
        more: source.more,
        expiresAt: source.expiresAt,
      };
      this.cache.delete(session.owner);
      this.cache.set(session.owner, cached);
      while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    } catch (error) {
      if (session !== this.session || source.reader.controller.signal.aborted) return;
      source.error =
        error instanceof GitHubError
          ? name === 'public' && error.status === 404
            ? 'GitHub owner not found. Check the owner name and retry.'
            : error.message
          : error instanceof Error && error.message.startsWith('Could not reach GitHub.')
            ? error.message
            : 'Could not load repositories. Please retry.';
      source.retryAt = error instanceof GitHubError ? error.retryAt || null : null;
      this.retryAt[name] = Math.max(this.retryAt[name], source.retryAt || 0);
    } finally {
      if (session === this.session) {
        source.busy = false;
        this.publish(session);
      }
    }
  }
}
